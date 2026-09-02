import { describe, expect, it } from "vitest"
import { nullLogger } from "../logger.js"
import { sleep } from "../concurrency.js"
import type { TaskDefinition } from "../domain/task.js"
import { GauntletRunner, type GauntletRunnerDeps } from "./gauntlet-runner.js"
import { buildStartUrl } from "./run-pipeline.js"
import {
  FakeAgent,
  FakeBrowserProvider,
  FakeEvaluator,
  FakeFixtureProvider,
  failedEvaluation,
  MemoryRunStore,
  plannedRuns,
} from "./test-doubles.js"

const TASK: TaskDefinition = {
  id: "task-1",
  name: "Checkout",
  description: "Add Aurora Headphones to cart and reach review.",
  startUrl: "/",
  maxSteps: 10,
  timeoutMs: 5_000,
  evaluatorConfig: {
    kind: "fixture_state",
    expect: {
      productSku: "aurora-headphones",
      quantity: 1,
      coupon: "SAVE20",
      discountApplied: true,
      checkoutName: "Ada Lovelace",
      checkoutCity: "London",
      stage: "review",
      purchaseSubmitted: false,
    },
  },
}

interface HarnessOverrides {
  browsers?: FakeBrowserProvider
  fixtures?: FakeFixtureProvider
  agent?: FakeAgent
  evaluator?: FakeEvaluator
  variants?: string[]
  repetitions?: number
  maxConcurrency?: number
  recording?: boolean
}

function harness(overrides: HarnessOverrides = {}) {
  const runs = plannedRuns(overrides.variants ?? ["baseline", "cookie_popup"], overrides.repetitions ?? 2)
  const store = new MemoryRunStore(runs)
  const browsers = overrides.browsers ?? new FakeBrowserProvider()
  const fixtures = overrides.fixtures ?? new FakeFixtureProvider()
  const agent = overrides.agent ?? new FakeAgent()
  const evaluator = overrides.evaluator ?? new FakeEvaluator()

  const deps: GauntletRunnerDeps = {
    browsers,
    fixtures,
    agent,
    evaluator,
    store,
    logger: nullLogger,
    resolve: () => ({ fixtureConfig: {}, browserOptions: {} }),
  }

  const runner = new GauntletRunner(deps, {
    suiteRunId: "suite-run-1",
    task: TASK,
    maxConcurrency: overrides.maxConcurrency ?? 2,
    browserDefaults: { recording: overrides.recording ?? false },
    heartbeatIntervalMs: 10,
  })

  return { runner, store, browsers, fixtures, agent, evaluator, runs }
}

const run = (h: ReturnType<typeof harness>) => h.runner.execute(new AbortController().signal)

describe("a clean suite", () => {
  it("runs every cell of the grid and reports 100%", async () => {
    const h = harness()
    const report = await run(h)

    expect(report.metrics.totalRuns).toBe(4)
    expect(report.metrics.passedRuns).toBe(4)
    expect(report.metrics.reliability).toBe(1)
    expect(h.agent.seen).toHaveLength(4)
    expect(h.store.suiteStatuses).toEqual(["preparing", "running", "evaluating", "completed"])
  })

  it("walks each run through the full lifecycle", async () => {
    const h = harness({ variants: ["baseline"], repetitions: 1 })
    await run(h)
    expect(h.store.lifecyclePhases("baseline-1")).toEqual([
      "run_queued",
      "environment_preparing",
      "fixture_ready",
      "session_created",
      "agent_started",
      "agent_finished",
      "evaluation_started",
      "evaluation_finished",
      "browser_released",
      "cleanup_complete",
    ])
  })

  it("records the session id, duration and step count", async () => {
    const h = harness({ variants: ["baseline"], repetitions: 1 })
    await run(h)
    const stored = h.store.runs.get("baseline-1")!
    expect(stored.status).toBe("passed")
    expect(stored.sessionId).toBe("sess-0")
    expect(stored.steps).toBe(5)
    expect(stored.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("configures the fixture for every run and tears each one down", async () => {
    const h = harness()
    await run(h)
    expect(h.fixtures.host!.registered).toHaveLength(4)
    expect(h.fixtures.host!.unregistered).toHaveLength(4)
  })
})

describe("evaluation decides the verdict", () => {
  it("fails a run the evaluator rejects, however the agent felt about it", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      agent: new FakeAgent(async () => ({
        finishReason: "finished",
        steps: 7,
        actions: [],
        message: "I completed the task successfully!",
      })),
      evaluator: new FakeEvaluator(async () => failedEvaluation()),
    })
    const report = await run(h)

    expect(h.store.statusOf("baseline-1")).toBe("failed")
    expect(report.metrics.reliability).toBe(0)
    expect(h.store.runs.get("baseline-1")!.failureMessage).toContain("coupon SAVE20 is applied")
  })

  it("evaluates a timed-out agent rather than assuming failure", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      agent: new FakeAgent(async () => {
        await sleep(60_000)
        throw new Error("unreachable")
      }),
    })
    const report = await run(h)
    expect(h.evaluator.calls).toBe(1)
    // The agent ran out of time but had already done the work; the evaluator
    // says so, and the evaluator is what counts.
    expect(report.metrics.passedRuns).toBe(1)
  })

  it("evaluates a crashed agent too", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      agent: new FakeAgent(async () => {
        throw new Error("agent blew up")
      }),
    })
    await run(h)
    expect(h.evaluator.calls).toBe(1)
    expect(h.store.statusOf("baseline-1")).toBe("passed")
  })
})

