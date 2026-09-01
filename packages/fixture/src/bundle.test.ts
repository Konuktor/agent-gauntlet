import { describe, expect, it } from "vitest"
import { buildFixtureBundle, getFixtureBundle } from "./bundle.js"

/**
 * The bundle is only *used* on the Solari path — the local provider starts the
 * fixture in-process — so nothing else exercises it without a Solari key. These
 * tests stand in for that, because a broken bundle would fail at the worst
 * possible moment: the first real run, inside a sandbox, at a distance.
 */
describe("fixture bundle", () => {
  it("builds a self-contained ES module with no external imports", async () => {
    const bundle = await buildFixtureBundle()

    expect(bundle.bytes).toBeGreaterThan(10_000)
    expect(bundle.hash).toMatch(/^[0-9a-f]{16}$/)

    // A sandbox has no npm install, so a single bare import would be fatal
    // there and invisible here.
    const bareImports = [...bundle.code.matchAll(/^\s*import\s.*?from\s+["']([^."'][^"']*)["']/gm)]
      .map((m) => m[1])
      .filter((specifier) => specifier && !specifier.startsWith("node:"))
    expect(bareImports).toEqual([])

    // It must be the server, not an empty shell.
    expect(bundle.code).toContain("GAUNTLET_SHOP_READY")
    expect(bundle.code).toContain("__gauntlet/state")
    expect(bundle.code).toContain("aurora-headphones")
  }, 60_000)

  it("is byte-identical across builds, so a stale upload is detectable", async () => {
    const first = await buildFixtureBundle()
    const second = await buildFixtureBundle()
    expect(second.hash).toBe(first.hash)
  }, 60_000)

  it("serves a cached bundle on subsequent reads", async () => {
    const built = await buildFixtureBundle()
    const cached = await getFixtureBundle()
    expect(cached.hash).toBe(built.hash)
  }, 60_000)
})
