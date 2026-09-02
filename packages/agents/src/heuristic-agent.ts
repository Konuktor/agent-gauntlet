import {
  type AgentAction,
  type AgentAdapter,
  type AgentExecutionResult,
  type AgentRunContext,
  type PageObservation,
} from "@gauntlet/core"
import { parseDirectives, type Directive } from "./directives.js"
import { runAgentLoop, type Planner } from "./loop.js"
import { findDismissControl, findElement } from "./targeting.js"

/**
 * Capabilities a heuristic agent may or may not have.
 *
 * These are the differences that actually decide whether a browser agent
 * survives production, so they are configuration rather than assumptions —
 * running the same suite against the same agent with `dismissOverlays` off is
 * a direct, honest measurement of what that one capability is worth.
 */
export interface AgentCapabilities {
  /** Notice a full-viewport overlay and dismiss it before acting. */
  dismissOverlays: boolean
  /** Wait and retry when a control has not hydrated yet. */
  waitForLateElements: boolean
  /** Recognise an interrupted session and re-establish it. */
  recoverSessions: boolean
}

export const NAIVE_CAPABILITIES: AgentCapabilities = {
  dismissOverlays: false,
  waitForLateElements: false,
  recoverSessions: false,
}

/** What a competent engineer's first real agent tends to handle. */
export const REFERENCE_CAPABILITIES: AgentCapabilities = {
  dismissOverlays: true,
  waitForLateElements: true,
  recoverSessions: false,
}

export const RESILIENT_CAPABILITIES: AgentCapabilities = {
  dismissOverlays: true,
  waitForLateElements: true,
  recoverSessions: true,
}

/**
 * The built-in Reference Agent: deterministic, no LLM, no credentials.
 *
 * It exists so AgentGauntlet is useful and demoable the moment you clone it,
 * and so the product's own tests do not depend on a model provider being up.
 *
 * What it handles, honestly stated:
 *   - executing an ordered list of intents parsed from the task description
 *   - matching controls by accessible name, with a synonym table
 *   - noticing a full-viewport overlay and dismissing it before acting
 *   - waiting and retrying when a control is not on the page yet
 *
 * What it does NOT handle, equally honestly:
 *   - recovering from an expired session or any other unexpected page
 *   - re-planning when the site does something the description did not mention
 *   - reading page state to verify its own progress
 *
 * Those gaps are real, and the gauntlet finds them. That is the point: this is
 * a plausible first agent, not a straw man and not a champion.
 */
export class HeuristicReferenceAgent implements AgentAdapter {
  readonly type = "reference" as const

  constructor(
    private readonly capabilities: AgentCapabilities = REFERENCE_CAPABILITIES,
    readonly name = "Reference Agent",
  ) {}

  async run(context: AgentRunContext): Promise<AgentExecutionResult> {
    return runAgentLoop(context, new HeuristicPlanner(context, this.capabilities))
  }
}

/** A deliberately plain agent: no overlay handling, no patience. Useful as the
 *  control arm when measuring what a capability is actually worth. */
export function createNaiveAgent(): HeuristicReferenceAgent {
  return new HeuristicReferenceAgent(NAIVE_CAPABILITIES, "Naive Agent")
}

export function createResilientAgent(): HeuristicReferenceAgent {
  return new HeuristicReferenceAgent(RESILIENT_CAPABILITIES, "Resilient Agent")
}

/** How many times a single intent is attempted before the agent gives up. */
const MAX_ATTEMPTS_PER_DIRECTIVE = 6
const RETRY_WAIT_MS = 1_500

class HeuristicPlanner implements Planner {
  readonly name = "heuristic"

  private readonly directives: Directive[]
  private cursor = 0
  private attempts = 0
  /**
   * Whether the action just emitted was an attempt at the current directive,
   * or housekeeping (a wait, or dismissing an overlay). Only a successful
   * DIRECTIVE action advances the cursor — treating a successful overlay
   * dismissal as progress silently skips a real step, and the run then fails
   * for a reason that has nothing to do with the perturbation.
   */
  private lastEmitted: "directive" | "housekeeping" = "housekeeping"
  private lastTargetResolved = false

