import { and, asc, count, desc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm"
import {
  assertRunTransition,
  assertSuiteTransition,
  computeSuiteMetrics,
  type IndividualRunStatus,
  type PerturbationCategory,
  type RunSummary,
  type SuiteMetrics,
  type SuiteRunStatus,
} from "@gauntlet/core"
import type { FailureCategory } from "@gauntlet/core"
import type { Database } from "./client.js"
import {
  agents,
  evaluationResults,
  individualRuns,
  projects,
  runEvents,
  replayArtifacts,
  suiteRuns,
  suiteVariants,
  suites,
  taskDefinitions,
  type Agent,
  type EvaluationResultRow,
  type IndividualRun,
  type Project,
  type RunEventRow,
  type Suite,
  type SuiteRun,
  type SuiteVariant,
  type TaskDefinitionRow,
} from "./schema.js"

// ── reads ────────────────────────────────────────────────────────────────────

export async function getProjectBySlug(db: Database, slug: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
  return row ?? null
}

export async function listProjects(db: Database): Promise<Project[]> {
  return db.select().from(projects).orderBy(asc(projects.createdAt))
}

export async function listAgents(db: Database, projectId: string): Promise<Agent[]> {
  return db.select().from(agents).where(eq(agents.projectId, projectId)).orderBy(asc(agents.createdAt))
}

export async function listTasks(db: Database, projectId: string): Promise<TaskDefinitionRow[]> {
  return db
    .select()
    .from(taskDefinitions)
    .where(eq(taskDefinitions.projectId, projectId))
    .orderBy(asc(taskDefinitions.createdAt))
}

export interface SuiteWithRelations {
  suite: Suite
  agent: Agent
  task: TaskDefinitionRow
  variants: SuiteVariant[]
}

export async function getSuite(db: Database, suiteId: string): Promise<SuiteWithRelations | null> {
  const [row] = await db
    .select({ suite: suites, agent: agents, task: taskDefinitions })
    .from(suites)
    .innerJoin(agents, eq(agents.id, suites.agentId))
    .innerJoin(taskDefinitions, eq(taskDefinitions.id, suites.taskDefinitionId))
    .where(eq(suites.id, suiteId))
    .limit(1)
  if (!row) return null

  const variants = await db
    .select()
    .from(suiteVariants)
    .where(eq(suiteVariants.suiteId, suiteId))
    .orderBy(asc(suiteVariants.position))

  return { ...row, variants }
}

export async function getSuiteRun(db: Database, suiteRunId: string): Promise<SuiteRun | null> {
  const [row] = await db.select().from(suiteRuns).where(eq(suiteRuns.id, suiteRunId)).limit(1)
  return row ?? null
}

export interface SuiteRunContext {
  suiteId: string
  suiteName: string
  agentName: string
  agentType: string
  taskName: string
  taskDescription: string
}

/** Names surrounding a suite run, for headers and breadcrumbs. Lives here so
 *  the web app never has to build SQL of its own. */
export async function getSuiteRunContext(
  db: Database,
  suiteRunId: string,
): Promise<SuiteRunContext | null> {
  const [row] = await db
    .select({
      suiteId: suites.id,
      suiteName: suites.name,
      agentName: agents.name,
      agentType: agents.type,
      taskName: taskDefinitions.name,
      taskDescription: taskDefinitions.description,
    })
    .from(suiteRuns)
    .innerJoin(suites, eq(suites.id, suiteRuns.suiteId))
    .innerJoin(agents, eq(agents.id, suites.agentId))
    .innerJoin(taskDefinitions, eq(taskDefinitions.id, suites.taskDefinitionId))
    .where(eq(suiteRuns.id, suiteRunId))
    .limit(1)
  return row ?? null
}

export async function listIndividualRuns(db: Database, suiteRunId: string): Promise<IndividualRun[]> {
  return db
    .select()
    .from(individualRuns)
    .where(eq(individualRuns.suiteRunId, suiteRunId))
    .orderBy(asc(individualRuns.variant), asc(individualRuns.repetition))
}

export async function getIndividualRun(db: Database, runId: string): Promise<IndividualRun | null> {
  const [row] = await db.select().from(individualRuns).where(eq(individualRuns.id, runId)).limit(1)
  return row ?? null
}

export async function listRunEvents(db: Database, runId: string): Promise<RunEventRow[]> {
  return db
    .select()
    .from(runEvents)
    .where(eq(runEvents.individualRunId, runId))
    .orderBy(asc(runEvents.sequence))
}

export async function getEvaluation(
  db: Database,
  runId: string,
): Promise<EvaluationResultRow | null> {
  const [row] = await db
    .select()
    .from(evaluationResults)
    .where(eq(evaluationResults.individualRunId, runId))
    .limit(1)
  return row ?? null
}

export interface SuiteRunListItem extends SuiteRun {
  suiteName: string
  agentName: string
  taskName: string
}

export async function listSuiteRuns(
  db: Database,
  options: { projectId?: string; suiteId?: string; limit?: number } = {},
): Promise<SuiteRunListItem[]> {
  const conditions = []
  if (options.suiteId) conditions.push(eq(suiteRuns.suiteId, options.suiteId))
  if (options.projectId) conditions.push(eq(suites.projectId, options.projectId))

  const rows = await db
    .select({
      run: suiteRuns,
      suiteName: suites.name,
      agentName: agents.name,
      taskName: taskDefinitions.name,
    })
    .from(suiteRuns)
    .innerJoin(suites, eq(suites.id, suiteRuns.suiteId))
    .innerJoin(agents, eq(agents.id, suites.agentId))
    .innerJoin(taskDefinitions, eq(taskDefinitions.id, suites.taskDefinitionId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(suiteRuns.createdAt))
    .limit(options.limit ?? 25)

  return rows.map((r) => ({ ...r.run, suiteName: r.suiteName, agentName: r.agentName, taskName: r.taskName }))
}

// ── writes ───────────────────────────────────────────────────────────────────

export interface EnqueueSuiteRunInput {
  suiteId: string
  mode: string
  label?: string
  variants: Array<{ id: string; name: string; category: PerturbationCategory }>
  runsPerVariant: number
  /** Deterministic seed per (variant, repetition), derived by the caller. */
  seedFor: (variant: string, repetition: number) => number
  git?: { repo?: string; branch?: string; sha?: string }
}

/**
 * Create a suite run and all of its individual runs atomically. Either the
 * whole grid exists or none of it does — a half-created suite would report a
 * reliability computed over a denominator that never existed.
 */
export async function enqueueSuiteRun(db: Database, input: EnqueueSuiteRunInput): Promise<SuiteRun> {
  const total = input.variants.length * input.runsPerVariant
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(suiteRuns)
      .values({
        suiteId: input.suiteId,
        status: "queued",
        mode: input.mode,
        label: input.label ?? null,
        totalRuns: total,
        gitRepo: input.git?.repo ?? null,
        gitBranch: input.git?.branch ?? null,
        gitSha: input.git?.sha ?? null,
      })
      .returning()
    if (!run) throw new Error("failed to create suite run")

    const rows = input.variants.flatMap((variant) =>
      Array.from({ length: input.runsPerVariant }, (_, i) => ({
        suiteRunId: run.id,
        variant: variant.id,
        variantName: variant.name,
        category: variant.category,
        repetition: i + 1,
        seed: input.seedFor(variant.id, i + 1),
        status: "queued" as const,
      })),
    )
    if (rows.length > 0) await tx.insert(individualRuns).values(rows)

    return run
  })
}

