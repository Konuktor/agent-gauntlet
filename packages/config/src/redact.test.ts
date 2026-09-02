import { describe, expect, it } from "vitest"
import { redactSecrets, redactValue } from "./redact.js"

describe("redactSecrets", () => {
  // The fixtures below are deliberately low-entropy and self-describing. A
  // redactor cannot be tested without key-shaped input, but a fixture that
  // *looks* like a real key trips secret scanners and teaches everyone to wave
  // their alerts through — which is the opposite of what this module is for.
  it("redacts Solari and model API keys", () => {
    expect(redactSecrets("SOLARI_API_KEY=slr_live_EXAMPLENOTAREALKEY")).toBe(
      "SOLARI_API_KEY=slr_live_[redacted]",
    )
    expect(redactSecrets("sk-ant-EXAMPLENOTAREALKEY")).toBe("sk-ant-[redacted]")
    expect(redactSecrets("sk-EXAMPLENOTAREALKEYAAAAA")).toBe("sk-[redacted]")
  })

  // The docs are explicit that these URLs ARE the credential: anyone holding
  // one can drive the browser. They must never survive into a log.
  it("redacts Solari session control endpoints", () => {
    expect(redactSecrets("connect wss://api.getsolari.com/cdp/pool-7f3a:vm:org.sig now")).toBe(
      "connect [redacted-session-endpoint] now",
    )
    expect(redactSecrets("wss://api.getsolari.com/ws/abc.def")).toBe("[redacted-session-endpoint]")
    expect(redactSecrets("wss://api.getsolari.com/control/abc.def")).toBe(
      "[redacted-session-endpoint]",
    )
  })

  it("redacts presigned URL signatures but keeps the path readable", () => {
    const out = redactSecrets(
      "https://storage.getsolari.com/org/replay.ndjson?X-Amz-Signature=deadbeef&x=1",
    )
    expect(out).toContain("replay.ndjson")
    expect(out).toContain("X-Amz-Signature=[redacted]")
    expect(out).not.toContain("deadbeef")
  })

  it("redacts database credentials", () => {
    expect(redactSecrets("postgres://user:hunter2@db:5432/x")).toBe(
      "postgres://[redacted]@db:5432/x",
    )
  })

  it("leaves innocuous text alone", () => {
    expect(redactSecrets("run 4f2a passed in 12.3s")).toBe("run 4f2a passed in 12.3s")
  })
})

describe("redactValue", () => {
  it("redacts by key name as well as by content", () => {
    expect(redactValue({ apiKey: "anything", cdpEndpoint: "wss://x/cdp/y", runId: "r1" })).toEqual({
      apiKey: "[redacted]",
      cdpEndpoint: "[redacted]",
      runId: "r1",
    })
  })

  it("recurses into nested objects and arrays", () => {
    expect(redactValue({ a: [{ token: "t" }, "slr_live_zz"] })).toEqual({
      a: [{ token: "[redacted]" }, "slr_live_[redacted]"],
    })
  })

  it("survives circular references", () => {
    const node: Record<string, unknown> = { name: "n" }
    node.self = node
    expect(redactValue(node)).toEqual({ name: "n", self: "[circular]" })
  })

  it("passes primitives through", () => {
    expect(redactValue(42)).toBe(42)
    expect(redactValue(null)).toBe(null)
    expect(redactValue(true)).toBe(true)
  })

  // Walking these with Object.entries flattens a Date to `{}` and a byte array
  // to a map of indices. This scrubber runs on values headed for the database,
  // so destroying one is worse than the leak it was meant to prevent.
  it("leaves anything that is not a plain object intact", () => {
    const when = new Date("2026-01-01T00:00:00.000Z")
    expect(redactValue(when)).toBe(when)
    const bytes = new Uint8Array([1, 2, 3])
    expect(redactValue(bytes)).toBe(bytes)
    expect(redactValue({ completedAt: when, note: "fine" })).toEqual({
      completedAt: when,
      note: "fine",
    })
  })

  // The shape that actually leaked: Playwright quotes the endpoint it was
  // handed, inside a multi-line error, nested in a patch bound for Postgres.
  it("scrubs an endpoint quoted inside a nested error message", () => {
    const patch = {
      failureMessage:
        "browserType.connectOverCDP: WebSocket error\nCall log:\n" +
        "  - <ws connecting> wss://api.getsolari.com/cdp/abc.signature\n" +
        "  - <ws error> wss://api.getsolari.com/cdp/abc.signature error",
      completedAt: new Date("2026-01-01T00:00:00.000Z"),
    }
    const safe = redactValue(patch) as typeof patch
    expect(safe.failureMessage).not.toContain("abc.signature")
    expect(safe.failureMessage).toContain("[redacted-session-endpoint]")
    expect(safe.completedAt).toBe(patch.completedAt)
  })
})
