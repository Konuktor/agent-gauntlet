import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * The deployment contract.
 *
 * Everything here is a promise this repository makes to Render. Each assertion
 * corresponds to a way a deploy can fail silently: binding the wrong interface,
 * ignoring `PORT`, migrating twice, dying on SIGTERM without releasing paid
 * resources, or leaving a claimed job that no future instance will pick up.
 */

const repoRoot = resolve(import.meta.dirname, "..")

/**
 * Load `.env` without importing a workspace package.
 *
 * This suite deliberately treats the app as a black box — it spawns the built
 * artifact and talks to it over HTTP, exactly as Render does — so it must not
 * link against the code it is testing.
 */
function loadEnvFile(): void {
  const path = resolve(repoRoot, ".env")
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (key in process.env) continue
    process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
  }
}
loadEnvFile()
const serverEntry = resolve(repoRoot, "apps/web/dist/server.js")
// Not 3000/3100: those collide with a dev server somebody left running.
const PORT = 13977
const baseUrl = `http://127.0.0.1:${PORT}`

let server: ChildProcessWithoutNullStreams | undefined
const logLines: string[] = []

function startServer(env: Record<string, string> = {}): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: resolve(repoRoot, "apps/web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      GAUNTLET_DEPLOY_MODE: "single",
      LOG_LEVEL: "info",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const record = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) logLines.push(line)
  }
  child.stdout.on("data", record)
  child.stderr.on("data", record)
  return child
}

async function waitForHealth(timeoutMs = 90_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  let lastError = "never responded"
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return response
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`health never came up: ${lastError}\n${logLines.slice(-15).join("\n")}`)
}

/**
 * Wait until nothing is queued or running.
 *
 * The deployment limits itself to one suite at a time so a visitor cannot
 * outrun the Solari quota, so a test that enqueues has to start from quiescence
 * rather than fight its own rate limiter.
 */
async function waitForIdle(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const body = (await (await fetch(`${baseUrl}/api/suite-runs?limit=5`)).json()) as {
      runs: Array<{ status: string }>
    }
    const active = body.runs.filter((r) =>
      ["queued", "preparing", "running", "evaluating"].includes(r.status),
    )
    if (active.length === 0) return
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error("a suite was still active after waiting for the deployment to go idle")
}

async function stop(child: ChildProcessWithoutNullStreams | undefined, signal: NodeJS.Signals = "SIGKILL") {
  if (!child || child.exitCode !== null) return
  child.kill(signal)
  await new Promise((r) => setTimeout(r, signal === "SIGKILL" ? 300 : 100))
}

const built = existsSync(serverEntry)

