import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * One browser, however many runs ask for it at once.
 *
 * This guards the defect that cost the CLI its ability to exit. `ensureBrowser`
 * memoised the browser rather than the promise, so with concurrency N every run
 * reached it before the first launch resolved, each launched its own Chromium,
 * and all but the last were orphaned — never closed, and holding the process
 * open. The gauntlet finished, printed a correct verdict, and then hung until
 * something killed it. In CI that was a 25-minute timeout on every single run.
 *
 * The test counts launches, because that is the thing that went wrong. Asserting
 * on the returned environments would pass against the broken version too.
 */
const launch = vi.fn()

vi.mock("playwright", () => ({
  chromium: {
    launch: (...args: unknown[]) => launch(...args),
  },
}))

function fakeBrowser() {
  const context = {
    newPage: vi.fn(async () => ({ on: vi.fn() })),
    close: vi.fn(async () => {}),
    exposeBinding: vi.fn(async () => {}),
    addInitScript: vi.fn(async () => {}),
    route: vi.fn(async () => {}),
  }
  return {
    isConnected: () => true,
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  }
}

const { LocalBrowserProvider } = await import("./browser-provider.js")

describe("LocalBrowserProvider", () => {
  beforeEach(() => {
    launch.mockReset()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("launches exactly one browser for concurrent runs", async () => {
    // Resolve on a later tick, which is what makes the race reachable: every
    // caller arrives before the first launch settles.
    launch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(fakeBrowser()), 10)),
    )
    const provider = new LocalBrowserProvider({ headless: true, recording: false })

    await Promise.all(
      Array.from({ length: 4 }, () => provider.create({ recording: false, stealth: false })),
    )

    expect(launch, "four concurrent runs must share one browser").toHaveBeenCalledTimes(1)
    await provider.shutdown()
  })

  it("closes the browser it launched", async () => {
    const browser = fakeBrowser()
    launch.mockResolvedValue(browser)
    const provider = new LocalBrowserProvider({ headless: true, recording: false })

    await provider.create({ recording: false, stealth: false })
    await provider.shutdown()

    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  // A cached rejection would poison every later run in the suite.
  it("does not cache a failed launch", async () => {
    launch.mockRejectedValueOnce(new Error("no chromium"))
    const provider = new LocalBrowserProvider({ headless: true, recording: false })

    await expect(provider.create({ recording: false, stealth: false })).rejects.toThrow()

    launch.mockResolvedValue(fakeBrowser())
    await expect(provider.create({ recording: false, stealth: false })).resolves.toBeTruthy()
    expect(launch).toHaveBeenCalledTimes(2)
    await provider.shutdown()
  })
})