export async function transitionSuiteRun(
  db: Database,
  suiteRunId: string,
  to: SuiteRunStatus,
  patch: Partial<typeof suiteRuns.$inferInsert> = {},
): Promise<SuiteRun> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: suiteRuns.status })
      .from(suiteRuns)
      .where(eq(suiteRuns.id, suiteRunId))
      .for("update")
      .limit(1)
    if (!current) throw new Error(`suite run ${suiteRunId} not found`)

    // Re-entering the same state is a no-op, not an error: the worker's
    // progress writes are idempotent by design.
    if (current.status !== to) assertSuiteTransition(current.status as SuiteRunStatus, to)

    const [updated] = await tx
      .update(suiteRuns)
      .set({ status: to, ...patch })
      .where(eq(suiteRuns.id, suiteRunId))
      .returning()
    if (!updated) throw new Error(`suite run ${suiteRunId} vanished mid-transition`)
    return updated
  })
}

export async function transitionIndividualRun(
  db: Database,
  runId: string,
  to: IndividualRunStatus,
  patch: Partial<typeof individualRuns.$inferInsert> = {},
): Promise<IndividualRun> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: individualRuns.status })
      .from(individualRuns)
      .where(eq(individualRuns.id, runId))
      .for("update")
      .limit(1)
    if (!current) throw new Error(`individual run ${runId} not found`)
    if (current.status !== to) assertRunTransition(current.status as IndividualRunStatus, to)

    const [updated] = await tx
      .update(individualRuns)
      .set({ status: to, ...patch })
      .where(eq(individualRuns.id, runId))
      .returning()
    if (!updated) throw new Error(`individual run ${runId} vanished mid-transition`)
    return updated
  })
}

