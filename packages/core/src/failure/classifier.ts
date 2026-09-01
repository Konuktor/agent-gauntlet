import type { AgentExecutionResult } from "../domain/agent.js"
import type { EvaluationResult } from "../domain/evaluation.js"
import type { ErrorCode } from "../errors.js"
import type { FailureCategory } from "./categories.js"

export interface FailureEvidence {
  agentResult: AgentExecutionResult | null
  evaluation: EvaluationResult | null
  errorCode: ErrorCode | null
  consoleErrors: string[]
  pageErrors: string[]
  networkErrors: Array<{ url: string; failure: string }>
  /** Every URL the page visited, in order. */
  urlHistory: string[]
  /** True when the fixture reported the run's session was invalidated. */
  sessionExpired?: boolean
  /** True when the page had a blocking overlay at the moment the run ended. */
  overlayPresentAtEnd?: boolean
}

export interface Classification {
  category: FailureCategory
  /** The rule that fired, so a surprising classification is debuggable. */
  rule: string
  /** Deterministic sentence built from evidence. An LLM may later add colour,
   *  but it is stored separately and never overwrites this (§14). */
  message: string
}

/** Infrastructure error codes map straight to a category — no inference needed. */
const ERROR_CODE_CATEGORY: Partial<Record<ErrorCode, FailureCategory>> = {
  browser_launch_failed: "browser_error",
  browser_disconnected: "browser_error",
  solari_auth: "browser_error",
  solari_plan: "browser_error",
  solari_concurrency: "browser_error",
  solari_capacity: "browser_error",
  solari_unavailable: "browser_error",
  sandbox_create_failed: "sandbox_error",
  sandbox_command_failed: "sandbox_error",
  fixture_unavailable: "sandbox_error",
  preview_url_unavailable: "sandbox_error",
  evaluator_unavailable: "evaluator_failure",
  evaluator_failed: "evaluator_failure",
  repository_invalid: "agent_error",
  repository_manifest_invalid: "agent_error",
  agent_crashed: "agent_error",
  agent_timeout: "timeout",
  agent_loop_detected: "loop",
}

type Rule = (e: FailureEvidence) => Classification | null

/**
 * Ordered rules, most specific first. The first match wins, and the rule name
 * is recorded — a classification you cannot explain is worse than none.
 *
 * Everything here is derived from observed evidence. No LLM participates in
 * this decision.
 */
