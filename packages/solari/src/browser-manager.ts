import { Solari, type CreateSessionOptions, type Session } from "@solarisdk/browser"
import { chromium, type Browser, type BrowserContext } from "patchright-core"
import {
  createPlaywrightPageDriver,
  createPlaywrightPageSignals,
  createRng,
  GauntletError,
  newId,
  nullLogger,
  retry,
  sleep,
  type BrowserEnvironment,
  type BrowserEnvironmentOptions,
  type BrowserProvider,
  type Logger,
  type PlaywrightLikePage,
  type ReplayArtifact,
} from "@gauntlet/core"
import { isRetryableInfrastructure, mapSolariError } from "./errors.js"
import { fetchReplayWithBackoff } from "./replay.js"

export interface SolariBrowserProviderOptions {
  apiKey: string
  baseUrl?: string
  logger?: Logger
  /** Attempts for the connect step only. Never used to retry an agent. */
  connectAttempts?: number
  /** How many times to wait for a Solari slot before giving up on a 429. */
  capacityWaitAttempts?: number
  /** Base wait between those attempts; a little jitter is added on top. */
  capacityWaitMs?: number
}

/**
 * The only place in AgentGauntlet that talks to Solari Browser.
 *
 * Design note — why `sessions.create()` rather than `launch()`:
 *
 *   `launch()` is the ergonomic path, but the endpoints it exposes on the
 *   returned BrowserSession are wrapped through a loopback proxy running on
 *   THIS machine (`ws://127.0.0.1:...`). That is invisible and harmless right
 *   up until you hand the endpoint to an agent running inside a Solari Sandbox,
 *   which cannot reach our loopback interface and fails with a connection
 *   error that looks like a Solari outage.
 *
 *   `sessions.create()` returns the raw, publicly routable `wss://` endpoints,
 *   which is what a remote agent needs. We connect to `wsEndpoint` ourselves
 *   with the pinned patchright client, and hand `cdpEndpoint` to repository
 *   agents. One code path, and the remote case works.
 *
 * Those endpoints are CREDENTIALS — the docs are explicit that "the URL is the
 * credential ... anyone holding the URL can drive the browser" — so they live
 * in memory for the life of a run and are never persisted, logged or sent to
 * the frontend. Only the session id is.
 */
/** How long to wait for a Solari slot before giving up, and how many times. */
const CAPACITY_WAIT_ATTEMPTS = 6
const CAPACITY_WAIT_MS = 10_000
export class SolariBrowserProvider implements BrowserProvider {
  readonly mode = "solari" as const

  private readonly client: Solari
  private readonly logger: Logger
  private readonly liveSessions = new Set<string>()
  private readonly capacityWaitAttempts: number
  private readonly capacityWaitMs: number

  constructor(private readonly options: SolariBrowserProviderOptions) {
    this.client = new Solari({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    })
    this.logger = options.logger ?? nullLogger
    this.capacityWaitAttempts = options.capacityWaitAttempts ?? CAPACITY_WAIT_ATTEMPTS
    this.capacityWaitMs = options.capacityWaitMs ?? CAPACITY_WAIT_MS
  }

