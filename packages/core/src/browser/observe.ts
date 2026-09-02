import type { AgentActionRecord, Observation, ObservedElement } from "../domain/agent.js"
import type { PageDriver } from "../ports/page.js"
import { snapshotScript, type RawSnapshot } from "./page-scripts.js"

export interface ObserveLimits {
  maxElements: number
  maxTextChars: number
  /** How many prior actions the planner is reminded of. Enough to notice it is
   *  repeating itself, not enough to blow the context budget. */
  recentActions: number
}

export const DEFAULT_OBSERVE_LIMITS: ObserveLimits = {
  maxElements: 40,
  maxTextChars: 2_000,
  recentActions: 5,
}

export interface PageObservation extends Observation {
  blockingOverlay: { present: boolean; label: string | null }
}

/** Take one bounded, semantic reading of the page. */
export async function observe(
  page: PageDriver,
  input: {
    stepsRemaining: number
    recentActions: AgentActionRecord[]
    limits?: ObserveLimits
  },
): Promise<PageObservation> {
  const limits = input.limits ?? DEFAULT_OBSERVE_LIMITS
  const raw = await page.evaluate<RawSnapshot>(
    snapshotScript({ maxElements: limits.maxElements, maxTextChars: limits.maxTextChars }),
  )

  const elements: ObservedElement[] = raw.elements.map((el) => ({
    ref: el.ref,
    role: el.role,
    name: el.name,
    tag: el.tag,
    ...(el.value === undefined ? {} : { value: el.value }),
    ...(el.disabled ? { disabled: true } : {}),
    ...(el.obscured ? { obscured: true } : {}),
  }))

  return {
    url: raw.url,
    title: raw.title,
    visibleText: raw.visibleText,
    elements,
    stepsRemaining: input.stepsRemaining,
    recentActions: input.recentActions.slice(-limits.recentActions),
    blockingOverlay: raw.blockingOverlay,
  }
}

/** Compact, deterministic text rendering of an observation for an LLM prompt. */
export function renderObservation(observation: PageObservation): string {
  const lines: string[] = [
    `URL: ${observation.url}`,
    `TITLE: ${observation.title}`,
    `STEPS REMAINING: ${observation.stepsRemaining}`,
  ]

  if (observation.blockingOverlay.present) {
    lines.push(
      `WARNING: a full-screen overlay is covering the page${observation.blockingOverlay.label ? ` (${observation.blockingOverlay.label})` : ""}. Dismiss it before anything else.`,
    )
  }

  lines.push("", "INTERACTIVE ELEMENTS:")
  for (const el of observation.elements) {
    const flags = [el.disabled ? "disabled" : "", el.obscured ? "OBSCURED" : ""].filter(Boolean)
    const value = el.value ? ` value=${JSON.stringify(el.value)}` : ""
    lines.push(
      `  [${el.ref}] ${el.role} ${JSON.stringify(el.name)}${value}${flags.length ? ` (${flags.join(", ")})` : ""}`,
    )
  }

  if (observation.recentActions.length > 0) {
    lines.push("", "RECENT ACTIONS:")
    for (const record of observation.recentActions) {
      lines.push(
        `  ${record.step}. ${record.action.type} — ${record.ok ? "ok" : "FAILED"}: ${record.detail}`,
      )
    }
  }

  lines.push("", "VISIBLE TEXT:", observation.visibleText)
  return lines.join("\n")
}
