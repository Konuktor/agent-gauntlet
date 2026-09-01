/**
 * Nearest-rank percentile on an ascending copy of the input.
 * Nearest-rank (not interpolated) because every value returned is an
 * observation that actually happened — a p95 latency the UI shows should be a
 * real run's duration, not an average of two runs.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  if (p <= 0) return Math.min(...values)
  if (p >= 1) return Math.max(...values)
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil(p * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Population standard deviation. */
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

/**
 * How much a variant's outcome flips between repetitions of the *identical*
 * setup. 0 = every repetition agreed, 1 = maximally split.
 *
 * This is the number that makes AgentGauntlet's point: an agent that passes 3
 * and fails 3 of the same run is not "50% good", it is unpredictable, and that
 * is a different and worse property than being consistently mediocre.
 */
export function flipRate(outcomes: readonly boolean[]): number {
  if (outcomes.length < 2) return 0
  let flips = 0
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i] !== outcomes[i - 1]) flips += 1
  }
  return flips / (outcomes.length - 1)
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
