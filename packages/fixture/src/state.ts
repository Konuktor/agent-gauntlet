import { COUPONS, findProduct } from "./catalog.js"
import type { FixtureConfig, PublicRunState, RunState, Stage } from "./types.js"

/**
 * Per-run state, held in memory and keyed by run id.
 *
 * One sandbox serves every run of a suite concurrently — 16 browsers hitting
 * the same process — so isolation is by run id, not by cookie or by process.
 * That keeps the demo to a single sandbox, which matters because Solari's free
 * plan allows exactly one.
 */
export class FixtureStore {
  private readonly runs = new Map<string, RunState>()

  constructor(
    /** Runs older than this are evicted, so a long-lived sandbox cannot grow
     *  without bound if a worker dies before tearing its runs down. */
    private readonly maxAgeMs = 60 * 60_000,
    private readonly maxRuns = 500,
    /** Injectable clock. Eviction is otherwise untestable without sleeping,
     *  and a sleep-based test for it would be flaky by construction. */
    private readonly now: () => number = Date.now,
  ) {}

  register(runId: string, variant: string, seed: number, config: FixtureConfig): RunState {
    this.evictStale()
    const state: RunState = {
      runId,
      variant,
      seed,
      config,
      createdAt: this.now(),
      cart: [],
      coupon: null,
      discountApplied: false,
      checkout: { name: null, city: null },
      stage: "browse",
      purchaseSubmitted: false,
      sessionExpired: false,
      expiryTriggered: false,
      timeline: [{ at: this.now(), event: "session_registered", detail: variant }],
    }
    this.runs.set(runId, state)
    return state
  }

  get(runId: string): RunState | undefined {
    return this.runs.get(runId)
  }

  /** Returns the run, creating a default one if it was never registered. This
   *  keeps the fixture browsable by a human without a worker in the loop. */
  getOrCreate(runId: string): RunState {
    return this.runs.get(runId) ?? this.register(runId, "baseline", 0, {})
  }

  delete(runId: string): boolean {
    return this.runs.delete(runId)
  }

  size(): number {
    return this.runs.size
  }

  private evictStale(): void {
    const cutoff = this.now() - this.maxAgeMs
    for (const [id, state] of this.runs) {
      if (state.createdAt <= cutoff) this.runs.delete(id)
    }
    while (this.runs.size >= this.maxRuns) {
      const oldest = this.runs.keys().next()
      if (oldest.done) break
      this.runs.delete(oldest.value)
    }
  }
}

function note(state: RunState, event: string, detail?: string): void {
  state.timeline.push({ at: Date.now(), event, ...(detail ? { detail } : {}) })
}

export function addToCart(state: RunState, sku: string, quantity = 1): { ok: boolean; error?: string } {
  const product = findProduct(sku)
  if (!product) return { ok: false, error: "unknown_sku" }

  const existing = state.cart.find((line) => line.sku === sku)
  if (existing) existing.quantity += quantity
  else
    state.cart.push({
      sku,
      name: product.name,
      quantity,
      unitPriceCents: product.priceCents,
    })

  if (state.stage === "browse") state.stage = "cart"
  note(state, "add_to_cart", sku)
  return { ok: true }
}

export function removeFromCart(state: RunState, sku: string): void {
  state.cart = state.cart.filter((line) => line.sku !== sku)
  note(state, "remove_from_cart", sku)
}

export function applyCoupon(state: RunState, code: string): { ok: boolean; error?: string } {
  const normalized = code.trim().toUpperCase()
  const coupon = COUPONS[normalized]
  if (!coupon) {
    note(state, "coupon_rejected", normalized)
    return { ok: false, error: "invalid_coupon" }
  }
  if (state.cart.length === 0) {
    note(state, "coupon_rejected", "empty_cart")
    return { ok: false, error: "empty_cart" }
  }
  state.coupon = normalized
  state.discountApplied = true
  note(state, "coupon_applied", normalized)
  return { ok: true }
}

export function setStage(state: RunState, stage: Stage): void {
  state.stage = stage
  note(state, "stage", stage)
}

export function setCheckoutDetails(
  state: RunState,
  details: { name?: string; city?: string },
): void {
  if (typeof details.name === "string") state.checkout.name = details.name.trim() || null
  if (typeof details.city === "string") state.checkout.city = details.city.trim() || null
  note(state, "checkout_details", `${state.checkout.name ?? ""}|${state.checkout.city ?? ""}`)
}

export function submitPurchase(state: RunState): void {
  state.purchaseSubmitted = true
  state.stage = "done"
  note(state, "purchase_submitted")
}

/**
 * The expired_session perturbation. Fires once, when the run first reaches the
 * configured stage, and is recoverable: the expired page offers a "Resume
 * session" button that restores the cart. A perturbation that cannot be
 * survived tests nothing (§31).
 */
export function maybeExpireSession(state: RunState, atStage: Stage): boolean {
  const rule = state.config.expiredSession
  if (!rule || state.expiryTriggered || rule.afterStage !== atStage) return false
  state.expiryTriggered = true
  state.sessionExpired = true
  note(state, "session_expired", atStage)
  return true
}

export function resumeSession(state: RunState): void {
  state.sessionExpired = false
  note(state, "session_resumed")
}

export function totals(state: RunState): {
  subtotalCents: number
  discountCents: number
  totalCents: number
} {
  const subtotalCents = state.cart.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  )
  const percent = state.discountApplied && state.coupon ? (COUPONS[state.coupon]?.percentOff ?? 0) : 0
  const discountCents = Math.round((subtotalCents * percent) / 100)
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents }
}

/**
 * The evaluator's ground truth. Computed server-side from state the agent can
 * only change by actually performing the actions — there is no field here the
 * agent can assert into being true.
 */
export function publicState(state: RunState): PublicRunState {
  const { subtotalCents, discountCents, totalCents } = totals(state)
  return {
    runId: state.runId,
    variant: state.variant,
    cart: state.cart.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
    })),
    coupon: state.coupon,
    discountApplied: state.discountApplied,
    subtotalCents,
    discountCents,
    totalCents,
    checkout: { ...state.checkout },
    stage: state.stage,
    purchaseSubmitted: state.purchaseSubmitted,
    sessionExpired: state.sessionExpired,
    timeline: state.timeline,
  }
}
