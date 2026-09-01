import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { parseEnv } from "@gauntlet/config"
import { deriveSeed } from "@gauntlet/core"
import {
  enqueueSuiteRun,
  getSuiteRun,
  type DbHandle,
  type SuiteRun,
} from "@gauntlet/db"
import { agents, projects, suiteVariants, suites, taskDefinitions } from "@gauntlet/db/schema"
import { databaseAvailable, testDb, truncateAll, TEST_DATABASE_URL } from "@gauntlet/db/test-utils"
import { createWorkerRuntime, type WorkerRuntime } from "./worker-runtime.js"

const available = await databaseAvailable()

/**
 * These cover the failure path that actually wedged a deployment: a suite whose
 * setup throws before the GauntletRunner ever starts. The runner marks its own
 * failures terminal, so nothing else was watching this seam — and with
 * one-suite-at-a-time limiting, a single wedged run blocks every later one.
 */
describe.skipIf(!available)("worker runtime failure handling", () => {
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
    // An LLM agent on a deployment with no ANTHROPIC_API_KEY: a real
    // misconfiguration, and one that throws while the agent is being built —
    // after the claim is taken, before the runner exists.
    const [agent] = await db
      .insert(agents)
      .values({ projectId: project!.id, name: "LLM agent", type: "llm" })
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
        // A valid config on purpose: the failure under test must come from the
        // agent, not from a malformed fixture.
        evaluatorConfigJson: {
          kind: "fixture_state",
          expect: {
            productSku: "aurora-headphones",
            coupon: "SAVE20",
            discountApplied: true,
            checkoutName: "Ada Lovelace",
            checkoutCity: "London",
            stage: "review",
            purchaseSubmitted: false,
          },
        },
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

  const enqueue = () =>
    enqueueSuiteRun(handle.db, {
      suiteId,
      mode: "local",
      variants: [{ id: "baseline", name: "Baseline", category: "none" }],
      runsPerVariant: 1,
      seedFor: (variant, repetition) => deriveSeed("wedge-test", variant, repetition),
    })

  const config = () =>
    parseEnv({
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      GAUNTLET_MODE: "local",
      // deliberately no ANTHROPIC_API_KEY
    })

  /** `start()` resolves only when the loop ends, so callers launch it rather
   *  than awaiting it — exactly as the single-service server does. */
  function launch(runtime: WorkerRuntime): Promise<void> {
    return runtime.start()
  }

  async function settle(runId: string, timeoutMs = 20_000): Promise<SuiteRun> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const run = await getSuiteRun(handle.db, runId)
      if (run && ["completed", "failed", "cancelled"].includes(run.status)) return run
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const last = await getSuiteRun(handle.db, runId)
    throw new Error(`suite run never reached a terminal state (stuck in ${last?.status})`)
  }

  it("leaves a suite terminal when setup fails, rather than wedged in preparing", async () => {
    const queued = await enqueue()
    const runtime = createWorkerRuntime({ config: config(), pollIntervalMs: 100 })
    const loop = launch(runtime)
    try {
      const settled = await settle(queued.id)
      expect(settled.status).toBe("failed")
      // The real reason survives; it is not flattened into "internal".
      expect(settled.errorCode).toBe("config_invalid")
      expect(settled.errorMessage).toContain("ANTHROPIC_API_KEY")
      expect(settled.completedAt).not.toBeNull()
    } finally {
      await runtime.shutdown(2_000)
      await loop
    }
  })

  it("keeps claiming after a suite fails, so one bad run cannot stop the worker", async () => {
    const first = await enqueue()
    const runtime = createWorkerRuntime({ config: config(), pollIntervalMs: 100 })
    const loop = launch(runtime)
    try {
      await settle(first.id)
      // The proof that the loop survived: a job enqueued afterwards is claimed
      // by the same still-running worker.
      const second = await enqueue()
      const settled = await settle(second.id)
      expect(settled.status).toBe("failed")
      expect(settled.id).not.toBe(first.id)
    } finally {
      await runtime.shutdown(2_000)
      await loop
    }
  })

  it("releases its claim on a failed suite instead of holding it", async () => {
    const queued = await enqueue()
    const runtime = createWorkerRuntime({ config: config(), pollIntervalMs: 100 })
    const loop = launch(runtime)
    try {
      await settle(queued.id)
      const run = await getSuiteRun(handle.db, queued.id)
      expect(run?.claimedBy).toBeNull()
      expect(runtime.activeSuiteRunId).toBeUndefined()
    } finally {
      await runtime.shutdown(2_000)
      await loop
    }
  })
})
