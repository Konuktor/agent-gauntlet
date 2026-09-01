export { CATALOG, COUPONS, findProduct, formatPrice, type Product } from "./catalog.js"
export { labelsFor, type Labels } from "./labels.js"
export {
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
export { createFixtureApp, startFixtureServer } from "./server.js"
export type { FixtureServerHandle, FixtureServerOptions } from "./server.js"
export type { CartLine, FixtureConfig, PublicRunState, RunState, Stage } from "./types.js"

/** The task every demo suite runs, and the state the evaluator expects. */
export const DEMO_TASK = {
  productSku: "aurora-headphones",
  quantity: 1,
  coupon: "SAVE20",
  checkoutName: "Ada Lovelace",
  checkoutCity: "London",
  stopAtStage: "review",
} as const
