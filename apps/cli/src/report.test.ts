import { describe, expect, it } from "vitest"
import { compareSuites, computeSuiteMetrics, type RunSummary } from "@gauntlet/core"
import { evaluateThresholds, renderComparison, renderReport, type GauntletReport } from "./report.js"
import { gauntletConfigSchema } from "./config.js"

function metricsFor(passed: number, total: number, baselinePassed = 2, baselineTotal = 2) {
  const runs: RunSummary[] = [
    ...Array.from({ length: baselineTotal }, (_, i) => ({
      variant: "baseline",
      variantName: "Baseline",
      category: "none" as const,
      repetition: i + 1,
      status: (i < baselinePassed ? "passed" : "failed") as RunSummary["status"],
      durationMs: 1_000,
      steps: 5,
      failureCategory: null,
    })),
    ...Array.from({ length: total }, (_, i) => ({
      variant: "modal",
      variantName: "Modal",
      category: "ui" as const,
      repetition: i + 1,
      status: (i < passed ? "passed" : "failed") as RunSummary["status"],
      durationMs: 1_000,
      steps: 5,
      failureCategory: (i < passed ? null : "unexpected_ui") as RunSummary["failureCategory"],
    })),
  ]
  return computeSuiteMetrics(runs)
}

function report(overrides: Partial<GauntletReport> = {}): GauntletReport {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: "local",
    agent: "Reference Agent",
    task: "Checkout",
    thresholds: {},
    metrics: metricsFor(2, 2),
    failures: [],
    ...overrides,
  }
}

describe("evaluateThresholds", () => {
  it("passes when the configured threshold is met", () => {
    const verdict = evaluateThresholds(report({ thresholds: { reliability: 0.9 } }))
    expect(verdict.pass).toBe(true)
    expect(verdict.required).toHaveLength(1)
  })

  // The exact case the bundled demo hits: 87.5% against a 90% gate.
  it("fails when reliability is below the threshold", () => {
    const metrics = metricsFor(6, 8, 8, 8) // 14/16 = 87.5%
    expect(metrics.reliability).toBe(0.875)
    const verdict = evaluateThresholds(report({ thresholds: { reliability: 0.9 }, metrics }))
    expect(verdict.pass).toBe(false)
    expect(verdict.required[0]).toMatchObject({ label: "Reliability", met: false })
  })

  it("enforces a baseline threshold separately", () => {
    // Perturbed results are meaningless if the control itself is failing.
    const metrics = metricsFor(2, 2, 1, 2)
    const verdict = evaluateThresholds(report({ thresholds: { baseline: 1 }, metrics }))
    expect(verdict.pass).toBe(false)
    expect(verdict.required[0]).toMatchObject({ label: "Baseline", actual: 0.5 })
  })

  // A missing threshold must not behave like a threshold of zero, nor silently
  // pass something the user meant to gate.
  it("enforces nothing when no thresholds are configured", () => {
    const verdict = evaluateThresholds(report({ metrics: metricsFor(0, 4, 0, 2) }))
    expect(verdict.required).toHaveLength(0)
    expect(verdict.pass).toBe(true)
  })

  it("skips a baseline threshold when the suite ran no baseline", () => {
    const metrics = computeSuiteMetrics([
      { variant: "modal", variantName: "Modal", category: "ui", repetition: 1, status: "passed", durationMs: 1, steps: 1, failureCategory: null },
    ])
    expect(metrics.baselineReliability).toBeNull()
    expect(evaluateThresholds(report({ thresholds: { baseline: 1 }, metrics })).required).toHaveLength(0)
  })
})

describe("renderReport", () => {
  it("prints per-variant rates, the headline and the verdict", () => {
    const text = renderReport(report({ thresholds: { reliability: 0.9 }, metrics: metricsFor(6, 8, 8, 8) }))
    expect(text).toContain("AgentGauntlet")
    expect(text).toContain("Baseline")
    expect(text).toContain("87.5%")
    expect(text).toContain("FAIL")
  })

  it("says PASS when the gate is met", () => {
    expect(renderReport(report({ thresholds: { reliability: 0.5 } }))).toContain("PASS")
  })

  it("says so when nothing is gated, rather than implying a pass", () => {
    expect(renderReport(report())).toContain("No thresholds configured")
  })

  it("surfaces infrastructure errors as excluded rather than hiding them", () => {
    const metrics = computeSuiteMetrics([
      { variant: "baseline", variantName: "Baseline", category: "none", repetition: 1, status: "passed", durationMs: 1, steps: 1, failureCategory: null },
      { variant: "baseline", variantName: "Baseline", category: "none", repetition: 2, status: "infrastructure_error", durationMs: null, steps: null, failureCategory: "browser_error" },
    ])
    expect(renderReport(report({ metrics }))).toMatch(/excluded from the score/)
  })
})

describe("renderComparison", () => {
  it("reports a regression and names the variant that caused it", () => {
    const before = metricsFor(2, 2, 2, 2)
    const after = metricsFor(0, 2, 2, 2)
    const text = renderComparison(compareSuites(before, after), { previous: "main", current: "pr-82" })
    expect(text).toContain("REGRESSION DETECTED")
    expect(text).toContain("Modal")
    expect(text).toContain("-100pp")
  })

  it("reports no regression when nothing moved", () => {
    const metrics = metricsFor(2, 2)
    expect(renderComparison(compareSuites(metrics, metrics), { previous: "a", current: "b" })).toContain(
      "NO REGRESSION",
    )
  })
})

describe("gauntlet.yaml schema", () => {
  const base = {
    version: 1,
    agent: { type: "reference" },
    task: { description: "Do the thing." },
    variants: ["baseline"],
  }

  it("applies defaults for everything optional", () => {
    const config = gauntletConfigSchema.parse(base)
    expect(config.repetitions).toBe(2)
    expect(config.task.maxSteps).toBe(25)
    expect(config.agent).toMatchObject({ type: "reference", preset: "reference" })
    expect(config.thresholds).toEqual({})
  })

  it("requires at least one variant", () => {
    expect(gauntletConfigSchema.safeParse({ ...base, variants: [] }).success).toBe(false)
  })

  it("rejects an unknown agent type", () => {
    expect(gauntletConfigSchema.safeParse({ ...base, agent: { type: "psychic" } }).success).toBe(false)
  })

  it("requires a repository for a repository agent", () => {
    expect(gauntletConfigSchema.safeParse({ ...base, agent: { type: "repository" } }).success).toBe(false)
    expect(
      gauntletConfigSchema.safeParse({
        ...base,
        agent: { type: "repository", repository: "https://github.com/acme/agent" },
      }).success,
    ).toBe(true)
  })

  it("clamps repetitions and thresholds to sane ranges", () => {
    expect(gauntletConfigSchema.safeParse({ ...base, repetitions: 99 }).success).toBe(false)
    expect(gauntletConfigSchema.safeParse({ ...base, thresholds: { reliability: 1.5 } }).success).toBe(false)
  })
})
