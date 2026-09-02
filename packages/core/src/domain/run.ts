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

/**
 * The session id recorded for a run that borrowed the visitor's browser.
 *
 * A borrowed session has no id we are entitled to — it is theirs — so this
 * marks the run instead. It is also why such runs carry no replay: recording
 * is fixed when a session is created, and we did not create this one.
 */
export const BORROWED_SESSION_ID = "borrowed"

/**
 * A session id you can show, from one you must not.
 *
 * Solari's composite id — `host:uuid:cuid:timestamp.signature` — is the
 * authorizing component of that session's WebSocket URL. Prefix it with the
 * public base and you are holding the capability, which is why the endpoint
 * itself is treated as a secret everywhere else in this codebase.
 *
 * It has to be *stored*: replay retrieval happens minutes after a run ends and
 * needs the real id. Nothing outside the worker has any use for it, though, so
 * it must never leave the API. This keeps the part that identifies a run and
 * drops the parts that authorize anything — the signature, and the internal
 * hostname that comes with it.
 */
export function displaySessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null
  // A borrowed session has no id of ours; the marker is meaningful as-is.
  if (sessionId === BORROWED_SESSION_ID) return sessionId
  const segments = sessionId.split(":")
  const identifier = segments.length > 1 ? segments[1]! : sessionId
  return identifier.split(".")[0]!.slice(0, 12)
}

export const TERMINAL_SUITE_STATUSES: readonly SuiteRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
]
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

/**
 * How far a replay has got, independently of the run's verdict.
 *
 * A replay is evidence, not a judgement, and Solari publishes it
 * asynchronously after the session is released — observed anywhere from ~7s to
 * beyond 75s. Blocking a run on it made a passing run look unfinished and,
 * worse, made the metrics wait on an artefact that changes nothing. So the run
 * goes terminal immediately and the replay is enriched afterwards.
 */
export const replayStatuses = ["not_requested", "processing", "ready", "unavailable"] as const
export type ReplayStatus = (typeof replayStatuses)[number]

/**
 * Delays before each replay fetch attempt, in order.
 *
 * Five bounded tries over ~7.5 minutes: long enough for the slow publications
 * measured on real sessions, short enough that a run is never left
 * "processing" forever.
 */
export const REPLAY_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 240_000] as const
