import {
  deriveSeed,
  type BrowserPerturbationOptions,
  type FixturePerturbationConfig,
  type Perturbation,
  type PerturbationContext,
} from "@gauntlet/core"
import type { FixtureConfig } from "@gauntlet/fixture"
import { requirePerturbation } from "./registry.js"

export interface ResolvedPerturbation {
  perturbation: Perturbation
  context: PerturbationContext
  fixtureConfig: FixturePerturbationConfig
  browserOptions: BrowserPerturbationOptions
}

/**
 * Turn (suite run, variant, repetition) into the concrete environment for one
 * run. The seed is derived here and nowhere else, so the fixture config and the
 * browser options for a given run are always the same pair.
 */
export function resolvePerturbation(input: {
  suiteRunId: string
  individualRunId: string
  variant: string
  repetition: number
  /** Persisted seed, when replaying a recorded run. Derived when absent. */
  seed?: number
}): ResolvedPerturbation {
  const perturbation = requirePerturbation(input.variant)
  const context: PerturbationContext = {
    suiteRunId: input.suiteRunId,
    individualRunId: input.individualRunId,
    variant: input.variant,
    repetition: input.repetition,
    seed: input.seed ?? deriveSeed(input.suiteRunId, input.variant, input.repetition),
  }

  return {
    perturbation,
    context,
    fixtureConfig: perturbation.fixtureConfig(context),
    browserOptions: perturbation.browserOptions(context),
  }
}

/**
 * Compile-time guard that the fixture's own config type — duplicated there so
 * its bundle stays dependency-free — has not drifted from the domain type the
 * perturbations produce. If either side changes, this stops compiling, which is
 * the only thing standing between a renamed field and a perturbation that
 * silently stops perturbing.
 *
 * Exported so `noUnusedLocals` treats it as load-bearing rather than dead.
 */
type Extends<A extends B, B> = A
type AssertTrue<T extends true> = T
type KeysEqual<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false

/** Catches a type change on a field both sides already declare. */
export type FieldTypesAgree = [
  Extends<FixtureConfig, FixturePerturbationConfig>,
  Extends<FixturePerturbationConfig, FixtureConfig>,
]

/**
 * Catches an added or removed knob. Assignability alone does NOT: both types
 * are all-optional, so adding a field to one side leaves them mutually
 * assignable and the guard passes while the perturbation silently stops
 * perturbing. Comparing the key sets is what actually holds the line.
 */
export type ConfigKeysAgree = AssertTrue<KeysEqual<FixtureConfig, FixturePerturbationConfig>>
