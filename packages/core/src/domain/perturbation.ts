export const perturbationCategories = [
  "none",
  "ui",
  "network",
  "state",
  "viewport",
  "locale",
  "environment",
] as const
export type PerturbationCategory = (typeof perturbationCategories)[number]

export const CATEGORY_LABELS: Record<PerturbationCategory, string> = {
  none: "Baseline",
  ui: "UI",
  network: "Network",
  state: "State",
  viewport: "Viewport",
  locale: "Locale",
  environment: "Environment",
}

/** Knobs the fixture reads to change the environment it renders for one run. */
export interface FixturePerturbationConfig {
  cookieBanner?: boolean
  unexpectedModal?: { afterMs: number }
  apiLatencyMs?: number
  renamedCta?: boolean
  expiredSession?: { afterStage: "cart" | "checkout" }
  reorderedLayout?: boolean
  delayedElement?: { target: "add-to-cart" | "checkout"; delayMs: number }
  locale?: "en-US" | "de-DE"
}

/** Knobs applied to the browser rather than the site. */
export interface BrowserPerturbationOptions {
  viewport?: { width: number; height: number }
  isMobile?: boolean
  hasTouch?: boolean
  deviceScaleFactor?: number
  userAgent?: string
  locale?: string
  /** Deterministic per-request delay applied via request interception. */
  networkDelay?: { matches: string[]; delayMs: number }
}

export interface PerturbationContext {
  suiteRunId: string
  individualRunId: string
  variant: string
  repetition: number
  seed: number
}

export interface Perturbation {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: PerturbationCategory
  /** How the fixture should render for this run. */
  fixtureConfig(ctx: PerturbationContext): FixturePerturbationConfig
  /** How the browser context should be built for this run. */
  browserOptions(ctx: PerturbationContext): BrowserPerturbationOptions
}
