export interface Assertion {
  name: string
  /** Human sentence shown in the evidence table. */
  description: string
  expected: unknown
  actual: unknown
  passed: boolean
  /** Assertions can matter more or less; score is the weighted pass ratio. */
  weight: number
}

export interface EvaluationResult {
  /** The verdict. Independent of anything the agent said about itself. */
  success: boolean
  /** Weighted partial credit in [0,1]. Useful for "how close did it get". */
  score: number
  assertions: Assertion[]
  /** Raw material the assertions were computed from, for the diagnostics panel. */
  evidence: Record<string, unknown>
}

export function scoreAssertions(assertions: Assertion[]): { success: boolean; score: number } {
  if (assertions.length === 0) return { success: false, score: 0 }
  const totalWeight = assertions.reduce((sum, a) => sum + a.weight, 0)
  const earned = assertions.reduce((sum, a) => sum + (a.passed ? a.weight : 0), 0)
  return {
    // Every assertion must pass. Partial credit informs the UI; it never
    // upgrades a run to a pass.
    success: assertions.every((a) => a.passed),
    score: totalWeight === 0 ? 0 : Number((earned / totalWeight).toFixed(4)),
  }
}
