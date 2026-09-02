import type { ObservedElement } from "@gauntlet/core"

/**
 * Resolve "click the thing that says X" against a page snapshot.
 *
 * Targeting by accessible name rather than by CSS path or coordinates is a
 * deliberate product decision: half the perturbations we test are layout
 * changes, and an agent pinned to `body > div:nth-child(3) > button` fails all
 * of them for reasons that say nothing about its reasoning. Matching on what a
 * person would read keeps the test about resilience, not selector brittleness.
 */

export interface MatchResult {
  element: ObservedElement
  score: number
  reason: string
}

/** Words that carry no signal when comparing two labels. */
const STOPWORDS = new Set(["the", "a", "an", "to", "in", "on", "of", "for", "your", "my", "and"])

/**
 * Phrases that mean the same thing to a person. This is what lets an agent
 * survive `renamed_cta` — and its coverage being finite is exactly why a real
 * agent still fails when a site renames something outside the list.
 */
const SYNONYMS: Array<string[]> = [
  ["add to cart", "add to basket", "add to bag", "add", "buy", "in den warenkorb", "hinzufügen"],
  [
    "checkout",
    "check out",
    "proceed to checkout",
    "continue to checkout",
    "continue",
    "weiter",
    "zur kasse gehen",
  ],
  ["apply", "apply coupon", "redeem", "use code", "gutschein einlösen"],
  ["accept", "accept all", "allow", "agree", "got it", "ok", "alle akzeptieren"],
  ["close", "dismiss", "no thanks", "not now", "×", "x", "schließen", "nein danke"],
  ["place order", "buy now", "pay now", "submit order", "jetzt kaufen"],
  ["continue to review", "review", "review order", "weiter zur übersicht"],
  ["resume", "resume session", "sign in again", "continue session", "sitzung fortsetzen"],
]

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

function synonymGroup(text: string): string[] | undefined {
  const normalized = normalize(text)
  return SYNONYMS.find((group) => group.includes(normalized))
}

/** Are two labels synonyms of each other? */
export function areSynonyms(a: string, b: string): boolean {
  const group = synonymGroup(a)
  return group ? group.includes(normalize(b)) : false
}

function similarity(query: string, candidate: string): { score: number; reason: string } {
  const q = normalize(query)
  const c = normalize(candidate)
  if (!q || !c) return { score: 0, reason: "empty" }

  if (q === c) return { score: 1, reason: "exact name" }
  if (areSynonyms(q, c)) return { score: 0.92, reason: "known synonym" }
  if (c.startsWith(q) || q.startsWith(c)) return { score: 0.8, reason: "prefix match" }
  if (c.includes(q) || q.includes(c)) return { score: 0.72, reason: "substring match" }

  const qt = tokens(query)
  const ct = new Set(tokens(candidate))
  if (qt.length === 0) return { score: 0, reason: "no tokens" }
  const overlap = qt.filter((t) => ct.has(t)).length
  const ratio = overlap / qt.length

  // A single shared word is not a match. "Add to cart" and "Cart (0)" overlap
  // on one token out of two, and accepting that made the agent click the cart
  // link when the real button had not hydrated yet — a wrong action that looks
  // like success and corrupts the rest of the run. Requiring two shared words
  // (or a single-word query matching exactly) keeps fuzzy matching useful
  // without letting it invent targets.
  const strongEnough = qt.length === 1 ? overlap === 1 : overlap >= 2
  return strongEnough && ratio >= 0.6
    ? { score: 0.4 + ratio * 0.25, reason: `${overlap}/${qt.length} words match` }
    : { score: 0, reason: "no match" }
}

const CLICKABLE_ROLES = new Set(["button", "link", "checkbox", "radio", "tab", "menuitem"])
const TEXT_ROLES = new Set(["textbox", "combobox", "searchbox"])

export interface FindOptions {
  /** Restrict to controls you can click, or to fields you can type into. */
  intent: "click" | "type"
  /** Minimum score to accept. Below this we report "not found" rather than
   *  clicking something arbitrary, because a wrong click corrupts the run. */
  threshold?: number
}

export function findElement(
  elements: readonly ObservedElement[],
  query: string,
  options: FindOptions,
): MatchResult | null {
  const wanted = options.intent === "click" ? CLICKABLE_ROLES : TEXT_ROLES
  const threshold = options.threshold ?? 0.5

  let best: MatchResult | null = null
  for (const element of elements) {
    if (element.disabled) continue
    const roleFits = wanted.has(element.role)
    const { score, reason } = similarity(query, element.name)
    if (score === 0) continue

    // A role mismatch is not fatal — a <div role=generic onclick> is still a
    // button to a person — but it loses to a genuine control.
    const adjusted = roleFits ? score : score * 0.6
    if (adjusted < threshold) continue
    if (!best || adjusted > best.score) best = { element, score: adjusted, reason }
  }

  return best
}

/** The control most likely to dismiss a blocking overlay. */
export function findDismissControl(elements: readonly ObservedElement[]): ObservedElement | null {
  const candidates = ["accept all", "accept", "close", "dismiss", "no thanks", "ok", "got it"]
  for (const candidate of candidates) {
    const match = findElement(elements, candidate, { intent: "click", threshold: 0.7 })
    if (match) return match.element
  }
  return null
}

/** A stable description of the page, used to tell "nothing changed" from "the
 *  same action worked twice". */
export function observationSignature(input: {
  url: string
  elements: readonly ObservedElement[]
}): string {
  const names = input.elements
    .map((e) => `${e.role}:${normalize(e.name)}:${e.value ?? ""}`)
    .sort()
    .join("|")
  return `${input.url}::${names}`
}
