import pc from "picocolors"
import type { SuiteComparison, SuiteMetrics } from "@gauntlet/core"
import { FAILURE_CATEGORY_META, type FailureCategory } from "@gauntlet/core"

export interface GauntletReport {
  version: 1
  generatedAt: string
  mode: string
  agent: string
  task: string
  label?: string
  thresholds: { reliability?: number; baseline?: number }
  metrics: SuiteMetrics
  failures: Array<{
    variant: string
    repetition: number
    category: FailureCategory | null
    message: string | null
  }>
}

const PASS = pc.green("✓")
const FAIL = pc.red("✗")
const WARN = pc.yellow("!")

/** The terminal output. Legible in CI logs, which are not always colour-capable. */
export function renderReport(report: GauntletReport): string {
  const { metrics } = report
  const lines: string[] = ["", pc.bold("AgentGauntlet"), ""]

  const nameWidth = Math.max(12, ...metrics.byVariant.map((v) => v.variantName.length))
  for (const variant of metrics.byVariant) {
    const complete = variant.passed === variant.total && variant.total > 0
    const mark = variant.total === 0 ? WARN : complete ? PASS : FAIL
    const rate = `${variant.passed}/${variant.total}`
    const percent = variant.total > 0 ? `${(variant.reliability * 100).toFixed(0)}%` : "—"
    lines.push(
      `  ${mark} ${variant.variantName.padEnd(nameWidth)}  ${rate.padStart(5)}  ${pc.dim(percent.padStart(4))}`,
    )
  }

  if (metrics.infrastructureErrors > 0) {
    lines.push(
      "",
      pc.yellow(
        `  ${metrics.infrastructureErrors} run(s) failed on infrastructure and are excluded from the score.`,
      ),
    )
  }

  const reliability = (metrics.reliability * 100).toFixed(1)
  lines.push("", `  ${pc.bold("Reliability")}   ${pc.bold(`${reliability}%`)}  ${pc.dim(`(${metrics.passedRuns}/${metrics.scoredRuns})`)}`)
  lines.push(
    `  ${pc.dim("95% CI")}        ${pc.dim(`${(metrics.interval.low * 100).toFixed(1)}% – ${(metrics.interval.high * 100).toFixed(1)}%`)}`,
  )
  if (metrics.baselineReliability !== null) {
    lines.push(`  ${pc.dim("Baseline")}      ${pc.dim(`${(metrics.baselineReliability * 100).toFixed(1)}%`)}`)
  }
  if (metrics.perturbedReliability !== null) {
    lines.push(`  ${pc.dim("Perturbed")}     ${pc.dim(`${(metrics.perturbedReliability * 100).toFixed(1)}%`)}`)
  }

  if (metrics.failureDistribution.length > 0) {
    lines.push("", pc.dim("  Failure modes"))
    for (const entry of metrics.failureDistribution) {
      lines.push(
        `    ${String(entry.count).padStart(3)}  ${FAILURE_CATEGORY_META[entry.category].label}`,
      )
    }
  }

  const verdict = evaluateThresholds(report)
  lines.push("")
  if (verdict.required.length > 0) {
    for (const requirement of verdict.required) {
      lines.push(
        `  ${requirement.met ? PASS : FAIL} ${requirement.label} ${pc.dim(`required ${(requirement.threshold * 100).toFixed(0)}%, got ${(requirement.actual * 100).toFixed(1)}%`)}`,
      )
    }
    lines.push("")
    lines.push(verdict.pass ? pc.green(pc.bold("  PASS")) : pc.red(pc.bold("  FAIL")))
  } else {
    lines.push(pc.dim("  No thresholds configured, so nothing to fail against."))
  }
  lines.push("")
  return lines.join("\n")
}

export interface ThresholdVerdict {
  pass: boolean
  required: Array<{ label: string; threshold: number; actual: number; met: boolean }>
}

/**
 * The gate. Only thresholds that were actually configured are enforced — a
 * missing threshold is not a silent zero.
 */
export function evaluateThresholds(report: GauntletReport): ThresholdVerdict {
  const required: ThresholdVerdict["required"] = []
  const { thresholds, metrics } = report

  if (thresholds.reliability !== undefined) {
    required.push({
      label: "Reliability",
      threshold: thresholds.reliability,
      actual: metrics.reliability,
      met: metrics.reliability >= thresholds.reliability,
    })
  }
  if (thresholds.baseline !== undefined && metrics.baselineReliability !== null) {
    required.push({
      label: "Baseline",
      threshold: thresholds.baseline,
      actual: metrics.baselineReliability,
      met: metrics.baselineReliability >= thresholds.baseline,
    })
  }

  return { pass: required.every((r) => r.met), required }
}

export function renderComparison(comparison: SuiteComparison, labels: { previous: string; current: string }): string {
  const lines: string[] = ["", pc.bold("AgentGauntlet · comparison"), ""]
  lines.push(`  ${pc.dim(labels.previous)}  ${(comparison.previousReliability * 100).toFixed(1)}%`)
  lines.push(`  ${pc.dim(labels.current)}   ${(comparison.currentReliability * 100).toFixed(1)}%`)
  const sign = comparison.deltaPp > 0 ? "+" : ""
  const delta = `${sign}${comparison.deltaPp}pp`
  lines.push(`  ${pc.bold("delta")}       ${comparison.regressed ? pc.red(delta) : pc.green(delta)}`)
  lines.push("")

  const width = Math.max(12, ...comparison.variants.map((v) => v.variantName.length))
  for (const variant of [...comparison.variants].sort((a, b) => (a.deltaPp ?? 0) - (b.deltaPp ?? 0))) {
    if (variant.deltaPp === null) {
      lines.push(`  ${WARN} ${variant.variantName.padEnd(width)}  ${pc.dim("not in both runs")}`)
      continue
    }
    const from = variant.previous === null ? "—" : `${(variant.previous * 100).toFixed(0)}%`
    const to = variant.current === null ? "—" : `${(variant.current * 100).toFixed(0)}%`
    const change = `${variant.deltaPp > 0 ? "+" : ""}${variant.deltaPp}pp`
    const mark = variant.regressed ? FAIL : variant.improved ? PASS : pc.dim("·")
    lines.push(
      `  ${mark} ${variant.variantName.padEnd(width)}  ${from.padStart(4)} → ${to.padStart(4)}  ${
        variant.regressed ? pc.red(change) : variant.improved ? pc.green(change) : pc.dim(change)
      }`,
    )
  }

  lines.push("")
  lines.push(comparison.regressed ? pc.red(pc.bold("  REGRESSION DETECTED")) : pc.green(pc.bold("  NO REGRESSION")))
  if (comparison.variantSetsDiffer) {
    lines.push(pc.yellow("  Note: the two runs did not test the same variant set."))
  }
  lines.push("")
  return lines.join("\n")
}
