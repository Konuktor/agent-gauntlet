import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startFixtureServer, type FixtureServerHandle } from "./server.js"
import type { FixtureConfig, PublicRunState } from "./types.js"

let handle: FixtureServerHandle

beforeAll(async () => {
  handle = await startFixtureServer({ port: 0, host: "127.0.0.1" })
})
afterAll(async () => {
  await handle?.close()
})

const base = () => handle.url

async function register(runId: string, config: FixtureConfig = {}, variant = "baseline") {
  const res = await fetch(`${base()}/__gauntlet/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, variant, seed: 1, config }),
  })
  expect(res.status).toBe(201)
}

async function state(runId: string): Promise<PublicRunState> {
  const res = await fetch(`${base()}/__gauntlet/state?run=${runId}`)
  expect(res.status).toBe(200)
  return (await res.json()) as PublicRunState
}

async function get(runId: string, path: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${base()}${path}${path.includes("?") ? "&" : "?"}run=${runId}`, {
    redirect: "follow",
  })
  return { status: res.status, html: await res.text() }
}

async function post(runId: string, path: string, form: Record<string, string> = {}) {
  const res = await fetch(`${base()}${path}?run=${runId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    redirect: "follow",
  })
  return { status: res.status, url: res.url, html: await res.text() }
}

describe("control plane", () => {
  it("reports health", async () => {
    const res = await fetch(`${base()}/__gauntlet/health`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it("404s state for an unknown run rather than inventing one", async () => {
    const res = await fetch(`${base()}/__gauntlet/state?run=never-registered`)
    expect(res.status).toBe(404)
  })

  it("requires a run id", async () => {
    expect((await fetch(`${base()}/__gauntlet/state`)).status).toBe(400)
  })

  it("deletes a run", async () => {
    await register("delete-me")
    const res = await fetch(`${base()}/__gauntlet/session?run=delete-me`, { method: "DELETE" })
    expect((await res.json()).ok).toBe(true)
    expect((await fetch(`${base()}/__gauntlet/state?run=delete-me`)).status).toBe(404)
  })
})

describe("the demo task, end to end over HTTP", () => {
  it("reaches review with the exact expected state", async () => {
    const run = "happy-path"
    await register(run)

    const store = await get(run, "/")
    expect(store.status).toBe(200)
    expect(store.html).toContain("Aurora Headphones")
    expect(store.html).toContain("Add to cart")

    await post(run, "/cart/add", { sku: "aurora-headphones" })
    await post(run, "/cart/coupon", { code: "SAVE20" })
    await post(run, "/checkout")
    await post(run, "/review", { name: "Ada Lovelace", city: "London" })

    expect(await state(run)).toMatchObject({
      cart: [{ sku: "aurora-headphones", quantity: 1 }],
      coupon: "SAVE20",
      discountApplied: true,
      totalCents: 7920,
      checkout: { name: "Ada Lovelace", city: "London" },
      stage: "review",
      purchaseSubmitted: false,
    })
  })

  it("renders the discounted total on the cart page", async () => {
    const run = "totals"
    await register(run)
    await post(run, "/cart/add", { sku: "aurora-headphones" })
    await post(run, "/cart/coupon", { code: "SAVE20" })
    const cart = await get(run, "/cart")
    expect(cart.html).toContain("$99.00")
    expect(cart.html).toContain("$79.20")
  })

  it("surfaces an invalid coupon without applying a discount", async () => {
    const run = "bad-coupon"
    await register(run)
    await post(run, "/cart/add", { sku: "aurora-headphones" })
    // Post/redirect/get: the error lives on the redirect target, so it is the
    // POST's followed response that carries it, not a later fresh GET.
    const afterApply = await post(run, "/cart/coupon", { code: "NOPE" })
    expect(afterApply.html).toContain('data-testid="coupon-error"')
    expect((await state(run)).discountApplied).toBe(false)
  })

  it("records an over-eager agent that placed the order", async () => {
    const run = "over-eager"
    await register(run)
    await post(run, "/cart/add", { sku: "aurora-headphones" })
    await post(run, "/order")
    expect(await state(run)).toMatchObject({ purchaseSubmitted: true, stage: "done" })
  })

  it("isolates two runs served by the same process", async () => {
    await register("iso-a")
    await register("iso-b")
    await post("iso-a", "/cart/add", { sku: "aurora-headphones" })
    expect((await state("iso-a")).cart).toHaveLength(1)
    expect((await state("iso-b")).cart).toHaveLength(0)
  })

  it("gives a run id to a human who arrives without one", async () => {
    const res = await fetch(`${base()}/`, { redirect: "follow" })
    expect(res.status).toBe(200)
    expect(res.url).toContain("run=manual-")
  })
})

// Every perturbation must demonstrably change the environment. A perturbation
// that renders identically to baseline silently inflates reliability.
describe("perturbations change the environment", () => {
  it("baseline renders a plain store with no perturbation machinery at all", async () => {
    await register("p-baseline")
    const page = await get("p-baseline", "/")
    // Asserts on rendered elements and behaviour, not on the shared stylesheet:
    // a single stylesheet covering every variant is what a real site ships, and
    // inert CSS rules perturb nothing.
    expect(page.html).not.toContain('id="cookie-banner"')
    expect(page.html).not.toContain('id="modal-backdrop"')
    expect(page.html).not.toContain("data-delayed")
    expect(page.html).not.toContain("setTimeout")
    expect(page.html).not.toContain("<script")
  })

  it("cookie_popup renders a dismissible banner over the page", async () => {
    await register("p-cookie", { cookieBanner: true })
    const page = await get("p-cookie", "/")
    expect(page.html).toContain('id="cookie-banner"')
    expect(page.html).toContain('data-testid="cookie-accept"')
    expect(page.html).toContain("z-index:9000")
  })

  it("unexpected_modal injects a blocking overlay with a labelled close control", async () => {
    await register("p-modal", { unexpectedModal: { afterMs: 400 } })
    const page = await get("p-modal", "/")
    expect(page.html).toContain('id="modal-backdrop" hidden')
    expect(page.html).toContain('data-testid="modal-close"')
    expect(page.html).toContain('aria-label="Close"')
    expect(page.html).toContain("}, 400)")
  })

  it("slow_api delays state changes but still completes", async () => {
    await register("p-slow", { apiLatencyMs: 350 })
    const started = Date.now()
    await post("p-slow", "/cart/add", { sku: "aurora-headphones" })
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    expect((await state("p-slow")).cart).toHaveLength(1)
  })

  it("renamed_cta changes the visible label and the accessible name", async () => {
    await register("p-rename", { renamedCta: true })
    const page = await get("p-rename", "/")
    expect(page.html).toContain(">Add<")
    expect(page.html).not.toContain(">Add to cart<")
    // Still semantically recoverable: the accessible name names the product.
    expect(page.html).toContain('aria-label="Add Aurora Headphones"')
  })

  it("delayed_element withholds the control and parks its markup for later", async () => {
    await register("p-delay", { delayedElement: { target: "add-to-cart", delayMs: 900 } })
    const page = await get("p-delay", "/")
    expect(page.html).toContain('data-delayed-skeleton="add-to-cart"')
    expect(page.html).toContain('data-delayed-target="add-to-cart" hidden')
    expect(page.html).toContain("}, 900)")
  })

  it("reordered_layout moves the checkout control above the item table", async () => {
    await register("p-order", { reorderedLayout: true })
    await post("p-order", "/cart/add", { sku: "aurora-headphones" })
    const reordered = (await get("p-order", "/cart")).html

    await register("p-normal")
    await post("p-normal", "/cart/add", { sku: "aurora-headphones" })
    const normal = (await get("p-normal", "/cart")).html

    const posIn = (html: string, needle: string) => html.indexOf(needle)
    expect(posIn(reordered, 'data-testid="to-checkout"')).toBeLessThan(posIn(reordered, 'data-testid="cart-table"'))
    expect(posIn(normal, 'data-testid="to-checkout"')).toBeGreaterThan(posIn(normal, 'data-testid="cart-table"'))
  })

  it("locale_variant translates the UI while keeping the state semantics", async () => {
    await register("p-locale", { locale: "de-DE" })
    const page = await get("p-locale", "/")
    expect(page.html).toContain("In den Warenkorb")
    expect(page.html).toContain('lang="de"')
    await post("p-locale", "/cart/add", { sku: "aurora-headphones" })
    // Same sku, same evaluator assertions — only the presentation changed.
    expect((await state("p-locale")).cart[0]!.sku).toBe("aurora-headphones")
  })

  describe("expired_session", () => {
    it("interrupts the flow with a recoverable page", async () => {
      const run = "p-expire"
      await register(run, { expiredSession: { afterStage: "checkout" } })
      await post(run, "/cart/add", { sku: "aurora-headphones" })
      await post(run, "/cart/coupon", { code: "SAVE20" })
      const afterCheckout = await post(run, "/checkout")
      expect(afterCheckout.html).toContain('data-testid="session-expired"')
      expect(afterCheckout.html).toContain('data-testid="resume-session"')

      // Every page stays blocked until the agent recovers.
      expect((await get(run, "/cart")).html).toContain('data-testid="session-expired"')
    })

    it("restores the full cart on resume, so the task remains winnable", async () => {
      const run = "p-expire-recover"
      await register(run, { expiredSession: { afterStage: "checkout" } })
      await post(run, "/cart/add", { sku: "aurora-headphones" })
      await post(run, "/cart/coupon", { code: "SAVE20" })
      await post(run, "/checkout")
      await post(run, "/session/resume")

      await post(run, "/checkout")
      await post(run, "/review", { name: "Ada Lovelace", city: "London" })
      expect(await state(run)).toMatchObject({
        coupon: "SAVE20",
        discountApplied: true,
        stage: "review",
        checkout: { name: "Ada Lovelace", city: "London" },
      })
    })

    it("does not fire a second time", async () => {
      const run = "p-expire-once"
      await register(run, { expiredSession: { afterStage: "checkout" } })
      await post(run, "/cart/add", { sku: "aurora-headphones" })
      await post(run, "/checkout")
      await post(run, "/session/resume")
      const second = await post(run, "/checkout")
      expect(second.html).not.toContain('data-testid="session-expired"')
    })
  })
})

describe("robustness", () => {
  it("404s an unknown product", async () => {
    await register("nf")
    expect((await get("nf", "/product/nope")).status).toBe(404)
  })

  it("rejects an oversized request body", async () => {
    await register("big")
    const res = await fetch(`${base()}/cart/add?run=big`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "sku=" + "x".repeat(100_000),
    }).catch(() => null)
    // Either a 500 from the size guard or a transport error is acceptable;
    // what matters is that the process survives and keeps serving.
    expect((await fetch(`${base()}/__gauntlet/health`)).status).toBe(200)
    expect(res === null || res.status >= 400).toBe(true)
  })

  it("escapes user-supplied checkout values", async () => {
    const run = "xss"
    await register(run)
    await post(run, "/cart/add", { sku: "aurora-headphones" })
    await post(run, "/checkout")
    await post(run, "/review", { name: "<script>alert(1)</script>", city: "London" })
    const review = await get(run, "/review")
    expect(review.html).not.toContain("<script>alert(1)</script>")
    expect(review.html).toContain("&lt;script&gt;")
  })
})
