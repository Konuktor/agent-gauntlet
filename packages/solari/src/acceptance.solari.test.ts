import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createLogger, type FixtureHost } from "@gauntlet/core"
import { parseEnv } from "@gauntlet/config"
import { SolariBrowserProvider } from "./browser-manager.js"
import { SolariSandboxProvider } from "./sandbox-manager.js"
import { SolariFixtureProvider } from "./fixture-provider.js"

/**
 * The real-credential acceptance test.
 *
 * Spends actual Solari credits, so it lives behind its own vitest config and an
 * explicit opt-in. It is never part of `pnpm test` or CI.
 *
 *   SOLARI_E2E=1 SOLARI_API_KEY=slr_live_... pnpm test:solari
 *
 * It provisions one sandbox for ~2 minutes and one browser session for under a
 * minute, and its final assertion is that neither is left running.
 */
const env = (() => {
  try {
    return parseEnv()
  } catch {
    return null
  }
})()

const enabled = Boolean(env?.SOLARI_E2E && env.SOLARI_API_KEY)
const logger = createLogger({ component: "acceptance" }, { level: "info" })

describe.skipIf(!enabled)("Solari acceptance", () => {
  let sandboxes: SolariSandboxProvider
  let browsers: SolariBrowserProvider
  let fixture: FixtureHost | undefined
  let sessionId: string | undefined

  beforeAll(() => {
    const apiKey = env!.SOLARI_API_KEY!
    sandboxes = new SolariSandboxProvider({ apiKey, baseUrl: env!.SOLARI_BASE_URL, logger })
    browsers = new SolariBrowserProvider({ apiKey, baseUrl: env!.SOLARI_BASE_URL, logger })
  })

  afterAll(async () => {
    await fixture?.dispose().catch(() => {})
    await browsers?.shutdown().catch(() => {})
    await sandboxes?.shutdown().catch(() => {})
  })

  it(
    "hosts the benchmark site in a sandbox and exposes it on a public URL",
    async () => {
      const provider = new SolariFixtureProvider({ sandboxes, logger })
      fixture = await provider.start()

      expect(fixture.kind).toBe("sandbox")
      expect(fixture.sandboxId).toBeTruthy()
      expect(fixture.baseUrl).toMatch(/^https:\/\//)

      // Fetched from HERE, outside the VM: proves the preview URL is genuinely
      // public and not just reachable from inside the sandbox.
      const health = await fetch(`${fixture.baseUrl}/__gauntlet/health`)
      expect(health.ok).toBe(true)
      expect((await health.json()).ok).toBe(true)
      logger.info("preview URL is publicly reachable", { url: fixture.baseUrl })
    },
    240_000,
  )

  it(
    "drives the task in a recorded browser session and judges it from server state",
    async () => {
      const runId = `acceptance-${Date.now().toString(36)}`
      await fixture!.registerRun({ runId, variant: "baseline", seed: 1, config: {} })

      const environment = await browsers.create({ recording: true, stealth: false })
      sessionId = environment.sessionId!
      expect(sessionId).toBeTruthy()
      expect(environment.mode).toBe("solari")

      // The raw CDP endpoint must be publicly routable — this is what a
      // sandboxed repository agent connects to, and a loopback address here
      // would fail only in production.
      const cdp = SolariBrowserProvider.cdpEndpointOf(environment)
      expect(cdp).toMatch(/^wss:\/\//)
      expect(cdp).not.toContain("127.0.0.1")

      try {
        const page = environment.page
        await page.goto(`${fixture!.baseUrl}/?run=${runId}`, { waitUntil: "domcontentloaded" })
        expect(await page.title()).toContain("Gauntlet Shop")

        await page.clickSelector('[data-testid="add-aurora-headphones"]')
        await page.waitForTimeout(500)
      } finally {
        // Release before polling: the replay upload only begins on release.
        await environment.dispose()
      }

      const state = (await fixture!.readState(runId)) as { cart: Array<{ sku: string }> }
      expect(state.cart).toHaveLength(1)
      expect(state.cart[0]!.sku).toBe("aurora-headphones")

      const replay = await browsers.fetchReplay(environment)
      // A missing replay is reported, never fatal — but on a healthy account
      // with recording enabled it should arrive.
      if (replay) {
        expect(replay.source).toBe("solari")
        expect(replay.eventCount).toBeGreaterThan(0)
        logger.info("replay collected", { events: replay.eventCount, bytes: replay.bytes.length })
      } else {
        logger.warn("no replay arrived within the polling window")
      }
    },
    240_000,
  )

  it(
    "leaves nothing running",
    async () => {
      await fixture?.dispose()
      fixture = undefined
      await browsers.shutdown()
      await sandboxes.shutdown()

      expect(browsers.outstandingSessions()).toEqual([])
      expect(sandboxes.outstandingSandboxes()).toEqual([])

      // Ask Solari, not ourselves: the only leak that matters is the one the
      // gateway still believes in.
      const orphans = await sandboxes.listOrphans()
      expect(orphans, `orphaned sandboxes: ${JSON.stringify(orphans)}`).toEqual([])
    },
    120_000,
  )
})

describe.skipIf(enabled)("Solari acceptance (skipped)", () => {
  it("explains why it did not run", () => {
    expect(enabled).toBe(false)
    logger.info(
      "Skipped: set SOLARI_E2E=1 and SOLARI_API_KEY to run the real acceptance test. It spends credits.",
    )
  })
})
