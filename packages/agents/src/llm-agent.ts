import {
  renderObservation,
  type AgentAction,
  type AgentAdapter,
  type AgentExecutionResult,
  type AgentRunContext,
  type PageObservation,
} from "@gauntlet/core"
import { runAgentLoop, type Planner } from "./loop.js"
import { LlmProviderError, type LlmDecision, type LlmProvider } from "./llm/index.js"

const SYSTEM_PROMPT = `You are a browser agent completing a task on a web page.

You will be shown the page's URL, its interactive elements, and its visible text.
Each element has a ref like "e7". Choose exactly ONE next action.

Rules:
- Target elements by their ref. Refs change between steps, so always use the
  refs from the observation you were just given.
- If an element is marked OBSCURED, or the observation warns about an overlay,
  deal with that first: close, dismiss or accept it before anything else.
- If a control you need is not on the page yet, wait briefly and look again
  rather than clicking something else.
- Do only what the task asks. If the task says to stop before a final action,
  stop before it — completing extra steps is a failure, not initiative.
- When the task is complete, use "finish".`

export interface LlmAgentOptions {
  provider: LlmProvider
  name?: string
  /** Consecutive provider failures tolerated before the run is abandoned. */
  maxProviderErrors?: number
}

/**
 * An agent that asks a model for its next action.
 *
 * Shares the exact execution loop, targeting and bookkeeping used by the
 * deterministic reference agent, so a reliability difference between the two is
 * attributable to the planner and not to the harness around it.
 */
export class LlmAgent implements AgentAdapter {
  readonly type = "llm" as const
  readonly name: string

  constructor(private readonly options: LlmAgentOptions) {
    this.name = options.name ?? `LLM Agent (${options.provider.model})`
  }

  async run(context: AgentRunContext): Promise<AgentExecutionResult> {
    return runAgentLoop(context, new LlmPlanner(this.options, context))
  }
}

class LlmPlanner implements Planner {
  readonly name = "llm"
  private consecutiveErrors = 0
  private inputTokens = 0
  private outputTokens = 0

  constructor(
    private readonly options: LlmAgentOptions,
    private readonly context: AgentRunContext,
  ) {}

  async plan(input: { observation: PageObservation }): Promise<AgentAction> {
    const user = [
      `TASK: ${this.context.task.description}`,
      "",
      renderObservation(input.observation),
    ].join("\n")

    try {
      const { decision, usage } = await this.options.provider.decide({
        system: SYSTEM_PROMPT,
        user,
        signal: this.context.signal,
      })
      this.consecutiveErrors = 0
      if (usage) {
        this.inputTokens += usage.inputTokens
        this.outputTokens += usage.outputTokens
        this.context.recorder.log("llm step", {
          model: this.options.provider.model,
          inputTokens: this.inputTokens,
          outputTokens: this.outputTokens,
        })
      }
      return toAgentAction(decision)
    } catch (error) {
      this.consecutiveErrors += 1
      const limit = this.options.maxProviderErrors ?? 2
      const retryable = error instanceof LlmProviderError ? error.retryable : false

      // A provider outage is OUR infrastructure failing, not the agent being
      // unreliable, so it must not be scored as an agent failure. Backing off
      // once is fair; repeatedly is not, so the run ends and is recorded as an
      // infrastructure error further up.
      if (retryable && this.consecutiveErrors <= limit) {
        return { type: "wait", ms: 1_500, reason: "model provider hiccup; retrying" }
      }
      throw error
    }
  }
}

/** Map the model's flat decision into the strict action union. */
function toAgentAction(decision: LlmDecision): AgentAction {
  const reason = decision.reason || decision.observation
  switch (decision.action) {
    case "click":
      return { type: "click", text: decision.target, reason }
    case "type":
      return { type: "type", label: decision.target, text: decision.value, reason }
    case "navigate":
      return { type: "navigate", url: decision.value, reason }
    case "press":
      return { type: "press", key: decision.value || "Enter", reason }
    case "wait":
      return { type: "wait", ms: clampWait(decision.waitMs), reason }
    case "finish":
      return { type: "finish", reason: reason || "task complete" }
  }
}

function clampWait(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 1_000
  return Math.min(15_000, Math.round(ms))
}
