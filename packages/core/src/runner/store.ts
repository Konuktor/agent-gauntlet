import type { ReplayStatus } from "../domain/run.js"
import type { EvaluationResult } from "../domain/evaluation.js"
import type { RunEventInput } from "../domain/events.js"
import type { IndividualRunStatus, SuiteRunStatus } from "../domain/run.js"
import type { SuiteMetrics } from "../metrics/reliability.js"

/** One planned run in the grid. */
export interface PlannedRun {
  id: string
  variant: string
  variantName: string
  repetition: number
  seed: number
  status: IndividualRunStatus
}

export interface RunPatch {
  status?: IndividualRunStatus
  sessionId?: string | null
  sandboxId?: string | null
  startedAt?: Date
  completedAt?: Date
  durationMs?: number
  steps?: number
  errorCode?: string | null
  failureCategory?: string | null
  failureMessage?: string | null
  replayStatus?: ReplayStatus
  replayAttempts?: number
  replayNextAttemptAt?: Date | null
  replayEventCount?: number | null
  replayBytes?: number | null
  replayArtifactPath?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Everything the orchestrator needs to persist, expressed as a port.
 *
 * Keeps the runner free of Drizzle and Postgres, which is what makes the
 * failure-injection tests below possible: a suite where the browser dies, the
 * evaluator 500s and the replay never uploads is a few lines of fake, not a
 * chaos-engineering exercise against a real database.
 */
export interface RunStore {
  listPlannedRuns(): Promise<PlannedRun[]>
  setSuiteStatus(
    status: SuiteRunStatus,
    patch?: {
      errorCode?: string
      errorMessage?: string
      fixtureSandboxId?: string
      completedAt?: Date
    },
  ): Promise<void>
  updateRun(runId: string, patch: RunPatch): Promise<void>
  appendEvents(runId: string, events: RunEventInput[]): Promise<void>
  saveEvaluation(runId: string, result: EvaluationResult): Promise<void>
  refreshMetrics(): Promise<SuiteMetrics>
  /** Called periodically so a dead worker's claim can be reclaimed. */
  heartbeat(): Promise<void>
  /** Persist a replay artifact, returning where it was written. */
  saveReplay(runId: string, bytes: Uint8Array): Promise<string>
}
