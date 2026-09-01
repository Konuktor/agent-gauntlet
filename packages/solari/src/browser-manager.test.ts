import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Lifecycle contract tests for the Solari browser adapter.
 *
 * These exist because the failure they guard against is invisible in
 * development and expensive in production: a session that is created but never
 * released keeps billing until the plan deadline, and there is no local symptom
 * to notice. So every path — success, mid-construction failure, double dispose,
 * shutdown — is asserted to release exactly what it created.
 */

const sessions = {
  create: vi.fn(),
  release: vi.fn(),
  releaseAndWait: vi.fn(async () => {}),
  getReplayUrl: vi.fn(),
  downloadReplay: vi.fn(),
}
const clientClose = vi.fn(async () => {})

class FakeSolariError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
    readonly code?: string,
  ) {
    super(message)
  }
}

vi.mock("@solarisdk/browser", () => ({
  Solari: class {
    sessions = sessions
    profiles = { create: vi.fn(), list: vi.fn(), delete: vi.fn(), save: vi.fn() }
    close = clientClose
  },
  SolariError: FakeSolariError,
}))

const pageStub = {
  url: () => "https://shop.test/",
  title: async () => "t",
  goto: async () => undefined,
  evaluate: async () => ({}),
  click: async () => {},
  fill: async () => {},
  keyboard: { press: async () => {} },
  waitForTimeout: async () => {},
  screenshot: async () => new Uint8Array(),
  isClosed: () => false,
  on: () => {},
}

const contextStub = { newPage: vi.fn(async () => pageStub), route: vi.fn(async () => {}) }
const browserClose = vi.fn(async () => {})
const newContext = vi.fn(async () => contextStub)
const connect = vi.fn(async () => ({
  contexts: () => [contextStub],
  newContext,
  close: browserClose,
}))

vi.mock("patchright-core", () => ({ chromium: { connect: (...a: unknown[]) => connect(...(a as [])) } }))

const { SolariBrowserProvider } = await import("./browser-manager.js")

const session = {
  id: "sess_abc",
  wsEndpoint: "wss://api.getsolari.com/ws/pool:vm:org.sig",
  cdpEndpoint: "wss://api.getsolari.com/cdp/pool:vm:org.sig",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  sessions.create.mockResolvedValue(session)
  sessions.releaseAndWait.mockResolvedValue(undefined)
  connect.mockResolvedValue({ contexts: () => [contextStub], newContext, close: browserClose })
  contextStub.newPage.mockResolvedValue(pageStub)
})

const provider = () => new SolariBrowserProvider({ apiKey: "slr_live_test" })

describe("session creation", () => {
  it("enables recording per session, because it cannot be turned on later", async () => {
    await provider().create({ recording: true, stealth: false })
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ recording: true }))
  })

  // The gateway rejects both unless stealth is on, so we never send a request
  // we know will 400.
  it("withholds proxy and captcha unless stealth is enabled", async () => {
    await provider().create({ recording: false, stealth: false, proxy: "us", captcha: true })
    const sent = sessions.create.mock.calls[0]![0]
    expect(sent.proxy).toBeUndefined()
    expect(sent.captcha).toBeUndefined()
  })

  it("forwards proxy and captcha when stealth is on", async () => {
    await provider().create({ recording: false, stealth: true, proxy: "us", captcha: true })
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ stealth: true, proxy: "us", captcha: true }),
    )
  })

  it("reuses the default context when no viewport perturbation is requested", async () => {
    await provider().create({ recording: false, stealth: false })
    expect(newContext).not.toHaveBeenCalled()
  })

  // Solari has no session-level viewport, so this MUST land on the context.
  it("opens a custom context for a mobile viewport", async () => {
    await provider().create({
      recording: false,
      stealth: false,
      perturbation: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    })
    expect(newContext).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { width: 390, height: 844 }, isMobile: true }),
    )
  })

  it("connects to the RAW wsEndpoint, not a loopback-wrapped one", async () => {
    await provider().create({ recording: false, stealth: false })
    expect(connect).toHaveBeenCalledWith(session.wsEndpoint, expect.anything())
  })
})

describe("the CDP endpoint is treated as a credential", () => {
  it("is retrievable for a sandboxed repository agent", async () => {
    const env = await provider().create({ recording: false, stealth: false })
    expect(SolariBrowserProvider.cdpEndpointOf(env)).toBe(session.cdpEndpoint)
  })

  // Held in a WeakMap, not on the object: serialising an environment must not
  // emit a URL that grants full control of a live browser.
  it("does not appear when the environment is serialised", async () => {
    const env = await provider().create({ recording: false, stealth: false })
    expect(JSON.stringify(env)).not.toContain("cdp")
    expect(Object.keys(env)).not.toContain("cdpEndpoint")
  })

  it("is dropped once the session it controls is gone", async () => {
    const env = await provider().create({ recording: false, stealth: false })
    await env.dispose()
    expect(SolariBrowserProvider.cdpEndpointOf(env)).toBeUndefined()
  })

  it("never persists the endpoint on the environment we hand upstream", async () => {
    const env = await provider().create({ recording: false, stealth: false })
    expect(env.sessionId).toBe("sess_abc")
    expect(Object.values(env).some((v) => typeof v === "string" && v.includes("wss://"))).toBe(false)
  })
})

