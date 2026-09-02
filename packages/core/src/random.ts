import { createHash } from "node:crypto"

/**
 * Perturbations must be reproducible: re-running a suite with the same inputs
 * has to produce the same environment, or a reliability number means nothing.
 * Every stochastic decision derives from this seed, never from Math.random.
 */
export function deriveSeed(suiteRunId: string, variant: string, repetition: number): number {
  const digest = createHash("sha256").update(`${suiteRunId}|${variant}|${repetition}`).digest()
  // 31 bits, not 32: the seed is persisted in a Postgres `integer` column,
  // which is SIGNED, so anything above 2^31-1 is rejected at write time.
  // 2.1 billion distinct environments is far more than a perturbation needs.
  return digest.readUInt32BE(0) >>> 1
}

/** mulberry32 — small, fast, well-distributed, and deterministic across runs. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("cannot pick from an empty list")
      return items[Math.floor(next() * items.length)] as T
    },
    bool: (probability = 0.5) => next() < probability,
    /** Deterministic jitter around a base value, +/- ratio. */
    jitter: (base, ratio = 0.2) => Math.round(base * (1 - ratio + next() * ratio * 2)),
  }
}

export interface Rng {
  next(): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  bool(probability?: number): boolean
  jitter(base: number, ratio?: number): number
}
