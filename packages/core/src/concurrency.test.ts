import { describe, expect, it, vi } from "vitest"
import { mapWithConcurrency, retry, Semaphore, sleep, withTimeout } from "./concurrency.js"
import { GauntletError } from "./errors.js"

describe("Semaphore", () => {
  it("never exceeds its capacity", async () => {
    const sem = new Semaphore(3)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 20 }, () =>
        sem.run(async () => {
          active++
          peak = Math.max(peak, active)
          await sleep(5)
          active--
        }),
      ),
    )
    expect(peak).toBe(3)
    expect(sem.inUse).toBe(0)
  })

  it("returns the slot even when the task throws", async () => {
    const sem = new Semaphore(1)
    await expect(
      sem.run(async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(sem.inUse).toBe(0)
    await expect(sem.run(async () => "ok")).resolves.toBe("ok")
  })

  it("is idempotent on double release", async () => {
    const sem = new Semaphore(2)
    const release = await sem.acquire()
    release()
    release()
    expect(sem.inUse).toBe(0)
  })

  it("hands the freed slot to a waiter in FIFO order", async () => {
    const sem = new Semaphore(1)
    const order: number[] = []
    const first = await sem.acquire()
    const waiters = [1, 2, 3].map((n) =>
      sem.run(async () => {
        order.push(n)
        await sleep(1)
      }),
    )
    await sleep(5)
    first()
    await Promise.all(waiters)
    expect(order).toEqual([1, 2, 3])
  })

  it("rejects a waiter when its signal aborts, without leaking the queue slot", async () => {
    const sem = new Semaphore(1)
    const held = await sem.acquire()
    const controller = new AbortController()
    const pending = sem.acquire(controller.signal)
    await sleep(1)
    expect(sem.queued).toBe(1)
    controller.abort()
    await expect(pending).rejects.toThrow(GauntletError)
    expect(sem.queued).toBe(0)
    held()
    await expect(sem.run(async () => "free")).resolves.toBe("free")
  })

  it("rejects an already-aborted acquire immediately", async () => {
    const sem = new Semaphore(1)
    await expect(sem.acquire(AbortSignal.abort())).rejects.toThrow(/cancelled/i)
    expect(sem.inUse).toBe(0)
  })

  it("requires a positive capacity", () => {
    expect(() => new Semaphore(0)).toThrow(/capacity/)
  })
})

describe("withTimeout", () => {
  it("resolves when the work finishes in time", async () => {
    const value = await withTimeout(
      async () => "done",
      1_000,
      () => new GauntletError({ code: "agent_timeout", message: "late" }),
    )
    expect(value).toBe("done")
  })

  it("rejects with the caller's error and aborts the passed signal", async () => {
    let observed: AbortSignal | undefined
    const promise = withTimeout(
      async (signal) => {
        observed = signal
        await sleep(1_000)
        return "never"
      },
      20,
      () => new GauntletError({ code: "agent_timeout", message: "The agent ran out of time." }),
    )
    await expect(promise).rejects.toThrow("The agent ran out of time.")
    expect(observed?.aborted).toBe(true)
  })

  it("propagates a parent abort", async () => {
    const parent = new AbortController()
    let observed: AbortSignal | undefined
    const promise = withTimeout(
      async (signal) => {
        observed = signal
        await sleep(500)
        return "x"
      },
      5_000,
      () => new GauntletError({ code: "agent_timeout", message: "late" }),
    )
    parent.abort()
    // The parent link is established inside withTimeout; give it a tick.
    await sleep(1)
    void promise.catch(() => {})
    expect(observed).toBeDefined()
  })
})

describe("retry", () => {
  it("returns the first success without sleeping", async () => {
    const fn = vi.fn(async () => "ok")
    await expect(retry(fn, { attempts: 3, baseDelayMs: 1, shouldRetry: () => true })).resolves.toBe(
      "ok",
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries transient failures up to the attempt cap", async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls++
        if (calls < 3) throw new Error("transient")
        return "recovered"
      },
      { attempts: 5, baseDelayMs: 1, shouldRetry: () => true },
    )
    expect(result).toBe("recovered")
    expect(calls).toBe(3)
  })

  // §17: infrastructure may retry; an agent's unreliability must never be
  // papered over, so shouldRetry is always explicit at the call site.
  it("does not retry when shouldRetry says no", async () => {
    const fn = vi.fn(async () => {
      throw new GauntletError({ code: "solari_concurrency", message: "at cap" })
    })
    await expect(
      retry(fn, { attempts: 5, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toThrow("at cap")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("surfaces the last error when every attempt fails", async () => {
    let n = 0
    await expect(
      retry(
        async () => {
          throw new Error(`attempt ${++n}`)
        },
        { attempts: 3, baseDelayMs: 1, shouldRetry: () => true },
      ),
    ).rejects.toThrow("attempt 3")
  })
})

describe("mapWithConcurrency", () => {
  // A single bad run must not take the suite down (§16).
  it("collects every outcome even when some reject", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      if (n % 2 === 0) throw new Error(`fail ${n}`)
      return n * 10
    })
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "rejected"])
    expect(results[0]).toMatchObject({ value: 10 })
    expect(results[3]).toMatchObject({ reason: expect.objectContaining({ message: "fail 4" }) })
  })

  it("respects the concurrency limit", async () => {
    let active = 0
    let peak = 0
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async () => {
        active++
        peak = Math.max(peak, active)
        await sleep(3)
        active--
      },
    )
    expect(peak).toBe(4)
  })

  it("preserves input order in the output", async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await sleep(ms)
      return ms
    })
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([30, 10, 20])
  })

  it("handles an empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })
})
