import { describe, expect, it, vi } from "vitest"
import { nullLogger } from "@gauntlet/core"
import { fetchReplayWithBackoff, toArtifact } from "./replay.js"

const ndjson = (n: number) =>
  Buffer.from(Array.from({ length: n }, (_, i) => JSON.stringify({ type: 3, i })).join("\n"))

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

const fast = { attempts: 4, intervalMs: 1 }

describe("fetchReplayWithBackoff", () => {
  it("returns the artifact on the first successful poll", async () => {
    const downloadReplay = vi.fn(async () => ndjson(3))
    const artifact = await fetchReplayWithBackoff("sess_1", { downloadReplay, logger: nullLogger }, fast)
    expect(artifact).toMatchObject({ source: "solari", eventCount: 3, truncated: false })
    expect(downloadReplay).toHaveBeenCalledTimes(1)
  })

  // The upload is asynchronous after release, so the docs say the first poll
  // "usually 404s even on a perfectly good recording".
  it("keeps polling through 404s while the upload lands", async () => {
    let calls = 0
    const downloadReplay = vi.fn(async () => {
      if (++calls < 3) throw new HttpError(404)
      return ndjson(5)
    })
    const artifact = await fetchReplayWithBackoff("sess_1", { downloadReplay, logger: nullLogger }, fast)
    expect(artifact?.eventCount).toBe(5)
    expect(downloadReplay).toHaveBeenCalledTimes(3)
  })

  it("recognises a 404 reported only in the message", async () => {
    let calls = 0
    const downloadReplay = vi.fn(async () => {
      if (++calls < 2) throw new Error("Request failed: 404 Not Found")
      return ndjson(2)
    })
    expect((await fetchReplayWithBackoff("s", { downloadReplay, logger: nullLogger }, fast))?.eventCount).toBe(2)
  })

  // Replay is evidence infrastructure, not a verdict: a missing recording must
  // never turn a passing run into a failing one.
  it("gives up quietly rather than throwing when the replay never arrives", async () => {
    const downloadReplay = vi.fn(async () => {
      throw new HttpError(404)
    })
    expect(await fetchReplayWithBackoff("s", { downloadReplay, logger: nullLogger }, fast)).toBeNull()
    expect(downloadReplay).toHaveBeenCalledTimes(4)
  })

  it("stops immediately on a non-404 error instead of hammering the API", async () => {
    const downloadReplay = vi.fn(async () => {
      throw new HttpError(500)
    })
    expect(await fetchReplayWithBackoff("s", { downloadReplay, logger: nullLogger }, fast)).toBeNull()
    expect(downloadReplay).toHaveBeenCalledTimes(1)
  })

  it("treats an empty body as not-yet-uploaded", async () => {
    let calls = 0
    const downloadReplay = vi.fn(async () => (++calls < 2 ? new Uint8Array() : ndjson(1)))
    expect((await fetchReplayWithBackoff("s", { downloadReplay, logger: nullLogger }, fast))?.eventCount).toBe(1)
  })

  it("abandons the poll when the run is cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    const downloadReplay = vi.fn(async () => ndjson(1))
    expect(
      await fetchReplayWithBackoff("s", { downloadReplay, logger: nullLogger }, { ...fast, signal: controller.signal }),
    ).toBeNull()
    expect(downloadReplay).not.toHaveBeenCalled()
  })
})

describe("toArtifact", () => {
  it("counts newline-delimited events", () => {
    expect(toArtifact(ndjson(7), 1_000_000).eventCount).toBe(7)
    expect(toArtifact(new Uint8Array(), 1_000).eventCount).toBe(0)
  })

  it("truncates oversized replays at a line boundary so NDJSON stays parseable", () => {
    const big = ndjson(200)
    const artifact = toArtifact(big, 300)
    expect(artifact.truncated).toBe(true)
    expect(artifact.bytes.length).toBeLessThanOrEqual(300)
    const text = Buffer.from(artifact.bytes).toString("utf8")
    for (const line of text.split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it("leaves a replay inside the cap untouched", () => {
    const small = ndjson(4)
    const artifact = toArtifact(small, 1_000_000)
    expect(artifact.truncated).toBe(false)
    expect(Buffer.from(artifact.bytes).equals(small)).toBe(true)
  })
})