/**
 * Update a run WITHOUT changing its status.
 *
 * Separate from `transitionIndividualRun` so a plain field write (a session id,
 * a replay path) does not have to read the current status back just to satisfy
 * the state machine — which would turn every progress write into two queries.
 */
export async function patchIndividualRun(
  db: Database,
  runId: string,
  patch: Partial<typeof individualRuns.$inferInsert>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  const { status: _ignored, ...safe } = patch
  await db.update(individualRuns).set(safe).where(eq(individualRuns.id, runId))
}

export async function appendRunEvents(
  db: Database,
  runId: string,
  events: Array<{ type: string; timestamp: Date; payload: Record<string, unknown> }>,
): Promise<void> {
  if (events.length === 0) return
  const [{ value: existing } = { value: 0 }] = await db
    .select({ value: count() })
    .from(runEvents)
    .where(eq(runEvents.individualRunId, runId))

  await db.insert(runEvents).values(
    events.map((event, i) => ({
      individualRunId: runId,
      sequence: Number(existing) + i,
      timestamp: event.timestamp,
      type: event.type,
      payloadJson: event.payload,
    })),
  )
}

export async function saveEvaluation(
  db: Database,
  runId: string,
  input: {
    success: boolean
    score: number
    assertions: unknown
    evidence: unknown
    agentClaim?: unknown
  },
): Promise<void> {
  await db
    .insert(evaluationResults)
    .values({
      individualRunId: runId,
      success: input.success,
      score: input.score,
      assertionsJson: input.assertions as object,
      evidenceJson: input.evidence as object,
      agentClaimJson: (input.agentClaim ?? null) as object | null,
    })
    .onConflictDoUpdate({
      target: evaluationResults.individualRunId,
      set: {
        success: input.success,
        score: input.score,
        assertionsJson: input.assertions as object,
        evidenceJson: input.evidence as object,
        agentClaimJson: (input.agentClaim ?? null) as object | null,
      },
    })
}

/** Recompute a suite run's metrics from its individual runs and persist them. */
export async function refreshSuiteRunMetrics(
  db: Database,
  suiteRunId: string,
): Promise<SuiteMetrics> {
  const rows = await db
    .select({
      variant: individualRuns.variant,
      variantName: individualRuns.variantName,
      category: individualRuns.category,
      repetition: individualRuns.repetition,
      status: individualRuns.status,
      durationMs: individualRuns.durationMs,
      steps: individualRuns.steps,
      failureCategory: individualRuns.failureCategory,
    })
    .from(individualRuns)
    .where(eq(individualRuns.suiteRunId, suiteRunId))

  const summaries: RunSummary[] = rows.map((r) => ({
    variant: r.variant,
    variantName: r.variantName,
    category: r.category as PerturbationCategory,
    repetition: r.repetition,
    status: r.status as IndividualRunStatus,
    durationMs: r.durationMs,
    steps: r.steps,
    failureCategory: r.failureCategory as FailureCategory | null,
  }))

  const metrics = computeSuiteMetrics(summaries)
  await db
    .update(suiteRuns)
    .set({
      passedRuns: metrics.passedRuns,
      failedRuns: metrics.failedRuns,
      infrastructureErrors: metrics.infrastructureErrors,
      reliability: metrics.reliability,
      metricsJson: metrics as unknown as object,
    })
    .where(eq(suiteRuns.id, suiteRunId))

  return metrics
}

