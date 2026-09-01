import { describe, expect, it } from "vitest"
import { createRng, deriveSeed } from "./random.js"

describe("deriveSeed", () => {
  // Reproducibility is the whole basis of comparing two suite runs. If the
  // seed drifts, so does the environment, and the comparison is meaningless.
  it("is stable for the same inputs", () => {
    expect(deriveSeed("suite-1", "cookie_popup", 2)).toBe(deriveSeed("suite-1", "cookie_popup", 2))
  })

  it("differs across variants, repetitions and suites", () => {
    const base = deriveSeed("suite-1", "cookie_popup", 1)
    expect(deriveSeed("suite-1", "cookie_popup", 2)).not.toBe(base)
    expect(deriveSeed("suite-1", "unexpected_modal", 1)).not.toBe(base)
    expect(deriveSeed("suite-2", "cookie_popup", 1)).not.toBe(base)
  })

  // Regression guard: seeds are stored in a Postgres `integer` (signed int4).
  // A uint32 seed overflows it and every enqueue fails at write time.
  it("always fits a signed 32-bit column", () => {
    for (let i = 0; i < 2_000; i++) {
      const seed = deriveSeed(`suite-${i}`, "cookie_popup", i % 5)
      expect(Number.isSafeInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(2 ** 31 - 1)
    }
  })
})

describe("createRng", () => {
  it("replays the identical sequence from the same seed", () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it("diverges for different seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  it("stays inside [0,1)", () => {
    const rng = createRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it("bounds int() inclusively", () => {
    const rng = createRng(7)
    for (let i = 0; i < 500; i++) {
      const v = rng.int(3, 6)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(6)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it("picks only from the given list and rejects an empty one", () => {
    const rng = createRng(11)
    expect(["a", "b", "c"]).toContain(rng.pick(["a", "b", "c"]))
    expect(() => rng.pick([])).toThrow(/empty/)
  })

  it("jitters deterministically within the requested ratio", () => {
    const values = Array.from({ length: 50 }, (_, i) => createRng(i).jitter(1000, 0.2))
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(800)
      expect(v).toBeLessThanOrEqual(1200)
    }
    expect(createRng(5).jitter(1000, 0.2)).toBe(createRng(5).jitter(1000, 0.2))
  })

  it("is reasonably uniform", () => {
    const rng = createRng(2024)
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 10_000; i++) buckets[Math.floor(rng.next() * 10)]++
    for (const count of buckets) expect(count).toBeGreaterThan(800)
  })
})
