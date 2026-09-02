import { Solari, SolariError, type CreateSessionOptions } from "@solarisdk/browser"
import { chromium, type Browser, type BrowserContext } from "patchright-core"
import {
  BORROWED_SESSION_ID,
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
  /**
   * A session the visitor created and owns.
   *
   * When set, no session is created and none is released: this provider
   * borrows one browser for the run. It is how somebody can test an agent
   * without handing over an account key — the endpoint is a capability scoped
   * to a single session they can revoke by closing it.
   *
   * Recording cannot be turned on after the fact, so a borrowed session yields
   * no replay. That is stated rather than silently degraded.
   */
  borrowedCdpEndpoint?: string
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
/** Where Solari lives when no baseUrl is configured. */
const DEFAULT_SOLARI_BASE_URL = "https://api.getsolari.com"

/** A session with its real, publicly routable endpoints. */
interface RawSession {
  id: string
  wsEndpoint: string
  cdpEndpoint: string
  expiresAt: string
}

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

    let session: RawSession | undefined
    let browser: Browser | undefined
    let context: BrowserContext | undefined
    const borrowed = this.options.borrowedCdpEndpoint

    try {
      session = borrowed
        ? // Somebody else's session. We connect and, crucially, never release.
          { id: BORROWED_SESSION_ID, wsEndpoint: borrowed, cdpEndpoint: borrowed, expiresAt: "" }
        : await this.createSessionWithCapacityWait(sessionOptions, options.signal)
      // Only sessions we created are ours to release.
      if (!borrowed) this.liveSessions.add(session.id)

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
        // Recording is fixed when a session is created, so a borrowed one can
        // never produce a replay. Say so rather than queue a fetch that will
        // 404 forever.
        recordingEnabled: borrowed ? false : options.recording,
        page: createPlaywrightPageDriver(like),
        signals: createPlaywrightPageSignals(like),
        dispose: async () => {
          if (disposed) return
          disposed = true
          // Disconnect, but never release: the session is theirs.
          await this.dispose(scopedBrowser, borrowed ? undefined : sessionId)
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
  async fetchReplayForSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ReplayArtifact | null> {
    return fetchReplayWithBackoff(
      sessionId,
      {
        downloadReplay: (id) => this.client.sessions.downloadReplay(id),
        logger: this.logger.child({ sessionId }),
      },
      // One attempt: the sweeper decides when to come back.
      { attempts: 1, intervalMs: 0, ...(signal ? { signal } : {}) },
    )
  }

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

  /**
   * Create a session and keep the PUBLICLY routable endpoints.
   *
   * `sessions.create()` in the SDK wraps both `wsEndpoint` and `cdpEndpoint`
   * through a loopback proxy, and discards the upstream URLs it computed. That
   * is fine for this process — and useless for a repository agent, which runs
   * in a different VM and got `ECONNREFUSED 127.0.0.1` when handed one.
   *
   * So the session is created against the REST API directly, which returns the
   * real endpoints. Everything else still goes through the SDK.
   */
  private async createSessionRaw(
    options: CreateSessionOptions,
    signal?: AbortSignal,
  ): Promise<RawSession> {
    const base = (this.options.baseUrl ?? DEFAULT_SOLARI_BASE_URL).replace(/\/$/, "")
    const res = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(options),
      ...(signal ? { signal } : {}),
    })
    const text = await res.text()
    if (!res.ok) {
      // Throw the SDK's own error type so every existing mapping and retry
      // rule applies unchanged — a 429 still becomes solari_concurrency, a 5xx
      // is still a retryable transient.
      let code: string | undefined
      try {
        const parsed = JSON.parse(text) as { code?: unknown }
        if (typeof parsed.code === "string") code = parsed.code
      } catch {
        // A non-JSON body is fine; the status still classifies it.
      }
      throw new SolariError(
        `Solari POST /sessions failed: ${res.status} ${text}`,
        res.status,
        undefined,
        code,
      )
    }
    const data = JSON.parse(text) as {
      sessionId?: string
      wsEndpoint?: string
      cdpEndpoint?: string
      expiresAt?: string
    }
    if (!data.sessionId || !data.wsEndpoint) {
      throw new GauntletError({
        code: "internal",
        message: "Solari returned a session with no endpoints.",
        detail: text.slice(0, 300),
      })
    }
    return {
      id: data.sessionId,
      wsEndpoint: data.wsEndpoint,
      // The same derivation the SDK does internally, kept because the API does
      // not always send cdpEndpoint explicitly.
      cdpEndpoint: data.cdpEndpoint ?? data.wsEndpoint.replace("/ws/", "/cdp/"),
      expiresAt: data.expiresAt ?? new Date(Date.now() + 60 * 60_000).toISOString(),
    }
  }

  private async createSessionWithCapacityWait(
    options: CreateSessionOptions,
    signal?: AbortSignal,
  ): Promise<RawSession> {
    const create = () =>
      retry(() => this.createSessionRaw(options, signal), {
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

  private async connect(session: RawSession, signal?: AbortSignal): Promise<Browser> {
    // A session we created answers Playwright's own protocol; one the visitor
    // created is reached over plain CDP, which is all they can hand us.
    const open = () =>
      session.id === BORROWED_SESSION_ID
        ? chromium.connectOverCDP(session.cdpEndpoint, { timeout: 30_000 })
        : chromium.connect(session.wsEndpoint, { timeout: 30_000 })
    return retry(open, {
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