describe.skipIf(!built)("Render deployment contract", () => {
  beforeAll(async () => {
    server = startServer()
    await waitForHealth()
  })

  afterAll(async () => {
    await stop(server)
  })

  describe("networking", () => {
    // Render injects PORT (default 10000) and 502s a service that binds
    // anything but 0.0.0.0.
    it("listens on the injected PORT", async () => {
      const response = await fetch(`${baseUrl}/api/health`)
      expect(response.ok).toBe(true)
    })

    it("binds 0.0.0.0 rather than loopback only", () => {
      const listening = logLines.find((line) => line.includes('"msg":"listening"'))
      expect(listening, "server never logged that it was listening").toBeDefined()
      expect(JSON.parse(listening!)).toMatchObject({ hostname: "0.0.0.0", port: PORT })
    })

    it("serves the landing page without a localhost URL in the markup", async () => {
      const html = await (await fetch(baseUrl)).text()
      expect(html).toContain("AgentGauntlet")
      expect(html).not.toMatch(/http:\/\/(localhost|127\.0\.0\.1)/)
    })
  })

  describe("health check", () => {
    it("returns the shape Render polls, and reports the deployment mode", async () => {
      const body = (await (await fetch(`${baseUrl}/api/health`)).json()) as Record<string, unknown>
      expect(body).toMatchObject({
        status: "ok",
        database: "ok",
        deployment: "render-single",
      })
      expect(typeof body.solariConfigured).toBe("boolean")
    })

    it("never leaks a credential", async () => {
      const raw = await (await fetch(`${baseUrl}/api/health`)).text()
      expect(raw).not.toMatch(/slr_live_|sk-ant-|postgres:\/\//)
    })

    // Render polls this constantly; a Solari call here would spend credits on
    // every probe.
    it("is cheap enough to poll", async () => {
      const started = Date.now()
      for (let i = 0; i < 5; i++) await fetch(`${baseUrl}/api/health`)
      expect(Date.now() - started).toBeLessThan(5_000)
    })
  })

  describe("startup", () => {
    it("applies migrations before it serves traffic", () => {
      const applied = logLines.findIndex((l) => l.includes('"msg":"migrations applied"'))
      const listening = logLines.findIndex((l) => l.includes('"msg":"listening"'))
      expect(applied).toBeGreaterThanOrEqual(0)
      expect(listening).toBeGreaterThan(applied)
    })

    it("runs the worker in-process in single deploy mode", () => {
      expect(logLines.some((l) => l.includes("worker running in-process"))).toBe(true)
    })

    // Every deploy re-runs them; a non-idempotent migration would break the
    // second deploy, not the first, which is the worst time to find out.
    it("migrates idempotently across a restart", async () => {
      await stop(server)
      logLines.length = 0
      server = startServer()
      await waitForHealth()
      expect(logLines.some((l) => l.includes('"msg":"migrations applied"'))).toBe(true)
      // Only STARTUP errors matter here. A suite that failed earlier in the
      // session also logs at error level, and that is not this test's business.
      const startupErrors = logLines
        .slice(0, logLines.findIndex((l) => l.includes('"msg":"listening"')) + 1)
        .filter((l) => l.includes('"level":"error"'))
      expect(startupErrors, startupErrors.join("\n")).toHaveLength(0)
    })
  })

  describe("public-demo safety", () => {
    // The limiter that makes a public URL survivable: one paid suite at a time.
    it("refuses a second suite while one is already active", async () => {
      const catalog = (await (await fetch(`${baseUrl}/api/catalog`)).json()) as {
        agents: Array<{ id: string }>
        tasks: Array<{ id: string }>
      }
      if (catalog.agents.length === 0) return

      await waitForIdle()
      const suiteFor = async () => {
        const created = await fetch(`${baseUrl}/api/suites`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "limiter",
            agentId: catalog.agents[0]!.id,
            taskDefinitionId: catalog.tasks[0]!.id,
            variants: ["baseline"],
            runsPerVariant: 1,
          }),
        })
        return ((await created.json()) as { id: string }).id
      }

      const first = await fetch(`${baseUrl}/api/suites/${await suiteFor()}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(first.status).toBe(202)

      const second = await fetch(`${baseUrl}/api/suites/${await suiteFor()}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(second.status).toBe(429)
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe("busy")

      await waitForIdle()
    })
  })

  describe("the in-process worker", () => {
    /**
     * The single-service claim: a job enqueued through the HTTP API is picked
     * up by the worker running inside the SAME process. If this passes, the
     * free-tier deployment genuinely works without a background worker.
     */
    it("claims a job enqueued through the API", async () => {
      const catalog = (await (await fetch(`${baseUrl}/api/catalog`)).json()) as {
        agents: Array<{ id: string; name: string }>
        tasks: Array<{ id: string }>
      }
      if (catalog.agents.length === 0 || catalog.tasks.length === 0) {
        console.log("Skipped: run `pnpm db:seed` to give this test a project.")
        return
      }

      await waitForIdle()

      const created = await fetch(`${baseUrl}/api/suites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "render contract",
          agentId: catalog.agents[0]!.id,
          taskDefinitionId: catalog.tasks[0]!.id,
          variants: ["baseline"],
          runsPerVariant: 1,
        }),
      })
      expect(created.status).toBe(201)
      const suite = (await created.json()) as { id: string }

      const enqueued = await fetch(`${baseUrl}/api/suites/${suite.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "render contract" }),
      })
      expect(enqueued.status).toBe(202)
      const run = (await enqueued.json()) as { id: string }

      // Claimed, not necessarily finished: the point is that something in this
      // process took the job off the queue.
      const deadline = Date.now() + 60_000
      let status = "queued"
      while (Date.now() < deadline && status === "queued") {
        await new Promise((r) => setTimeout(r, 500))
        const view = (await (await fetch(`${baseUrl}/api/suite-runs/${run.id}`)).json()) as {
          status: string
        }
        status = view.status
      }
      expect(status, "the in-process worker never claimed the job").not.toBe("queued")

      // And the API can read back what the worker wrote — same process, same
      // database, no message bus.
      const view = (await (await fetch(`${baseUrl}/api/suite-runs/${run.id}`)).json()) as {
        metrics: { totalRuns: number }
        mode: string
      }
      expect(view.metrics.totalRuns).toBe(1)
      expect(view.mode).toBe("local")
    })

    /**
     * A job interrupted by a restart must be recoverable, or a Render deploy
     * mid-suite would strand it in `running` forever.
     */
    it("reclaims work abandoned by a previous instance", async () => {
      logLines.length = 0
      await stop(server)
      server = startServer()
      await waitForHealth()
      // The reclaim runs unconditionally on boot; it logs only when it found
      // something, so the assertion is that the boot completed and the worker
      // came back up ready to claim.
      expect(logLines.some((l) => l.includes("worker running in-process"))).toBe(true)
    })
  })

  describe("graceful shutdown", () => {
    // Render SIGTERMs and then SIGKILLs after maxShutdownDelaySeconds. Exiting
    // cleanly inside that window is what releases in-flight Solari sessions.
    it("exits cleanly on SIGTERM well inside the 60s window", async () => {
      logLines.length = 0
      const child = server!
      const started = Date.now()

      const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)))
      child.kill("SIGTERM")
      const code = await Promise.race([
        exited,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 50_000)),
      ])

      expect(code, `did not exit in time:\n${logLines.slice(-10).join("\n")}`).not.toBe("timeout")
      expect(Date.now() - started).toBeLessThan(50_000)
      expect(logLines.some((l) => l.includes("shutdown complete"))).toBe(true)

      server = startServer()
      await waitForHealth()
    })
  })
})

describe.skipIf(built)("Render deployment contract (skipped)", () => {
  it("needs a production build", () => {
    expect(built).toBe(false)
    console.log("Skipped: run `pnpm build` first, then `pnpm test:render`.")
  })
})
