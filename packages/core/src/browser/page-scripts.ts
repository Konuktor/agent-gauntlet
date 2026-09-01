/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Workspace packages ship as TypeScript source, so this file is compiled under
// each consumer's tsconfig. The references above make its DOM requirement
// self-declaring rather than something every consumer has to remember.
/**
 * Scripts that run inside the page.
 *
 * They are authored as real, type-checked functions and stringified for
 * `evaluate`, so they get compile-time checking rather than living as opaque
 * template strings. They must stay self-contained: no imports, no closures over
 * module scope, nothing that survives serialisation.
 */

export const REF_ATTRIBUTE = "data-gauntlet-ref"

export interface RawElement {
  ref: string
  role: string
  name: string
  tag: string
  value?: string
  disabled?: boolean
  obscured?: boolean
}

export interface RawSnapshot {
  url: string
  title: string
  visibleText: string
  elements: RawElement[]
  /** A full-viewport overlay is the signature of the modal/cookie perturbations
   *  and the single most useful signal for classifying their failures. */
  blockingOverlay: { present: boolean; label: string | null }
}

/**
 * Extract a bounded, semantic view of the page.
 *
 * Bounded on purpose: an LLM planner is billed per token and a raw DOM dump is
 * both enormous and mostly noise. What survives is what a person would use to
 * decide the next action — what you can see, and what you can click.
 */
export function snapshotScript(limits: { maxElements: number; maxTextChars: number }): string {
  const fn = function (config: { maxElements: number; maxTextChars: number }) {
    const REF = "data-gauntlet-ref"

    function isVisible(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false
      if (el.hidden || el.closest("[hidden]")) return false
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false
      }
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }

    function accessibleName(el: Element): string {
      const aria = el.getAttribute("aria-label")
      if (aria && aria.trim()) return aria.trim()

      const labelledBy = el.getAttribute("aria-labelledby")
      if (labelledBy) {
        const parts = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim()
        if (parts) return parts
      }

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const labels = (el as HTMLInputElement).labels
        if (labels && labels.length > 0) {
          const text = Array.from(labels)
            .map((l) => l.textContent ?? "")
            .join(" ")
            .trim()
          if (text) return text
        }
        const placeholder = el.getAttribute("placeholder")
        if (placeholder) return placeholder.trim()
        const name = el.getAttribute("name")
        if (name) return name
      }

      if (el instanceof HTMLImageElement && el.alt) return el.alt.trim()

      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim()
      if (text) return text.slice(0, 120)

      return el.getAttribute("title")?.trim() ?? el.getAttribute("name")?.trim() ?? ""
    }

    function roleOf(el: Element): string {
      const explicit = el.getAttribute("role")
      if (explicit) return explicit
      const tag = el.tagName.toLowerCase()
      if (tag === "a") return el.hasAttribute("href") ? "link" : "generic"
      if (tag === "button") return "button"
      if (tag === "select") return "combobox"
      if (tag === "textarea") return "textbox"
      if (tag === "input") {
        const type = (el as HTMLInputElement).type
        if (type === "submit" || type === "button" || type === "reset") return "button"
        if (type === "checkbox") return "checkbox"
        if (type === "radio") return "radio"
        return "textbox"
      }
      return "generic"
    }

    /**
     * True when something else paints over this element's centre. This is how a
     * cookie banner or an interstitial is detected — the button is present and
     * "visible", but a click at its centre lands somewhere else entirely.
     */
    function isObscured(el: Element): boolean {
      const rect = el.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false
      const hit = document.elementFromPoint(x, y)
      if (!hit) return false
      return hit !== el && !el.contains(hit) && !hit.contains(el)
    }

    function detectOverlay(): { present: boolean; label: string | null } {
      const candidates = Array.from(document.body.querySelectorAll("*")).filter((el) => {
        if (!(el instanceof HTMLElement) || !isVisible(el)) return false
        const style = window.getComputedStyle(el)
        if (style.position !== "fixed" && style.position !== "sticky") return false
        if (Number(style.zIndex || "0") < 100) return false
        const rect = el.getBoundingClientRect()
        // Covers a meaningful slice of the viewport, not a sticky nav bar.
        const coverage = (rect.width * rect.height) / (window.innerWidth * window.innerHeight)
        return coverage > 0.15
      })
      const first = candidates[0]
      return first
        ? { present: true, label: (first.getAttribute("aria-label") ?? first.id ?? "").slice(0, 80) || null }
        : { present: false, label: null }
    }

    const selector = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "[role=button]",
      "[role=link]",
      "[role=checkbox]",
      "[onclick]",
    ].join(",")

    // Stale refs from a previous snapshot would let the agent act on elements
    // that no longer exist, so they are cleared every time.
    for (const stale of Array.from(document.querySelectorAll("[" + REF + "]"))) {
      stale.removeAttribute(REF)
    }

    const elements: Array<Record<string, unknown>> = []
    let index = 0
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (elements.length >= config.maxElements) break
      if (!isVisible(el)) continue
      const ref = "e" + index++
      el.setAttribute(REF, ref)
      const entry: Record<string, unknown> = {
        ref,
        role: roleOf(el),
        name: accessibleName(el),
        tag: el.tagName.toLowerCase(),
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) entry.value = el.value
      if ((el as HTMLButtonElement).disabled) entry.disabled = true
      if (isObscured(el)) entry.obscured = true
      elements.push(entry)
    }

    const bodyText = (document.body.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim()

    return {
      url: window.location.href,
      title: document.title,
      visibleText: bodyText.slice(0, config.maxTextChars),
      elements,
      blockingOverlay: detectOverlay(),
    }
  }

  return `(${fn.toString()})(${JSON.stringify(limits)})`
}

/** Read the fixture's own stage marker, when present. Cheap page-side evidence. */
export const STAGE_SCRIPT = `(() => document.body?.getAttribute("data-stage") ?? null)()`

/** Is a blocking overlay present right now? Used at the end of a run. */
export function overlayProbeScript(): string {
  const fn = function () {
    const overlay = Array.from(document.body.querySelectorAll("*")).find((el) => {
      if (!(el instanceof HTMLElement)) return false
      const style = window.getComputedStyle(el)
      if (style.position !== "fixed" && style.position !== "sticky") return false
      if (style.display === "none" || style.visibility === "hidden") return false
      if (Number(style.zIndex || "0") < 100) return false
      const rect = el.getBoundingClientRect()
      return (rect.width * rect.height) / (window.innerWidth * window.innerHeight) > 0.15
    })
    return Boolean(overlay)
  }
  return `(${fn.toString()})()`
}

export function refSelector(ref: string): string {
  return `[${REF_ATTRIBUTE}="${ref}"]`
}