/** Mark every non-terminal run of a suite as cancelled. Used on shutdown. */
export async function cancelOpenRuns(db: Database, suiteRunId: string): Promise<number> {
  const cancelled = await db
    .update(individualRuns)
    .set({ status: "cancelled", completedAt: new Date(), errorCode: "cancelled" })
    .where(
      and(
        eq(individualRuns.suiteRunId, suiteRunId),
        inArray(individualRuns.status, [
          "queued",
          "preparing_environment",
          "running_agent",
          "evaluating",
          "collecting_replay",
        ]),
      ),
    )
    .returning({ id: individualRuns.id })
  return cancelled.length
}

export interface StoredReplay {
  compressed: Buffer
  eventCount: number
  rawBytes: number
  source: string
}

/**
 * Persist a replay in the database.
 *
 * Durable by design: the container's filesystem is not. Idempotent, because a
 * reclaimed run may collect its replay a second time.
 */
export async function saveReplayArtifact(
  db: Database,
  runId: string,
  replay: StoredReplay,
): Promise<void> {
  await db
    .insert(replayArtifacts)
    .values({ individualRunId: runId, ...replay })
    .onConflictDoUpdate({ target: replayArtifacts.individualRunId, set: replay })
}

export async function getReplayArtifact(db: Database, runId: string): Promise<StoredReplay | null> {
  const [row] = await db
    .select()
    .from(replayArtifacts)
    .where(eq(replayArtifacts.individualRunId, runId))
    .limit(1)
  return row
    ? {
        compressed: row.compressed,
        eventCount: row.eventCount,
        rawBytes: row.rawBytes,
        source: row.source,
      }
    : null
}

/**
 * How many suite runs are queued or in flight.
 *
 * A public demo must not let one visitor stack up work faster than it drains —
 * each run is a paid browser session — so the run endpoint refuses to enqueue
 * while anything is still active.
 */
export async function countActiveSuiteRuns(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(suiteRuns)
    .where(inArray(suiteRuns.status, ["queued", "preparing", "running", "evaluating"]))
  return Number(row?.value ?? 0)
}

