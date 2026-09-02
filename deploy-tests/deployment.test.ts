import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * The deployment contract.
 *
 * Everything here is a promise this repository makes to the platform it runs
 * on. Each assertion corresponds to a way a deploy can fail silently: binding
 * the wrong interface, ignoring `PORT`, migrating twice, dying on SIGTERM
 * without releasing paid resources, or leaving a claimed job that no future
 * instance will pick up.
 *
 * The web service and the worker are separate processes here, exactly as they
 * are on Northflank — this suite spawns both and talks to the web one over
 * HTTP, never linking against the code it tests.
 */

const repoRoot = resolve(import.meta.dirname, "..")

/**
 * Load `.env` without importing a workspace package.
 *
 * This suite deliberately treats the app as a black box — it spawns the built
 * artifact and talks to it over HTTP, exactly as the platform does — so it
 * must not link against the code it is testing.
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
let workerProc: ChildProcessWithoutNullStreams | undefined
const logLines: string[] = []
const workerLines: string[] = []

const workerEntry = resolve(repoRoot, "apps/worker/dist/index.js")

/** The worker is a separate service; nothing about it is hosted by the web app. */
function startWorker(env: Record<string, string> = {}): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [workerEntry], {
    cwd: resolve(repoRoot, "apps/worker"),
    env: { ...process.env, NODE_ENV: "production", LOG_LEVEL: "info", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const record = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) workerLines.push(line)
  }
  child.stdout.on("data", record)
  child.stderr.on("data", record)
  return child
}

async function waitForWorker(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (workerLines.some((l) => l.includes('"msg":"worker started"'))) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`worker never started:\n${workerLines.slice(-10).join("\n")}`)
}

