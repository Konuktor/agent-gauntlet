"use client"

import { clsx } from "clsx"
import Link from "next/link"
import type {
  CategoryMetrics,
  FailureCategory,
  SuiteMetrics,
  VariantMetrics,
} from "@gauntlet/core/shared"
import { FAILURE_CATEGORY_META, CATEGORY_LABELS } from "@gauntlet/core/shared"
import { fraction, percent } from "@/lib/format"
import { STATUS_META, type RunStatus } from "./primitives"

/**
 * Charts.
 *
 * All single-series, so none carries a legend — the title names the measure and
 * the values are direct-labelled. Colour is one categorical slot for magnitude
 * and the fixed status palette for state; the status marks always ship a glyph
 * and a text label beside them, because red and green are ΔE 4.1 apart under
 * deuteranopia and cannot carry meaning on their own.
 */

/** The headline. A single number is not a chart, and should not pretend to be. */
export function ReliabilityHero({ metrics }: { metrics: SuiteMetrics }) {
  const { interval, reliability, passedRuns, scoredRuns } = metrics
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
      <div>
        <div className="section-title">Reliability</div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-6xl font-semibold leading-none tracking-tight">
            {scoredRuns === 0 ? "—" : percent(reliability)}
          </span>
          <span className="text-sm text-[var(--color-ink-2)]">
            {fraction(passedRuns, scoredRuns)} runs passed
          </span>
        </div>
        {scoredRuns > 0 ? (
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">
            95% confidence interval {percent(interval.low, 1)} – {percent(interval.high, 1)} over{" "}
            {scoredRuns} scored {scoredRuns === 1 ? "run" : "runs"}
          </p>
        ) : null}
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <Split
          label="Baseline"
          value={metrics.baselineReliability}
          interval={metrics.baselineInterval}
        />
        <Split
          label="Perturbed"
          value={metrics.perturbedReliability}
          interval={metrics.perturbedInterval}
        />
      </dl>
    </div>
  )
}

