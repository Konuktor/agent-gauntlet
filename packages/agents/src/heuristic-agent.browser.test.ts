import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createMemoryRecorder,
  createRng,
  nullLogger,
  type AgentRunContext,
  type FixtureHost,
  type TaskDefinition,
} from "@gauntlet/core"
import { LIMITS } from "@gauntlet/config"
import { LocalBrowserProvider, LocalFixtureProvider } from "@gauntlet/local-runtime"
import { resolvePerturbation } from "@gauntlet/perturbations"
import type { PublicRunState } from "@gauntlet/fixture"
import { HeuristicReferenceAgent } from "./heuristic-agent.js"

/**
 * The reference agent, driving a real Chromium against the real fixture.
 *
 * This is the test that proves the whole vertical slice works: page scripts,
 * targeting, the loop, the perturbations and the fixture's authoritative state.
 * It spends no Solari credits, and it deliberately asserts on the FIXTURE's
 * state rather than on what the agent said about itself.
 */

const TASK: TaskDefinition = {
  id: "task-checkout",
  name: "Complete Demo Checkout",
  description:
    "Add Aurora Headphones to cart, apply coupon SAVE20, proceed to checkout, enter Name: Ada Lovelace and City: London, continue to review, and stop before submitting payment.",
  startUrl: "/",
  maxSteps: 25,
  timeoutMs: 90_000,
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

let fixture: FixtureHost
let browsers: LocalBrowserProvider

beforeAll(async () => {
  fixture = await new LocalFixtureProvider().start()
  // Recording is off here: rrweb adds a megabyte of init script per context and
  // this suite is about agent behaviour, not replay capture.
  browsers = new LocalBrowserProvider({ headless: true, recording: false })
}, 120_000)

afterAll(async () => {
  await browsers?.shutdown()
  await fixture?.dispose()
})

async function runVariant(variant: string, repetition = 1) {
  const runId = `it-${variant}-${repetition}-${Date.now().toString(36)}`
  const resolved = resolvePerturbation({
    suiteRunId: "integration-suite",
    individualRunId: runId,
    variant,
    repetition,
  })

  await fixture.registerRun({
    runId,
    variant,
    seed: resolved.context.seed,
    config: resolved.fixtureConfig as Record<string, unknown>,
  })

  const environment = await browsers.create({
    recording: false,
    stealth: false,
    perturbation: resolved.browserOptions,
  })

  const controller = new AbortController()
  const context: AgentRunContext = {
    runId,
    task: TASK,
    startUrl: `${fixture.baseUrl}/?run=${runId}`,
    page: environment.page,
    maxSteps: TASK.maxSteps,
    signal: controller.signal,
    recorder: createMemoryRecorder(LIMITS.maxEventsPerRun),
    logger: nullLogger,
    rng: createRng(resolved.context.seed),
  }

  try {
    const result = await new HeuristicReferenceAgent().run(context)
    const state = (await fixture.readState(runId)) as PublicRunState
    return { result, state, runId }
  } finally {
    await environment.dispose()
    await fixture.unregisterRun(runId)
  }
}

describe("reference agent against the real fixture", () => {
  it("completes the baseline task exactly as specified", async () => {
    const { result, state } = await runVariant("baseline")

    expect(state.cart).toEqual([{ sku: "aurora-headphones", quantity: 1, unitPriceCents: 9900 }])
    expect(state.coupon).toBe("SAVE20")
    expect(state.discountApplied).toBe(true)
    expect(state.totalCents).toBe(7920)
    expect(state.checkout).toEqual({ name: "Ada Lovelace", city: "London" })
    expect(state.stage).toBe("review")
    // The task says stop before paying, and "mostly right" is still wrong.
    expect(state.purchaseSubmitted).toBe(false)

    expect(result.finishReason).toBe("finished")
    expect(result.steps).toBeLessThanOrEqual(TASK.maxSteps)
  }, 120_000)

  it("is reproducible: two runs of baseline reach the same state", async () => {
    const a = await runVariant("baseline", 1)
    const b = await runVariant("baseline", 2)
    expect(a.state.stage).toBe(b.state.stage)
    expect(a.state.totalCents).toBe(b.state.totalCents)
  }, 180_000)

  it("dismisses a cookie banner and still completes the task", async () => {
    const { state } = await runVariant("cookie_popup")
    expect(state.stage).toBe("review")
    expect(state.discountApplied).toBe(true)
  }, 120_000)

  it("survives a renamed call to action via the synonym table", async () => {
    const { state } = await runVariant("renamed_cta")
    expect(state.cart).toHaveLength(1)
    expect(state.stage).toBe("review")
  }, 120_000)

  it("waits out a control that hydrates late", async () => {
    const { state } = await runVariant("delayed_element")
    expect(state.cart).toHaveLength(1)
  }, 120_000)

  it("completes on a mobile viewport", async () => {
    const { state } = await runVariant("mobile_viewport")
    expect(state.stage).toBe("review")
  }, 120_000)

  // The documented gap in the reference agent: it has no notion of recovering
  // from a page the task description never mentioned. The gauntlet is supposed
  // to find exactly this, so the test asserts the failure is real and specific
  // rather than pretending the agent is better than it is.
  it("fails to recover from an expired session, and the fixture proves it", async () => {
    const { result, state } = await runVariant("expired_session")
    expect(state.stage).not.toBe("review")
    expect(state.purchaseSubmitted).toBe(false)
    // Whatever the agent reported about itself, the state is the verdict.
    expect(["finished", "loop_detected", "max_steps"]).toContain(result.finishReason)
  }, 120_000)

  it("never trusts the agent's own report over the fixture", async () => {
    const { result, state } = await runVariant("expired_session", 2)
    const claimedDone = result.finishReason === "finished"
    const actuallyDone = state.stage === "review" && state.discountApplied
    // This is the product thesis in one assertion: a self-reported "finished"
    // is not evidence of anything.
    if (claimedDone) expect(actuallyDone).toBe(false)
  }, 120_000)
})
