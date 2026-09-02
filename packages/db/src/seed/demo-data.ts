import { createRng, deriveSeed } from "@gauntlet/core"

/**
 * The seeded demo dataset.
 *
 * Every reliability figure below was MEASURED, by running the three built-in
 * reference-agent configurations against the real Gauntlet Shop in a real
 * Chromium — `pnpm demo` reproduces it. What is synthesised here is only the
 * texture around those outcomes: durations, step counts, console lines and
 * action traces, generated from a fixed seed so the dashboard has something
 * substantial to render before anyone has spent a single Solari credit.
 *
 * It is stored with `mode: "demo"` and the UI labels it DEMO DATA everywhere it
 * appears. It is never presented as a live Solari run, because it is not one.
 */

export interface DemoVariantOutcome {
  variant: string
  variantName: string
  category: string
  /** Per repetition, in order. */
  results: Array<"pass" | "fail">
  failureCategory?: string
  failureMessage?: string
}

/** Measured: the Reference Agent (overlay handling, patient retries). */
export const REFERENCE_OUTCOMES: DemoVariantOutcome[] = [
  { variant: "baseline", variantName: "Baseline", category: "none", results: ["pass", "pass"] },
  {
    variant: "cookie_popup",
    variantName: "Cookie popup",
    category: "ui",
    results: ["pass", "pass"],
  },
  { variant: "slow_api", variantName: "Slow API", category: "network", results: ["pass", "pass"] },
  {
    variant: "unexpected_modal",
    variantName: "Unexpected modal",
    category: "ui",
    results: ["pass", "pass"],
  },
  {
    variant: "mobile_viewport",
    variantName: "Mobile viewport",
    category: "viewport",
    results: ["pass", "pass"],
  },
  { variant: "renamed_cta", variantName: "Renamed CTA", category: "ui", results: ["pass", "pass"] },
  {
    variant: "expired_session",
    variantName: "Expired session",
    category: "state",
    results: ["fail", "fail"],
    failureCategory: "auth",
    failureMessage: "The shopping session expired mid-task and the agent did not re-establish it.",
  },
  {
    variant: "network_delay",
    variantName: "Network delay",
    category: "network",
    results: ["pass", "pass"],
  },
]

/** Measured: the same suite after overlay handling regressed out of the agent. */
export const REGRESSED_OUTCOMES: DemoVariantOutcome[] = REFERENCE_OUTCOMES.map((v) =>
  v.variant === "unexpected_modal"
    ? {
        ...v,
        results: ["fail", "fail"] as Array<"pass" | "fail">,
        failureCategory: "unexpected_ui",
        failureMessage:
          "An overlay covered the page and 3 clicks never reached the intended element.",
      }
    : v,
)

export interface DemoRun {
  variant: string
  variantName: string
  category: string
  repetition: number
  seed: number
  status: "passed" | "failed"
  durationMs: number
  steps: number
  failureCategory: string | null
  failureMessage: string | null
  sessionId: string
  events: Array<{ type: string; payload: Record<string, unknown>; offsetMs: number }>
  evaluation: {
    success: boolean
    score: number
    assertions: Array<{
      name: string
      description: string
      expected: unknown
      actual: unknown
      passed: boolean
      weight: number
    }>
    evidence: Record<string, unknown>
  }
}

const ACTION_SCRIPT = [
  { type: "click", label: "Add to cart: Aurora Headphones" },
  { type: "type", label: "Coupon code", text: "SAVE20" },
  { type: "click", label: "Apply coupon" },
  { type: "click", label: "Proceed to checkout" },
  { type: "type", label: "Full name", text: "Ada Lovelace" },
  { type: "type", label: "City", text: "London" },
  { type: "click", label: "Continue to review" },
]

