import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, TrendingDown, TrendingUp, Minus, AlertTriangle } from "lucide-react"
import { REGRESSION_THRESHOLD_PP } from "@gauntlet/core"
import { loadComparison } from "@/lib/queries"
import { percent, relativeTime } from "@/lib/format"
import { ModeBadge, Panel } from "@/components/primitives"

export const dynamic = "force-dynamic"

export default async function ComparePage(ctx: {
  params: Promise<{ id: string; otherId: string }>
}) {
  const { id, otherId } = await ctx.params
  const result = await loadComparison(id, otherId)
  if (!result) notFound()

  const { previous, current, comparison } = result
  const regressed = comparison.regressed
  const regressedVariants = comparison.variants.filter((v) => v.regressed).length
  const deltaColor = regressed
    ? "var(--color-critical)"
    : comparison.deltaPp > 0
      ? "var(--color-good)"
      : "var(--color-ink-2)"

  return (
    <div className="space-y-6">
      <Link className="btn btn-ghost -ml-2" href={`/runs/${otherId}`}>
        <ArrowLeft size={15} aria-hidden />
        Back to the run
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Regression comparison</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          {previous.label ?? "Baseline"} → {current.label ?? "Current"}
        </p>
      </header>

      {regressed ? (
        <div
          className="card flex items-start gap-3 p-4"
          style={{ borderColor: "color-mix(in oklab, var(--color-critical) 35%, transparent)" }}
        >
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--color-critical)" }}
            aria-hidden
          />
          <div>
            <h2 className="text-sm font-semibold">Regression detected</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              Reliability moved {comparison.deltaPp} percentage points
              {regressedVariants > 0
                ? `, and ${regressedVariants} ${regressedVariants === 1 ? "perturbation" : "perturbations"} got measurably worse.`
                : "."}{" "}
              A drop of {REGRESSION_THRESHOLD_PP}pp or more counts; smaller moves are treated as
              noise.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SideCard title="Baseline" run={previous} />
        <div className="card flex flex-col items-center justify-center p-6">
          <div className="section-title">Delta</div>
          <div
            className="mt-1 flex items-center gap-2 text-4xl font-semibold"
            style={{ color: deltaColor }}
          >
            {comparison.deltaPp > 0 ? (
              <TrendingUp size={26} aria-hidden />
            ) : comparison.deltaPp < 0 ? (
              <TrendingDown size={26} aria-hidden />
            ) : (
              <Minus size={26} aria-hidden />
            )}
            <span className="tabular-nums">
              {comparison.deltaPp > 0 ? "+" : ""}
              {comparison.deltaPp}
            </span>
          </div>
          <div className="mt-1 text-xs text-[var(--color-ink-3)]">percentage points</div>
        </div>
        <SideCard title="Current" run={current} />
      </div>

      {comparison.variantSetsDiffer ? (
        <p className="text-xs text-[var(--color-ink-3)]">
          These runs did not test exactly the same variant set, so rows without a value on both
          sides are not comparable.
        </p>
      ) : null}

      <Panel title="Per perturbation" description="Sorted with regressions first.">
        <table className="w-full text-sm">
          <caption className="sr-only">Reliability change per perturbation</caption>
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-3)]">
              <th scope="col" className="pb-2 font-medium">
                Perturbation
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Baseline
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Current
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {[...comparison.variants]
              .sort((a, b) => (a.deltaPp ?? 0) - (b.deltaPp ?? 0))
              .map((variant) => (
                <tr key={variant.variant} className="border-t border-[var(--color-line)]">
                  <td className="py-2">{variant.variantName}</td>
                  <td className="py-2 text-right tnum text-[var(--color-ink-2)]">
                    {variant.previous === null ? "—" : percent(variant.previous)}
                  </td>
                  <td className="py-2 text-right tnum">
                    {variant.current === null ? "—" : percent(variant.current)}
                  </td>
                  <td className="py-2 text-right">
                    {variant.deltaPp === null ? (
                      <span className="text-[var(--color-ink-3)]">—</span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 tabular-nums"
                        style={{
                          color: variant.regressed
                            ? "var(--color-critical)"
                            : variant.improved
                              ? "var(--color-good)"
                              : "var(--color-ink-3)",
                        }}
                      >
                        {variant.regressed ? (
                          <TrendingDown size={13} aria-hidden />
                        ) : variant.improved ? (
                          <TrendingUp size={13} aria-hidden />
                        ) : (
                          <Minus size={13} aria-hidden />
                        )}
                        {variant.deltaPp > 0 ? "+" : ""}
                        {variant.deltaPp}pp
                        <span className="sr-only">
                          {variant.regressed
                            ? " regression"
                            : variant.improved
                              ? " improvement"
                              : " unchanged"}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

function SideCard({
  title,
  run,
}: {
  title: string
  run: {
    id: string
    label: string | null
    mode: string
    completedAt: string | null
    metrics: { reliability: number; passedRuns: number; scoredRuns: number }
    git: { branch: string | null; sha: string | null }
  }
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="section-title">{title}</span>
        <ModeBadge mode={run.mode} />
      </div>
      <Link
        href={`/runs/${run.id}`}
        className="mt-2 block text-4xl font-semibold tabular-nums hover:underline"
      >
        {percent(run.metrics.reliability)}
      </Link>
      <div className="mt-1 text-sm text-[var(--color-ink-2)]">
        {run.metrics.passedRuns} / {run.metrics.scoredRuns} runs passed
      </div>
      <div className="mt-2 text-xs text-[var(--color-ink-3)]">
        {run.label ?? "—"}
        {run.git.branch ? ` · ${run.git.branch}` : ""} · {relativeTime(run.completedAt)}
      </div>
    </div>
  )
}
