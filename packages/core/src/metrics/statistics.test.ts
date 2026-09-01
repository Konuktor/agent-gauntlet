import { describe, expect, it } from "vitest"
import { flipRate, mean, percentile, round, stdDev } from "./statistics.js"

describe("percentile", () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

  it("uses nearest rank so every result is a real observation", () => {
    expect(percentile(values, 0.5)).toBe(50)
    expect(percentile(values, 0.95)).toBe(100)
    expect(percentile(values, 0.9)).toBe(90)
    expect(values).toContain(percentile(values, 0.37))
  })

  it("does not require sorted input", () => {
    expect(percentile([90, 10, 50, 30, 70], 0.5)).toBe(50)
  })

  it("handles degenerate inputs", () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([42], 0.95)).toBe(42)
    expect(percentile(values, 0)).toBe(10)
    expect(percentile(values, 1)).toBe(100)
  })
})

describe("flipRate", () => {
  it("is 0 when every repetition agreed", () => {
    expect(flipRate([true, true, true])).toBe(0)
    expect(flipRate([false, false])).toBe(0)
  })

  it("is 1 when the outcome alternates every time", () => {
    expect(flipRate([true, false, true, false])).toBe(1)
  })

  // The point of the metric: 2/4 passes can be steady or chaotic, and those
  // are different failure modes for the user.
  it("separates a clean split from an alternating one", () => {
    expect(flipRate([true, true, false, false])).toBeCloseTo(1 / 3)
    expect(flipRate([true, false, true, false])).toBe(1)
  })

  it("is 0 with fewer than two observations", () => {
    expect(flipRate([])).toBe(0)
    expect(flipRate([true])).toBe(0)
  })
})

describe("mean / stdDev / round", () => {
  it("computes mean and population stdDev", () => {
    expect(mean([2, 4, 6])).toBe(4)
    expect(stdDev([2, 4, 6])).toBeCloseTo(1.6329931, 6)
    expect(stdDev([5])).toBe(0)
    expect(mean([])).toBe(0)
  })

  it("rounds to a fixed number of digits", () => {
    expect(round(0.123456, 2)).toBe(0.12)
    expect(round(1 / 3)).toBe(0.3333)
  })
})