const RULES: Array<[string, Rule]> = [
  [
    "infrastructure_error_code",
    (e) => {
      if (!e.errorCode) return null
      const category = ERROR_CODE_CATEGORY[e.errorCode]
      if (!category) return null
      return {
        category,
        rule: "infrastructure_error_code",
        message: `The run stopped with error code ${e.errorCode}.`,
      }
    },
  ],
  [
    "agent_loop",
    (e) =>
      e.agentResult?.finishReason === "loop_detected"
        ? {
            category: "loop",
            rule: "agent_loop",
            message: `The agent repeated ${describeLastAction(e)} without the page changing.`,
          }
        : null,
  ],
  [
    "agent_timeout",
    (e) =>
      e.agentResult?.finishReason === "timeout"
        ? {
            category: "timeout",
            rule: "agent_timeout",
            message: `The agent ran out of time after ${e.agentResult.steps} steps.`,
          }
        : null,
  ],
  [
    "session_expired",
    (e) =>
      e.sessionExpired
        ? {
            category: "auth",
            rule: "session_expired",
            message: "The shopping session expired mid-task and the agent did not re-establish it.",
          }
        : null,
  ],
  [
    "blocked_by_overlay",
    (e) => {
      // The signature failure of a brittle agent: it kept clicking, the clicks
      // kept failing, and something was painted over the target the whole time.
      const failedClicks = countFailedActions(e, "click")
      if (!(e.overlayPresentAtEnd && failedClicks >= 1)) return null
      return {
        category: "unexpected_ui",
        rule: "blocked_by_overlay",
        message: `An overlay covered the page and ${failedClicks} click${failedClicks === 1 ? "" : "s"} never reached the intended element.`,
      }
    },
  ],
  [
    "network_failures",
    (e) => {
      if (e.networkErrors.length < 2) return null
      return {
        category: "network",
        rule: "network_failures",
        message: `${e.networkErrors.length} requests failed, including ${shortUrl(e.networkErrors[0]?.url ?? "")}.`,
      }
    },
  ],
  [
    "repeated_selector_misses",
    (e) => {
      const failed = countFailedActions(e)
      const total = e.agentResult?.actions.length ?? 0
      if (failed < 2 || total === 0 || failed / total < 0.34) return null
      return {
        category: "selector_failure",
        rule: "repeated_selector_misses",
        message: `${failed} of ${total} actions could not find their target element.`,
      }
    },
  ],
  [
    "agent_crashed",
    (e) =>
      e.agentResult?.finishReason === "error"
        ? {
            category: "agent_error",
            rule: "agent_crashed",
            message: e.agentResult.message || "The agent exited with an error.",
          }
        : null,
  ],
  [
    "state_regressed",
    (e) => {
      // Assertions that had to have passed at some point (an item was in the
      // cart) but are false at the end mean progress was lost, not never made.
      const lost = e.evaluation?.assertions.filter((a) => !a.passed && a.expected === true) ?? []
      const progressed = (e.agentResult?.actions.length ?? 0) >= 4
      if (lost.length === 0 || !progressed) return null
      const first = lost[0]
      return {
        category: "state_loss",
        rule: "state_regressed",
        message: `The agent acted ${e.agentResult?.actions.length} times but "${first?.description ?? first?.name}" was not true at the end.`,
      }
    },
  ],
  [
    "never_left_start",
    (e) => {
      const distinct = new Set(e.urlHistory.map(stripQuery))
      if (distinct.size > 1 || e.urlHistory.length === 0) return null
      return {
        category: "navigation",
        rule: "never_left_start",
        message: "The agent never navigated away from the starting page.",
      }
    },
  ],
  [
    "max_steps",
    (e) =>
      e.agentResult?.finishReason === "max_steps"
        ? {
            category: "timeout",
            rule: "max_steps",
            message: `The agent used all ${e.agentResult.steps} of its allowed steps without finishing.`,
          }
        : null,
  ],
  [
    "assertions_failed",
    (e) => {
      const failed = e.evaluation?.assertions.filter((a) => !a.passed) ?? []
      if (failed.length === 0) return null
      const first = failed[0]
      return {
        category: "unknown",
        rule: "assertions_failed",
        message: `${failed.length} assertion${failed.length === 1 ? "" : "s"} failed, starting with "${first?.description ?? first?.name}".`,
      }
    },
  ],
]

export function classifyFailure(evidence: FailureEvidence): Classification {
  for (const [, rule] of RULES) {
    const result = rule(evidence)
    if (result) return result
  }
  return {
    category: "unknown",
    rule: "fallback",
    message: "The run did not satisfy the task, and no specific cause could be identified.",
  }
}

function countFailedActions(e: FailureEvidence, type?: string): number {
  return (
    e.agentResult?.actions.filter((a) => !a.ok && (!type || a.action.type === type)).length ?? 0
  )
}

function describeLastAction(e: FailureEvidence): string {
  const last = e.agentResult?.actions.at(-1)
  if (!last) return "the same action"
  const action = last.action
  if (action.type === "click") return `clicking "${action.text ?? action.selector ?? "an element"}"`
  return `the ${action.type} action`
}

function stripQuery(url: string): string {
  const index = url.indexOf("?")
  return index === -1 ? url : url.slice(0, index)
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname.length > 1 ? parsed.pathname : parsed.host
  } catch {
    return url.slice(0, 60)
  }
}

/**
 * §Stretch 2 — group failures that share a category and a similar message, so a
 * 16-run suite reads as "5x unexpected overlay, 2x auth" instead of 7 rows.
 */
export interface FailureCluster {
  category: FailureCategory
  representativeMessage: string
  count: number
  runIds: string[]
}

export function clusterFailures(
  failures: Array<{ runId: string; category: FailureCategory; message: string }>,
): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>()
  for (const failure of failures) {
    const key = `${failure.category}::${normalizeMessage(failure.message)}`
    const existing = clusters.get(key)
    if (existing) {
      existing.count += 1
      existing.runIds.push(failure.runId)
    } else {
      clusters.set(key, {
        category: failure.category,
        representativeMessage: failure.message,
        count: 1,
        runIds: [failure.runId],
      })
    }
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count)
}

/** Collapse run-specific noise (numbers, quoted labels, urls) so that two
 *  messages describing the same defect land in the same bucket. */
function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/"[^"]*"/g, "<label>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
}
