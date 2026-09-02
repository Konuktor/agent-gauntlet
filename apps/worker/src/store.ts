import { gzip as gzipCallback } from "node:zlib"
import { promisify } from "node:util"
import { redactValue } from "@gauntlet/config"
import {
  appendRunEvents,
  listIndividualRuns,
  patchIndividualRun,
  refreshSuiteRunMetrics,
  saveEvaluation,
  saveReplayArtifact,
  transitionIndividualRun,
  transitionSuiteRun,
  heartbeat as heartbeatQuery,
  type Database,
} from "@gauntlet/db"
import type {
  EvaluationResult,
  IndividualRunStatus,
  PlannedRun,
  RunEventInput,
  RunPatch,
  RunStore,
  SuiteMetrics,
  SuiteRunStatus,
} from "@gauntlet/core"

/**
 * The orchestrator's persistence port, backed by Postgres.
 *
 * All the state-machine enforcement lives in the query layer, so an impossible
 * transition is rejected at the database boundary rather than only in memory.
 *
 * It is also the last place a secret can be stopped. Everything written here is
 * later served by the API and rendered on a run page, and the text is not ours:
 * a Playwright connect failure quotes the endpoint it was given, verbatim, and
 * that endpoint is a live credential — "anyone holding the URL can drive the
 * browser". The logger has always scrubbed. Persistence has to as well, or the
 * run detail page hands out what the log refused to print.
 */
export class DrizzleRunStore implements RunStore {
  constructor(
    private readonly db: Database,
    private readonly suiteRunId: string,
    private readonly workerId: string,
    private readonly replaySource: string = "solari",
  ) {}

  async listPlannedRuns(): Promise<PlannedRun[]> {
    const rows = await listIndividualRuns(this.db, this.suiteRunId)
    return rows.map((row) => ({
      id: row.id,
      variant: row.variant,
      variantName: row.variantName,
      repetition: row.repetition,
      seed: row.seed,
      status: row.status as IndividualRunStatus,
    }))
  }

  async setSuiteStatus(
    status: SuiteRunStatus,
    patch: { errorCode?: string; errorMessage?: string; fixtureSandboxId?: string; completedAt?: Date } = {},
  ): Promise<void> {
    await transitionSuiteRun(this.db, this.suiteRunId, status, {
      ...(patch.errorCode ? { errorCode: patch.errorCode } : {}),
      ...(patch.errorMessage ? { errorMessage: scrub(patch.errorMessage) } : {}),
      ...(patch.fixtureSandboxId ? { fixtureSandboxId: patch.fixtureSandboxId } : {}),
      ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
    })
  }

  async updateRun(runId: string, patch: RunPatch): Promise<void> {
    const { status, metadata, ...rest } = patch
    const columns = {
      ...scrub(rest),
      ...(metadata ? { metadataJson: scrub(metadata) } : {}),
    }
    if (status) {
      await transitionIndividualRun(this.db, runId, status, columns)
    } else {
      await patchIndividualRun(this.db, runId, columns)
    }
  }

  async appendEvents(runId: string, events: RunEventInput[]): Promise<void> {
    // The recorder carries agent output and page URLs; both can quote an
    // endpoint we were handed.
    await appendRunEvents(this.db, runId, scrub(events))
  }

  async saveEvaluation(runId: string, result: EvaluationResult): Promise<void> {
    await saveEvaluation(this.db, runId, {
      success: result.success,
      score: result.score,
      assertions: scrub(result.assertions),
      evidence: scrub(result.evidence),
      agentClaim: (result.evidence as { agentClaim?: unknown }).agentClaim,
    })
  }

  async refreshMetrics(): Promise<SuiteMetrics> {
    return refreshSuiteRunMetrics(this.db, this.suiteRunId)
  }

  async heartbeat(): Promise<void> {
    await heartbeatQuery(this.db, this.suiteRunId, this.workerId)
  }

  /**
   * Persist a replay in Postgres.
   *
   * Not on local disk: the deployment target's filesystem is ephemeral, so a
   * replay written there is evidence that silently disappears on the next
   * restart. Gzipped first — rrweb NDJSON compresses roughly ten to one, and
   * the size cap has already been applied upstream.
   */
  async saveReplay(runId: string, bytes: Uint8Array): Promise<string> {
    const compressed = await gzip(Buffer.from(bytes))
    await saveReplayArtifact(this.db, runId, {
      compressed,
      eventCount: countLines(bytes),
      rawBytes: bytes.length,
      source: this.replaySource,
    })
    return `db:replay_artifacts/${runId}`
  }
}

const gzip = promisify(gzipCallback)

function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  let count = 1
  for (const byte of bytes) if (byte === 0x0a) count++
  return count
}

/**
 * Scrub secrets out of anything on its way into the database.
 *
 * Typed as identity because it is: {@link redactValue} rewrites strings and
 * leaves every other shape — Dates, byte arrays, class instances — alone.
 */
function scrub<T>(value: T): T {
  return redactValue(value) as T
}
