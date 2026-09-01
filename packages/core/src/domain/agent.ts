import { z } from "zod"

export const agentTypes = ["reference", "llm", "repository"] as const
export type AgentType = (typeof agentTypes)[number]

/**
 * The action vocabulary an agent may emit. Deliberately small and semantic:
 * targeting by accessible name survives a layout change, pixel coordinates do
 * not, and half the perturbations we test are layout changes.
 */
export const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    /** Accessible name / visible label of the target. Preferred. */
    text: z.string().optional(),
    /** CSS selector escape hatch. */
    selector: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("type"),
    text: z.string(),
    /** Label of the field, e.g. "Full name". */
    label: z.string().optional(),
    selector: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("navigate"), url: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal("press"), key: z.string(), reason: z.string().optional() }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().min(0).max(15_000),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("finish"), reason: z.string() }),
])
export type AgentAction = z.infer<typeof agentActionSchema>

export interface AgentActionRecord {
  step: number
  action: AgentAction
  ok: boolean
  /** What actually happened — "clicked \"Add to cart\"", or why it failed. */
  detail: string
  durationMs: number
  urlBefore: string
  urlAfter: string
}

export const agentFinishReasons = [
  "finished",
  "max_steps",
  "timeout",
  "loop_detected",
  "error",
  "cancelled",
] as const
export type AgentFinishReason = (typeof agentFinishReasons)[number]

export interface AgentExecutionResult {
  /** How the loop ended. NOT whether the task succeeded — that is the
   *  evaluator's call, and only the evaluator's (§9, §13). */
  finishReason: AgentFinishReason
  steps: number
  actions: AgentActionRecord[]
  /** The agent's own closing statement. Recorded as a claim, never as truth. */
  message: string
  /** Raw stdout/stderr for repository agents (capped). */
  output?: string
  errorCode?: string
}

/** One page observation handed to a planner. Bounded on purpose (§12). */
export interface Observation {
  url: string
  title: string
  visibleText: string
  elements: ObservedElement[]
  stepsRemaining: number
  recentActions: AgentActionRecord[]
}

export interface ObservedElement {
  /** Stable handle the agent references; resolved back to a locator by us. */
  ref: string
  role: string
  name: string
  tag: string
  /** For inputs: the current value, so an agent can tell "typed" from "empty". */
  value?: string
  disabled?: boolean
  /** True when another element paints over this one — the single most useful
   *  signal for the overlay perturbations, and the thing brittle agents miss. */
  obscured?: boolean
}
