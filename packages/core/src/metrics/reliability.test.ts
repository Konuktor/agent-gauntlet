import { describe, expect, it } from "vitest"
import type { IndividualRunStatus } from "../domain/run.js"
import { compareSuites, computeSuiteMetrics, type RunSummary } from "./reliability.js"

function run(
  variant: string,
  repetition: number,
  status: IndividualRunStatus,
  overrides: Partial<RunSummary> = {},
): RunSummary {
  return {
    variant,
    variantName: variant,
    category: variant === "baseline" ? "none" : "ui",
    repetition,
    status,
    durationMs: 10_000,
    steps: 8,
    failureCategory: status === "failed" ? "unexpected_ui" : null,
    ...overrides,
  }
}

describe("computeSuiteMetrics", () => {
  it("computes reliability from scored runs only", () => {
    const m = computeSuiteMetrics([
      run("baseline", 1, "passed"),
      run("baseline", 2, "passed"),
      run("modal", 1, "failed"),
      run("modal", 2, "passed"),
    ])
    expect(m.scoredRuns).toBe(4)
    expect(m.passedRuns).toBe(3)
    expect(m.reliability).toBe(0.75)
  })

  // The agent must not be blamed for a Solari 429 or a dead sandbox.
  it("excludes infrastructure errors from the reliability denominator", () => {
    const m = computeSuiteMetrics([
      run("baseline", 1, "passed"),
      run("baseline", 2, "passed"),
      run("modal", 1, "infrastructure_error"),
    ])
    expect(m.reliability).toBe(1)
    expect(m.scoredRuns).toBe(2)
    expect(m.infrastructureErrors).toBe(1)
    expect(m.totalRuns).toBe(3)
  })

  it("separates baseline from perturbed reliability", () => {
    const m = computeSuiteMetrics([
      run("baseline", 1, "passed"),
      run("baseline", 2, "passed"),
      run("modal", 1, "failed"),
      run("modal", 2, "failed"),
      run("slow_api", 1, "passed"),
      run("slow_api", 2, "failed"),
    ])
    expect(m.baselineReliability).toBe(1)
    expect(m.perturbedReliability).toBe(0.25)
    expect(m.reliability).toBeCloseTo(0.5)
  })

  it("returns null baseline/perturbed splits when a side has no runs", () => {
    const only = computeSuiteMetrics([run("baseline", 1, "passed")])
    expect(only.baselineReliability).toBe(1)
    expect(only.perturbedReliability).toBeNull()
    expect(only.perturbedInterval).toBeNull()
  })

  it("counts in-flight runs as pending without scoring them", () => {
    const m = computeSuiteMetrics([
      run("baseline", 1, "passed"),
      run("baseline", 2, "running_agent"),
      run("modal", 1, "queued"),
    ])
    expect(m.pendingRuns).toBe(2)
    expect(m.scoredRuns).toBe(1)
    expect(m.reliability).toBe(1)
  })

  it("orders baseline first among variants", () => {
    const m = computeSuiteMetrics([run("zzz", 1, "passed"), run("baseline", 1, "passed")])
    expect(m.byVariant[0]?.variant).toBe("baseline")
  })

  it("reports per-variant flip rate for identical repetitions", () => {
    const m = computeSuiteMetrics([
      run("flaky", 1, "passed"),
      run("flaky", 2, "failed"),
      run("flaky", 3, "passed"),
      run("flaky", 4, "failed"),
      run("steady", 1, "passed"),
      run("steady", 2, "passed"),
      run("steady", 3, "failed"),
      run("steady", 4, "failed"),
    ])
    const flaky = m.byVariant.find((v) => v.variant === "flaky")
    const steady = m.byVariant.find((v) => v.variant === "steady")
    // Same 50% reliability, very different trustworthiness.
    expect(flaky?.reliability).toBe(steady?.reliability)
    expect(flaky?.flipRate).toBe(1)
    expect(steady?.flipRate).toBeCloseTo(1 / 3)
  })

  it("computes duration percentiles and average steps", () => {
    const m = computeSuiteMetrics([
      run("baseline", 1, "passed", { durationMs: 1_000, steps: 4 }),
      run("baseline", 2, "passed", { durationMs: 5_000, steps: 6 }),
      run("baseline", 3, "failed", { durationMs: 100_000, steps: 20 }),
    ])
    expect(m.p50DurationMs).toBe(5_000)
    expect(m.p95DurationMs).toBe(100_000)
    expect(m.avgSteps).toBeCloseTo(10)
  })

  it("builds a failure distribution over failed runs only", () => {
    const m = computeSuiteMetrics([
      run("a", 1, "failed", { failureCategory: "unexpected_ui" }),
      run("a", 2, "failed", { failureCategory: "unexpected_ui" }),
      run("b", 1, "failed", { failureCategory: "timeout" }),
      run("c", 1, "infrastructure_error", { failureCategory: "browser_error" }),
      run("d", 1, "passed"),
    ])
    expect(m.failureDistribution).toEqual([
      { category: "unexpected_ui", count: 2, share: 0.6667 },
      { category: "timeout", count: 1, share: 0.3333 },
    ])
  })

  it("handles an empty suite without dividing by zero", () => {
    const m = computeSuiteMetrics([])
    expect(m.reliability).toBe(0)
    expect(m.byVariant).toEqual([])
    expect(m.avgDurationMs).toBe(0)
  })
})

describe("compareSuites", () => {
  const previous = computeSuiteMetrics([
    run("baseline", 1, "passed"),
    run("baseline", 2, "passed"),
    run("modal", 1, "passed"),
    run("modal", 2, "passed"),
  ])
  const current = computeSuiteMetrics([
    run("baseline", 1, "passed"),
    run("baseline", 2, "passed"),
    run("modal", 1, "failed"),
    run("modal", 2, "failed"),
  ])

  it("reports the overall delta in percentage points", () => {
    const c = compareSuites(previous, current)
    expect(c.previousReliability).toBe(1)
    expect(c.currentReliability).toBe(0.5)
    expect(c.deltaPp).toBe(-50)
    expect(c.regressed).toBe(true)
  })

  it("attributes the regression to the specific variant", () => {
    const modal = compareSuites(previous, current).variants.find((v) => v.variant === "modal")
    expect(modal).toMatchObject({ previous: 1, current: 0, deltaPp: -100, regressed: true })
  })

  it("does not flag an unchanged variant", () => {
    const baseline = compareSuites(previous, current).variants.find((v) => v.variant === "baseline")
    expect(baseline).toMatchObject({ deltaPp: 0, regressed: false, improved: false })
  })

  it("flags mismatched variant sets so the UI can warn", () => {
    const other = computeSuiteMetrics([run("baseline", 1, "passed"), run("brand_new", 1, "failed")])
    const c = compareSuites(previous, other)
    expect(c.variantSetsDiffer).toBe(true)
    expect(c.variants.find((v) => v.variant === "brand_new")?.previous).toBeNull()
    expect(c.variants.find((v) => v.variant === "modal")?.current).toBeNull()
  })

  it("ignores noise below the regression threshold", () => {
    const a = computeSuiteMetrics(Array.from({ length: 100 }, (_, i) => run("baseline", i, "passed")))
    const b = computeSuiteMetrics(
      Array.from({ length: 100 }, (_, i) => run("baseline", i, i < 97 ? "passed" : "failed")),
    )
    const c = compareSuites(a, b)
    expect(c.deltaPp).toBe(-3)
    expect(c.regressed).toBe(false)
  })
})