export function buildDemoRuns(suiteRunId: string, outcomes: DemoVariantOutcome[]): DemoRun[] {
  const runs: DemoRun[] = []

  for (const variant of outcomes) {
    variant.results.forEach((result, index) => {
      const repetition = index + 1
      const seed = deriveSeed(suiteRunId, variant.variant, repetition)
      const rng = createRng(seed)
      const passed = result === "pass"

      // Perturbed variants legitimately take longer: an agent that waits out a
      // late control or dismisses a banner has spent real time doing it.
      const baseMs = variant.variant === "baseline" ? 9_500 : 14_000
      const durationMs = rng.jitter(passed ? baseMs : baseMs * 1.9, 0.18)
      const events = buildEvents(variant, passed, rng)
      // Derived from the trace, not invented alongside it: a run that shows
      // four actions must not also claim nineteen steps.
      const steps = events.filter((e) => e.type === "agent_action").length

      runs.push({
        variant: variant.variant,
        variantName: variant.variantName,
        category: variant.category,
        repetition,
        seed,
        status: passed ? "passed" : "failed",
        durationMs,
        steps,
        failureCategory: passed ? null : (variant.failureCategory ?? "unknown"),
        failureMessage: passed ? null : (variant.failureMessage ?? null),
        sessionId: `demo-${variant.variant}-${repetition}`,
        events,
        evaluation: buildEvaluation(variant, passed),
      })
    })
  }

  return runs
}

function buildEvents(
  variant: DemoVariantOutcome,
  passed: boolean,
  rng: ReturnType<typeof createRng>,
): DemoRun["events"] {
  const events: DemoRun["events"] = []
  let offset = 0
  const at = (ms: number) => (offset += ms)

  events.push({ type: "lifecycle", payload: { phase: "run_queued" }, offsetMs: at(0) })
  events.push({ type: "lifecycle", payload: { phase: "environment_preparing" }, offsetMs: at(120) })
  events.push({
    type: "lifecycle",
    payload: { phase: "fixture_ready", baseUrl: "https://demo.preview.getsolari.com" },
    offsetMs: at(rng.int(400, 900)),
  })
  events.push({
    type: "lifecycle",
    payload: { phase: "session_created", mode: "demo" },
    offsetMs: at(rng.int(600, 1_400)),
  })
  events.push({ type: "navigation", payload: { url: "/?run=demo" }, offsetMs: at(300) })
  events.push({ type: "lifecycle", payload: { phase: "agent_started" }, offsetMs: at(50) })

  if (variant.variant === "cookie_popup" || variant.variant === "unexpected_modal") {
    events.push({
      type: "agent_action",
      payload: {
        step: 1,
        action: { type: "click", text: "e9", reason: "dismiss the overlay" },
        ok: true,
        detail: 'clicked button "Accept all"',
      },
      offsetMs: at(rng.int(400, 900)),
    })
  }

  for (let i = 0; i < ACTION_SCRIPT.length; i++) {
    const action = ACTION_SCRIPT[i]!
    // A failing run stalls on the step where the perturbation bites.
    const failsHere = !passed && i === failurePoint(variant)
    events.push({
      type: "agent_action",
      payload: {
        step: events.filter((e) => e.type === "agent_action").length + 1,
        action:
          action.type === "click"
            ? { type: "click", text: action.label }
            : { type: "type", label: action.label, text: action.text },
        ok: !failsHere,
        detail: failsHere
          ? `no element matching "${action.label}"`
          : `${action.type === "click" ? "clicked" : "typed into"} "${action.label}"`,
      },
      offsetMs: at(rng.int(500, 1_600)),
    })
    if (failsHere) break
  }

  if (!passed) {
    if (variant.variant === "expired_session") {
      events.push({
        type: "navigation",
        payload: { url: "/session/expired?run=demo" },
        offsetMs: at(400),
      })
      events.push({
        type: "console",
        payload: { level: "warning", text: "Session token rejected (401); redirecting" },
        offsetMs: at(60),
      })
    } else {
      events.push({
        type: "console",
        payload: { level: "error", text: "Uncaught (in promise) intercepted pointer event" },
        offsetMs: at(80),
      })
    }
  }

  events.push({
    type: "lifecycle",
    payload: {
      phase: "agent_finished",
      finishReason: passed ? "finished" : "max_steps",
      steps: events.filter((e) => e.type === "agent_action").length,
    },
    offsetMs: at(200),
  })
  events.push({ type: "lifecycle", payload: { phase: "evaluation_started" }, offsetMs: at(120) })
  events.push({
    type: "evaluator",
    payload: { success: passed, score: passed ? 1 : 0.5 },
    offsetMs: at(rng.int(150, 400)),
  })
  events.push({
    type: "lifecycle",
    payload: { phase: "evaluation_finished", success: passed },
    offsetMs: at(20),
  })
  events.push({ type: "lifecycle", payload: { phase: "browser_released" }, offsetMs: at(300) })
  events.push({ type: "lifecycle", payload: { phase: "cleanup_complete" }, offsetMs: at(40) })

  return events
}

