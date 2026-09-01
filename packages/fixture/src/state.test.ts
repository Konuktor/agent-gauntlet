import { describe, expect, it } from "vitest"
import {
  addToCart,
  applyCoupon,
  FixtureStore,
  maybeExpireSession,
  publicState,
  removeFromCart,
  resumeSession,
  setCheckoutDetails,
  setStage,
  submitPurchase,
  totals,
} from "./state.js"
import type { FixtureConfig } from "./types.js"

const store = () => new FixtureStore()
const newRun = (config: FixtureConfig = {}) => store().register("run-1", "baseline", 42, config)

describe("cart", () => {
  it("adds a known product and moves out of browse", () => {
    const state = newRun()
    expect(addToCart(state, "aurora-headphones")).toEqual({ ok: true })
    expect(state.cart).toEqual([
      { sku: "aurora-headphones", name: "Aurora Headphones", quantity: 1, unitPriceCents: 9900 },
    ])
    expect(state.stage).toBe("cart")
  })

  it("rejects an unknown sku without mutating the cart", () => {
    const state = newRun()
    expect(addToCart(state, "not-a-product")).toEqual({ ok: false, error: "unknown_sku" })
    expect(state.cart).toHaveLength(0)
  })

  it("increments quantity rather than duplicating a line", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    addToCart(state, "aurora-headphones")
    expect(state.cart).toHaveLength(1)
    expect(state.cart[0]!.quantity).toBe(2)
  })

  it("removes a line", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    removeFromCart(state, "aurora-headphones")
    expect(state.cart).toHaveLength(0)
  })
})

describe("coupons", () => {
  it("applies SAVE20 as 20% off", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    expect(applyCoupon(state, "SAVE20")).toEqual({ ok: true })
    expect(totals(state)).toEqual({ subtotalCents: 9900, discountCents: 1980, totalCents: 7920 })
  })

  it("is case and whitespace insensitive", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    expect(applyCoupon(state, "  save20 ")).toEqual({ ok: true })
    expect(state.coupon).toBe("SAVE20")
  })

  it("rejects an unknown code and leaves state untouched", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    expect(applyCoupon(state, "FREESTUFF")).toEqual({ ok: false, error: "invalid_coupon" })
    expect(state.discountApplied).toBe(false)
    expect(totals(state).totalCents).toBe(9900)
  })

  it("refuses to apply a coupon to an empty cart", () => {
    expect(applyCoupon(newRun(), "SAVE20")).toEqual({ ok: false, error: "empty_cart" })
  })
})

describe("expired_session perturbation", () => {
  it("fires once, at the configured stage only", () => {
    const state = newRun({ expiredSession: { afterStage: "checkout" } })
    expect(maybeExpireSession(state, "cart")).toBe(false)
    expect(maybeExpireSession(state, "checkout")).toBe(true)
    expect(state.sessionExpired).toBe(true)

    resumeSession(state)
    // It must not re-fire, or the run becomes unwinnable rather than hard.
    expect(maybeExpireSession(state, "checkout")).toBe(false)
    expect(state.sessionExpired).toBe(false)
  })

  it("preserves the cart across expiry and resume, so recovery is possible", () => {
    const state = newRun({ expiredSession: { afterStage: "cart" } })
    addToCart(state, "aurora-headphones")
    applyCoupon(state, "SAVE20")
    maybeExpireSession(state, "cart")
    resumeSession(state)
    expect(state.cart).toHaveLength(1)
    expect(state.discountApplied).toBe(true)
  })

  it("does nothing when the perturbation is not configured", () => {
    const state = newRun()
    expect(maybeExpireSession(state, "cart")).toBe(false)
    expect(maybeExpireSession(state, "checkout")).toBe(false)
  })
})

describe("publicState", () => {
  it("is the completed task's expected shape", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    applyCoupon(state, "SAVE20")
    setStage(state, "checkout")
    setCheckoutDetails(state, { name: "Ada Lovelace", city: "London" })
    setStage(state, "review")

    expect(publicState(state)).toMatchObject({
      cart: [{ sku: "aurora-headphones", quantity: 1, unitPriceCents: 9900 }],
      coupon: "SAVE20",
      discountApplied: true,
      totalCents: 7920,
      checkout: { name: "Ada Lovelace", city: "London" },
      stage: "review",
      purchaseSubmitted: false,
    })
  })

  it("records purchase submission, which the task forbids", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    submitPurchase(state)
    const pub = publicState(state)
    expect(pub.purchaseSubmitted).toBe(true)
    expect(pub.stage).toBe("done")
  })

  it("trims blank checkout values to null rather than empty strings", () => {
    const state = newRun()
    setCheckoutDetails(state, { name: "   ", city: "London" })
    expect(publicState(state).checkout).toEqual({ name: null, city: "London" })
  })

  it("keeps an ordered evidence timeline the agent cannot forge", () => {
    const state = newRun()
    addToCart(state, "aurora-headphones")
    applyCoupon(state, "SAVE20")
    expect(state.timeline.map((t) => t.event)).toEqual([
      "session_registered",
      "add_to_cart",
      "coupon_applied",
    ])
  })
})

describe("FixtureStore", () => {
  it("isolates concurrent runs sharing one process", () => {
    const s = store()
    const a = s.register("run-a", "baseline", 1, {})
    const b = s.register("run-b", "cookie_popup", 2, { cookieBanner: true })
    addToCart(a, "aurora-headphones")
    expect(s.get("run-b")!.cart).toHaveLength(0)
    expect(b.config.cookieBanner).toBe(true)
    expect(s.get("run-a")!.cart).toHaveLength(1)
  })

  it("creates a browsable session for an unregistered run id", () => {
    const s = store()
    expect(s.getOrCreate("ad-hoc").variant).toBe("baseline")
  })

  it("evicts runs older than the retention window", () => {
    let clock = 1_000
    const s = new FixtureStore(60_000, 500, () => clock)
    s.register("old", "baseline", 1, {})
    clock += 61_000
    s.register("new", "baseline", 2, {})
    expect(s.get("old")).toBeUndefined()
    expect(s.get("new")).toBeDefined()
  })

  it("keeps runs that are still inside the retention window", () => {
    let clock = 1_000
    const s = new FixtureStore(60_000, 500, () => clock)
    s.register("recent", "baseline", 1, {})
    clock += 30_000
    s.register("newer", "baseline", 2, {})
    expect(s.get("recent")).toBeDefined()
  })

  it("caps the number of retained runs", () => {
    const s = new FixtureStore(60_000, 3)
    for (let i = 0; i < 10; i++) s.register(`run-${i}`, "baseline", i, {})
    expect(s.size()).toBeLessThanOrEqual(3)
  })
})
