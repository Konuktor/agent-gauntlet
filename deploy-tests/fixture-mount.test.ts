import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * The benchmark site, served by the web service itself.
 *
 * Normally it lives in its own Solari Sandbox. A repository agent needs a
 * sandbox too, and the free plan allows exactly one — so proving the
 * external-agent path at all requires hosting the site here and pointing
 * GAUNTLET_FIXTURE_URL at it. These assertions are what make that safe to rely
 * on: the mount answers, it is off unless asked for, and it does not shadow the
 * app.
 */
const repoRoot = resolve(import.meta.dirname, "..")
const serverEntry = resolve(repoRoot, "apps/web/dist/server.js")
const built = existsSync(serverEntry)
const PORT = 13988
const base = `http://127.0.0.1:${PORT}`

function loadEnvFile(): void {
  const path = resolve(repoRoot, ".env")
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (key in process.env) continue
    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
  }
}
loadEnvFile()

let server: ChildProcessWithoutNullStreams | undefined

async function waitForHealth(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error("server never became healthy")
}

describe.skipIf(!built)("hosted benchmark site", () => {
  beforeAll(async () => {
    server = spawn(process.execPath, [serverEntry], {
      cwd: resolve(repoRoot, "apps/web"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        GAUNTLET_HOST_FIXTURE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    await waitForHealth()
  })

  afterAll(async () => {
    server?.kill("SIGTERM")
    await new Promise((r) => setTimeout(r, 400))
  })

  it("serves the storefront under the mount point", async () => {
    const res = await fetch(`${base}/__fixture/?run=mount-test&v=baseline&seed=1`)
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/Aurora|Gauntlet Shop|headphones/i)
  })

  // This is the endpoint the worker drives the site through; without it the
  // external-agent path silently has no control channel.
  it("accepts a run registration on the control endpoint", async () => {
    const res = await fetch(`${base}/__fixture/__gauntlet/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "mount-test", variant: "baseline", seed: 1, config: {} }),
    })
    expect([200, 201]).toContain(res.status)
    const state = await fetch(`${base}/__fixture/__gauntlet/state?run=mount-test`)
    expect(state.status).toBe(200)
    expect(await state.json()).toMatchObject({ stage: expect.any(String) })
  })

  // The first external-agent run died here: root-relative links navigated
  // straight out of the store on the very first click.
  it("emits links that stay inside the mount", async () => {
    await fetch(`${base}/__fixture/__gauntlet/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "link-test", variant: "baseline", seed: 1, config: {} }),
    })
    const html = await (await fetch(`${base}/__fixture/?run=link-test`)).text()
    const hrefs = [...html.matchAll(/(?:href|action)="([^"]+)"/g)].map((m) => m[1]!)
    const internal = hrefs.filter((h) => h.startsWith("/"))
    expect(internal.length).toBeGreaterThan(0)
    for (const h of internal) expect(h.startsWith("/__fixture/")).toBe(true)
  })

  // Links were fixed first; redirects were not, and a POST that redirects is
  // how you get from the product page to the cart. The agent added the product
  // and then hunted for the coupon field on the app's 404 page.
  it("redirects back into the mount, not out of it", async () => {
    await fetch(`${base}/__fixture/__gauntlet/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "redirect-test", variant: "baseline", seed: 1, config: {} }),
    })
    const res = await fetch(`${base}/__fixture/cart/add?run=redirect-test`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "sku=aurora-headphones",
      redirect: "manual",
    })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toMatch(/^\/__fixture\/cart\?/)
  })

  it("does not shadow the application", async () => {
    expect((await fetch(`${base}/api/health`)).ok).toBe(true)
    expect((await fetch(base)).status).toBe(200)
  })
})

describe.skipIf(!built)("the mount is opt-in", () => {
  it("is absent unless GAUNTLET_HOST_FIXTURE is set", async () => {
    const port = PORT + 1
    const child = spawn(process.execPath, [serverEntry], {
      cwd: resolve(repoRoot, "apps/web"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        GAUNTLET_HOST_FIXTURE: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    try {
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 300))
      }
      const res = await fetch(`http://127.0.0.1:${port}/__fixture/`)
      expect(res.status).not.toBe(200)
    } finally {
      child.kill("SIGTERM")
      await new Promise((r) => setTimeout(r, 400))
    }
  })
})
