import type {
  BrowserPerturbationOptions,
  FixturePerturbationConfig,
  Perturbation,
  PerturbationContext,
} from "@gauntlet/core"
import { createRng } from "@gauntlet/core"

/**
 * Every perturbation is a pure function of its context. Nothing here calls
 * Math.random or reads the clock: the whole point of AgentGauntlet is that
 * re-running a suite reproduces the same environment, so a reliability delta
 * between two runs is attributable to the agent and not to the weather.
 */

const NO_FIXTURE: FixturePerturbationConfig = {}
const NO_BROWSER: BrowserPerturbationOptions = {}

function define(
  spec: Omit<Perturbation, "fixtureConfig" | "browserOptions"> & {
    fixtureConfig?: (ctx: PerturbationContext) => FixturePerturbationConfig
    browserOptions?: (ctx: PerturbationContext) => BrowserPerturbationOptions
  },
): Perturbation {
  return {
    ...spec,
    fixtureConfig: spec.fixtureConfig ?? (() => NO_FIXTURE),
    browserOptions: spec.browserOptions ?? (() => NO_BROWSER),
  }
}

export const baseline = define({
  id: "baseline",
  name: "Baseline",
  description: "The store exactly as it ships. This is the control.",
  category: "none",
})

export const cookiePopup = define({
  id: "cookie_popup",
  name: "Cookie popup",
  description: "A consent banner covers the lower part of every page until it is dismissed.",
  category: "ui",
  fixtureConfig: () => ({ cookieBanner: true }),
})

export const unexpectedModal = define({
  id: "unexpected_modal",
  name: "Unexpected modal",
  description:
    "A newsletter interstitial appears shortly after each page loads and blocks all clicks.",
  category: "ui",
  // The delay is jittered from the seed so the modal does not always land at
  // the same point in the agent's loop — that is what makes it a reliability
  // test rather than a fixed obstacle the agent can memorise.
  fixtureConfig: (ctx) => ({
    unexpectedModal: { afterMs: createRng(ctx.seed).jitter(1_200, 0.4) },
  }),
})

export const slowApi = define({
  id: "slow_api",
  name: "Slow API",
  description: "Every state-changing request takes noticeably longer, but still succeeds.",
  category: "network",
  fixtureConfig: (ctx) => ({ apiLatencyMs: createRng(ctx.seed).jitter(1_500, 0.3) }),
})

export const networkDelay = define({
  id: "network_delay",
  name: "Network delay",
  description: "Page and asset responses are delayed in the browser, simulating a poor connection.",
  category: "network",
  browserOptions: (ctx) => ({
    networkDelay: { matches: ["**/*"], delayMs: createRng(ctx.seed).jitter(350, 0.4) },
  }),
})

export const mobileViewport = define({
  id: "mobile_viewport",
  name: "Mobile viewport",
  description: "A phone-sized viewport with touch input, so the layout reflows and controls move.",
  category: "viewport",
  // Solari has no session-level viewport option, so this is applied when the
  // browser context is created rather than at session creation.
  browserOptions: () => ({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  }),
})

export const renamedCta = define({
  id: "renamed_cta",
  name: "Renamed CTA",
  description: '"Add to cart" becomes "Add" and "Proceed to checkout" becomes "Continue".',
  category: "ui",
  fixtureConfig: () => ({ renamedCta: true }),
})

export const expiredSession = define({
  id: "expired_session",
  name: "Expired session",
  description:
    "The session expires partway through checkout. The cart survives and can be resumed.",
  category: "state",
  // Alternating the trigger stage by seed means a suite exercises both the
  // early and the late failure, instead of only ever the same one.
  fixtureConfig: (ctx) => ({
    expiredSession: { afterStage: createRng(ctx.seed).bool() ? "cart" : "checkout" },
  }),
})

export const reorderedLayout = define({
  id: "reordered_layout",
  name: "Reordered layout",
  description: "The cart page puts the checkout button above the items and the coupon field last.",
  category: "ui",
  fixtureConfig: () => ({ reorderedLayout: true }),
})

export const delayedElement = define({
  id: "delayed_element",
  name: "Delayed element",
  description: "The add-to-cart control hydrates late, well inside the task's time budget.",
  category: "ui",
  fixtureConfig: (ctx) => ({
    delayedElement: { target: "add-to-cart", delayMs: createRng(ctx.seed).jitter(1_800, 0.3) },
  }),
})

export const localeVariant = define({
  id: "locale_variant",
  name: "German locale",
  description: "The storefront renders in German. The task and its evaluation are unchanged.",
  category: "locale",
  fixtureConfig: () => ({ locale: "de-DE" }),
  browserOptions: () => ({ locale: "de-DE" }),
})

export const PERTURBATIONS: readonly Perturbation[] = [
  baseline,
  cookiePopup,
  unexpectedModal,
  slowApi,
  networkDelay,
  mobileViewport,
  renamedCta,
  expiredSession,
  reorderedLayout,
  delayedElement,
  localeVariant,
]

const BY_ID = new Map(PERTURBATIONS.map((p) => [p.id, p]))

export function getPerturbation(id: string): Perturbation | undefined {
  return BY_ID.get(id)
}

export function requirePerturbation(id: string): Perturbation {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`unknown perturbation "${id}"`)
  return found
}

/** The variant set the demo suite runs, in the order the dashboard shows them. */
export const DEFAULT_VARIANTS: readonly string[] = [
  "baseline",
  "cookie_popup",
  "slow_api",
  "unexpected_modal",
  "mobile_viewport",
  "renamed_cta",
  "expired_session",
  "network_delay",
]
