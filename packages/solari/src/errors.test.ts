import { describe, expect, it } from "vitest"
import { GauntletError } from "@gauntlet/core"
import { SolariError as BrowserSolariError } from "@solarisdk/browser"
import {
  AuthError,
  ConcurrencyLimitError,
  ConnectionError,
  GatewayError,
  NoCapacityError,
  PlanError,
} from "@solarisdk/sdk"
import { isConcurrencyLimit, isRetryableInfrastructure, mapSolariError } from "./errors.js"

describe("browser client errors", () => {
  it("maps a plan restriction to actionable copy", () => {
    const mapped = mapSolariError(
      new BrowserSolariError("stealth requires a paid plan", 402, undefined, "FeatureRequiresPlan"),
      "browser_launch_failed",
    )
    expect(mapped.code).toBe("solari_plan")
    expect(mapped.retryable).toBe(false)
  })

  // The single most important mapping in the file: retrying a 429 cannot help,
  // because a slot only frees when somebody's session ends.
  it("marks a concurrency limit as NOT retryable", () => {
    const mapped = mapSolariError(
      new BrowserSolariError("limit reached", 429, undefined, "ConcurrencyLimitExceeded"),
      "browser_launch_failed",
    )
    expect(mapped.code).toBe("solari_concurrency")
    expect(mapped.retryable).toBe(false)
    expect(isConcurrencyLimit(mapped)).toBe(true)
    expect(isRetryableInfrastructure(mapped)).toBe(false)
  })

  it("treats an unhealthy browser as a transient worth one more attempt", () => {
    const mapped = mapSolariError(
      new BrowserSolariError("probe failed", undefined, undefined, "BrowserUnhealthy"),
      "browser_launch_failed",
    )
    expect(mapped.code).toBe("browser_launch_failed")
    expect(mapped.retryable).toBe(true)
  })

  it("maps an invalid session id to a disconnect", () => {
    expect(
      mapSolariError(
        new BrowserSolariError("gone", 404, undefined, "InvalidSessionId"),
        "browser_launch_failed",
      ).code,
    ).toBe("browser_disconnected")
  })

  it("falls back to the HTTP status when no code is set", () => {
    expect(mapSolariError(new BrowserSolariError("nope", 401), "internal").code).toBe("solari_auth")
    expect(mapSolariError(new BrowserSolariError("nope", 503), "internal").retryable).toBe(true)
  })
})

describe("sandbox client errors", () => {
  it("maps each typed subclass", () => {
    expect(mapSolariError(new AuthError(), "internal").code).toBe("solari_auth")
    expect(mapSolariError(new PlanError(), "internal").code).toBe("solari_plan")
    expect(mapSolariError(new ConcurrencyLimitError(), "internal").code).toBe("solari_concurrency")
    expect(mapSolariError(new NoCapacityError(), "internal").code).toBe("solari_capacity")
    expect(mapSolariError(new ConnectionError(), "internal").code).toBe("solari_unavailable")
  })

  it("only capacity and connection failures are retryable", () => {
    expect(mapSolariError(new NoCapacityError(), "internal").retryable).toBe(true)
    expect(mapSolariError(new ConnectionError(), "internal").retryable).toBe(true)
    expect(mapSolariError(new ConcurrencyLimitError(), "internal").retryable).toBe(false)
    expect(mapSolariError(new AuthError(), "internal").retryable).toBe(false)
  })

  // The VM gateway sets `retryable` explicitly; the docs say to prefer it over
  // guessing from the status code.
  it("honours the gateway's own retryable hint", () => {
    const hinted = new GatewayError(400, "transient-ish", { retryable: true })
    expect(mapSolariError(hinted, "sandbox_command_failed").retryable).toBe(true)

    const notHinted = new GatewayError(400, "bad request", { retryable: false })
    expect(mapSolariError(notHinted, "sandbox_command_failed").retryable).toBe(false)
    expect(mapSolariError(notHinted, "sandbox_command_failed").code).toBe("sandbox_command_failed")
  })

  it("routes 5xx to an unavailable error", () => {
    const mapped = mapSolariError(new GatewayError(503, "no host"), "sandbox_create_failed")
    expect(mapped.code).toBe("solari_unavailable")
    expect(mapped.retryable).toBe(true)
  })
})

describe("passthrough", () => {
  it("never rewraps one of our own errors", () => {
    const original = new GauntletError({ code: "agent_timeout", message: "late" })
    expect(mapSolariError(original, "internal")).toBe(original)
  })

  it("wraps an unknown throwable with the caller's fallback code", () => {
    const mapped = mapSolariError(new Error("something odd"), "sandbox_create_failed")
    expect(mapped.code).toBe("sandbox_create_failed")
    expect(mapped.message).toBe("something odd")
  })

  it("survives a non-Error throwable", () => {
    expect(mapSolariError("a string", "internal").message).toBe("a string")
  })
})