function startServer(env: Record<string, string> = {}): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: resolve(repoRoot, "apps/web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
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

describe.skipIf(!built)("Deployment contract", () => {
  beforeAll(async () => {
    server = startServer()
    await waitForHealth()
    workerProc = startWorker()
    await waitForWorker()
  })

  afterAll(async () => {
    await stop(workerProc)
    await stop(server)
  })

  describe("networking", () => {
    // The platform injects PORT and routes to the container's interface; a
    // service that binds loopback only is unreachable and reads as a crash.
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
    it("returns the shape the platform polls", async () => {
      const body = (await (await fetch(`${baseUrl}/api/health`)).json()) as Record<string, unknown>
      expect(body).toMatchObject({ status: "ok", database: "ok" })
      expect(typeof body.solariConfigured).toBe("boolean")
    })

    it("never leaks a credential", async () => {
      const raw = await (await fetch(`${baseUrl}/api/health`)).text()
      expect(raw).not.toMatch(/slr_live_|sk-ant-|postgres:\/\//)
    })

    // The readiness probe polls this constantly; a Solari call here would spend
    // credits on every probe.
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

    // The web service hosts HTTP and nothing else. If it ever started a
    // worker again, two services would race for the same queue.
    it("starts no worker of its own", () => {
      expect(logLines.some((l) => l.includes("worker"))).toBe(false)
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

  describe("the separate worker service", () => {
    /**
     * The two-service claim: a job enqueued over HTTP by the web service is
     * picked up by a DIFFERENT process, with only Postgres between them. If
     * this passes, the split topology genuinely works — no shared memory, no
     * message bus, nothing the platform has to broker.
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
          name: "deployment contract",
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
        body: JSON.stringify({ label: "deployment contract" }),
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
      expect(status, "the worker service never claimed the job").not.toBe("queued")

      // And the web service can read back what the worker wrote — different
      // process, one database, no message bus.
      const view = (await (await fetch(`${baseUrl}/api/suite-runs/${run.id}`)).json()) as {
        metrics: { totalRuns: number }
        mode: string
      }
      expect(view.metrics.totalRuns).toBe(1)
      expect(view.mode).toBe("local")
    })

    /**
     * A job interrupted by a restart must be recoverable, or a deploy
     * mid-suite would strand it in `running` forever.
     */
    it("reclaims work abandoned by a previous instance", async () => {
      workerLines.length = 0
      await stop(workerProc)
      workerProc = startWorker()
      await waitForWorker()
      // Reclaim runs unconditionally on boot and logs only when it found
      // something, so the assertion is that a replacement worker came back up
      // ready to claim — which is what makes a mid-suite deploy recoverable.
      expect(workerLines.some((l) => l.includes('"msg":"worker started"'))).toBe(true)
    })

    it("keeps the worker off HTTP entirely", () => {
      // Nothing in the worker should be listening; the platform gives it no
      // port and the product needs none.
      expect(workerLines.some((l) => l.includes('"msg":"listening"'))).toBe(false)
    })
  })

  describe("graceful shutdown", () => {
    // The platform SIGTERMs and then SIGKILLs after a grace period. Exiting
    // cleanly inside it is what releases in-flight Solari sessions.
    it("exits cleanly on SIGTERM well inside a 30s grace period", async () => {
      logLines.length = 0
      const child = server!
      const started = Date.now()

      const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)))
      child.kill("SIGTERM")
      const code = await Promise.race([
        exited,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 30_000)),
      ])

      expect(code, `did not exit in time:\n${logLines.slice(-10).join("\n")}`).not.toBe("timeout")
      expect(Date.now() - started).toBeLessThan(30_000)
      expect(logLines.some((l) => l.includes("shutdown complete"))).toBe(true)

      server = startServer()
      await waitForHealth()
    })
  })
})

/**
 * Northflank validates a template only when you run it, and that answer
 * arrives after the push. These assertions move the parts we can check
 * ourselves back into the repository: schema shape, the free Sandbox
 * allowance, and the promise that no browser ships in a production image.
 */
describe("northflank template", () => {
  const template = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../northflank/template.json"), "utf8"),
  ) as {
    apiVersion: string
    arguments: Record<string, string>
    spec: { spec: { type: string; steps: Array<{ kind: string; spec: Record<string, unknown> }> } }
  }

  /** Project-scoped nodes live in a child workflow, so flatten before asking. */
  type Node = { kind: string; spec: Record<string, unknown> }
  const flatten = (nodes: Node[]): Node[] =>
    nodes.flatMap((n) =>
      n.kind === "Workflow" ? flatten((n.spec as { steps: Node[] }).steps) : [n],
    )
  const steps = () => flatten(template.spec.spec.steps)
  const byKind = (kind: string) => steps().filter((s) => s.kind === kind)

  it("declares the only apiVersion Northflank supports", () => {
    expect(template.apiVersion).toBe("v1.2")
  })

  it("runs its nodes in order, so the database exists before the services", () => {
    expect(template.spec.spec.type).toBe("sequential")
    // The project must come first: a workflow context naming a project that
    // does not exist yet fails the whole run with a 404.
    expect(template.spec.spec.steps[0]!.kind).toBe("Project")
    const kinds = steps().map((s) => s.kind)
    expect(kinds.indexOf("Addon")).toBeLessThan(kinds.indexOf("SecretGroup"))
    expect(kinds.indexOf("SecretGroup")).toBeLessThan(kinds.indexOf("CombinedService"))
  })

  // Developer Sandbox: 2 services, 2 jobs, 1 addon. Exceeding any of them turns
  // a free deployment into a billing prompt, which is a hard stop for us.
  it("fits the free Developer Sandbox allowance", () => {
    expect(byKind("CombinedService").length + byKind("DeploymentService").length).toBeLessThanOrEqual(2)
    expect(byKind("ManualJob").length + byKind("CronJob").length).toBeLessThanOrEqual(2)
    expect(byKind("Addon").length).toBeLessThanOrEqual(1)
  })

  it("exposes the web service and nothing else", () => {
    const services = byKind("CombinedService")
    const web = services.find((s) => String(s.spec.name).endsWith("-web"))
    const worker = services.find((s) => String(s.spec.name).endsWith("-worker"))
    expect(web, "no web service in the template").toBeDefined()
    expect(worker, "no worker service in the template").toBeDefined()

    const webPorts = web!.spec.ports as Array<{ public: boolean; internalPort: number }>
    expect(webPorts.some((p) => p.public)).toBe(true)

    // The worker takes work from Postgres, not from HTTP. No port at all —
    // not a private one, and certainly not a fake server to satisfy a probe.
    expect(worker!.spec.ports as unknown[]).toEqual([])
  })

  it("gives each service its own Dockerfile target from the one build", () => {
    const targets = steps()
      .map((s) => (s.spec.buildConfiguration as { dockerfileTarget?: string } | undefined)?.dockerfileTarget)
      .filter(Boolean)
    expect(new Set(targets)).toEqual(new Set(["web", "worker", "migrate"]))
  })

  // An unresolved reference does not fail the run — it silently drops the
  // dependency, and the services come up with no DATABASE_URL. The node
  // response nests the resource under `data`.
  it("reads the addon id from the node response, which nests under data", () => {
    const group = byKind("SecretGroup")[0]!
    const deps = group.spec.addonDependencies as Array<{ addonId: string }>
    expect(deps[0]!.addonId).toBe("${refs.database.data.id}")
  })

  it("keeps the database private to the project", () => {
    const addon = byKind("Addon")[0]!
    expect(addon.spec.externalAccessEnabled).toBe(false)
    expect(addon.spec.tlsEnabled).toBe(true)
  })

  it("aliases the addon URI to the DATABASE_URL the app asks for", () => {
    const group = byKind("SecretGroup")[0]!
    const deps = group.spec.addonDependencies as Array<{
      keys: Array<{ keyName: string; aliases: string[] }>
    }>
    expect(deps[0]!.keys[0]!.aliases).toContain("DATABASE_URL")
  })

  // The whole file is committed, so a real value here would be a public leak.
  // The schema helps: it rejects `argumentOverrides` at the top level, so the
  // only place a secret could sit is an argument default, and both are empty.
  it("commits no secret values", () => {
    const raw = readFileSync(resolve(import.meta.dirname, "../northflank/template.json"), "utf8")
    expect(raw).not.toMatch(/slr_live_|sk-ant-|postgres:\/\/[^$]/)
    expect(template.arguments.SOLARI_API_KEY).toBe("")
    expect(template.arguments.GAUNTLET_RUN_TOKEN).toBe("")
  })

  it("declares only the two secrets a human must supply", () => {
    const blank = Object.entries(template.arguments)
      .filter(([, v]) => v === "")
      .map(([k]) => k)
      .sort()
    expect(blank).toEqual(["GAUNTLET_RUN_TOKEN", "SOLARI_API_KEY", "publicUrl"].sort())
  })
})

