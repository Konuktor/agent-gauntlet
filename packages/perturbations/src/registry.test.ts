import { describe, expect, it } from "vitest"
import { deriveSeed } from "@gauntlet/core"
import {
  DEFAULT_VARIANTS,
  getPerturbation,
  PERTURBATIONS,
  requirePerturbation,
} from "./registry.js"
import { resolvePerturbation } from "./resolve.js"

const resolve = (variant: string, repetition = 1, suiteRunId = "suite-1") =>
  resolvePerturbation({
    suiteRunId,
    individualRunId: `run-${variant}-${repetition}`,
    variant,
    repetition,
  })

describe("registry", () => {
  it("exposes unique ids and complete metadata", () => {
    const ids = PERTURBATIONS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PERTURBATIONS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(10)
      expect(p.category).toBeTruthy()
    }
  })

  it("covers every default demo variant", () => {
    for (const variant of DEFAULT_VARIANTS) expect(getPerturbation(variant)).toBeDefined()
  })

  it("throws a helpful error for an unknown id", () => {
    expect(getPerturbation("nope")).toBeUndefined()
    expect(() => requirePerturbation("nope")).toThrow(/unknown perturbation "nope"/)
  })

  it("spreads variants across categories rather than only testing the UI", () => {
    const categories = new Set(PERTURBATIONS.map((p) => p.category))
    expect(categories).toContain("ui")
    expect(categories).toContain("network")
    expect(categories).toContain("state")
    expect(categories).toContain("viewport")
    expect(categories).toContain("locale")
  })
})

describe("determinism", () => {
  // If this ever fails, every reliability comparison in the product is invalid:
  // two runs of the "same" suite would not be running the same environment.
  it("produces byte-identical config for the same coordinates", () => {
    for (const p of PERTURBATIONS) {
      const a = resolve(p.id, 2)
      const b = resolve(p.id, 2)
      expect(a.fixtureConfig).toEqual(b.fixtureConfig)
      expect(a.browserOptions).toEqual(b.browserOptions)
      expect(a.context.seed).toBe(b.context.seed)
    }
  })

  it("derives the seed from suite, variant and repetition", () => {
    expect(resolve("cookie_popup", 1).context.seed).toBe(deriveSeed("suite-1", "cookie_popup", 1))
    expect(resolve("cookie_popup", 2).context.seed).not.toBe(
      resolve("cookie_popup", 1).context.seed,
    )
    expect(resolve("cookie_popup", 1, "suite-2").context.seed).not.toBe(
      resolve("cookie_popup", 1, "suite-1").context.seed,
    )
  })

  it("honours a persisted seed so a recorded run can be reproduced exactly", () => {
    const pinned = resolvePerturbation({
      suiteRunId: "any",
      individualRunId: "any",
      variant: "unexpected_modal",
      repetition: 9,
      seed: 123456,
    })
    const again = resolvePerturbation({
      suiteRunId: "totally-different",
      individualRunId: "other",
      variant: "unexpected_modal",
      repetition: 1,
      seed: 123456,
    })
    expect(pinned.fixtureConfig).toEqual(again.fixtureConfig)
  })

  it("varies timing across repetitions so a fixed obstacle cannot be memorised", () => {
    const delays = [1, 2, 3, 4, 5].map(
      (r) => resolve("unexpected_modal", r).fixtureConfig.unexpectedModal?.afterMs,
    )
    expect(new Set(delays).size).toBeGreaterThan(1)
  })
})

describe("each perturbation actually perturbs", () => {
  it("baseline changes nothing at all", () => {
    const r = resolve("baseline")
    expect(r.fixtureConfig).toEqual({})
    expect(r.browserOptions).toEqual({})
  })

  it("every non-baseline perturbation changes the fixture or the browser", () => {
    for (const p of PERTURBATIONS.filter((x) => x.id !== "baseline")) {
      const r = resolve(p.id)
      const changed =
        Object.keys(r.fixtureConfig).length > 0 || Object.keys(r.browserOptions).length > 0
      expect(changed, `${p.id} produced no environment change`).toBe(true)
    }
  })

  it("cookie_popup enables the banner", () => {
    expect(resolve("cookie_popup").fixtureConfig).toEqual({ cookieBanner: true })
  })

  it("unexpected_modal schedules the interstitial inside the task budget", () => {
    const afterMs = resolve("unexpected_modal").fixtureConfig.unexpectedModal?.afterMs
    expect(afterMs).toBeGreaterThan(400)
    expect(afterMs).toBeLessThan(3_000)
  })

  it("slow_api adds latency that is noticeable but survivable", () => {
    const latency = resolve("slow_api").fixtureConfig.apiLatencyMs!
    expect(latency).toBeGreaterThan(800)
    expect(latency).toBeLessThan(3_000)
  })

  it("network_delay is a browser-side concern, not a fixture one", () => {
    const r = resolve("network_delay")
    expect(r.fixtureConfig).toEqual({})
    expect(r.browserOptions.networkDelay?.delayMs).toBeGreaterThan(0)
  })

  // Solari exposes no session-level viewport, so this must land on the context.
  it("mobile_viewport configures a phone-shaped browser context", () => {
    const o = resolve("mobile_viewport").browserOptions
    expect(o.viewport).toEqual({ width: 390, height: 844 })
    expect(o.isMobile).toBe(true)
    expect(o.hasTouch).toBe(true)
    expect(o.userAgent).toContain("iPhone")
  })

  it("renamed_cta and reordered_layout are pure fixture concerns", () => {
    expect(resolve("renamed_cta").fixtureConfig).toEqual({ renamedCta: true })
    expect(resolve("reordered_layout").fixtureConfig).toEqual({ reorderedLayout: true })
  })

  it("expired_session picks one of the two recoverable trigger points", () => {
    const stages = [1, 2, 3, 4, 5, 6].map(
      (r) => resolve("expired_session", r).fixtureConfig.expiredSession?.afterStage,
    )
    for (const stage of stages) expect(["cart", "checkout"]).toContain(stage)
    expect(new Set(stages).size).toBe(2)
  })

  it("delayed_element reveals the control well inside the timeout", () => {
    const delay = resolve("delayed_element").fixtureConfig.delayedElement!
    expect(delay.target).toBe("add-to-cart")
    expect(delay.delayMs).toBeLessThan(4_000)
  })

  it("locale_variant changes both the page and the browser locale", () => {
    const r = resolve("locale_variant")
    expect(r.fixtureConfig.locale).toBe("de-DE")
    expect(r.browserOptions.locale).toBe("de-DE")
  })
})