describe("cleanup", () => {
  it("closes the browser AND releases the session on dispose", async () => {
    const env = await provider().create({ recording: false, stealth: false })
    await env.dispose()
    expect(browserClose).toHaveBeenCalledTimes(1)
    // releaseAndWait, not release: the replay upload only begins once the
    // session is genuinely released, and we are about to poll for it.
    expect(sessions.releaseAndWait).toHaveBeenCalledWith("sess_abc")
  })

  it("is idempotent", async () => {
    const env = await provider().create({ recording: false, stealth: false })
    await env.dispose()
    await env.dispose()
    expect(sessions.releaseAndWait).toHaveBeenCalledTimes(1)
  })

  it("still releases the session when closing the browser throws", async () => {
    browserClose.mockRejectedValueOnce(new Error("socket already gone"))
    const env = await provider().create({ recording: false, stealth: false })
    await expect(env.dispose()).resolves.toBeUndefined()
    expect(sessions.releaseAndWait).toHaveBeenCalledWith("sess_abc")
  })

  it("does not throw when the release itself fails", async () => {
    sessions.releaseAndWait.mockRejectedValueOnce(new Error("gateway timeout"))
    const env = await provider().create({ recording: false, stealth: false })
    await expect(env.dispose()).resolves.toBeUndefined()
  })

  // Partial construction is the sneakiest leak: the session exists and is
  // billing, but nothing upstream ever received a handle to dispose.
  it("releases the session when connecting to the browser fails", async () => {
    connect.mockRejectedValue(new Error("connect refused"))
    await expect(provider().create({ recording: false, stealth: false })).rejects.toThrow()
    expect(sessions.releaseAndWait).toHaveBeenCalledWith("sess_abc")
  })

  it("releases the session when opening the first page fails", async () => {
    contextStub.newPage.mockRejectedValueOnce(new Error("target closed"))
    await expect(provider().create({ recording: false, stealth: false })).rejects.toThrow()
    expect(sessions.releaseAndWait).toHaveBeenCalledWith("sess_abc")
  })

  it("leaves nothing to release when session creation itself failed", async () => {
    sessions.create.mockRejectedValue(new FakeSolariError("cap reached", 429, undefined, "ConcurrencyLimitExceeded"))
    await expect(provider().create({ recording: false, stealth: false })).rejects.toMatchObject({
      code: "solari_concurrency",
    })
    expect(sessions.releaseAndWait).not.toHaveBeenCalled()
  })

  it("tracks outstanding sessions and releases them on shutdown", async () => {
    const p = provider()
    await p.create({ recording: false, stealth: false })
    expect(p.outstandingSessions()).toEqual(["sess_abc"])
    await p.shutdown()
    expect(sessions.releaseAndWait).toHaveBeenCalledWith("sess_abc")
    expect(p.outstandingSessions()).toEqual([])
  })

  // Skipping this is the documented way to make a Node process hang forever:
  // the client keeps a loopback proxy whose handle holds the event loop open.
  it("closes the Solari client on shutdown", async () => {
    const p = provider()
    await p.shutdown()
    expect(clientClose).toHaveBeenCalledTimes(1)
  })

  it("still closes the client when releasing a session fails", async () => {
    sessions.releaseAndWait.mockRejectedValue(new Error("nope"))
    const p = provider()
    await p.create({ recording: false, stealth: false })
    await p.shutdown()
    expect(clientClose).toHaveBeenCalledTimes(1)
  })
})

describe("retries", () => {
  it("retries a transient create once", async () => {
    sessions.create
      .mockRejectedValueOnce(new FakeSolariError("no host", 503))
      .mockResolvedValueOnce(session)
    await provider().create({ recording: false, stealth: false })
    expect(sessions.create).toHaveBeenCalledTimes(2)
  })

  // Retrying a concurrency limit burns quota against a wall.
  it("does not retry a concurrency limit", async () => {
    sessions.create.mockRejectedValue(
      new FakeSolariError("cap", 429, undefined, "ConcurrencyLimitExceeded"),
    )
    await expect(provider().create({ recording: false, stealth: false })).rejects.toMatchObject({
      code: "solari_concurrency",
    })
    expect(sessions.create).toHaveBeenCalledTimes(1)
  })
})

describe("replay", () => {
  it("does not attempt a fetch for an unrecorded session", async () => {
    const p = provider()
    const env = await p.create({ recording: false, stealth: false })
    expect(await p.fetchReplay(env)).toBeNull()
    expect(sessions.downloadReplay).not.toHaveBeenCalled()
  })

  it("mints a fresh presigned url on demand rather than persisting one", async () => {
    sessions.getReplayUrl.mockResolvedValue({ url: "https://storage/x?sig=1", expiresInSeconds: 60 })
    expect(await provider().mintReplayUrl("sess_abc")).toEqual({
      url: "https://storage/x?sig=1",
      expiresInSeconds: 60,
    })
  })

  it("returns null instead of throwing when a url cannot be minted", async () => {
    sessions.getReplayUrl.mockRejectedValue(new Error("404"))
    expect(await provider().mintReplayUrl("sess_abc")).toBeNull()
  })
})