/** Cheap liveness probe used by the health endpoint and the CLI. */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`)
    return true
  } catch {
    return false
  }
}

/** A run waiting for its replay to be published. */
export interface DueReplay {
  id: string
  suiteRunId: string
  sessionId: string
  attempts: number
}

/**
 * Runs whose replay is due another attempt.
 *
 * Deliberately not a claim: fetching a replay is idempotent and costs nothing
 * but an HTTP call, so a duplicate attempt is harmless where a stuck claim
 * would not be.
 */
export async function listDueReplays(db: Database, limit = 10): Promise<DueReplay[]> {
  const rows = await db
    .select({
      id: individualRuns.id,
      suiteRunId: individualRuns.suiteRunId,
      sessionId: individualRuns.sessionId,
      attempts: individualRuns.replayAttempts,
    })
    .from(individualRuns)
    .where(
      and(
        eq(individualRuns.replayStatus, "processing"),
        isNotNull(individualRuns.sessionId),
        lte(individualRuns.replayNextAttemptAt, new Date()),
      ),
    )
    .orderBy(individualRuns.replayNextAttemptAt)
    .limit(limit)
  return rows.filter((r): r is DueReplay => Boolean(r.sessionId))
}

/** Record a replay that arrived. */
export async function markReplayReady(
  db: Database,
  runId: string,
  artifact: { eventCount: number; bytes: number; path: string },
): Promise<void> {
  await db
    .update(individualRuns)
    .set({
      replayStatus: "ready",
      replayEventCount: artifact.eventCount,
      replayBytes: artifact.bytes,
      replayArtifactPath: artifact.path,
      replayNextAttemptAt: null,
    })
    .where(eq(individualRuns.id, runId))
}

/**
 * Schedule the next attempt, or give up.
 *
 * Giving up is `unavailable`, never a run failure: the verdict was decided by
 * the evaluator long before, and a missing recording says nothing about the
 * agent.
 */
export async function scheduleReplayRetry(
  db: Database,
  runId: string,
  attempts: number,
  nextAttemptAt: Date | null,
): Promise<void> {
  await db
    .update(individualRuns)
    .set({
      replayAttempts: attempts,
      replayStatus: nextAttemptAt ? "processing" : "unavailable",
      replayNextAttemptAt: nextAttemptAt,
    })
    .where(eq(individualRuns.id, runId))
}

/** A credential a visitor brought, still sealed. */
export interface SealedRunCredential {
  kind: "session" | "key"
  ciphertext: string
  iv: string
  tag: string
}

/** Attach a sealed credential to a queued run. */
export async function attachRunCredential(
  db: Database,
  suiteRunId: string,
  credential: SealedRunCredential,
): Promise<void> {
  await db
    .update(suiteRuns)
    .set({
      byoKind: credential.kind,
      byoCiphertext: credential.ciphertext,
      byoIv: credential.iv,
      byoTag: credential.tag,
    })
    .where(eq(suiteRuns.id, suiteRunId))
}

/** Read it back in the worker. Returns null when the run brought nothing. */
export async function readRunCredential(
  db: Database,
  suiteRunId: string,
): Promise<SealedRunCredential | null> {
  const [row] = await db
    .select({
      kind: suiteRuns.byoKind,
      ciphertext: suiteRuns.byoCiphertext,
      iv: suiteRuns.byoIv,
      tag: suiteRuns.byoTag,
    })
    .from(suiteRuns)
    .where(eq(suiteRuns.id, suiteRunId))
    .limit(1)
  if (!row?.kind || !row.ciphertext || !row.iv || !row.tag) return null
  return {
    kind: row.kind === "key" ? "key" : "session",
    ciphertext: row.ciphertext,
    iv: row.iv,
    tag: row.tag,
  }
}

/**
 * Forget a borrowed credential.
 *
 * Called the moment a run reaches a terminal state, and on every worker boot
 * for anything already finished — a credential that outlives its run is
 * exactly what this design exists to avoid.
 */
export async function wipeRunCredential(db: Database, suiteRunId: string): Promise<void> {
  await db
    .update(suiteRuns)
    .set({ byoKind: null, byoCiphertext: null, byoIv: null, byoTag: null })
    .where(eq(suiteRuns.id, suiteRunId))
}

/**
 * Wipe every credential that has outlived its usefulness.
 *
 * Two ways that happens. A run finished, so nothing needs it any more — the
 * common case. Or a run never ran at all, and the age bound catches it: a
 * borrowed session expires on Solari's side within the hour, so anything older
 * than {@link CREDENTIAL_MAX_AGE_MS} is pure liability whatever its status.
 */
export const CREDENTIAL_MAX_AGE_MS = 2 * 60 * 60 * 1_000

export async function wipeStaleCredentials(db: Database, now = new Date()): Promise<number> {
  const rows = await db
    .update(suiteRuns)
    .set({ byoKind: null, byoCiphertext: null, byoIv: null, byoTag: null })
    .where(
      and(
        isNotNull(suiteRuns.byoCiphertext),
        or(
          inArray(suiteRuns.status, ["completed", "failed", "cancelled"]),
          lte(suiteRuns.createdAt, new Date(now.getTime() - CREDENTIAL_MAX_AGE_MS)),
        ),
      ),
    )
    .returning({ id: suiteRuns.id })
  return rows.length
}