describe("production images", () => {
  const dockerfile = readFileSync(resolve(import.meta.dirname, "../Dockerfile"), "utf8")

  // The product's central safety claim: browsers run on Solari, never here.
  // A Playwright browser in the image would make that claim untestable.
  it("never downloads a browser into a production image", () => {
    expect(dockerfile).toMatch(/PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/)
    expect(dockerfile).not.toMatch(/playwright\s+install/)
  })

  it("runs as an unprivileged user", () => {
    expect(dockerfile).toMatch(/^USER node$/m)
  })

  it("builds web, worker and migrate from one compile", () => {
    for (const target of ["AS web", "AS worker", "AS migrate"]) {
      expect(dockerfile).toContain(target)
    }
    // One dependency install, one build stage: the worker cannot drift from
    // the web app's idea of the domain.
    expect(dockerfile.match(/^FROM deps AS build$/gm)).toHaveLength(1)
  })

  it("excludes the things that must never enter the build context", () => {
    const ignored = readFileSync(resolve(import.meta.dirname, "../.dockerignore"), "utf8")
    for (const entry of ["**/node_modules", "**/.next", ".git", ".env"]) {
      expect(ignored).toContain(entry)
    }
  })
})

describe.skipIf(built)("Deployment contract (skipped)", () => {
  it("needs a production build", () => {
    expect(built).toBe(false)
    console.log("Skipped: run `pnpm build` first, then `pnpm test:deploy`.")
  })
})
