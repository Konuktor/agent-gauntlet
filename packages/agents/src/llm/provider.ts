import { z } from "zod"

/**
 * A single structured decision from a model.
 *
 * Deliberately flat rather than a discriminated union: JSON-schema-constrained
 * decoding handles a flat object with an enum far more reliably than a union of
 * object shapes, and the mapping back into the strict `AgentAction` union
 * happens on our side where it can be validated.
 */
export const llmDecisionSchema = z.object({
  observation: z.string().describe("One sentence describing what is on the page right now."),
  action: z
    .enum(["click", "type", "navigate", "press", "wait", "finish"])
    .describe("The single next action to take."),
  target: z
    .string()
    .describe(
      'For click/type: the element ref from the list (e.g. "e7"), or its visible label. Empty string for other actions.',
    ),
  value: z
    .string()
    .describe(
      "For type: the text to enter. For navigate: the URL. For press: the key. Empty string otherwise.",
    ),
  waitMs: z.number().describe("For wait: milliseconds to wait. 0 otherwise."),
  reason: z.string().describe("Why this action moves the task forward."),
})

export type LlmDecision = z.infer<typeof llmDecisionSchema>

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmProvider {
  readonly id: string
  readonly model: string
  decide(input: {
    system: string
    user: string
    signal?: AbortSignal
  }): Promise<{ decision: LlmDecision; usage?: LlmUsage }>
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    /** True for outages and rate limits: our infrastructure failing, not the
     *  agent being unreliable, so it must not be scored against the agent. */
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "LlmProviderError"
  }
}
