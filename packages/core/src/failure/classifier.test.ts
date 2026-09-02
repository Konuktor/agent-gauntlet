import { describe, expect, it } from "vitest"
import type { AgentAction, AgentExecutionResult } from "../domain/agent.js"
import type { EvaluationResult } from "../domain/evaluation.js"
import { classifyFailure, clusterFailures, type FailureEvidence } from "./classifier.js"

function action(a: AgentAction, ok = true) {
  return { step: 1, action: a, ok, detail: "", durationMs: 10, urlBefore: "/", urlAfter: "/" }
}

function agent(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return { finishReason: "finished", steps: 5, actions: [], message: "", ...overrides }
}

function evidence(overrides: Partial<FailureEvidence> = {}): FailureEvidence {
  return {
    agentResult: agent(),
    evaluation: null,
    errorCode: null,
    consoleErrors: [],
    pageErrors: [],
    networkErrors: [],
    urlHistory: ["https://shop.test/", "https://shop.test/cart"],
    ...overrides,
  }
}

const failedEval = (names: string[]): EvaluationResult => ({
  success: false,
  score: 0.5,
  assertions: names.map((name) => ({
    name,
    description: name.replace(/_/g, " "),
    expected: true,
    actual: false,
    passed: false,
    weight: 1,
  })),
  evidence: {},
})

describe("classifyFailure", () => {
  it("maps infrastructure error codes without inference", () => {
    expect(classifyFailure(evidence({ errorCode: "solari_concurrency" })).category).toBe(
      "browser_error",
    )
    expect(classifyFailure(evidence({ errorCode: "sandbox_create_failed" })).category).toBe(
      "sandbox_error",
    )
    expect(classifyFailure(evidence({ errorCode: "evaluator_unavailable" })).category).toBe(
      "evaluator_failure",
    )
  })

  it("detects a loop before anything else the agent did", () => {
    const c = classifyFailure(
      evidence({
        agentResult: agent({
          finishReason: "loop_detected",
          actions: [action({ type: "click", text: "Add to cart" }, false)],
        }),
      }),
    )
    expect(c.category).toBe("loop")
    expect(c.message).toContain("Add to cart")
  })

  it("classifies a timeout", () => {
    const c = classifyFailure(
      evidence({ agentResult: agent({ finishReason: "timeout", steps: 12 }) }),
    )
    expect(c.category).toBe("timeout")
    expect(c.message).toContain("12 steps")
  })

  it("classifies an expired session as auth", () => {
    expect(classifyFailure(evidence({ sessionExpired: true })).category).toBe("auth")
  })

  // The signature failure this product exists to surface.
  it("blames an overlay when clicks failed while one was present", () => {
    const c = classifyFailure(
      evidence({
        overlayPresentAtEnd: true,
        agentResult: agent({
          actions: [
            action({ type: "click", text: "Checkout" }, false),
            action({ type: "click", text: "Checkout" }, false),
          ],
        }),
      }),
    )
    expect(c.category).toBe("unexpected_ui")
    expect(c.rule).toBe("blocked_by_overlay")
    expect(c.message).toContain("2 clicks")
  })

  it("does not blame an overlay that blocked nothing", () => {
    const c = classifyFailure(
      evidence({
        overlayPresentAtEnd: true,
        agentResult: agent({ actions: [action({ type: "click" })] }),
      }),
    )
    expect(c.category).not.toBe("unexpected_ui")
  })

  it("classifies repeated network failures", () => {
    const c = classifyFailure(
      evidence({
        networkErrors: [
          { url: "https://shop.test/api/cart", failure: "ECONNRESET" },
          { url: "https://shop.test/api/coupon", failure: "ECONNRESET" },
        ],
      }),
    )
    expect(c.category).toBe("network")
    expect(c.message).toContain("/api/cart")
  })

  it("classifies a high ratio of missed targets as selector failure", () => {
    const c = classifyFailure(
      evidence({
        agentResult: agent({
          actions: [
            action({ type: "click", text: "Add" }, false),
            action({ type: "click", text: "Add" }, false),
            action({ type: "navigate", url: "/" }, true),
          ],
        }),
      }),
    )
    expect(c.category).toBe("selector_failure")
    expect(c.message).toBe("2 of 3 actions could not find their target element.")
  })

  it("does not call one miss out of many a selector failure", () => {
    const c = classifyFailure(
      evidence({
        agentResult: agent({
          actions: [
            action({ type: "click" }, false),
            ...Array.from({ length: 8 }, () => action({ type: "click" }, true)),
          ],
        }),
      }),
    )
    expect(c.category).not.toBe("selector_failure")
  })

  it("classifies an agent that never navigated", () => {
    const c = classifyFailure(evidence({ urlHistory: ["https://shop.test/?run=1"] }))
    expect(c.category).toBe("navigation")
  })

  it("treats query-string-only changes as the same page", () => {
    const c = classifyFailure(
      evidence({ urlHistory: ["https://shop.test/?run=1", "https://shop.test/?run=1&x=2"] }),
    )
    expect(c.category).toBe("navigation")
  })

  it("classifies lost progress as state loss", () => {
    const c = classifyFailure(
      evidence({
        agentResult: agent({ actions: Array.from({ length: 6 }, () => action({ type: "click" })) }),
        evaluation: failedEval(["product_in_cart"]),
      }),
    )
    expect(c.category).toBe("state_loss")
  })

  it("falls back to reporting the failed assertion", () => {
    const c = classifyFailure(
      evidence({
        agentResult: agent({ actions: [action({ type: "click" })] }),
        evaluation: {
          success: false,
          score: 0.5,
          assertions: [
            {
              name: "coupon_applied",
              description: "coupon SAVE20 applied",
              expected: "SAVE20",
              actual: null,
              passed: false,
              weight: 1,
            },
          ],
          evidence: {},
        },
      }),
    )
    expect(c.rule).toBe("assertions_failed")
    expect(c.message).toContain("coupon SAVE20 applied")
  })

  it("never throws on empty evidence", () => {
    const c = classifyFailure({
      agentResult: null,
      evaluation: null,
      errorCode: null,
      consoleErrors: [],
      pageErrors: [],
      networkErrors: [],
      urlHistory: [],
    })
    expect(c.category).toBe("unknown")
    expect(c.rule).toBe("fallback")
  })
})

describe("clusterFailures", () => {
  it("groups failures that differ only in run-specific detail", () => {
    const clusters = clusterFailures([
      {
        runId: "r1",
        category: "unexpected_ui",
        message: "An overlay covered the page and 2 clicks failed.",
      },
      {
        runId: "r2",
        category: "unexpected_ui",
        message: "An overlay covered the page and 5 clicks failed.",
      },
      { runId: "r3", category: "auth", message: "The session expired." },
    ])
    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toMatchObject({ category: "unexpected_ui", count: 2 })
    expect(clusters[0]?.runIds).toEqual(["r1", "r2"])
  })

  it("keeps genuinely different failures apart", () => {
    const clusters = clusterFailures([
      { runId: "r1", category: "timeout", message: "Ran out of time." },
      { runId: "r2", category: "timeout", message: "Hit the step limit." },
    ])
    expect(clusters).toHaveLength(2)
  })

  it("sorts by frequency", () => {
    const clusters = clusterFailures([
      { runId: "a", category: "auth", message: "expired" },
      { runId: "b", category: "loop", message: "looped" },
      { runId: "c", category: "loop", message: "looped" },
    ])
    expect(clusters[0]?.category).toBe("loop")
  })
})
