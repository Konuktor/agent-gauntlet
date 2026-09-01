import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
  computeSuiteMetrics,
  type EvaluationResult,
  type IndividualRunStatus,
  type PlannedRun,
  type PerturbationCategory,
  type RunEventInput,
  type RunPatch,
  type RunStore,
  type SuiteMetrics,
  type SuiteRunStatus,
} from "@gauntlet/core"
import type { FailureCategory } from "@gauntlet/core"

/**
 * The CLI's run store: entirely in memory, with artifacts written to disk.
 *
 * Deliberately not Postgres. A reliability gate in CI should need a checkout, a
 * Node runtime and an API key — not a database service — and requiring one would
 * be the difference between a job people actually add to their pipeline and one
 * they mean to get around to.
 */
export class InMemoryRunStore implements RunStore {
  readonly runs = new Map<string, PlannedRun & RunPatch>()
  readonly evaluations = new Map<string, EvaluationResult>()
  readonly events = new Map<string, RunEventInput[]>()
  status: SuiteRunStatus = "queued"

  constructor(
    planned: PlannedRun[],
    private readonly categoryOf: (variant: string) => PerturbationCategory,
    private readonly replayDir: string | null,
    private readonly onProgress?: (runs: Array<PlannedRun & RunPatch>) => void,
  ) {
    for (const run of planned) this.runs.set(run.id, { ...run })
  }

  async listPlannedRuns(): Promise<PlannedRun[]> {
    return [...this.runs.values()].map((r) => ({
      id: r.id,
      variant: r.variant,
      variantName: r.variantName,
      repetition: r.repetition,
      seed: r.seed,
      status: r.status as IndividualRunStatus,
    }))
  }

  async setSuiteStatus(status: SuiteRunStatus): Promise<void> {
    this.status = status
  }

  async updateRun(runId: string, patch: RunPatch): Promise<void> {
    const current = this.runs.get(runId)
    if (!current) return
    this.runs.set(runId, { ...current, ...patch })
    this.onProgress?.([...this.runs.values()])
  }

  async appendEvents(runId: string, events: RunEventInput[]): Promise<void> {
    this.events.set(runId, [...(this.events.get(runId) ?? []), ...events])
  }

  async saveEvaluation(runId: string, result: EvaluationResult): Promise<void> {
    this.evaluations.set(runId, result)
  }

  async refreshMetrics(): Promise<SuiteMetrics> {
    return computeSuiteMetrics(
      [...this.runs.values()].map((r) => ({
        variant: r.variant,
        variantName: r.variantName,
        category: this.categoryOf(r.variant),
        repetition: r.repetition,
        status: (r.status ?? "queued") as IndividualRunStatus,
        durationMs: r.durationMs ?? null,
        steps: r.steps ?? null,
        failureCategory: (r.failureCategory ?? null) as FailureCategory | null,
      })),
    )
  }

  async heartbeat(): Promise<void> {
    // Nothing to reclaim: the CLI is the only worker and it dies with the run.
  }

  async saveReplay(runId: string, bytes: Uint8Array): Promise<string> {
    if (!this.replayDir) return ""
    const path = `${this.replayDir}/${runId}.ndjson`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(bytes))
    return path
  }
}
