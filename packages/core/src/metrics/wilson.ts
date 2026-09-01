export interface ConfidenceInterval {
  low: number
  high: number
  /** Point estimate the interval is centred on (the raw proportion). */
  point: number
}

/** Two-sided z for common confidence levels. */
const Z: Record<number, number> = {
  0.8: 1.2815515655446004,
  0.9: 1.6448536269514722,
  0.95: 1.959963984540054,
  0.99: 2.5758293035489004,
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * Chosen over the normal approximation deliberately: our samples are tiny
 * (often 3-5 runs per variant) and frequently hit 0/n or n/n, where the naive
 * interval collapses to zero width and would let the UI claim "100% reliable,
 * +/- 0" from three runs. Wilson stays sane at the boundaries.
 *
 * This is the only inferential statistic in the product, and the UI always
 * shows n alongside it — we do not dress small samples up as certainty.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  confidence: 0.8 | 0.9 | 0.95 | 0.99 = 0.95,
): ConfidenceInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(total)) {
    throw new Error("wilsonInterval expects integer counts")
  }
  if (total < 0 || successes < 0 || successes > total) {
    throw new Error(`invalid counts: ${successes}/${total}`)
  }
  if (total === 0) return { low: 0, high: 1, point: 0 }

  const z = Z[confidence] as number
  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))

  return {
    point: p,
    low: normalize((centre - margin) / denominator),
    high: normalize((centre + margin) / denominator),
  }
}

/**
 * Clamp to [0,1] and drop float noise. Without the rounding, `wilsonInterval(0, 3)`
 * returns a lower bound of 4.87e-17 rather than 0 — harmless arithmetically, but
 * it renders as a non-zero percentage and reads like a bug in the dashboard.
 * Six decimals is far finer than any reliability figure we display.
 */
function normalize(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 1e6) / 1e6))
}
