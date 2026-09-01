import {
  agentActionSchema,
  GauntletError,
  observe,
  refSelector,
  type AgentAction,
  type AgentActionRecord,
  type AgentExecutionResult,
  type AgentFinishReason,
  type AgentRunContext,
  type PageDriver,
  type PageObservation,
} from "@gauntlet/core"
import { findElement, observationSignature } from "./targeting.js"

/**
 * Decides the next action from a page observation. The loop below owns
 * everything else — validation, execution, loop detection, bookkeeping — so a
 * planner is a small, pure-ish function and both the heuristic and the LLM
 * agent share exactly the same execution semantics.
 */
export interface Planner {
  readonly name: string
  plan(input: {
    observation: PageObservation
    context: AgentRunContext
    history: AgentActionRecord[]
  }): Promise<AgentAction>
}

/** Identical action, unchanged page, this many times in a row = stuck. */
const LOOP_THRESHOLD = 3

export async function runAgentLoop(
  context: AgentRunContext,
  planner: Planner,
): Promise<AgentExecutionResult> {
  const actions: AgentActionRecord[] = []
  let finishReason: AgentFinishReason = "max_steps"
  let message = ""
  let repeats = 0
  let lastKey: string | undefined

  const finish = (reason: AgentFinishReason, text: string): AgentExecutionResult => ({
    finishReason: reason,
    steps: actions.length,
    actions,
    message: text,
  })

  try {
    await context.page.goto(context.startUrl, { waitUntil: "domcontentloaded" })
    context.recorder.navigation(context.startUrl)
  } catch (error) {
    return {
      ...finish("error", `Could not open the starting page: ${describe(error)}`),
      errorCode: "navigation_failed",
    }
  }

  for (let step = 1; step <= context.maxSteps; step++) {
    if (context.signal.aborted) return finish("cancelled", "The run was cancelled.")

    let observation: PageObservation
    try {
      observation = await observe(context.page, {
        stepsRemaining: context.maxSteps - step + 1,
        recentActions: actions,
      })
    } catch (error) {
      return {
        ...finish("error", `Could not read the page: ${describe(error)}`),
        errorCode: "observation_failed",
      }
    }

    let action: AgentAction
    try {
      action = agentActionSchema.parse(
        await planner.plan({ observation, context, history: actions }),
      )
    } catch (error) {
      // A planner that emits an unparseable action is an agent bug, and it is
      // reported as one rather than being silently retried.
      return {
        ...finish("error", `The agent proposed an invalid action: ${describe(error)}`),
        errorCode: "invalid_action",
      }
    }

    if (action.type === "finish") {
      finishReason = "finished"
      message = action.reason
      break
    }

    const signatureBefore = observationSignature(observation)
    const urlBefore = observation.url
    const startedAt = Date.now()
    const outcome = await execute(context.page, action, observation)
    const record: AgentActionRecord = {
      step,
      action,
      ok: outcome.ok,
      detail: outcome.detail,
      durationMs: Date.now() - startedAt,
      urlBefore,
      urlAfter: context.page.url(),
    }
    actions.push(record)
    context.recorder.action(record)
    if (record.urlAfter !== urlBefore) context.recorder.navigation(record.urlAfter)

    // Loop detection compares the ACTION and the resulting page. Repeating a
    // click that keeps changing the page is progress; repeating one that
    // changes nothing is the signature of an agent that cannot see what is
    // blocking it, which is precisely the failure mode we exist to surface.
    const key = `${JSON.stringify(action)}::${signatureBefore}`
    repeats = key === lastKey ? repeats + 1 : 0
    lastKey = key
    if (repeats >= LOOP_THRESHOLD - 1) {
      return {
        ...finish("loop_detected", `Repeated the same action ${repeats + 1} times with no change.`),
        errorCode: "loop",
      }
    }
  }

  if (finishReason === "max_steps") {
    message = `Used all ${context.maxSteps} steps without reporting completion.`
  }
  return finish(finishReason, message)
}

interface ActionOutcome {
  ok: boolean
  detail: string
}

async function execute(
  page: PageDriver,
  action: AgentAction,
  observation: PageObservation,
): Promise<ActionOutcome> {
  try {
    switch (action.type) {
      case "click": {
        const target = resolveTarget(action.selector, action.text, observation, "click")
        if (!target.selector) return { ok: false, detail: target.detail }
        await page.clickSelector(target.selector, { timeoutMs: 5_000 })
        return { ok: true, detail: `clicked ${target.detail}` }
      }
      case "type": {
        const target = resolveTarget(action.selector, action.label, observation, "type")
        if (!target.selector) return { ok: false, detail: target.detail }
        await page.fillSelector(target.selector, action.text, { timeoutMs: 5_000 })
        return { ok: true, detail: `typed into ${target.detail}` }
      }
      case "navigate": {
        await page.goto(action.url, { waitUntil: "domcontentloaded" })
        return { ok: true, detail: `navigated to ${action.url}` }
      }
      case "press": {
        await page.press(action.key)
        return { ok: true, detail: `pressed ${action.key}` }
      }
      case "wait": {
        await page.waitForTimeout(action.ms)
        return { ok: true, detail: `waited ${action.ms}ms` }
      }
      default:
        return { ok: false, detail: "unsupported action" }
    }
  } catch (error) {
    return { ok: false, detail: describe(error) }
  }
}

function resolveTarget(
  selector: string | undefined,
  label: string | undefined,
  observation: PageObservation,
  intent: "click" | "type",
): { selector?: string; detail: string } {
  if (selector) return { selector, detail: `selector ${selector}` }
  if (!label) return { detail: "no target given" }

  // Refs come straight from the snapshot the planner was shown, so an LLM can
  // point at exactly the element it reasoned about.
  const byRef = observation.elements.find((e) => e.ref === label)
  if (byRef) return { selector: refSelector(byRef.ref), detail: `${byRef.role} "${byRef.name}"` }

  const match = findElement(observation.elements, label, { intent })
  if (!match) {
    const nearby = observation.elements
      .slice(0, 6)
      .map((e) => `"${e.name}"`)
      .join(", ")
    return { detail: `no element matching "${label}" (visible: ${nearby || "none"})` }
  }
  return {
    selector: refSelector(match.element.ref),
    detail: `${match.element.role} "${match.element.name}" (${match.reason})`,
  }
}

function describe(error: unknown): string {
  if (error instanceof GauntletError) return error.message
  return error instanceof Error ? error.message.split("\n")[0]!.slice(0, 300) : String(error)
}