describe("infrastructure failures are not agent failures", () => {
  it("records a browser that never started as an infrastructure error", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 2,
      browsers: new FakeBrowserProvider({ failCreateFor: new Set([0]) }),
    })
    const report = await run(h)

    const statuses = [...h.store.runs.values()].map((r) => r.status)
    expect(statuses).toContain("infrastructure_error")
    expect(report.metrics.infrastructureErrors).toBe(1)
    // The key property: a failed browser launch does not drag reliability down.
    expect(report.metrics.scoredRuns).toBe(1)
    expect(report.metrics.reliability).toBe(1)
  })

  it("records an unreachable evaluator as an infrastructure error", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      evaluator: new FakeEvaluator(async () => {
        throw new Error("state endpoint returned 503")
      }),
    })
    const report = await run(h)
    expect(h.store.statusOf("baseline-1")).toBe("infrastructure_error")
    expect(report.metrics.scoredRuns).toBe(0)
  })

  it("keeps going after one run fails, and still finalises the suite", async () => {
    const h = harness({
      variants: ["baseline", "modal", "slow"],
      repetitions: 2,
      browsers: new FakeBrowserProvider({ failCreateFor: new Set([1, 4]) }),
    })
    const report = await run(h)
    expect(report.outcomes).toHaveLength(6)
    expect(h.store.suiteStatuses).toContain("completed")
    expect(report.metrics.scoredRuns).toBe(4)
  })

  it("fails the whole suite when the benchmark site cannot start", async () => {
    const h = harness({ fixtures: new FakeFixtureProvider({ failStart: true }) })
    await expect(run(h)).rejects.toThrow(/fixture would not start/)
    expect(h.store.suiteStatuses).toContain("failed")
    // Nothing was launched, so nothing needs releasing.
    expect(h.browsers.created).toHaveLength(0)
  })
})

describe("replay is evidence, never a verdict", () => {
  // The pipeline no longer downloads anything: publication is asynchronous and
  // waiting for it delayed a verdict a replay cannot change. It hands the run
  // off to the sweeper instead.
  it("marks a recorded run for later enrichment and does not fetch", async () => {
    const browsers = new FakeBrowserProvider({
      recording: true,
      replay: { source: "solari", bytes: new TextEncoder().encode("{}\n{}"), eventCount: 2, truncated: false },
    })
    const h = harness({ variants: ["baseline"], repetitions: 1, recording: true, browsers })
    await run(h)
    const stored = h.store.runs.get("baseline-1")!
    expect(stored.replayStatus).toBe("processing")
    expect(stored.replayAttempts).toBe(0)
    expect(stored.replayNextAttemptAt).toBeInstanceOf(Date)
    // Nothing was downloaded, and nothing was stored, inside the run.
    expect(h.store.replays.has("baseline-1")).toBe(false)
  })

  it("reaches a terminal verdict without waiting for any replay", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      recording: true,
      // A provider that would hang forever if the pipeline still waited on it.
      browsers: new FakeBrowserProvider({ recording: true, replayThrows: true }),
    })
    const report = await run(h)
    expect(h.store.statusOf("baseline-1")).toBe("passed")
    expect(report.metrics.reliability).toBe(1)
    expect(h.store.runs.get("baseline-1")!.replayStatus).toBe("processing")
  })

  it("does not queue a replay when recording was off", async () => {
    const h = harness({ variants: ["baseline"], repetitions: 1 })
    const stored = (await run(h), h.store.runs.get("baseline-1")!)
    expect(stored.replayStatus).toBe("not_requested")
    expect(stored.replayNextAttemptAt).toBeUndefined()
  })
})

