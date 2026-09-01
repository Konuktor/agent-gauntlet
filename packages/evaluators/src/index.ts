import type { EvaluatorConfig, Evaluator } from "@gauntlet/core"
import { FixtureStateEvaluator } from "./fixture-evaluator.js"
import { WebAssertionEvaluator } from "./web-assertions.js"

export { FixtureStateEvaluator } from "./fixture-evaluator.js"
export { WebAssertionEvaluator, webAssertionSchema, type WebAssertion } from "./web-assertions.js"

/** Build the evaluator a task definition asks for. */
export function createEvaluator(config: EvaluatorConfig): Evaluator {
  switch (config.kind) {
    case "fixture_state":
      return new FixtureStateEvaluator(config.expect)
    case "web_assertions":
      return new WebAssertionEvaluator(config.assertions)
  }
}
