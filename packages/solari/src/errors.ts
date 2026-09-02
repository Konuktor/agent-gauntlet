import { GauntletError, type ErrorCode } from "@gauntlet/core"
import { SolariError as BrowserSolariError } from "@solarisdk/browser"
import {
  AuthError,
  ConcurrencyLimitError,
  ConnectionError,
  GatewayError,
  NoCapacityError,
  PlanError,
  TimeoutError,
} from "@solarisdk/sdk"

/**
 * Translate a Solari failure into our own error vocabulary.
 *
 * The two SDK families report failures differently — the browser client throws
 * a single `SolariError` carrying a `code` string, while the sandbox client
 * throws typed subclasses — so this is the one place that knows about either.
 */
export function mapSolariError(error: unknown, fallback: ErrorCode): GauntletError {
  if (error instanceof GauntletError) return error

  const detail = error instanceof Error ? error.message : String(error)

  // Browser client: discriminate on the documented code string.
  if (error instanceof BrowserSolariError) {
    switch (error.code) {
      case "ConcurrencyLimitExceeded":
        return concurrency(error, detail)
      case "FeatureRequiresPlan":
      case "PlanLimitExceeded":
        return new GauntletError({
          code: "solari_plan",
          message:
            "Your Solari plan does not allow this. Stealth, proxies and captcha need a paid plan.",
          detail,
          cause: error,
        })
      case "InvalidSessionId":
        return new GauntletError({
          code: "browser_disconnected",
          message: "The Solari browser session is no longer valid.",
          detail,
          cause: error,
        })
      case "BrowserUnhealthy":
        return new GauntletError({
          code: "browser_launch_failed",
          message: "Solari started a browser but it failed its health probe.",
          detail,
          retryable: true,
          cause: error,
        })
      default:
        break
    }
    if (error.status === 401) return auth(error, detail)
    if (error.status === 402) return plan(error, detail)
    if (error.status === 429) return concurrency(error, detail)
    if (error.status && error.status >= 500) return unavailable(error, detail, fallback)
  }

  // Sandbox / VM client: typed subclasses.
  if (error instanceof ConcurrencyLimitError) return concurrency(error, detail)
  if (error instanceof AuthError) return auth(error, detail)
  if (error instanceof PlanError) return plan(error, detail)
  if (error instanceof NoCapacityError) {
    return new GauntletError({
      code: "solari_capacity",
      message: "Solari had no capacity to start this machine. It is worth retrying shortly.",
      detail,
      retryable: true,
      cause: error,
    })
  }
  if (error instanceof ConnectionError || error instanceof TimeoutError) {
    return new GauntletError({
      code: "solari_unavailable",
      message: "Lost the connection to Solari.",
      detail,
      retryable: true,
      cause: error,
    })
  }
  if (error instanceof GatewayError) {
    // The VM gateway sets `retryable` on transient failures; the docs say to
    // prefer it over guessing from the bare status.
    const retryable = error.body?.retryable === true || error.status >= 502
    return new GauntletError({
      code: error.status >= 500 ? "solari_unavailable" : fallback,
      message:
        error.status >= 500 ? "Solari returned a server error." : "Solari rejected the request.",
      detail: `HTTP ${error.status}${error.code ? ` ${error.code}` : ""}: ${detail}`,
      retryable,
      cause: error,
    })
  }

  return GauntletError.from(error, fallback)
}

function concurrency(error: unknown, detail: string): GauntletError {
  return new GauntletError({
    code: "solari_concurrency",
    message:
      "Solari is at its concurrent-session limit. Lower GAUNTLET_MAX_CONCURRENCY or upgrade the plan.",
    detail,
    // Deliberately NOT retryable. The docs are explicit: a slot only frees when
    // a session ends, so "a tight retry loop here burns quota against a wall".
    // The orchestrator waits for one of its own slots instead.
    retryable: false,
    cause: error,
  })
}

function auth(error: unknown, detail: string): GauntletError {
  return new GauntletError({
    code: "solari_auth",
    message: "Solari rejected the API key.",
    detail,
    cause: error,
  })
}

function plan(error: unknown, detail: string): GauntletError {
  return new GauntletError({
    code: "solari_plan",
    message: "Your Solari plan or credit balance does not cover this request.",
    detail,
    cause: error,
  })
}

function unavailable(error: unknown, detail: string, fallback: ErrorCode): GauntletError {
  return new GauntletError({
    code: fallback === "internal" ? "solari_unavailable" : fallback,
    message: "Solari returned a server error.",
    detail,
    retryable: true,
    cause: error,
  })
}

/** True when a failure is worth another attempt at the INFRASTRUCTURE level. */
export function isRetryableInfrastructure(error: unknown): boolean {
  const mapped = error instanceof GauntletError ? error : mapSolariError(error, "internal")
  return mapped.retryable
}

/** True when we are at the concurrency cap and should wait for a slot, not retry. */
export function isConcurrencyLimit(error: unknown): boolean {
  return error instanceof GauntletError
    ? error.code === "solari_concurrency"
    : mapSolariError(error, "internal").code === "solari_concurrency"
}