  constructor(
    context: AgentRunContext,
    private readonly capabilities: AgentCapabilities,
  ) {
    this.directives = parseDirectives(context.task.description)
    this.maxAttempts = capabilities.waitForLateElements ? MAX_ATTEMPTS_PER_DIRECTIVE : 2
  }

  private readonly maxAttempts: number

  async plan(input: {
    observation: PageObservation
    context: AgentRunContext
    history: Array<{ ok: boolean }>
  }): Promise<AgentAction> {
    const { observation, history } = input
    const previous = history.at(-1)

    // Advance only when the previous action was a directive attempt that both
    // resolved a target and executed cleanly.
    if (previous?.ok && this.lastEmitted === "directive" && this.lastTargetResolved) {
      this.cursor += 1
      this.attempts = 0
    }
    this.lastEmitted = "housekeeping"
    this.lastTargetResolved = false

    // An overlay is checked before every action, not once at the start: the
    // interstitial perturbation appears on a timer, so a page that was clear a
    // moment ago may not be now.
    if (this.capabilities.recoverSessions) {
      const recovery = this.findRecoveryControl(observation)
      if (recovery) return { type: "click", text: recovery, reason: "re-establish the session" }
    }

    if (this.capabilities.dismissOverlays && observation.blockingOverlay.present) {
      const dismiss = findDismissControl(observation.elements)
      if (dismiss) {
        return {
          type: "click",
          text: dismiss.ref,
          reason: `dismiss the overlay (${observation.blockingOverlay.label ?? "unlabelled"})`,
        }
      }
    }

    const directive = this.directives[this.cursor]
    if (!directive || directive.kind === "stop") {
      return { type: "finish", reason: directive?.describe ?? "no further steps" }
    }

    if (this.attempts >= this.maxAttempts) {
      return {
        type: "finish",
        reason: `gave up trying to ${directive.describe} after ${this.attempts} attempts`,
      }
    }

    // Wait before EVERY retry, not just the first. Controls that hydrate a
    // couple of seconds after load are ordinary on real sites, and an agent
    // that gives up after one 1.2s pause would be failing for a reason that
    // says nothing interesting about its reasoning.
    if (this.capabilities.waitForLateElements && this.attempts > 0 && this.attempts % 2 === 1) {
      this.attempts += 1
      return {
        type: "wait",
        ms: RETRY_WAIT_MS,
        reason: `waiting for "${directive.describe}" to appear`,
      }
    }
    this.attempts += 1

    this.lastEmitted = "directive"

    if (directive.kind === "click") {
      const match = this.firstMatch(observation, directive.candidates, "click")
      this.lastTargetResolved = Boolean(match)
      return {
        type: "click",
        text: match ?? directive.candidates[0]!,
        reason: directive.describe,
      }
    }

    const field = this.firstMatch(observation, directive.fieldCandidates, "type")
    this.lastTargetResolved = Boolean(field)
    return {
      type: "type",
      label: field ?? directive.fieldCandidates[0]!,
      text: directive.value,
      reason: directive.describe,
    }
  }

  /**
   * An interrupted session shows a page the task description never mentioned.
   * Recognising it means noticing that the page offers exactly one obvious way
   * forward that is not part of the plan, and taking it.
   */
  private findRecoveryControl(observation: PageObservation): string | null {
    if (!/expired|signed out|session/i.test(observation.visibleText)) return null
    for (const label of ["Resume session", "Resume", "Continue session", "Sign in again"]) {
      const match = findElement(observation.elements, label, { intent: "click", threshold: 0.7 })
      if (match) return match.element.ref
    }
    return null
  }

  /** Try each label in order; return the ref of the first that resolves. */
  private firstMatch(
    observation: PageObservation,
    candidates: string[],
    intent: "click" | "type",
  ): string | null {
    for (const candidate of candidates) {
      const match = findElement(observation.elements, candidate, { intent })
      if (match) return match.element.ref
    }
    return null
  }
}
