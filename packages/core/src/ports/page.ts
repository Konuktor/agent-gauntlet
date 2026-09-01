/**
 * The only browser surface the rest of AgentGauntlet is allowed to see.
 *
 * Deliberately narrow. Solari ships a patched Playwright (`patchright-core`)
 * while local mode uses stock `playwright`; the two are structurally similar
 * but nominally incompatible types. Depending on this port instead means the
 * agent loop, evaluators and classifier are testable with no browser at all.
 */
export interface PageDriver {
  url(): string
  title(): Promise<string>
  goto(url: string, options?: NavigateOptions): Promise<void>
  /** Runs `script` (a stringified function body) in the page. */
  evaluate<T>(script: string, arg?: unknown): Promise<T>
  clickSelector(selector: string, options?: ActionOptions): Promise<void>
  fillSelector(selector: string, value: string, options?: ActionOptions): Promise<void>
  press(key: string): Promise<void>
  waitForTimeout(ms: number): Promise<void>
  screenshot(): Promise<Uint8Array>
  isClosed(): boolean
}

export interface NavigateOptions {
  timeoutMs?: number
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"
}

export interface ActionOptions {
  timeoutMs?: number
}

/** Signals the page emits, forwarded into the run's event log (§15). */
export interface PageSignals {
  onConsole(handler: (level: string, text: string, url?: string) => void): void
  onPageError(handler: (message: string, stack?: string) => void): void
  onRequestFailed(handler: (url: string, failure: string, method?: string) => void): void
  onNavigation(handler: (url: string) => void): void
}

/** Turn an authored function into the string form `evaluate` accepts, so page
 *  scripts stay type-checked at their definition site. */
export function toScript(fn: (...args: never[]) => unknown): string {
  return fn.toString()
}
