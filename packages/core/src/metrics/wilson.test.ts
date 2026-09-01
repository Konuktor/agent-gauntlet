import { describe, expect, it } from "vitest"
import { wilsonInterval } from "./wilson.js"

describe("wilsonInterval", () => {
  // Reference values computed independently from the closed form
  //   (p + z²/2n ± z·sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n)
  // with z = 1.959963984540054.
  it("matches the closed form for a balanced sample", () => {
    const ci = wilsonInterval(50, 100)
    expect(ci.point).toBe(0.5)
    expect(ci.low).toBeCloseTo(0.403832, 6)
    expect(ci.high).toBeCloseTo(0.596168, 6)
  })

  it("matches the closed form for a small lopsided sample", () => {
    const ci = wilsonInterval(3, 4)
    expect(ci.point).toBe(0.75)
    expect(ci.low).toBeCloseTo(0.300642, 6)
    expect(ci.high).toBeCloseTo(0.954413, 6)
  })

  // This is the whole reason Wilson was chosen over the normal approximation:
  // the naive interval is ±0 at the boundaries and would let a 3-run variant
  // claim certainty.
  it("keeps a non-degenerate interval at 100%", () => {
    const ci = wilsonInterval(3, 3)
    expect(ci.point).toBe(1)
    expect(ci.high).toBe(1)
    expect(ci.low).toBeCloseTo(0.438503, 6)
    expect(ci.high - ci.low).toBeGreaterThan(0.5)
  })

  it("keeps a non-degenerate interval at 0%", () => {
    const ci = wilsonInterval(0, 3)
    expect(ci.low).toBe(0)
    expect(ci.high).toBeCloseTo(0.561497, 6)
  })

  it("narrows as the sample grows", () => {
    const small = wilsonInterval(8, 10)
    const large = wilsonInterval(80, 100)
    expect(large.high - large.low).toBeLessThan(small.high - small.low)
  })

  it("is symmetric under success/failure inversion", () => {
    const a = wilsonInterval(7, 20)
    const b = wilsonInterval(13, 20)
    expect(a.low).toBeCloseTo(1 - b.high, 6)
    expect(a.high).toBeCloseTo(1 - b.low, 6)
  })

  it("widens with a higher confidence level", () => {
    const ninety = wilsonInterval(5, 10, 0.9)
    const ninetyNine = wilsonInterval(5, 10, 0.99)
    expect(ninetyNine.high - ninetyNine.low).toBeGreaterThan(ninety.high - ninety.low)
  })

  it("returns the full interval for an empty sample", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1, point: 0 })
  })

  it("rejects impossible counts", () => {
    expect(() => wilsonInterval(4, 3)).toThrow(/invalid counts/)
    expect(() => wilsonInterval(-1, 3)).toThrow(/invalid counts/)
    expect(() => wilsonInterval(1.5, 3)).toThrow(/integer/)
  })
})