  async create(options: BrowserEnvironmentOptions): Promise<BrowserEnvironment> {
    const sessionOptions: CreateSessionOptions = {
      // Recording is per session and cannot be turned on later: a session
      // created without it 404s on its replay endpoint forever.
      recording: options.recording,
      stealth: options.stealth,
      ...(options.profileId ? { profileId: options.profileId } : {}),
      // Both of these are rejected by the gateway unless stealth is on, so we
      // only forward them when it is, rather than surfacing a confusing 400.
      ...(options.stealth && options.proxy ? { proxy: options.proxy } : {}),
      ...(options.stealth && options.captcha ? { captcha: true } : {}),
    }

    let session: Session | undefined
    let browser: Browser | undefined
    let context: BrowserContext | undefined

    try {
      session = await this.createSession(sessionOptions, options.signal)
      this.liveSessions.add(session.id)

      browser = await this.connect(session, options.signal)
      context = await this.openContext(browser, options)

      const page = await context.newPage()
      const like = page as unknown as PlaywrightLikePage

      if (options.perturbation?.networkDelay) {
        await this.applyNetworkDelay(context, options.perturbation.networkDelay)
      }

      const sessionId = session.id
      // Logged at info, before anything can go wrong with the run: the SDK
      // offers no way to enumerate sessions, only `release(id)`. When a worker
      // died mid-suite its three live sessions became unreleasable — they held
      // the whole free-plan concurrency budget until they expired on their own,
      // and the id was the one thing that would have let us hand them back.
      this.logger.info("browser session open", {
        sessionId,
        expiresAt: session.expiresAt,
        recording: options.recording,
      })
      const cdpEndpoint = session.cdpEndpoint
      const scopedBrowser = browser
      let disposed = false

      const environment: BrowserEnvironment = {
        id: newId(),
        sessionId,
        mode: "solari",
        recordingEnabled: options.recording,
        page: createPlaywrightPageDriver(like),
        signals: createPlaywrightPageSignals(like),
        dispose: async () => {
          if (disposed) return
          disposed = true
          await this.dispose(scopedBrowser, sessionId)
          // The endpoint is a live credential; drop it the moment the session
          // it controls is gone.
          CDP_ENDPOINTS.delete(environment)
        },
      }

      CDP_ENDPOINTS.set(environment, cdpEndpoint)
      return environment
    } catch (error) {
      // Partial construction must not leak a paid session.
      await this.dispose(browser, session?.id)
      throw mapSolariError(error, "browser_launch_failed")
    }
  }

  /**
   * The raw, publicly routable CDP endpoint for a session.
   *
   * Handed only to a repository agent that must connect from inside a sandbox.
   * It is held in a module-level WeakMap rather than as a property on the
   * environment, so that `JSON.stringify(environment)`, a structured-clone into
   * a worker, or a careless log of the object cannot leak a URL that grants
   * full control of a running browser. It is dropped on dispose.
   */
  static cdpEndpointOf(environment: BrowserEnvironment): string | undefined {
    return CDP_ENDPOINTS.get(environment)
  }

  /** Port implementation; see `BrowserProvider.rawCdpEndpoint`. */
  rawCdpEndpoint(environment: BrowserEnvironment): string | undefined {
    return SolariBrowserProvider.cdpEndpointOf(environment)
  }

  async fetchReplay(
    environment: BrowserEnvironment,
    signal?: AbortSignal,
  ): Promise<ReplayArtifact | null> {
    if (!environment.sessionId || !environment.recordingEnabled) return null
    return fetchReplayWithBackoff(
      environment.sessionId,
      {
        downloadReplay: (id) => this.client.sessions.downloadReplay(id),
        logger: this.logger.child({ sessionId: environment.sessionId }),
      },
      signal ? { signal } : {},
    )
  }