function Split({
  label,
  value,
  interval,
}: {
  label: string
  value: number | null
  interval: { low: number; high: number } | null
}) {
  return (
    <div>
      <dt className="section-title">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">
        {value === null ? "—" : percent(value)}
      </dd>
      {interval ? (
        <div className="text-xs text-[var(--color-ink-3)] tnum">
          {percent(interval.low, 0)}–{percent(interval.high, 0)}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Reliability per perturbation, worst first.
 *
 * One series, so one hue. The bar carries magnitude; the Wilson interval is
 * drawn over it as a thin whisker, because "3/3 = 100%" from three runs is not
 * the same claim as "30/30 = 100%" and the chart should not let you forget it.
 */
export function ReliabilityByVariant({ variants }: { variants: VariantMetrics[] }) {
  // Sorted here rather than in the metrics: the matrix below wants a STABLE
  // order so two runs can be compared row by row, while this chart wants the
  // problems at the top. Same data, two different jobs.
  const rows = [...variants]
    .filter((v) => v.total > 0)
    .sort((a, b) => a.reliability - b.reliability || a.variantName.localeCompare(b.variantName))
  if (rows.length === 0)
    return <p className="text-sm text-[var(--color-ink-3)]">No scored runs yet.</p>

  return (
    <div className="space-y-2.5">
      {rows.map((variant) => (
        <div
          key={variant.variant}
          className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(7rem,10rem)_1fr_auto]"
        >
          <div className="min-w-0 sm:col-auto">
            <div className="truncate text-sm">{variant.variantName}</div>
            <div className="text-[11px] text-[var(--color-ink-3)]">
              {CATEGORY_LABELS[variant.category]}
            </div>
          </div>

          <div
            className="relative order-last col-span-2 h-6 rounded bg-[var(--color-raised)] sm:order-none sm:col-span-1"
            role="img"
            aria-label={`${variant.variantName}: ${percent(variant.reliability)}, ${fraction(variant.passed, variant.total)} runs passed`}
            title={`${fraction(variant.passed, variant.total)} passed · 95% CI ${percent(variant.interval.low, 0)}–${percent(variant.interval.high, 0)}`}
          >
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${Math.max(variant.reliability * 100, variant.reliability > 0 ? 1.5 : 0)}%`,
                background: "var(--color-accent)",
              }}
            />
            {/* Confidence whisker, drawn above the fill. */}
            <div
              className="absolute top-1/2 h-[9px] -translate-y-1/2 border-x-2"
              style={{
                left: `${variant.interval.low * 100}%`,
                width: `${Math.max((variant.interval.high - variant.interval.low) * 100, 0.5)}%`,
                borderColor: "color-mix(in oklab, var(--color-ink) 55%, transparent)",
              }}
              aria-hidden
            >
              <div
                className="absolute top-1/2 h-px w-full -translate-y-1/2"
                style={{ background: "color-mix(in oklab, var(--color-ink) 40%, transparent)" }}
              />
            </div>
          </div>

          <div className="w-24 shrink-0 text-right text-sm tnum">
            <span className="font-medium">{percent(variant.reliability)}</span>
            <span className="ml-2 text-xs text-[var(--color-ink-3)]">
              {fraction(variant.passed, variant.total)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ReliabilityByCategory({ categories }: { categories: CategoryMetrics[] }) {
  if (categories.length === 0)
    return <p className="text-sm text-[var(--color-ink-3)]">No scored runs yet.</p>
  return (
    <div className="space-y-2.5">
      {categories.map((category) => (
        <div key={category.category} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3">
          <div className="truncate text-sm">{CATEGORY_LABELS[category.category]}</div>
          <div
            className="relative h-5 rounded bg-[var(--color-raised)]"
            role="img"
            aria-label={`${CATEGORY_LABELS[category.category]}: ${percent(category.reliability)} over ${category.total} runs`}
          >
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${Math.max(category.reliability * 100, category.reliability > 0 ? 1.5 : 0)}%`,
                background: "var(--color-accent)",
              }}
            />
          </div>
          <div className="w-20 text-right text-sm tnum">
            {percent(category.reliability)}
            <span className="ml-2 text-xs text-[var(--color-ink-3)]">
              {fraction(category.passed, category.total)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function FailureDistribution({
  distribution,
}: {
  distribution: Array<{ category: FailureCategory; count: number; share: number }>
}) {
  if (distribution.length === 0) {
    return <p className="text-sm text-[var(--color-ink-3)]">No failures to categorise.</p>
  }
  const max = Math.max(...distribution.map((d) => d.count))

  return (
    <div className="space-y-2.5">
      {distribution.map((entry) => {
        const meta = FAILURE_CATEGORY_META[entry.category]
        return (
          <div
            key={entry.category}
            className="grid grid-cols-[minmax(7rem,9rem)_1fr_auto] items-center gap-3"
          >
            <div className="truncate text-sm" title={meta.summary}>
              {meta.label}
            </div>
            <div
              className="relative h-5 rounded bg-[var(--color-raised)]"
              role="img"
              aria-label={`${meta.label}: ${entry.count} ${entry.count === 1 ? "run" : "runs"}`}
            >
              <div
                className="absolute inset-y-0 left-0 rounded"
                style={{
                  width: `${(entry.count / max) * 100}%`,
                  background:
                    meta.blame === "infrastructure"
                      ? "var(--color-warning)"
                      : "var(--color-serious)",
                }}
              />
            </div>
            <div className="w-16 text-right text-sm tnum">
              {entry.count}
              <span className="ml-2 text-xs text-[var(--color-ink-3)]">{percent(entry.share)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The run matrix — the signature view.
 *
 * A real <table> with proper header cells, so a screen reader reads
 * "Cookie popup, run 2, Failed" rather than announcing a grid of divs. Each
 * cell carries a glyph, an accessible label and a tooltip; the fill colour is
 * the least important of the four channels.
 */
export function RunMatrix({
  variants,
  suiteRunId,
  runIndex,
}: {
  variants: VariantMetrics[]
  suiteRunId: string
  runIndex: Map<string, string>
}) {
  const repetitions = Math.max(1, ...variants.map((v) => v.outcomes.length))

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Outcome of every run, by perturbation and repetition. Select a cell to open that run.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="px-2 py-2 text-left text-xs font-medium text-[var(--color-ink-3)]"
            >
              Perturbation
            </th>
            {Array.from({ length: repetitions }, (_, i) => (
              <th
                key={i}
                scope="col"
                className="px-2 py-2 text-center text-xs font-medium text-[var(--color-ink-3)]"
              >
                Run {i + 1}
              </th>
            ))}
            <th
              scope="col"
              className="px-2 py-2 text-right text-xs font-medium text-[var(--color-ink-3)]"
            >
              Rate
            </th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => (
            <tr key={variant.variant} className="border-t border-[var(--color-line)]">
              <th scope="row" className="max-w-[12rem] truncate px-2 py-1.5 text-left font-normal">
                {variant.variantName}
              </th>
              {Array.from({ length: repetitions }, (_, i) => {
                const outcome = variant.outcomes[i]
                const runId = outcome
                  ? runIndex.get(`${variant.variant}#${outcome.repetition}`)
                  : undefined
                return (
                  <td key={i} className="px-1 py-1 text-center">
                    {outcome ? (
                      <MatrixCell
                        status={outcome.status as RunStatus}
                        variantName={variant.variantName}
                        repetition={outcome.repetition}
                        href={runId ? `/runs/${suiteRunId}/individual/${runId}` : undefined}
                      />
                    ) : (
                      <span className="text-[var(--color-ink-3)]" aria-hidden>
                        ·
                      </span>
                    )}
                  </td>
                )
              })}
              <td className="px-2 py-1.5 text-right tnum">
                <span
                  className={
                    variant.reliability < 1
                      ? "text-[var(--color-ink)]"
                      : "text-[var(--color-ink-2)]"
                  }
                >
                  {variant.total > 0 ? percent(variant.reliability) : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MatrixCell({
  status,
  variantName,
  repetition,
  href,
}: {
  status: RunStatus
  variantName: string
  repetition: number
  href?: string
}) {
  const meta = STATUS_META[status]
  const label = `${variantName}, run ${repetition}: ${meta.label}`
  const isTerminal = status === "passed" || status === "failed" || status === "infrastructure_error"

  const body = (
    <span
      className={clsx(
        "inline-flex h-8 w-full min-w-8 items-center justify-center rounded border text-xs font-semibold",
        !isTerminal && "pulse",
      )}
      style={{
        // Passed is a solid fill, failed is an outline — the shapes differ, so
        // the cells stay distinguishable in greyscale or with no colour at all.
        background:
          status === "passed"
            ? "color-mix(in oklab, var(--color-good) 22%, transparent)"
            : "transparent",
        borderColor: `color-mix(in oklab, ${meta.color} 55%, transparent)`,
        color: meta.color,
      }}
    >
      <meta.Icon size={14} aria-hidden className={meta.spin ? "animate-spin" : undefined} />
      <span className="sr-only">{label}</span>
    </span>
  )

  if (!href) return <span title={label}>{body}</span>
  return (
    <Link href={href} title={label} aria-label={label} className="block hover:opacity-80">
      {body}
    </Link>
  )
}
