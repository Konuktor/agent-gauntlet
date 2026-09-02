import type { PerturbationCategory } from "../domain/perturbation.js"
import { isPass, isScorable, type IndividualRunStatus } from "../domain/run.js"
import type { FailureCategory } from "../failure/categories.js"
import { mean, flipRate, percentile, round, stdDev } from "./statistics.js"
import { wilsonInterval, type ConfidenceInterval } from "./wilson.js"

/** The minimum a run must expose for metrics. Keeps this module free of DB types. */
export interface RunSummary {
  variant: string
  variantName: string
  category: PerturbationCategory
  repetition: number
  status: IndividualRunStatus
  durationMs: number | null
  steps: number | null
  failureCategory: FailureCategory | null
}

export interface VariantMetrics {
  variant: string
  variantName: string
  category: PerturbationCategory
  total: number
  passed: number
  failed: number
  infrastructureErrors: number
  reliability: number
  interval: ConfidenceInterval
  /** Outcome per repetition, in order, for the run matrix. */
  outcomes: Array<{ repetition: number; status: IndividualRunStatus }>
  flipRate: number
  avgDurationMs: number
  avgSteps: number
}

export interface CategoryMetrics {
  category: PerturbationCategory
  total: number
  passed: number
  reliability: number
  interval: ConfidenceInterval
}

export interface SuiteMetrics {
  /** Runs that produced a verdict (passed or failed). */
  scoredRuns: number
  passedRuns: number
  failedRuns: number
  /** Runs that broke on OUR infrastructure. Reported, never scored against the
   *  agent — blaming the agent for a Solari 429 would be dishonest. */
  infrastructureErrors: number
  /** Runs still in flight, for the live view. */
  pendingRuns: number
  totalRuns: number

  reliability: number
  interval: ConfidenceInterval

  baselineReliability: number | null
  baselineInterval: ConfidenceInterval | null
  perturbedReliability: number | null
  perturbedInterval: ConfidenceInterval | null

  byVariant: VariantMetrics[]
  byCategory: CategoryMetrics[]
  failureDistribution: Array<{ category: FailureCategory; count: number; share: number }>

  avgDurationMs: number
  p50DurationMs: number
  p95DurationMs: number
  avgSteps: number
  /** Std dev of per-variant reliability: how unevenly the agent copes. */
  reliabilityStdDev: number
  /** Mean per-variant flip rate: how unpredictable it is run to run. */
  meanFlipRate: number
}

export const BASELINE_VARIANT = "baseline"

export function computeSuiteMetrics(runs: readonly RunSummary[]): SuiteMetrics {
  const scorable = runs.filter((r) => isScorable(r.status))
  const passed = scorable.filter((r) => isPass(r.status))
  const infra = runs.filter((r) => r.status === "infrastructure_error")
  const pending = runs.filter(
    (r) => !isScorable(r.status) && r.status !== "infrastructure_error" && r.status !== "cancelled",
  )

  const byVariant = groupVariants(runs)
  const baselineRuns = scorable.filter((r) => r.variant === BASELINE_VARIANT)
  const perturbedRuns = scorable.filter((r) => r.variant !== BASELINE_VARIANT)

  const durations = scorable
    .map((r) => r.durationMs)
    .filter((d): d is number => typeof d === "number" && d >= 0)
  const steps = scorable.map((r) => r.steps).filter((s): s is number => typeof s === "number")

  return {
    scoredRuns: scorable.length,
    passedRuns: passed.length,
    failedRuns: scorable.length - passed.length,
    infrastructureErrors: infra.length,
    pendingRuns: pending.length,
    totalRuns: runs.length,

    reliability: ratio(passed.length, scorable.length),
    interval: wilsonInterval(passed.length, scorable.length),

    baselineReliability: baselineRuns.length
      ? ratio(countPass(baselineRuns), baselineRuns.length)
      : null,
    baselineInterval: baselineRuns.length
      ? wilsonInterval(countPass(baselineRuns), baselineRuns.length)
      : null,
    perturbedReliability: perturbedRuns.length
      ? ratio(countPass(perturbedRuns), perturbedRuns.length)
      : null,
    perturbedInterval: perturbedRuns.length
      ? wilsonInterval(countPass(perturbedRuns), perturbedRuns.length)
      : null,

    byVariant,
    byCategory: groupCategories(scorable),
    failureDistribution: distributeFailures(runs),

    avgDurationMs: Math.round(mean(durations)),
    p50DurationMs: Math.round(percentile(durations, 0.5)),
    p95DurationMs: Math.round(percentile(durations, 0.95)),
    avgSteps: round(mean(steps), 2),
    reliabilityStdDev: round(
      stdDev(byVariant.filter((v) => v.total > 0).map((v) => v.reliability)),
      4,
    ),
    meanFlipRate: round(mean(byVariant.filter((v) => v.total > 1).map((v) => v.flipRate)), 4),
  }
}

function countPass(runs: readonly RunSummary[]): number {
  return runs.filter((r) => isPass(r.status)).length
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : round(part / total, 4)
}

