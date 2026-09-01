import type { BrowserPerturbationOptions } from "../domain/perturbation.js"
import type { PageDriver, PageSignals } from "./page.js"

export type BrowserMode = "solari" | "local"

export interface BrowserEnvironmentOptions {
  /** Solari records per session, never per account. Off here means no replay,
   *  forever — the endpoint 404s permanently. */
  recording: boolean
  stealth: boolean
  /** Requires stealth. Country code, or a richer request. */
  proxy?: string | { country: string; tier?: "residential" | "static" | "mobile" }
  /** Requires stealth. */
  captcha?: boolean
  profileId?: string
  /** Applied to the browser context, since Solari has no session-level viewport. */
  perturbation?: BrowserPerturbationOptions
  signal?: AbortSignal
}

export interface BrowserEnvironment {
  /** Stable id for this environment, unique within the process. Used to key
   *  locally-captured artifacts; never shown to a user. */
  readonly id: string
  /** Solari session id, or null in local mode. Safe to display and persist. */
  readonly sessionId: string | null
  readonly mode: BrowserMode
  readonly recordingEnabled: boolean
  readonly page: PageDriver
  readonly signals: PageSignals
  /** Release the browser AND the underlying session. Idempotent, and always
   *  called from a `finally` — a leaked session bills until the plan deadline. */
  dispose(): Promise<void>
}

export type ReplaySource = "solari" | "local" | "none"

export interface ReplayArtifact {
  source: ReplaySource
  /** rrweb NDJSON, already decompressed. */
  bytes: Uint8Array
  eventCount: number
  truncated: boolean
}

export interface BrowserProvider {
  readonly mode: BrowserMode
  create(options: BrowserEnvironmentOptions): Promise<BrowserEnvironment>
  /**
   * Fetch a session's replay. Only meaningful AFTER the session is released:
   * the upload is asynchronous, so this polls with bounded backoff and returns
   * null rather than throwing when the recording never lands. Replay is
   * evidence infrastructure — its absence must never flip a pass to a fail.
   */
  fetchReplay(environment: BrowserEnvironment, signal?: AbortSignal): Promise<ReplayArtifact | null>
  /**
   * The RAW, publicly routable CDP endpoint for an environment, when the
   * provider can expose one.
   *
   * Needed only by agents that connect to the browser themselves from another
   * machine — a repository agent inside a Solari Sandbox. Local mode returns
   * undefined on purpose: its endpoint is a loopback address that a remote VM
   * cannot reach, and handing one over would fail confusingly.
   *
   * The value is a CREDENTIAL. Pass it, never persist or log it.
   */
  rawCdpEndpoint?(environment: BrowserEnvironment): string | undefined
  /** Release process-wide client resources. In Solari's case this is REQUIRED:
   *  the browser client holds a loopback proxy that keeps Node's event loop
   *  alive, and skipping it hangs the process forever. */
  shutdown(): Promise<void>
}
