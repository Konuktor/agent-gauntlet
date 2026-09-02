/**
 * The browser-safe surface of @gauntlet/core.
 *
 * Client components import from here, never from the package root. The root
 * barrel reaches the orchestrator, which reaches `node:fs` and `node:zlib`;
 * pulling that into a browser bundle fails the build if you are lucky and ships
 * dead server code if you are not. Everything below is pure data and pure
 * functions with no Node dependency.
 */
export {
  CATEGORY_LABELS,
  perturbationCategories,
  type PerturbationCategory,
} from "./domain/perturbation.js"

export {
  BORROWED_SESSION_ID,
  displaySessionId,
  individualRunStatuses,
  isPass,
  isScorable,
  suiteRunStatuses,
  TERMINAL_RUN_STATUSES,
  TERMINAL_SUITE_STATUSES,
  type IndividualRunStatus,
  type SuiteRunStatus,
} from "./domain/run.js"

export {
  failureCategories,
  FAILURE_CATEGORY_META,
  type FailureCategory,
} from "./failure/categories.js"
export type { FailureCluster } from "./failure/classifier.js"

export {
  BASELINE_VARIANT,
  REGRESSION_THRESHOLD_PP,
  type CategoryMetrics,
  type SuiteComparison,
  type SuiteMetrics,
  type VariantDelta,
  type VariantMetrics,
} from "./metrics/reliability.js"
export type { ConfidenceInterval } from "./metrics/wilson.js"

export { ERROR_COPY, errorCodes, type ErrorCode } from "./errors.js"
export type { Assertion, EvaluationResult } from "./domain/evaluation.js"
export type { AgentAction, AgentActionRecord, AgentFinishReason } from "./domain/agent.js"