function groupVariants(runs: readonly RunSummary[]): VariantMetrics[] {
  const groups = new Map<string, RunSummary[]>()
  for (const run of runs) {
    const list = groups.get(run.variant)
    if (list) list.push(run)
    else groups.set(run.variant, [run])
  }

  return [...groups.entries()]
    .map(([variant, all]) => {
      const ordered = [...all].sort((a, b) => a.repetition - b.repetition)
      const scorable = ordered.filter((r) => isScorable(r.status))
      const passed = countPass(scorable)
      const durations = scorable
        .map((r) => r.durationMs)
        .filter((d): d is number => typeof d === "number")
      const steps = scorable.map((r) => r.steps).filter((s): s is number => typeof s === "number")
      const first = ordered[0]

      return {
        variant,
        variantName: first?.variantName ?? variant,
        category: first?.category ?? "environment",
        total: scorable.length,
        passed,
        failed: scorable.length - passed,
        infrastructureErrors: ordered.filter((r) => r.status === "infrastructure_error").length,
        reliability: ratio(passed, scorable.length),
        interval: wilsonInterval(passed, scorable.length),
        outcomes: ordered.map((r) => ({ repetition: r.repetition, status: r.status })),
        flipRate: round(flipRate(scorable.map((r) => isPass(r.status))), 4),
        avgDurationMs: Math.round(mean(durations)),
        avgSteps: round(mean(steps), 2),
      }
    })
    .sort(
      (a, b) =>
        orderVariant(a.variant) - orderVariant(b.variant) || a.variant.localeCompare(b.variant),
    )
}

/** Baseline always reads first: the whole story is "baseline vs the rest". */
function orderVariant(variant: string): number {
  return variant === BASELINE_VARIANT ? 0 : 1
}

function groupCategories(runs: readonly RunSummary[]): CategoryMetrics[] {
  const groups = new Map<PerturbationCategory, RunSummary[]>()
  for (const run of runs) {
    const list = groups.get(run.category)
    if (list) list.push(run)
    else groups.set(run.category, [run])
  }

  return [...groups.entries()]
    .map(([category, all]) => {
      const passed = countPass(all)
      return {
        category,
        total: all.length,
        passed,
        reliability: ratio(passed, all.length),
        interval: wilsonInterval(passed, all.length),
      }
    })
    .sort((a, b) => a.reliability - b.reliability)
}

function distributeFailures(
  runs: readonly RunSummary[],
): Array<{ category: FailureCategory; count: number; share: number }> {
  const counts = new Map<FailureCategory, number>()
  for (const run of runs) {
    if (run.status !== "failed" || !run.failureCategory) continue
    counts.set(run.failureCategory, (counts.get(run.failureCategory) ?? 0) + 1)
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
  return [...counts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      share: total === 0 ? 0 : round(count / total, 4),
    }))
    .sort((a, b) => b.count - a.count)
}

/** §19 — regression comparison between two suite runs. */
export interface VariantDelta {
  variant: string
  variantName: string
  previous: number | null
  current: number | null
  deltaPp: number | null
  regressed: boolean
  improved: boolean
}

export interface SuiteComparison {
  previousReliability: number
  currentReliability: number
  deltaPp: number
  regressed: boolean
  variants: VariantDelta[]
  /** Set when the two runs did not test the same variant set — a comparison
   *  across different suites is not apples to apples and the UI says so. */
  variantSetsDiffer: boolean
}

/** Percentage points of reliability drop before we call it a regression. Small
 *  suites are noisy, so a 1-run flip in a 3-run variant should not scream. */
export const REGRESSION_THRESHOLD_PP = 5

export function compareSuites(previous: SuiteMetrics, current: SuiteMetrics): SuiteComparison {
  const names = new Map<string, string>()
  for (const v of [...previous.byVariant, ...current.byVariant]) names.set(v.variant, v.variantName)

  const prevByVariant = new Map(previous.byVariant.map((v) => [v.variant, v]))
  const currByVariant = new Map(current.byVariant.map((v) => [v.variant, v]))
  const allVariants = [...new Set([...prevByVariant.keys(), ...currByVariant.keys()])].sort(
    (a, b) => orderVariant(a) - orderVariant(b) || a.localeCompare(b),
  )

  const variants: VariantDelta[] = allVariants.map((variant) => {
    const prev = prevByVariant.get(variant)
    const curr = currByVariant.get(variant)
    const previousValue = prev && prev.total > 0 ? prev.reliability : null
    const currentValue = curr && curr.total > 0 ? curr.reliability : null
    const deltaPp =
      previousValue === null || currentValue === null
        ? null
        : round((currentValue - previousValue) * 100, 2)
    return {
      variant,
      variantName: names.get(variant) ?? variant,
      previous: previousValue,
      current: currentValue,
      deltaPp,
      regressed: deltaPp !== null && deltaPp <= -REGRESSION_THRESHOLD_PP,
      improved: deltaPp !== null && deltaPp >= REGRESSION_THRESHOLD_PP,
    }
  })

  const deltaPp = round((current.reliability - previous.reliability) * 100, 2)
  return {
    previousReliability: previous.reliability,
    currentReliability: current.reliability,
    deltaPp,
    regressed: deltaPp <= -REGRESSION_THRESHOLD_PP || variants.some((v) => v.regressed),
    variants,
    variantSetsDiffer:
      prevByVariant.size !== currByVariant.size ||
      allVariants.some((v) => !prevByVariant.has(v) || !currByVariant.has(v)),
  }
}
