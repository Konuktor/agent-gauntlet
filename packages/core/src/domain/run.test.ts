import { describe, expect, it } from "vitest"
import {
  assertRunTransition,
  assertSuiteTransition,
  canTransitionRun,
  canTransitionSuite,
  individualRunStatuses,
  isPass,
  isScorable,
  suiteRunStatuses,
  TERMINAL_RUN_STATUSES,
} from "./run.js"

describe("suite run state machine", () => {
  it("allows the happy path", () => {
    expect(canTransitionSuite("queued", "preparing")).toBe(true)
    expect(canTransitionSuite("preparing", "running")).toBe(true)
    expect(canTransitionSuite("running", "evaluating")).toBe(true)
    expect(canTransitionSuite("evaluating", "completed")).toBe(true)
  })

  it("rejects skipping and reversing", () => {
    expect(canTransitionSuite("queued", "completed")).toBe(false)
    expect(canTransitionSuite("running", "queued")).toBe(false)
    expect(() => assertSuiteTransition("completed", "running")).toThrow(
      /Invalid suite run transition/,
    )
  })

  it("treats terminal states as absorbing", () => {
    for (const terminal of ["completed", "failed", "cancelled"] as const) {
      for (const to of suiteRunStatuses) {
        expect(canTransitionSuite(terminal, to)).toBe(false)
      }
    }
  })

  it("can be cancelled from any non-terminal state", () => {
    for (const from of ["queued", "preparing", "running", "evaluating"] as const) {
      expect(canTransitionSuite(from, "cancelled")).toBe(true)
    }
  })
})

describe("individual run state machine", () => {
  it("allows the full pipeline", () => {
    expect(canTransitionRun("queued", "preparing_environment")).toBe(true)
    expect(canTransitionRun("preparing_environment", "running_agent")).toBe(true)
    expect(canTransitionRun("running_agent", "evaluating")).toBe(true)
    expect(canTransitionRun("evaluating", "collecting_replay")).toBe(true)
    expect(canTransitionRun("collecting_replay", "failed")).toBe(true)
  })

  // Replay is evidence, not truth. A run may reach a verdict without one.
  it("allows reaching a verdict without collecting a replay", () => {
    expect(canTransitionRun("evaluating", "passed")).toBe(true)
    expect(canTransitionRun("evaluating", "failed")).toBe(true)
  })

  // A crashed agent still gets evaluated: the evaluator, not the agent, decides.
  it("never lets a running agent jump straight to passed or failed", () => {
    expect(canTransitionRun("running_agent", "passed")).toBe(false)
    expect(canTransitionRun("running_agent", "failed")).toBe(false)
    expect(canTransitionRun("running_agent", "infrastructure_error")).toBe(true)
  })

  it("treats terminal states as absorbing", () => {
    for (const terminal of TERMINAL_RUN_STATUSES) {
      for (const to of individualRunStatuses) {
        expect(canTransitionRun(terminal, to)).toBe(false)
      }
    }
  })

  it("throws on an impossible transition", () => {
    expect(() => assertRunTransition("passed", "failed")).toThrow(
      /Invalid individual run transition/,
    )
  })
})

describe("scoring", () => {
  it("scores only runs that produced a verdict", () => {
    expect(isScorable("passed")).toBe(true)
    expect(isScorable("failed")).toBe(true)
    expect(isScorable("infrastructure_error")).toBe(false)
    expect(isScorable("cancelled")).toBe(false)
    expect(isScorable("running_agent")).toBe(false)
  })

  it("counts only passed as a pass", () => {
    expect(isPass("passed")).toBe(true)
    expect(isPass("failed")).toBe(false)
    expect(isPass("infrastructure_error")).toBe(false)
  })
})
