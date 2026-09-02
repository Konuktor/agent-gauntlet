import { chromium, type Browser, type BrowserContext, type Route } from "playwright"
import {
  createPlaywrightPageDriver,
  createPlaywrightPageSignals,
  createRng,
  GauntletError,
  newId,
  nullLogger,
  type BrowserEnvironment,
  type BrowserEnvironmentOptions,
  type BrowserProvider,
  type Logger,
  type PlaywrightLikePage,
  type ReplayArtifact,
} from "@gauntlet/core"
import { LIMITS } from "@gauntlet/config"
import { RRWEB_BINDING, RrwebCollector, rrwebInitScript } from "./rrweb.js"

export interface LocalBrowserProviderOptions {
  headless?: boolean
  logger?: Logger
  /** Off by default in tests, where the rrweb bundle is pure overhead. */
  recording?: boolean
  slowMoMs?: number
}

/**
 * Runs the gauntlet against a real Chromium on this machine.
 *
 * This is not a mock. It executes the same agent, against the same fixture,
 * through the same ports, and evaluates it with the same evaluator — the only
 * thing that differs is where the browser lives. That makes the whole pipeline
 * testable and demoable without spending Solari credits, and it is labelled
 * LOCAL everywhere it surfaces so it can never be mistaken for a Solari run.
 */
export class LocalBrowserProvider implements BrowserProvider {
  readonly mode = "local" as const

  private browserPromise: Promise<Browser> | undefined
  private readonly replays = new Map<string, ReplayArtifact>()
  private readonly logger: Logger

  constructor(private readonly options: LocalBrowserProviderOptions = {}) {
    this.logger = options.logger ?? nullLogger
  }

  async create(options: BrowserEnvironmentOptions): Promise<BrowserEnvironment> {
    const browser = await this.ensureBrowser()
    const perturbation = options.perturbation ?? {}
    const envId = newId()

    let context: BrowserContext | undefined
    try {
      context = await browser.newContext({
        viewport: perturbation.viewport ?? { width: 1280, height: 800 },
        ...(perturbation.userAgent ? { userAgent: perturbation.userAgent } : {}),
        ...(perturbation.isMobile ? { isMobile: true } : {}),
        ...(perturbation.hasTouch ? { hasTouch: true } : {}),
        ...(perturbation.deviceScaleFactor
          ? { deviceScaleFactor: perturbation.deviceScaleFactor }
          : {}),
        locale: perturbation.locale ?? "en-US",
      })

      const collector = new RrwebCollector(LIMITS.maxReplayBytes)
      let recording = options.recording && this.options.recording !== false
      if (recording) {
        try {
          await context.exposeBinding(RRWEB_BINDING, (_source, serialized: string) => {
            collector.push(serialized)
          })
          await context.addInitScript({ content: rrwebInitScript() })
        } catch (error) {
          // Recording is evidence infrastructure. Losing it must not cost the
          // user their run — the agent can still be executed and judged, and
          // the run is simply marked as having no replay.
          recording = false
          this.logger.warn("local session recording is unavailable; continuing without a replay", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // network_delay is applied here rather than in the fixture: it is a
      // property of the connection, not of the site.
      if (perturbation.networkDelay) {
        const { matches, delayMs } = perturbation.networkDelay
        const rng = createRng(delayMs)
        for (const pattern of matches) {
          await context.route(pattern, async (route: Route) => {
            await new Promise((resolve) => setTimeout(resolve, rng.jitter(delayMs, 0.3)))
            await route.continue()
          })
        }
      }

      const page = await context.newPage()
      const like = page as unknown as PlaywrightLikePage
      const scopedContext = context
      let disposed = false

      return {
        id: envId,
        // Local mode has no Solari session, and says so rather than inventing
        // an id that would render like a real one in the dashboard.
        sessionId: null,
        mode: "local",
        recordingEnabled: Boolean(recording),
        page: createPlaywrightPageDriver(like),
        signals: createPlaywrightPageSignals(like),
        dispose: async () => {
          if (disposed) return
          disposed = true
          if (recording && collector.eventCount > 0) {
            this.replays.set(envId, {
              source: "local",
              bytes: collector.toNdjson(),
              eventCount: collector.eventCount,
              truncated: collector.wasTruncated,
            })
          }
          await closeQuietly(() => scopedContext.close(), this.logger, "local context close")
        },
      }
    } catch (error) {
      await closeQuietly(() => context?.close(), this.logger, "local context cleanup")
      throw new GauntletError({
        code: "browser_launch_failed",
        message: "Could not start a local browser.",
        detail: error instanceof Error ? error.message : String(error),
        cause: error,
      })
    }
  }

  async fetchReplay(environment: BrowserEnvironment): Promise<ReplayArtifact | null> {
    return this.replays.get(environment.id) ?? null
  }

  async shutdown(): Promise<void> {
    this.replays.clear()
    const pending = this.browserPromise
    this.browserPromise = undefined
    if (!pending) return
    const browser = await pending.catch(() => undefined)
    if (browser) await closeQuietly(() => browser.close(), this.logger, "local browser close")
  }

  /**
   * One Chromium, however many runs ask for it at once.
   *
   * The memoised value is the *promise*, not the browser. Memoising the browser
   * looks equivalent and is not: with concurrency N, all N runs reach this
   * method before the first launch resolves, every one of them sees no browser,
   * and every one launches its own. The last assignment wins the field and the
   * rest are orphaned — never closed, and holding the process open long after
   * the gauntlet has printed its verdict. That is why the CLI would finish a
   * suite, print the result, and then hang until something killed it.
   */
  private ensureBrowser(): Promise<Browser> {
    const pending = this.browserPromise
    if (pending) {
      return pending.then((browser) => {
        if (browser.isConnected()) return browser
        // Crashed between runs: drop it and launch a replacement, once.
        if (this.browserPromise === pending) this.browserPromise = undefined
        return this.ensureBrowser()
      })
    }

    const launch = chromium
      .launch({
        headless: this.options.headless ?? true,
        ...(this.options.slowMoMs ? { slowMo: this.options.slowMoMs } : {}),
      })
      .catch((error: unknown) => {
        // A failed launch must not be cached, or every later run inherits it.
        if (this.browserPromise === launch) this.browserPromise = undefined
        throw new GauntletError({
          code: "browser_launch_failed",
          message:
            "Could not launch a local Chromium. Run `pnpm exec playwright install chromium` and try again.",
          detail: error instanceof Error ? error.message : String(error),
          cause: error,
        })
      })
    this.browserPromise = launch
    return launch
  }
}

/** Cleanup must never mask the original failure with a teardown error. */
async function closeQuietly(
  fn: () => Promise<void> | undefined,
  logger: Logger,
  what: string,
): Promise<void> {
  try {
    await fn()
  } catch (error) {
    logger.warn(`${what} failed`, { error: error instanceof Error ? error.message : String(error) })
  }
}
