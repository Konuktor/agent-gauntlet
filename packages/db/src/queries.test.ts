import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { deriveSeed } from "@gauntlet/core"
import type { DbHandle } from "./client.js"
import {
  appendRunEvents,
  enqueueSuiteRun,
  getIndividualRun,
  listIndividualRuns,
  listRunEvents,
  refreshSuiteRunMetrics,
  saveEvaluation,
  transitionIndividualRun,
  transitionSuiteRun,
  cancelOpenRuns,
} from "./queries.js"
import { claimNextSuiteRun, heartbeat, reclaimStaleSuiteRuns } from "./queue.js"
import { agents, projects, suiteVariants, suites, taskDefinitions } from "./schema.js"
import { databaseAvailable, testDb, truncateAll } from "./test-utils.js"

const available = await databaseAvailable()

describe.skipIf(!available)("database integration", () => {
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
        runsPerVariant: 2,
      })
      .returning()
    await db.insert(suiteVariants).values([
      { suiteId: suite!.id, perturbationType: "baseline", position: 0 },
      { suiteId: suite!.id, perturbationType: "cookie_popup", position: 1 },
    ])
    suiteId = suite!.id
  })

  const enqueue = () =>
    enqueueSuiteRun(handle.db, {
      suiteId,
      mode: "local",
      variants: [
        { id: "baseline", name: "Baseline", category: "none" },
        { id: "cookie_popup", name: "Cookie popup", category: "ui" },
      ],
      runsPerVariant: 2,
      seedFor: (variant, repetition) => deriveSeed("fixed-suite", variant, repetition),
    })

  it("creates the whole run grid atomically", async () => {
    const run = await enqueue()
    expect(run.totalRuns).toBe(4)
    expect(run.status).toBe("queued")

    const runs = await listIndividualRuns(handle.db, run.id)
    expect(runs).toHaveLength(4)
    expect(runs.map((r) => `${r.variant}#${r.repetition}`)).toEqual([
      "baseline#1",
      "baseline#2",
      "cookie_popup#1",
      "cookie_popup#2",
    ])
    // Seeds are derived, not random: the same suite reproduces the same grid.
    expect(runs[0]!.seed).toBe(deriveSeed("fixed-suite", "baseline", 1))
  })

  it("rejects a duplicate (variant, repetition) pair", async () => {
    const run = await enqueue()
    await expect(
      handle.db.insert((await import("./schema.js")).individualRuns).values({
        suiteRunId: run.id,
        variant: "baseline",
        variantName: "Baseline",
        category: "none",
        repetition: 1,
        seed: 1,
      }),
    ).rejects.toThrow()
  })

  describe("queue", () => {
    it("claims a queued run and marks it preparing", async () => {
      const run = await enqueue()
      const claimed = await claimNextSuiteRun(handle.db, "worker-a")
      expect(claimed?.id).toBe(run.id)
      expect(claimed?.status).toBe("preparing")
      expect(claimed?.claimedBy).toBe("worker-a")
    })

    // The property that makes a DB queue safe at all.
    it("never hands the same run to two workers", async () => {
      await enqueue()
      const [a, b] = await Promise.all([
        claimNextSuiteRun(handle.db, "worker-a"),
        claimNextSuiteRun(handle.db, "worker-b"),
      ])
      const claimed = [a, b].filter(Boolean)
      expect(claimed).toHaveLength(1)
    })

    it("returns null when the queue is empty", async () => {
      expect(await claimNextSuiteRun(handle.db, "worker-a")).toBeNull()
    })

    it("claims runs oldest first", async () => {
      const first = await enqueue()
      await new Promise((r) => setTimeout(r, 10))
      await enqueue()
      expect((await claimNextSuiteRun(handle.db, "w"))?.id).toBe(first.id)
    })

    it("does not reclaim a run whose worker is heartbeating", async () => {
      await enqueue()
      const claimed = await claimNextSuiteRun(handle.db, "worker-a")
      await heartbeat(handle.db, claimed!.id, "worker-a")
      expect(await reclaimStaleSuiteRuns(handle.db, 60_000)).toBe(0)
    })

    // Without this, `kill -9` mid-suite wedges a run in `running` forever.
    it("reclaims a run abandoned by a dead worker", async () => {
      await enqueue()
      const claimed = await claimNextSuiteRun(handle.db, "worker-a")
      expect(await reclaimStaleSuiteRuns(handle.db, 0)).toBe(1)
      const requeued = await claimNextSuiteRun(handle.db, "worker-b")
      expect(requeued?.id).toBe(claimed!.id)
    })

    it("ignores a heartbeat from a worker that no longer holds the claim", async () => {
      await enqueue()
      const claimed = await claimNextSuiteRun(handle.db, "worker-a")
      await heartbeat(handle.db, claimed!.id, "worker-b")
      expect(await reclaimStaleSuiteRuns(handle.db, 0)).toBe(1)
    })
  })

  describe("state transitions", () => {
    it("permits the legal path and blocks an illegal one", async () => {
      const run = await enqueue()
      await transitionSuiteRun(handle.db, run.id, "preparing")
      await transitionSuiteRun(handle.db, run.id, "running")
      await expect(transitionSuiteRun(handle.db, run.id, "queued")).rejects.toThrow(
        /Invalid suite run/,
      )
    })

    it("treats re-entering the same state as a no-op", async () => {
      const run = await enqueue()
      await transitionSuiteRun(handle.db, run.id, "preparing")
      await expect(transitionSuiteRun(handle.db, run.id, "preparing")).resolves.toBeDefined()
    })

    it("applies a patch alongside the transition", async () => {
      const run = await enqueue()
      const runs = await listIndividualRuns(handle.db, run.id)
      await transitionIndividualRun(handle.db, runs[0]!.id, "preparing_environment", {
        sessionId: "sess_123",
      })
      const updated = await getIndividualRun(handle.db, runs[0]!.id)
      expect(updated?.sessionId).toBe("sess_123")
      expect(updated?.status).toBe("preparing_environment")
    })
  })

  describe("events and evaluation", () => {
    it("appends events with monotonically increasing sequence across batches", async () => {
      const run = await enqueue()
      const runId = (await listIndividualRuns(handle.db, run.id))[0]!.id
      const now = new Date()
      await appendRunEvents(handle.db, runId, [
        { type: "lifecycle", timestamp: now, payload: { phase: "agent_started" } },
        { type: "navigation", timestamp: now, payload: { url: "/" } },
      ])
      await appendRunEvents(handle.db, runId, [
        { type: "lifecycle", timestamp: now, payload: { phase: "agent_finished" } },
      ])
      const events = await listRunEvents(handle.db, runId)
      expect(events.map((e) => e.sequence)).toEqual([0, 1, 2])
      expect(events[2]!.payloadJson).toEqual({ phase: "agent_finished" })
    })

    it("is idempotent when an evaluation is written twice", async () => {
      const run = await enqueue()
      const runId = (await listIndividualRuns(handle.db, run.id))[0]!.id
      await saveEvaluation(handle.db, runId, {
        success: false,
        score: 0.5,
        assertions: [],
        evidence: {},
      })
      await saveEvaluation(handle.db, runId, {
        success: true,
        score: 1,
        assertions: [],
        evidence: {},
      })
      const rows =
        await handle.sql`SELECT success, score FROM evaluation_results WHERE individual_run_id = ${runId}`
      expect(rows).toHaveLength(1)
      expect(rows[0]!.success).toBe(true)
    })
  })

  describe("metrics", () => {
    it("recomputes and persists reliability from the individual runs", async () => {
      const run = await enqueue()
      const runs = await listIndividualRuns(handle.db, run.id)
      await transitionIndividualRun(handle.db, runs[0]!.id, "preparing_environment")
      await transitionIndividualRun(handle.db, runs[0]!.id, "running_agent")
      await transitionIndividualRun(handle.db, runs[0]!.id, "evaluating")
      await transitionIndividualRun(handle.db, runs[0]!.id, "passed", {
        durationMs: 5_000,
        steps: 7,
      })

      await transitionIndividualRun(handle.db, runs[2]!.id, "preparing_environment")
      await transitionIndividualRun(handle.db, runs[2]!.id, "running_agent")
      await transitionIndividualRun(handle.db, runs[2]!.id, "evaluating")
      await transitionIndividualRun(handle.db, runs[2]!.id, "failed", {
        durationMs: 9_000,
        steps: 12,
        failureCategory: "unexpected_ui",
      })

      const metrics = await refreshSuiteRunMetrics(handle.db, run.id)
      expect(metrics.reliability).toBe(0.5)
      expect(metrics.pendingRuns).toBe(2)
      expect(metrics.failureDistribution).toEqual([
        { category: "unexpected_ui", count: 1, share: 1 },
      ])

      const rows =
        await handle.sql`SELECT reliability, passed_runs FROM suite_runs WHERE id = ${run.id}`
      expect(Number(rows[0]!.reliability)).toBe(0.5)
      expect(rows[0]!.passed_runs).toBe(1)
    })
  })

  it("cancels every open run without touching terminal ones", async () => {
    const run = await enqueue()
    const runs = await listIndividualRuns(handle.db, run.id)
    await transitionIndividualRun(handle.db, runs[0]!.id, "preparing_environment")
    await transitionIndividualRun(handle.db, runs[0]!.id, "running_agent")
    await transitionIndividualRun(handle.db, runs[0]!.id, "evaluating")
    await transitionIndividualRun(handle.db, runs[0]!.id, "passed")

    expect(await cancelOpenRuns(handle.db, run.id)).toBe(3)
    const after = await listIndividualRuns(handle.db, run.id)
    expect(after.filter((r) => r.status === "cancelled")).toHaveLength(3)
    expect(after.find((r) => r.id === runs[0]!.id)?.status).toBe("passed")
  })
})
