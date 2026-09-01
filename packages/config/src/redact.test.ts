import { describe, expect, it } from "vitest"
import { redactSecrets, redactValue } from "./redact.js"

describe("redactSecrets", () => {
  it("redacts Solari and model API keys", () => {
    expect(redactSecrets("SOLARI_API_KEY=slr_live_abc123DEF")).toBe("SOLARI_API_KEY=slr_live_[redacted]")
    expect(redactSecrets("sk-ant-api03-xyz789")).toBe("sk-ant-[redacted]")
    expect(redactSecrets("sk-proj1234567890abcdefghij")).toBe("sk-[redacted]")
  })

  // The docs are explicit that these URLs ARE the credential: anyone holding
  // one can drive the browser. They must never survive into a log.
  it("redacts Solari session control endpoints", () => {
    expect(redactSecrets("connect wss://api.getsolari.com/cdp/pool-7f3a:vm:org.sig now")).toBe(
      "connect [redacted-session-endpoint] now",
    )
    expect(redactSecrets("wss://api.getsolari.com/ws/abc.def")).toBe("[redacted-session-endpoint]")
    expect(redactSecrets("wss://api.getsolari.com/control/abc.def")).toBe("[redacted-session-endpoint]")
  })

  it("redacts presigned URL signatures but keeps the path readable", () => {
    const out = redactSecrets("https://storage.getsolari.com/org/replay.ndjson?X-Amz-Signature=deadbeef&x=1")
    expect(out).toContain("replay.ndjson")
    expect(out).toContain("X-Amz-Signature=[redacted]")
    expect(out).not.toContain("deadbeef")
  })

  it("redacts database credentials", () => {
    expect(redactSecrets("postgres://user:hunter2@db:5432/x")).toBe("postgres://[redacted]@db:5432/x")
  })

  it("leaves innocuous text alone", () => {
    expect(redactSecrets("run 4f2a passed in 12.3s")).toBe("run 4f2a passed in 12.3s")
  })
})

describe("redactValue", () => {
  it("redacts by key name as well as by content", () => {
    expect(
      redactValue({ apiKey: "anything", cdpEndpoint: "wss://x/cdp/y", runId: "r1" }),
    ).toEqual({ apiKey: "[redacted]", cdpEndpoint: "[redacted]", runId: "r1" })
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
})
