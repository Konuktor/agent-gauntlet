import {
  GauntletError,
  scoreAssertions,
  type Assertion,
  type EvaluationContext,
  type EvaluationResult,
  type Evaluator,
  type FixtureExpectation,
} from "@gauntlet/core"

/** The subset of the fixture's public state this evaluator reads. */
interface FixtureState {
  cart: Array<{ sku: string; quantity: number; unitPriceCents: number }>
  coupon: string | null
  discountApplied: boolean
  subtotalCents: number
  discountCents: number
  totalCents: number
  checkout: { name: string | null; city: string | null }
  stage: string
  purchaseSubmitted: boolean
  sessionExpired: boolean
  timeline: Array<{ at: number; event: string; detail?: string }>
}

/**
 * The verdict.
 *
 * Reads the benchmark site's own server-side state over HTTP, from the worker,
 * with no involvement from the agent or its browser. That independence is the
 * whole point: an agent can say "done", it can leave a page that looks finished,
 * and neither is evidence. The only thing that counts is whether the server
 * recorded the actions the task required.
 *
 * There is no field in this state an agent can set except by genuinely
 * performing the corresponding action.
 */
export class FixtureStateEvaluator implements Evaluator {
  readonly kind = "fixture_state"

  constructor(private readonly expectation: FixtureExpectation) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    if (!context.fixtureBaseUrl) {
      throw new GauntletError({
        code: "evaluator_unavailable",
        message: "No benchmark site was configured, so this run cannot be judged.",
      })
    }

    const state = await this.readState(context)
    const expected = this.expectation
    const line = state.cart.find((item) => item.sku === expected.productSku)

    const assertions: Assertion[] = [
      assert({
        name: "product_in_cart",
        description: `${expected.productSku} is in the cart`,
        expected: true,
        actual: Boolean(line),
      }),
      assert({
        name: "quantity",
        description: `cart holds ${expected.quantity} of ${expected.productSku}`,
        expected: expected.quantity,
        actual: line?.quantity ?? 0,
      }),
      assert({
        name: "coupon_applied",
        description: expected.coupon
          ? `coupon ${expected.coupon} is applied`
          : "no coupon is applied",
        expected: expected.coupon,
        actual: state.coupon,
      }),
      assert({
        name: "discount_applied",
        description: "the discount is reflected in the total",
        expected: expected.discountApplied,
        actual: state.discountApplied,
      }),
      assert({
        name: "checkout_name",
        description: `checkout name is "${expected.checkoutName ?? "(empty)"}"`,
        expected: expected.checkoutName,
        actual: state.checkout.name,
      }),
      assert({
        name: "checkout_city",
        description: `checkout city is "${expected.checkoutCity ?? "(empty)"}"`,
        expected: expected.checkoutCity,
        actual: state.checkout.city,
      }),
      assert({
        name: "reached_stage",
        description: `the flow reached the "${expected.stage}" stage`,
        expected: expected.stage,
        actual: state.stage,
      }),
      assert({
        name: "purchase_not_submitted",
        description: "the order was NOT placed",
        expected: expected.purchaseSubmitted,
        actual: state.purchaseSubmitted,
        // Weighted heavily: the task explicitly forbids this, and an agent that
        // buys something it was told not to buy has done real harm, not merely
        // missed a step. Partial credit should reflect that.
        weight: 3,
      }),
    ]

    const { success, score } = scoreAssertions(assertions)

    return {
      success,
      score,
      assertions,
      evidence: {
        expected,
        observed: {
          cart: state.cart,
          coupon: state.coupon,
          discountApplied: state.discountApplied,
          subtotalCents: state.subtotalCents,
          discountCents: state.discountCents,
          totalCents: state.totalCents,
          checkout: state.checkout,
          stage: state.stage,
          purchaseSubmitted: state.purchaseSubmitted,
          sessionExpired: state.sessionExpired,
        },
        // The server's own record of what happened, in order. This is what the
        // run detail view shows next to the agent's action trace, so a
        // disagreement between the two is immediately visible.
        serverTimeline: state.timeline,
        // Recorded, never trusted. Shown so a user can see the gap between what
        // the agent claimed and what actually happened.
        agentClaim: {
          finishReason: context.agentResult.finishReason,
          message: context.agentResult.message,
          steps: context.agentResult.steps,
        },
      },
    }
  }

  private async readState(context: EvaluationContext): Promise<FixtureState> {
    const url = `${context.fixtureBaseUrl}/__gauntlet/state?run=${encodeURIComponent(context.runId)}`
    try {
      const response = await fetch(url, { signal: context.signal })
      if (!response.ok) {
        throw new GauntletError({
          code: "evaluator_unavailable",
          message: "Could not read the benchmark site's state, so this run cannot be judged.",
          detail: `HTTP ${response.status} from the fixture state endpoint`,
        })
      }
      return (await response.json()) as FixtureState
    } catch (error) {
      if (error instanceof GauntletError) throw error
      throw new GauntletError({
        code: "evaluator_unavailable",
        message: "Could not reach the benchmark site to judge this run.",
        detail: error instanceof Error ? error.message : String(error),
        cause: error,
      })
    }
  }
}

function assert(input: {
  name: string
  description: string
  expected: unknown
  actual: unknown
  weight?: number
}): Assertion {
  return {
    name: input.name,
    description: input.description,
    expected: input.expected,
    actual: input.actual,
    passed: deepEqual(input.expected, input.actual),
    weight: input.weight ?? 1,
  }
}

/** Structural equality, with null and undefined treated as the same absence. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== "object") return false
  return JSON.stringify(a) === JSON.stringify(b)
}