function failurePoint(variant: DemoVariantOutcome): number {
  if (variant.variant === "expired_session") return 3 // stalls going to checkout
  if (variant.variant === "unexpected_modal") return 0 // the very first click is swallowed
  return 2
}

function buildEvaluation(variant: DemoVariantOutcome, passed: boolean): DemoRun["evaluation"] {
  const expected = {
    productSku: "aurora-headphones",
    quantity: 1,
    coupon: "SAVE20",
    discountApplied: true,
    checkoutName: "Ada Lovelace",
    checkoutCity: "London",
    stage: "review",
    purchaseSubmitted: false,
  }

  // A failing run's observed state stops where the agent stopped, which is what
  // makes the evidence table worth reading.
  const observed = passed
    ? {
        cart: [{ sku: "aurora-headphones", quantity: 1, unitPriceCents: 9900 }],
        coupon: "SAVE20",
        discountApplied: true,
        subtotalCents: 9900,
        discountCents: 1980,
        totalCents: 7920,
        checkout: { name: "Ada Lovelace", city: "London" },
        stage: "review",
        purchaseSubmitted: false,
        sessionExpired: false,
      }
    : variant.variant === "expired_session"
      ? {
          cart: [{ sku: "aurora-headphones", quantity: 1, unitPriceCents: 9900 }],
          coupon: "SAVE20",
          discountApplied: true,
          subtotalCents: 9900,
          discountCents: 1980,
          totalCents: 7920,
          checkout: { name: null, city: null },
          stage: "cart",
          purchaseSubmitted: false,
          sessionExpired: true,
        }
      : {
          cart: [],
          coupon: null,
          discountApplied: false,
          subtotalCents: 0,
          discountCents: 0,
          totalCents: 0,
          checkout: { name: null, city: null },
          stage: "browse",
          purchaseSubmitted: false,
          sessionExpired: false,
        }

  const line = observed.cart[0]
  const assertions = [
    a("product_in_cart", "aurora-headphones is in the cart", true, Boolean(line)),
    a("quantity", "cart holds 1 of aurora-headphones", 1, line?.quantity ?? 0),
    a("coupon_applied", "coupon SAVE20 is applied", "SAVE20", observed.coupon),
    a("discount_applied", "the discount is reflected in the total", true, observed.discountApplied),
    a("checkout_name", 'checkout name is "Ada Lovelace"', "Ada Lovelace", observed.checkout.name),
    a("checkout_city", 'checkout city is "London"', "London", observed.checkout.city),
    a("reached_stage", 'the flow reached the "review" stage', "review", observed.stage),
    a("purchase_not_submitted", "the order was NOT placed", false, observed.purchaseSubmitted, 3),
  ]

  const totalWeight = assertions.reduce((s, x) => s + x.weight, 0)
  const earned = assertions.reduce((s, x) => s + (x.passed ? x.weight : 0), 0)

  return {
    success: assertions.every((x) => x.passed),
    score: Number((earned / totalWeight).toFixed(4)),
    assertions,
    evidence: {
      expected,
      observed,
      agentClaim: {
        finishReason: passed ? "finished" : "max_steps",
        message: passed
          ? "stop before the final action, as instructed"
          : "Used all steps without reporting completion.",
      },
    },
  }
}

function a(
  name: string,
  description: string,
  expected: unknown,
  actual: unknown,
  weight = 1,
): DemoRun["evaluation"]["assertions"][number] {
  return {
    name,
    description,
    expected,
    actual,
    passed: JSON.stringify(expected) === JSON.stringify(actual),
    weight,
  }
}
