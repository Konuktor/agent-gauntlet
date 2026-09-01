import { GauntletError } from "../errors.js"

/** §36 — explicit states. Impossible transitions are rejected, not tolerated. */
export const suiteRunStatuses = [
  "queued",
  "preparing",
  "running",
  "evaluating",
  "completed",
  "failed",
  "cancelled",
] as const
export type SuiteRunStatus = (typeof suiteRunStatuses)[number]

export const individualRunStatuses = [
  "queued",
  "preparing_environment",
  "running_agent",
  "evaluating",
  "collecting_replay",
  "passed",
  "failed",
  "infrastructure_error",
  "cancelled",
] as const
export type IndividualRunStatus = (typeof individualRunStatuses)[number]

const SUITE_TRANSITIONS: Record<SuiteRunStatus, readonly SuiteRunStatus[]> = {
  queued: ["preparing", "cancelled", "failed"],
  preparing: ["running", "failed", "cancelled"],
  running: ["evaluating", "completed", "failed", "cancelled"],
  evaluating: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
}

const RUN_TRANSITIONS: Record<IndividualRunStatus, readonly IndividualRunStatus[]> = {
  queued: ["preparing_environment", "cancelled", "infrastructure_error"],
  preparing_environment: ["running_agent", "infrastructure_error", "cancelled"],
  // An agent can fail so hard we skip straight to a verdict, but we still
  // evaluate whenever we can: the evaluator, not the agent, decides.
  running_agent: ["evaluating", "infrastructure_error", "cancelled"],
  evaluating: ["collecting_replay", "passed", "failed", "infrastructure_error", "cancelled"],
  collecting_replay: ["passed", "failed", "infrastructure_error", "cancelled"],
  passed: [],
  failed: [],
  infrastructure_error: [],
  cancelled: [],
}

export const TERMINAL_SUITE_STATUSES: readonly SuiteRunStatus[] = ["completed", "failed", "cancelled"]
export const TERMINAL_RUN_STATUSES: readonly IndividualRunStatus[] = [
  "passed",
  "failed",
  "infrastructure_error",
  "cancelled",
]

export function canTransitionSuite(from: SuiteRunStatus, to: SuiteRunStatus): boolean {
  return SUITE_TRANSITIONS[from].includes(to)
}

export function canTransitionRun(from: IndividualRunStatus, to: IndividualRunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to)
}

export function assertSuiteTransition(from: SuiteRunStatus, to: SuiteRunStatus): void {
  if (!canTransitionSuite(from, to)) {
    throw new GauntletError({
      code: "internal",
      message: `Invalid suite run transition ${from} -> ${to}`,
    })
  }
}

export function assertRunTransition(from: IndividualRunStatus, to: IndividualRunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new GauntletError({
      code: "internal",
      message: `Invalid individual run transition ${from} -> ${to}`,
    })
  }
}

/**
 * Only `passed` counts toward reliability, and only `passed`/`failed` count in
 * the denominator. An infrastructure error is OUR fault, not the agent's, so
 * scoring it as a failure would slander the agent; it is reported separately.
 */
export function isScorable(status: IndividualRunStatus): boolean {
  return status === "passed" || status === "failed"
}

export function isPass(status: IndividualRunStatus): boolean {
  return status === "passed"
}
