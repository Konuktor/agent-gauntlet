import { describe, expect, it } from "vitest"
import { randomBytes } from "node:crypto"
import { openSecret, parseSealingKey, sealSecret, validateCdpEndpoint } from "./secrets.js"

const key = randomBytes(32)

/**
 * These guard a borrowed credential — someone else's Solari session or API
 * key, sitting in our queue between two services. The failure they prevent is
 * quiet: a plaintext secret in a database, or a tampered one used anyway.
 */
describe("sealing a borrowed credential", () => {
  it("round-trips", () => {
    const sealed = sealSecret("slr_live_example", key)
    expect(openSecret(sealed, key)).toBe("slr_live_example")
  })

  it("never stores the plaintext", () => {
    const sealed = sealSecret("slr_live_example", key)
    expect(JSON.stringify(sealed)).not.toContain("slr_live_example")
  })

  it("produces a different ciphertext every time", () => {
    // A repeated IV would leak that two visitors brought the same key.
    const a = sealSecret("same", key)
    const b = sealSecret("same", key)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
  })

  it("refuses a tampered ciphertext rather than returning nonsense", () => {
    const sealed = sealSecret("slr_live_example", key)
    const flipped = Buffer.from(sealed.ciphertext, "base64")
    flipped[0] = (flipped[0] ?? 0) ^ 0xff
    expect(() => openSecret({ ...sealed, ciphertext: flipped.toString("base64") }, key)).toThrow()
  })

  it("refuses the wrong key", () => {
    const sealed = sealSecret("slr_live_example", key)
    expect(() => openSecret(sealed, randomBytes(32))).toThrow()
  })

  it("rejects a sealing key of the wrong length", () => {
    expect(() => parseSealingKey(Buffer.alloc(16).toString("base64"))).toThrow(/32/)
    expect(parseSealingKey(undefined)).toBeUndefined()
  })
})

describe("accepting a CDP endpoint from a stranger", () => {
  it("accepts a public wss endpoint", () => {
    const url = "wss://api.getsolari.com/cdp/pool:vm:org.signature"
    expect(validateCdpEndpoint(` ${url} `)).toBe(url)
  })

  it("refuses ws://, which would send the credential in the clear", () => {
    expect(() => validateCdpEndpoint("ws://api.getsolari.com/cdp/x")).toThrow(/wss/)
  })

  // The same reasoning as the repository-URL allowlist: never let a stranger
  // point this service at something inside its own network.
  it.each([
    "wss://localhost/cdp",
    "wss://127.0.0.1/cdp",
    "wss://10.0.0.5/cdp",
    "wss://192.168.1.9/cdp",
    "wss://172.16.4.4/cdp",
    "wss://169.254.169.254/cdp",
    "wss://db.internal/cdp",
  ])("refuses %s", (endpoint) => {
    expect(() => validateCdpEndpoint(endpoint)).toThrow()
  })

  it("refuses something that is not a URL", () => {
    expect(() => validateCdpEndpoint("not a url")).toThrow()
  })
})
