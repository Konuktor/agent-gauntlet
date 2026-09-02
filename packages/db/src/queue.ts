import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import type { Database } from "./client.js"
import { suiteRuns, type SuiteRun } from "./schema.js"

/**
 * A DB-backed job queue. No Redis, no broker — a suite run is already a row we
 * have to persist, so making it the queue entry removes a whole moving part.
 *
 * Correctness rests on two Postgres features:
 *   FOR UPDATE SKIP LOCKED  — two workers never claim the same run
 *   a heartbeat column      — a worker killed mid-run is detectable and its
 *                             work reclaimable, instead of the run wedging
 *                             in `running` forever.
 */

/** A claim is considered dead after this long without a heartbeat. */
export const STALE_CLAIM_MS = 90_000
export const HEARTBEAT_INTERVAL_MS = 15_000

export async function claimNextSuiteRun(db: Database, workerId: string): Promise<SuiteRun | null> {
  const now = new Date()
  // Built through the query builder rather than raw `execute` so the returned
  // row is mapped to camelCase domain fields. A raw `RETURNING *` hands back
  // snake_case columns, and casting those to SuiteRun is a lie the type system
  // cannot catch.
  const [claimed] = await db
    .update(suiteRuns)
    .set({
      status: "preparing",
      claimedBy: workerId,
      claimedAt: now,
      heartbeatAt: now,
      startedAt: sql`COALESCE(${suiteRuns.startedAt}, now())`,
    })
    .where(
      sql`${suiteRuns.id} = (
        SELECT id FROM ${suiteRuns}
         WHERE ${suiteRuns.status} = 'queued'
         ORDER BY ${suiteRuns.createdAt}
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )`,
    )
    .returning()
  return claimed ?? null
}

export async function heartbeat(db: Database, suiteRunId: string, workerId: string): Promise<void> {
  await db
    .update(suiteRuns)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(suiteRuns.id, suiteRunId), eq(suiteRuns.claimedBy, workerId)))
}

/**
 * Return runs abandoned by a dead worker to the queue. Called on worker start
 * and periodically: without it, a `kill -9` mid-suite leaves a row that no
 * worker will ever pick up and a user staring at a spinner.
 */
export async function reclaimStaleSuiteRuns(
  db: Database,
  staleMs = STALE_CLAIM_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs)
  const reclaimed = await db
    .update(suiteRuns)
    .set({ status: "queued", claimedBy: null, claimedAt: null, heartbeatAt: null })
    .where(
      and(
        or(
          eq(suiteRuns.status, "preparing"),
          eq(suiteRuns.status, "running"),
          eq(suiteRuns.status, "evaluating"),
        ),
        or(isNull(suiteRuns.heartbeatAt), lt(suiteRuns.heartbeatAt, cutoff)),
      ),
    )
    .returning({ id: suiteRuns.id })
  return reclaimed.length
}

export async function releaseClaim(db: Database, suiteRunId: string): Promise<void> {
  await db
    .update(suiteRuns)
    .set({ claimedBy: null, claimedAt: null, heartbeatAt: null })
    .where(eq(suiteRuns.id, suiteRunId))
}