describe("resource discipline", () => {
  it("disposes every browser it created", async () => {
    const h = harness({ variants: ["a", "b"], repetitions: 2 })
    await run(h)
    expect(h.browsers.created).toHaveLength(4)
    expect(h.browsers.disposed).toHaveLength(4)
  })

  it("disposes browsers even when the evaluator throws", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 2,
      evaluator: new FakeEvaluator(async () => {
        throw new Error("evaluator down")
      }),
    })
    await run(h)
    expect(h.browsers.disposed).toHaveLength(2)
  })

  it("does not let a teardown error change the run's result", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      browsers: new FakeBrowserProvider({ throwOnDispose: true }),
    })
    await run(h)
    expect(h.store.statusOf("baseline-1")).toBe("passed")
  })

  // The sandbox hosting the benchmark site bills until it is killed, and
  // nothing else in the system notices if this is skipped.
  it("tears the benchmark site down on success", async () => {
    const h = harness()
    await run(h)
    expect(h.fixtures.host!.disposeCalls).toBe(1)
  })

  it("tears the benchmark site down when the suite fails", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      evaluator: new FakeEvaluator(async () => {
        throw new Error("boom")
      }),
    })
    await run(h)
    expect(h.fixtures.host!.disposeCalls).toBe(1)
  })

  it("honours the concurrency cap", async () => {
    const h = harness({
      variants: ["a", "b", "c", "d"],
      repetitions: 3,
      maxConcurrency: 2,
      agent: new FakeAgent(async () => {
        await sleep(15)
        return { finishReason: "finished", steps: 1, actions: [], message: "" }
      }),
    })
    await run(h)
    expect(h.browsers.peakConcurrent).toBeLessThanOrEqual(2)
    expect(h.browsers.created).toHaveLength(12)
  })

  it("heartbeats while the suite runs so a dead worker is detectable", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 1,
      agent: new FakeAgent(async () => {
        await sleep(60)
        return { finishReason: "finished", steps: 1, actions: [], message: "" }
      }),
    })
    await run(h)
    expect(h.store.heartbeats).toBeGreaterThan(0)
  })
})

describe("guards", () => {
  it("refuses an empty suite with a clear message", async () => {
    const h = harness({ variants: [], repetitions: 0 })
    await expect(run(h)).rejects.toThrow(/at least one variant/)
  })

  it("refuses a suite larger than the hard cap", async () => {
    const h = harness({ variants: Array.from({ length: 30 }, (_, i) => `v${i}`), repetitions: 10 })
    await expect(run(h)).rejects.toThrow(/may not exceed/)
  })

  it("cancels cleanly when the signal aborts", async () => {
    const h = harness({
      variants: ["baseline"],
      repetitions: 2,
      agent: new FakeAgent(async () => {
        await sleep(200)
        return { finishReason: "finished", steps: 1, actions: [], message: "" }
      }),
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)
    await h.runner.execute(controller.signal).catch(() => {})
    expect(h.fixtures.host!.disposeCalls).toBe(1)
  })
})

describe("buildStartUrl", () => {
  it("joins the fixture base with the task path and the run id", () => {
    expect(buildStartUrl("https://fixture.test", "/", "r1")).toBe("https://fixture.test/?run=r1")
    expect(buildStartUrl("https://fixture.test/", "cart", "r1")).toBe("https://fixture.test/cart?run=r1")
    expect(buildStartUrl("https://fixture.test", "/cart?x=1", "r1")).toBe("https://fixture.test/cart?x=1&run=r1")
  })

  it("passes an absolute URL through untouched, for authorised external targets", () => {
    expect(buildStartUrl("https://fixture.test", "https://example.com/app", "r1")).toBe(
      "https://example.com/app",
    )
  })

  it("escapes the run id", () => {
    expect(buildStartUrl("https://fixture.test", "/", "a b&c")).toBe("https://fixture.test/?run=a%20b%26c")
  })
})
