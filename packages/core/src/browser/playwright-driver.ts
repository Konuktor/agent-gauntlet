import type { ActionOptions, NavigateOptions, PageDriver, PageSignals } from "../ports/page.js"

/**
 * Structural description of the slice of a Playwright `Page` we use.
 *
 * Solari drives a patched Playwright (`patchright-core`) while local mode uses
 * stock `playwright`. The two are behaviourally identical here but nominally
 * distinct types, so each adapter asserts its page into this shape exactly
 * once, at its own boundary, and everything downstream is type-safe again.
 */
export interface PlaywrightLikePage {
  url(): string
  title(): Promise<string>
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>
  evaluate(script: string, arg?: unknown): Promise<unknown>
  click(selector: string, options?: { timeout?: number }): Promise<void>
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>
  keyboard: { press(key: string): Promise<void> }
  waitForTimeout(ms: number): Promise<void>
  screenshot(options?: { type?: "png" | "jpeg"; fullPage?: boolean }): Promise<Uint8Array>
  isClosed(): boolean
  on(event: string, handler: (payload: never) => void): void
}

const DEFAULT_ACTION_TIMEOUT_MS = 8_000
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000

export function createPlaywrightPageDriver(page: PlaywrightLikePage): PageDriver {
  return {
    url: () => page.url(),
    title: () => page.title(),
    goto: async (url: string, options?: NavigateOptions) => {
      await page.goto(url, {
        timeout: options?.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
        waitUntil: options?.waitUntil ?? "domcontentloaded",
      })
    },
    evaluate: <T,>(script: string, arg?: unknown) => page.evaluate(script, arg) as Promise<T>,
    clickSelector: (selector: string, options?: ActionOptions) =>
      page.click(selector, { timeout: options?.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS }),
    fillSelector: (selector: string, value: string, options?: ActionOptions) =>
      page.fill(selector, value, { timeout: options?.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS }),
    press: (key: string) => page.keyboard.press(key),
    waitForTimeout: (ms: number) => page.waitForTimeout(ms),
    screenshot: () => page.screenshot({ type: "png" }),
    isClosed: () => page.isClosed(),
  }
}

/** Shapes of the Playwright events we subscribe to, described structurally. */
interface ConsoleMessageLike {
  type(): string
  text(): string
  location(): { url?: string }
}
interface RequestLike {
  url(): string
  method(): string
  failure(): { errorText: string } | null
}
interface FrameLike {
  url(): string
}

export function createPlaywrightPageSignals(page: PlaywrightLikePage): PageSignals {
  return {
    onConsole(handler) {
      page.on("console", ((message: ConsoleMessageLike) => {
        const level = message.type()
        // Only errors and warnings are worth persisting; `console.log` noise
        // from a busy app would swamp the run timeline.
        if (level !== "error" && level !== "warning") return
        handler(level, message.text().slice(0, 2_000), message.location()?.url)
      }) as (payload: never) => void)
    },
    onPageError(handler) {
      page.on("pageerror", ((error: Error) => {
        handler(error.message.slice(0, 2_000), error.stack?.slice(0, 4_000))
      }) as (payload: never) => void)
    },
    onRequestFailed(handler) {
      page.on("requestfailed", ((request: RequestLike) => {
        handler(request.url().slice(0, 500), request.failure()?.errorText ?? "unknown", request.method())
      }) as (payload: never) => void)
    },
    onNavigation(handler) {
      page.on("framenavigated", ((frame: FrameLike) => {
        handler(frame.url())
      }) as (payload: never) => void)
    },
  }
}
