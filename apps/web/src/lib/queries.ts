import "server-only"
import {
  computeSuiteMetrics,
  compareSuites,
  clusterFailures,
  type FailureCategory,
  type PerturbationCategory,
  type IndividualRunStatus,
  type RunSummary,
  type SuiteComparison,
  type SuiteMetrics,
} from "@gauntlet/core"
import {
  getEvaluation,
  getIndividualRun,
  getSuiteRun,
  getSuiteRunContext,
  listIndividualRuns,
  listRunEvents,
  listSuiteRuns,
  type IndividualRun,
} from "@gauntlet/db"
import { db } from "./server.js"

export interface SuiteRunView {
  id: string
  suiteId: string
  suiteName: string
  agentName: string
  taskName: string
  status: string
  mode: string
  label: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  git: { repo: string | null; branch: string | null; sha: string | null }
  errorCode: string | null
  errorMessage: string | null
  metrics: SuiteMetrics
  runs: IndividualRunView[]
  clusters: ReturnType<typeof clusterFailures>
}

export interface IndividualRunView {
  id: string
  variant: string
  variantName: string
  category: PerturbationCategory
  repetition: number
  status: IndividualRunStatus
  durationMs: number | null
  steps: number | null
  sessionId: string | null
  failureCategory: FailureCategory | null
  failureMessage: string | null
  replayStatus: string
  replayEventCount: number | null
}

function toRunView(row: IndividualRun): IndividualRunView {
  return {
    id: row.id,
    variant: row.variant,
    variantName: row.variantName,
    category: row.category as PerturbationCategory,
    repetition: row.repetition,
    status: row.status as IndividualRunStatus,
    durationMs: row.durationMs,
    steps: row.steps,
    sessionId: row.sessionId,
    failureCategory: row.failureCategory as FailureCategory | null,
    failureMessage: row.failureMessage,
    replayStatus: row.replayStatus,
    replayEventCount: row.replayEventCount,
  }
}

function toSummaries(rows: IndividualRun[]): RunSummary[] {
  return rows.map((r) => ({
    variant: r.variant,
    variantName: r.variantName,
    category: r.category as PerturbationCategory,
    repetition: r.repetition,
    status: r.status as IndividualRunStatus,
    durationMs: r.durationMs,
    steps: r.steps,
    failureCategory: r.failureCategory as FailureCategory | null,
  }))
}

export async function loadSuiteRun(suiteRunId: string): Promise<SuiteRunView | null> {
  const database = db()
  const run = await getSuiteRun(database, suiteRunId)
  if (!run) return null

  const context = await getSuiteRunContext(database, suiteRunId)

  const rows = await listIndividualRuns(database, suiteRunId)

  // Metrics are recomputed from the rows rather than trusted from the snapshot:
  // while a suite is live the snapshot is always one write behind.
  const metrics = computeSuiteMetrics(toSummaries(rows))

  return {
    id: run.id,
    suiteId: run.suiteId,
    suiteName: context?.suiteName ?? "Suite",
    agentName: context?.agentName ?? "Agent",
    taskName: context?.taskName ?? "Task",
    status: run.status,
    mode: run.mode,
    label: run.label,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    git: { repo: run.gitRepo, branch: run.gitBranch, sha: run.gitSha },
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    metrics,
    runs: rows.map(toRunView),
    clusters: clusterFailures(
      rows
        .filter((r) => r.status === "failed" && r.failureCategory)
        .map((r) => ({
          runId: r.id,
          category: r.failureCategory as FailureCategory,
          message: r.failureMessage ?? "",
        })),
    ),
  }
}

export interface RunDetailView {
  run: IndividualRunView & { suiteRunId: string; startedAt: string | null; completedAt: string | null; mode: string }
  events: Array<{ sequence: number; timestamp: string; type: string; payload: Record<string, unknown> }>
  evaluation: {
    success: boolean
    score: number
    assertions: Array<{ name: string; description: string; expected: unknown; actual: unknown; passed: boolean; weight: number }>
    evidence: Record<string, unknown>
  } | null
}

export async function loadRunDetail(runId: string): Promise<RunDetailView | null> {
  const database = db()
  const run = await getIndividualRun(database, runId)
  if (!run) return null

  const suiteRun = await getSuiteRun(database, run.suiteRunId)
  const [events, evaluation] = await Promise.all([
    listRunEvents(database, runId),
    getEvaluation(database, runId),
  ])

  return {
    run: {
      ...toRunView(run),
      suiteRunId: run.suiteRunId,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      mode: suiteRun?.mode ?? "demo",
    },
    events: events.map((e) => ({
      sequence: e.sequence,
      timestamp: e.timestamp.toISOString(),
      type: e.type,
      payload: e.payloadJson as Record<string, unknown>,
    })),
    evaluation: evaluation
      ? {
          success: evaluation.success,
          score: evaluation.score,
          assertions: evaluation.assertionsJson as RunDetailView["evaluation"] extends null
            ? never
            : Array<{ name: string; description: string; expected: unknown; actual: unknown; passed: boolean; weight: number }>,
          evidence: evaluation.evidenceJson as Record<string, unknown>,
        }
      : null,
  }
}

export async function loadComparison(
  previousId: string,
  currentId: string,
): Promise<{ previous: SuiteRunView; current: SuiteRunView; comparison: SuiteComparison } | null> {
  const [previous, current] = await Promise.all([loadSuiteRun(previousId), loadSuiteRun(currentId)])
  if (!previous || !current) return null
  return { previous, current, comparison: compareSuites(previous.metrics, current.metrics) }
}

export async function loadRecentSuiteRuns(limit = 20) {
  return listSuiteRuns(db(), { limit })
}
