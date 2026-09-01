"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { GitBranch, RefreshCw } from "lucide-react"
import type { SuiteRunView } from "@/lib/queries"
import { duration, percent, relativeTime, shortId } from "@/lib/format"
import { EmptyState, ErrorPanel, ModeBadge, Panel, StatTile, StatusPill } from "./primitives"
import {
  FailureDistribution,
  ReliabilityByCategory,
  ReliabilityByVariant,
  ReliabilityHero,
  RunMatrix,
} from "./charts"
import { FAILURE_CATEGORY_META, type FailureCategory } from "@gauntlet/core/shared"

const LIVE_STATUSES = new Set(["queued", "preparing", "running", "evaluating"])

export function RunDashboard({ initial }: { initial: SuiteRunView }) {
  const [view, setView] = useState(initial)
  const [streamError, setStreamError] = useState<string | null>(null)
  const live = LIVE_STATUSES.has(view.status)

  /**
   * Live updates over SSE while the suite is in flight.
   *
   * The stream closes itself when the run reaches a terminal state, so a
   * finished dashboard holds no connection at all — no polling loop left
   * running behind a tab somebody forgot to close.
   */
  useEffect(() => {
    if (!live) return
    const source = new EventSource(`/api/suite-runs/${initial.id}/stream`)

    source.addEventListener("update", (event) => {
      try {
        setView(JSON.parse((event as MessageEvent<string>).data) as SuiteRunView)
        setStreamError(null)
      } catch {
        setStreamError("Received an update we could not read.")
      }
    })
    source.addEventListener("done", () => source.close())
    source.addEventListener("error", () => {
      setStreamError("The live feed dropped. Refresh to see the latest state.")
      source.close()
    })

    return () => source.close()
    // Keyed on the run and on whether it is still live — NOT on the view
    // itself. Depending on the view would tear down and re-open the stream on
    // every update it delivers, which is a reconnect loop wearing a disguise.
  }, [initial.id, live])

  const runIndex = useMemo(
    () => new Map(view.runs.map((r) => [`${r.variant}#${r.repetition}`, r.id])),
    [view.runs],
  )

  const { metrics } = view
  const progress = metrics.totalRuns === 0 ? 0 : (metrics.totalRuns - metrics.pendingRuns) / metrics.totalRuns
  const failures = view.runs.filter((r) => r.status === "failed")

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {view.label ?? view.suiteName}
            </h1>
            <ModeBadge mode={view.mode} />
            {live ? (
              <span className="chip pulse" style={{ color: "var(--color-accent)" }}>
                <RefreshCw size={11} aria-hidden className="animate-spin" />
                Running
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {view.agentName} · {view.taskName} · run {shortId(view.id)} ·{" "}
            {view.completedAt ? relativeTime(view.completedAt) : relativeTime(view.createdAt)}
          </p>
          {view.git.branch ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-ink-3)]">
              <GitBranch size={12} aria-hidden />
              {view.git.repo} · {view.git.branch}
              {view.git.sha ? ` @ ${view.git.sha}` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Link className="btn btn-secondary" href="/runs">
            All runs
          </Link>
        </div>
      </header>

      {view.errorMessage ? (
        <ErrorPanel
          title="This suite did not finish"
          message={view.errorMessage}
          {...(view.errorCode ? { hint: `Error code: ${view.errorCode}` } : {})}
        />
      ) : null}
      {streamError ? (
        <ErrorPanel title="Live updates stopped" message={streamError} hint="The run itself is unaffected." />
      ) : null}

      {live ? (
        <div className="card px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {metrics.totalRuns - metrics.pendingRuns} / {metrics.totalRuns} runs complete
            </span>
            <span className="text-[var(--color-ink-2)]">
              reliability so far {metrics.scoredRuns > 0 ? percent(metrics.reliability) : "—"}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-raised)]"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Suite progress"
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${progress * 100}%`, background: "var(--color-accent)" }}
            />
          </div>
        </div>
      ) : null}

      <section className="card p-6">
        <ReliabilityHero metrics={metrics} />
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Runs" value={metrics.totalRuns} sub={`${metrics.scoredRuns} scored`} />
        <StatTile
          label="Failed"
          value={metrics.failedRuns}
          tone={metrics.failedRuns > 0 ? "critical" : "default"}
          sub={metrics.infrastructureErrors > 0 ? `${metrics.infrastructureErrors} infra errors (unscored)` : "no infra errors"}
        />
        <StatTile label="p95 duration" value={duration(metrics.p95DurationMs)} sub={`p50 ${duration(metrics.p50DurationMs)}`} />
        <StatTile label="Avg steps" value={metrics.avgSteps || "—"} sub={`avg ${duration(metrics.avgDurationMs)}`} />
        <StatTile
          label="Run-to-run flips"
          value={percent(metrics.meanFlipRate)}
          sub="how often identical repetitions disagreed"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Panel
          title="Reliability by perturbation"
          description="Worst first. The whisker is the 95% Wilson interval — small samples are wide on purpose."
        >
          <ReliabilityByVariant variants={metrics.byVariant} />
        </Panel>

        <div className="space-y-6">
          <Panel title="Reliability by category">
            <ReliabilityByCategory categories={metrics.byCategory} />
          </Panel>
          <Panel title="Failure distribution" description="Only scored failures. Infrastructure errors are excluded.">
            <FailureDistribution distribution={metrics.failureDistribution} />
          </Panel>
        </div>
      </div>

      <Panel
        title="Run matrix"
        description="Every cell is one run. Select one to open its evidence."
      >
        <RunMatrix variants={metrics.byVariant} suiteRunId={view.id} runIndex={runIndex} />
      </Panel>

      {view.clusters.length > 0 ? (
        <Panel
          title="Failure clusters"
          description="Failures grouped by category and cause, so a repeated defect reads as one problem."
        >
          <ul className="space-y-2">
            {view.clusters.map((cluster, index) => (
              <li key={index} className="flex items-start gap-3 rounded border border-[var(--color-line)] px-3 py-2">
                <span
                  className="chip mt-0.5"
                  style={{ color: "var(--color-serious)", borderColor: "color-mix(in oklab, var(--color-serious) 45%, transparent)" }}
                >
                  {FAILURE_CATEGORY_META[cluster.category as FailureCategory].label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{cluster.representativeMessage}</p>
                  <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                    {cluster.count} {cluster.count === 1 ? "run" : "runs"} ·{" "}
                    {cluster.runIds.slice(0, 4).map((id, i) => (
                      <span key={id}>
                        {i > 0 ? ", " : ""}
                        <Link className="hover:text-[var(--color-ink)]" href={`/runs/${view.id}/individual/${id}`}>
                          {shortId(id)}
                        </Link>
                      </span>
                    ))}
                    {cluster.runIds.length > 4 ? ` +${cluster.runIds.length - 4} more` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Individual failures" description="Open one to see the assertion that failed and the trace that led there.">
        {failures.length === 0 ? (
          <EmptyState title="No failures in this run.">
            Every scored run satisfied the task&apos;s assertions.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {failures.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/runs/${view.id}/individual/${run.id}`}
                  className="-mx-2 flex items-center gap-4 rounded px-2 py-2.5 transition-colors hover:bg-[var(--color-raised)]"
                >
                  <StatusPill status={run.status} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {run.variantName} · run {run.repetition}
                    </div>
                    <div className="truncate text-xs text-[var(--color-ink-3)]">{run.failureMessage}</div>
                  </div>
                  <span className="chip">{run.failureCategory ?? "unknown"}</span>
                  <span className="hidden w-16 text-right text-xs text-[var(--color-ink-3)] tnum sm:block">
                    {duration(run.durationMs)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
