/**
 * The fixture is bundled to a single zero-dependency .mjs and uploaded into a
 * Solari sandbox, so it deliberately declares its own types rather than
 * importing from @gauntlet/core. `packages/perturbations` asserts at compile
 * time that the two shapes stay compatible.
 */

export interface FixtureConfig {
  cookieBanner?: boolean
  unexpectedModal?: { afterMs: number }
  apiLatencyMs?: number
  renamedCta?: boolean
  expiredSession?: { afterStage: "cart" | "checkout" }
  reorderedLayout?: boolean
  delayedElement?: { target: "add-to-cart" | "checkout"; delayMs: number }
  locale?: "en-US" | "de-DE"
}

export type Stage = "browse" | "cart" | "checkout" | "review" | "done"

export interface CartLine {
  sku: string
  name: string
  quantity: number
  unitPriceCents: number
}

export interface RunState {
  runId: string
  variant: string
  seed: number
  config: FixtureConfig
  createdAt: number
  cart: CartLine[]
  coupon: string | null
  discountApplied: boolean
  checkout: { name: string | null; city: string | null }
  stage: Stage
  purchaseSubmitted: boolean
  /** True once the expired_session perturbation has fired and not been resolved. */
  sessionExpired: boolean
  /** True once it has fired at all, so it fires exactly once per run. */
  expiryTriggered: boolean
  /** Ordered log of every state-changing event. This is the evidence trail the
   *  evaluator and the run detail view read; the agent cannot write to it
   *  except by actually performing the actions. */
  timeline: Array<{ at: number; event: string; detail?: string }>
}

/** The public shape returned by GET /__gauntlet/state. */
export interface PublicRunState {
  runId: string
  variant: string
  cart: Array<{ sku: string; quantity: number; unitPriceCents: number }>
  coupon: string | null
  discountApplied: boolean
  subtotalCents: number
  discountCents: number
  totalCents: number
  checkout: { name: string | null; city: string | null }
  stage: Stage
  purchaseSubmitted: boolean
  sessionExpired: boolean
  timeline: Array<{ at: number; event: string; detail?: string }>
}
