import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { deriveSeed, REPLAY_BACKOFF_MS } from "@gauntlet/core"
import type { DbHandle } from "./client.js"
import {
  enqueueSuiteRun,
  listDueReplays,
  listIndividualRuns,
  markReplayReady,
  scheduleReplayRetry,
  getIndividualRun,
  patchIndividualRun,
} from "./queries.js"
import { agents, projects, suiteVariants, suites, taskDefinitions } from "./schema.js"
import { databaseAvailable, testDb, truncateAll } from "./test-utils.js"

const available = await databaseAvailable()

/**
 * The delayed-artefact queue behind asynchronous replays.
 *
 * A replay lands after the run is already terminal, so none of this may ever
 * touch a verdict — it only decides when to look again, and when to stop.
 */
describe.skipIf(!available)("replay queue", () => {
  let handle: DbHandle
  let suiteId: string

  beforeAll(() => {
    handle = testDb()
  })
  afterAll(async () => {
    await handle?.close()
  })

  beforeEach(async () => {
    await truncateAll(handle)
    const db = handle.db
    const [project] = await db.insert(projects).values({ name: "Demo", slug: "demo" }).returning()
    const [agent] = await db
      .insert(agents)
      .values({ projectId: project!.id, name: "Reference Agent", type: "reference" })
      .returning()
    const [task] = await db
      .insert(taskDefinitions)
      .values({
        projectId: project!.id,
        name: "Checkout",
        description: "Add to cart and reach review",
        startUrl: "/",
        maxSteps: 20,
        timeoutMs: 90_000,
        evaluatorConfigJson: { kind: "fixture_state", expect: {} },
      })
      .returning()
    const [suite] = await db
      .insert(suites)
      .values({
        projectId: project!.id,
        name: "Checkout gauntlet",
        agentId: agent!.id,
        taskDefinitionId: task!.id,
        runsPerVariant: 1,
      })
      .returning()
    await db
      .insert(suiteVariants)
      .values([{ suiteId: suite!.id, perturbationType: "baseline", position: 0 }])
    suiteId = suite!.id
  })

  async function queuedRun(patch: Record<string, unknown> = {}) {
    const suiteRun = await enqueueSuiteRun(handle.db, {
      suiteId,
      mode: "solari",
      variants: [{ id: "baseline", name: "Baseline", category: "none" }],
      runsPerVariant: 1,
      seedFor: (v, r) => deriveSeed("replay-queue", v, r),
    })
    const [run] = await listIndividualRuns(handle.db, suiteRun.id)
    await patchIndividualRun(handle.db, run!.id, {
      sessionId: "session-abc",
      replayStatus: "processing",
      replayNextAttemptAt: new Date(Date.now() - 1_000),
      ...patch,
    })
    return run!.id
  }

  it("returns a run whose next attempt has come due", async () => {
    const id = await queuedRun()
    const due = await listDueReplays(handle.db)
    expect(due.map((d) => d.id)).toEqual([id])
    expect(due[0]!.sessionId).toBe("session-abc")
  })

  it("leaves a run alone until its delay has elapsed", async () => {
    await queuedRun({ replayNextAttemptAt: new Date(Date.now() + 60_000) })
    expect(await listDueReplays(handle.db)).toEqual([])
  })

  // A recording that never existed must not be polled forever.
  it("ignores runs that were never recorded and runs with no session", async () => {
    await queuedRun({ replayStatus: "not_requested" })
    expect(await listDueReplays(handle.db)).toEqual([])
    await queuedRun({ sessionId: null })
    expect(await listDueReplays(handle.db)).toEqual([])
  })

  it("records an arrived replay and stops polling it", async () => {
    const id = await queuedRun()
    await markReplayReady(handle.db, id, { eventCount: 56, bytes: 1234, path: "db:x" })
    const run = await getIndividualRun(handle.db, id)
    expect(run?.replayStatus).toBe("ready")
    expect(run?.replayEventCount).toBe(56)
    expect(await listDueReplays(handle.db)).toEqual([])
  })

  it("walks the backoff schedule, then gives up as unavailable", async () => {
    const id = await queuedRun()
    for (let attempt = 1; attempt < REPLAY_BACKOFF_MS.length; attempt++) {
      const next = REPLAY_BACKOFF_MS[attempt]!
      await scheduleReplayRetry(handle.db, id, attempt, new Date(Date.now() + next))
      expect(await listDueReplays(handle.db)).toEqual([])
    }
    // Out of schedule: give up, and never as a run failure.
    await scheduleReplayRetry(handle.db, id, REPLAY_BACKOFF_MS.length, null)
    expect(await listDueReplays(handle.db)).toEqual([])
    const run = await getIndividualRun(handle.db, id)
    expect(run?.replayStatus).toBe("unavailable")
    // The verdict was decided long before, and is untouched.
    expect(run?.status).not.toBe("failed")
  })
})
