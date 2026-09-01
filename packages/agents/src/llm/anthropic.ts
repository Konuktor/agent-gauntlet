import Anthropic from "@anthropic-ai/sdk"
import { llmDecisionSchema, LlmProviderError, type LlmProvider } from "./provider.js"

export interface AnthropicProviderOptions {
  apiKey: string
  /** Defaults to Claude Opus 5. */
  model?: string
  /**
   * Thinking depth. Choosing the next click on a page is a small decision made
   * dozens of times per suite, so this defaults low; raise it when you are
   * measuring the model's reasoning rather than the harness around it.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  maxTokens?: number
}

/**
 * JSON Schema handed to the API as `output_config.format`, which constrains
 * decoding so the model cannot return prose where an action belongs.
 *
 * Written out longhand rather than generated from the Zod schema on purpose:
 * the SDK's Zod helper targets zod/v4 while the rest of this workspace is on
 * zod 3, and dragging a second major version of a validation library through
 * the tree to save twenty lines is a bad trade. The Zod schema still validates
 * the response, so there is exactly one source of truth for what is legal.
 */
const DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    observation: { type: "string", description: "One sentence describing what is on the page now." },
    action: {
      type: "string",
      enum: ["click", "type", "navigate", "press", "wait", "finish"],
      description: "The single next action to take.",
    },
    target: {
      type: "string",
      description:
        'For click/type: the element ref from the list (e.g. "e7"), or its visible label. Empty string otherwise.',
    },
    value: {
      type: "string",
      description:
        "For type: the text to enter. For navigate: the URL. For press: the key. Empty string otherwise.",
    },
    waitMs: { type: "number", description: "For wait: milliseconds to wait. 0 otherwise." },
    reason: { type: "string", description: "Why this action moves the task forward." },
  },
  required: ["observation", "action", "target", "value", "waitMs", "reason"],
  additionalProperties: false,
} as const

/**
 * Anthropic-backed planner.
 *
 * The response is schema-constrained on the wire and then validated again on
 * arrival — an action that does not parse is an agent bug we want to surface,
 * not something to paper over with a regex.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly id = "anthropic"
  readonly model: string

  private readonly client: Anthropic
  private readonly effort: NonNullable<AnthropicProviderOptions["effort"]>
  private readonly maxTokens: number

  constructor(options: AnthropicProviderOptions) {
    if (!options.apiKey) {
      throw new LlmProviderError("ANTHROPIC_API_KEY is required for the LLM agent.", false)
    }
    this.client = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model ?? "claude-opus-5"
    this.effort = options.effort ?? "low"
    this.maxTokens = options.maxTokens ?? 4_096
  }

  async decide(input: { system: string; user: string; signal?: AbortSignal }) {
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: input.system,
          output_config: {
            effort: this.effort,
            format: { type: "json_schema", schema: DECISION_JSON_SCHEMA as unknown as Record<string, unknown> },
          },
          messages: [{ role: "user", content: input.user }],
        },
        input.signal ? { signal: input.signal } : {},
      )

      if (response.stop_reason === "refusal") {
        throw new LlmProviderError(
          `The model declined this request (${response.stop_details?.category ?? "unspecified"}).`,
          false,
        )
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")

      const decision = llmDecisionSchema.safeParse(safeJsonParse(text))
      if (!decision.success) {
        throw new LlmProviderError(
          `The model returned an unusable decision: ${decision.error.issues[0]?.message ?? "invalid shape"}`,
          true,
        )
      }

      return {
        decision: decision.data,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      }
    } catch (error) {
      throw toProviderError(error)
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function toProviderError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmProviderError("The model provider is rate limiting us.", true, error)
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmProviderError("ANTHROPIC_API_KEY was rejected.", false, error)
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmProviderError("Could not reach the model provider.", true, error)
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmProviderError(
      `The model provider returned ${error.status}: ${error.message}`,
      typeof error.status === "number" && error.status >= 500,
      error,
    )
  }
  return new LlmProviderError(error instanceof Error ? error.message : String(error), false, error)
}
