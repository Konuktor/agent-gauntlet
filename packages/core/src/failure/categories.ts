export const failureCategories = [
  "timeout",
  "navigation",
  "unexpected_ui",
  "selector_failure",
  "state_loss",
  "auth",
  "network",
  "loop",
  "agent_error",
  "evaluator_failure",
  "sandbox_error",
  "browser_error",
  "unknown",
] as const

export type FailureCategory = (typeof failureCategories)[number]

export interface FailureCategoryMeta {
  label: string
  /** One line the dashboard shows under the category chip. */
  summary: string
  /** Whose problem this is. Infrastructure categories are excluded from the
   *  agent's reliability score. */
  blame: "agent" | "infrastructure"
}

export const FAILURE_CATEGORY_META: Record<FailureCategory, FailureCategoryMeta> = {
  timeout: {
    label: "Timeout",
    summary: "The agent did not reach a verdict inside the task's time budget.",
    blame: "agent",
  },
  navigation: {
    label: "Navigation",
    summary: "The agent ended up on the wrong page, or never left the first one.",
    blame: "agent",
  },
  unexpected_ui: {
    label: "Unexpected UI",
    summary: "An overlay, banner or modal blocked the agent and it did not recover.",
    blame: "agent",
  },
  selector_failure: {
    label: "Selector failure",
    summary: "The agent kept targeting elements that were not there.",
    blame: "agent",
  },
  state_loss: {
    label: "State loss",
    summary: "Work the agent had already done was gone by the end of the run.",
    blame: "agent",
  },
  auth: {
    label: "Auth",
    summary: "The session expired and the agent did not re-establish it.",
    blame: "agent",
  },
  network: {
    label: "Network",
    summary: "Requests the task depended on failed or never returned.",
    blame: "agent",
  },
  loop: {
    label: "Loop",
    summary: "The agent repeated the same action with no change in page state.",
    blame: "agent",
  },
  agent_error: { label: "Agent error", summary: "The agent itself threw or exited badly.", blame: "agent" },
  evaluator_failure: {
    label: "Evaluator failure",
    summary: "We could not read authoritative state, so the run could not be judged.",
    blame: "infrastructure",
  },
  sandbox_error: { label: "Sandbox error", summary: "The Solari sandbox failed.", blame: "infrastructure" },
  browser_error: {
    label: "Browser error",
    summary: "The Solari browser session failed or disconnected.",
    blame: "infrastructure",
  },
  unknown: { label: "Unclassified", summary: "No rule matched this failure.", blame: "agent" },
}