  /**
   * Mint a fresh presigned replay URL. Called on demand from the API rather
   * than persisted, because the URL expires (`expiresInSeconds`) while the
   * recording behind it does not.
   */
  async mintReplayUrl(sessionId: string): Promise<{ url: string; expiresInSeconds: number } | null> {
    try {
      const { url, expiresInSeconds } = await this.client.sessions.getReplayUrl(sessionId)
      return { url, expiresInSeconds }
    } catch (error) {
      this.logger.warn("could not mint a replay url", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /** Sessions this provider believes are still live. Used by the leak audit. */
  outstandingSessions(): string[] {
    return [...this.liveSessions]
  }

  async shutdown(): Promise<void> {
    // Release anything still held before dropping the client, or it bills
    // until the plan deadline.
    for (const sessionId of [...this.liveSessions]) {
      await this.releaseSession(sessionId)
    }
    // REQUIRED in Node. The client keeps a loopback proxy server open for its
    // connection-retry path, and that handle keeps the event loop alive: skip
    // this and the worker prints its last log line and then hangs forever.
    await this.client.close().catch((error: unknown) => {
      this.logger.warn("solari client close failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  private async createSession(
    options: CreateSessionOptions,
    signal?: AbortSignal,
  ): Promise<Session> {
    const create = () =>
      retry(() => this.client.sessions.create(options), {
        attempts: 2,
        baseDelayMs: 750,
        ...(signal ? { signal } : {}),
        // Only genuine transients here. A 429 is handled separately below,
        // because a tight retry against a concurrency wall only burns quota.
        shouldRetry: (error) => isRetryableInfrastructure(error),
        onRetry: (error, attempt, delayMs) =>
          this.logger.warn("retrying session create", {
            attempt,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
          }),
      })

    // A 429 is not a failure of this run, it is a queue. Observed for real: a
    // four-variant suite died outright because two of the plan's three slots
    // were briefly held, when it could simply have run narrower for a minute.
    // Retrying blindly would burn quota, so this waits for a slot to actually
    // come free — one of ours finishing is the common case — and gives up with
    // the original error when nothing frees.
    for (let attempt = 1; ; attempt++) {
      try {
        return await create()
      } catch (error) {
        const atCapacity = mapSolariError(error, "internal").code === "solari_concurrency"
        if (!atCapacity || attempt >= this.capacityWaitAttempts) throw error
        const delay =
          this.capacityWaitMs + Math.floor(Math.random() * (this.capacityWaitMs / 2 + 1))
        this.logger.warn("at the Solari concurrency limit; waiting for a slot", {
          attempt,
          attempts: this.capacityWaitAttempts,
          delayMs: delay,
          ourLiveSessions: this.liveSessions.size,
        })
        await sleep(delay, signal)
      }
    }
  }

  private async connect(session: Session, signal?: AbortSignal): Promise<Browser> {
    return retry(() => chromium.connect(session.wsEndpoint, { timeout: 30_000 }), {
      attempts: this.options.connectAttempts ?? 2,
      baseDelayMs: 500,
      ...(signal ? { signal } : {}),
      shouldRetry: () => true,
      onRetry: (error, attempt, delayMs) =>
        this.logger.warn("retrying browser connect", {
          sessionId: session.id,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
    })
  }

  private async openContext(
    browser: Browser,
    options: BrowserEnvironmentOptions,
  ): Promise<BrowserContext> {
    const p = options.perturbation
    // Solari exposes no viewport option at session creation, so every viewport
    // and locale perturbation has to land on the browser context.
    const needsCustomContext = Boolean(
      p?.viewport || p?.userAgent || p?.isMobile || p?.locale || p?.deviceScaleFactor,
    )
    if (!needsCustomContext) {
      const existing = browser.contexts()[0]
      if (existing) return existing
    }
    return browser.newContext({
      viewport: p?.viewport ?? { width: 1280, height: 800 },
      ...(p?.userAgent ? { userAgent: p.userAgent } : {}),
      ...(p?.isMobile ? { isMobile: true } : {}),
      ...(p?.hasTouch ? { hasTouch: true } : {}),
      ...(p?.deviceScaleFactor ? { deviceScaleFactor: p.deviceScaleFactor } : {}),
      ...(p?.locale ? { locale: p.locale } : {}),
    })
  }

  private async applyNetworkDelay(
    context: BrowserContext,
    delay: { matches: string[]; delayMs: number },
  ): Promise<void> {
    const rng = createRng(delay.delayMs)
    for (const pattern of delay.matches) {
      await context.route(pattern, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, rng.jitter(delay.delayMs, 0.3)))
        await route.continue()
      })
    }
  }

  private async dispose(browser: Browser | undefined, sessionId: string | undefined): Promise<void> {
    if (browser) {
      try {
        await browser.close()
      } catch (error) {
        this.logger.warn("browser close failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (sessionId) await this.releaseSession(sessionId)
  }

  private async releaseSession(sessionId: string): Promise<void> {
    try {
      // releaseAndWait, not release: the replay upload only starts once the
      // session is genuinely released, and we are about to poll for it.
      await this.client.sessions.releaseAndWait(sessionId)
    } catch (error) {
      // A failed release is not fatal — the pool reaps orphans after a grace
      // period — but it is worth knowing about, so it is logged loudly.
      this.logger.warn("session release failed; pool will reap it", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.liveSessions.delete(sessionId)
    }
  }
}

/** Session endpoints, kept off the environment object on purpose. */
const CDP_ENDPOINTS = new WeakMap<BrowserEnvironment, string>()

export function assertSolariCredentials(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new GauntletError({
      code: "config_invalid",
      message: "Real runs need a Solari API key. Set SOLARI_API_KEY in .env.",
    })
  }
  return apiKey
}
