import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { fixtureBasePath } from "./render.js"
import { findProduct } from "./catalog.js"
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
} from "./state.js"
import {
  cartPage,
  checkoutPage,
  expiredPage,
  notFoundPage,
  orderPage,
  productPage,
  reviewPage,
  storePage,
} from "./render.js"
import type { FixtureConfig, RunState } from "./types.js"

const MAX_BODY_BYTES = 64 * 1024

export interface FixtureServerOptions {
  port?: number
  host?: string
  store?: FixtureStore
}

export interface FixtureServerHandle {
  server: Server
  store: FixtureStore
  port: number
  url: string
  close(): Promise<void>
}

export function createFixtureApp(store: FixtureStore = new FixtureStore()) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await route(store, req, res)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send(res, 500, "application/json", JSON.stringify({ error: "internal", message }))
    }
  }
}

export async function startFixtureServer(
  options: FixtureServerOptions = {},
): Promise<FixtureServerHandle> {
  const store = options.store ?? new FixtureStore()
  const server = createServer(createFixtureApp(store))
  const host = options.host ?? "0.0.0.0"

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === "object" && address ? address.port : (options.port ?? 0)

  return {
    server,
    store,
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

// ── routing ──────────────────────────────────────────────────────────────────

async function route(
  store: FixtureStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://fixture.local")
  const path = url.pathname
  const method = (req.method ?? "GET").toUpperCase()

  if (path.startsWith("/__gauntlet/")) {
    return controlRoute(store, req, res, url, path, method)
  }

  const runId = url.searchParams.get("run")
  if (!runId) {
    // A human poking at the fixture without a run id gets a usable session
    // rather than an error, which makes the sandbox URL debuggable by hand.
    return redirect(res, `${path}?run=manual-${Date.now().toString(36)}`)
  }

  const state = store.getOrCreate(runId)

  // slow_api: the delay is applied server-side to state-changing requests, so
  // the page still works, just late. An agent that does not wait fails; one
  // that does, does not.
  if (method === "POST" && state.config.apiLatencyMs) {
    await sleep(state.config.apiLatencyMs)
  }

  // Once the session has expired, every page becomes the recovery page until
  // the agent resumes. The cart survives — this tests recovery, not amnesia.
  if (state.sessionExpired && path !== "/session/resume") {
    return sendHtml(res, 200, expiredPage(state))
  }

  if (method === "GET") return getRoute(state, res, path, url)
  if (method === "POST") return postRoute(state, req, res, path, url)
  return send(res, 405, "text/plain", "method not allowed")
}

function getRoute(state: RunState, res: ServerResponse, path: string, url: URL): void {
  if (path === "/" || path === "/index.html") return sendHtml(res, 200, storePage(state))

  if (path.startsWith("/product/")) {
    const product = findProduct(path.slice("/product/".length))
    return product
      ? sendHtml(res, 200, productPage(state, product))
      : sendHtml(res, 404, notFoundPage(state))
  }

  if (path === "/cart") {
    return sendHtml(
      res,
      200,
      cartPage(state, { couponError: url.searchParams.get("coupon") === "invalid" }),
    )
  }

  if (path === "/cart/remove") {
    const sku = url.searchParams.get("sku")
    if (sku) removeFromCart(state, sku)
    return redirect(res, withRun("/cart", state.runId))
  }

  if (path === "/checkout") return sendHtml(res, 200, checkoutPage(state))
  if (path === "/review") return sendHtml(res, 200, reviewPage(state))
  if (path === "/order") return sendHtml(res, 200, orderPage(state))
  if (path === "/favicon.ico") return send(res, 204, "image/x-icon", "")

  return sendHtml(res, 404, notFoundPage(state))
}

async function postRoute(
  state: RunState,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
): Promise<void> {
  const form = parseForm(await readBody(req))

  if (path === "/cart/add") {
    const sku = form.get("sku") ?? url.searchParams.get("sku")
    if (sku) addToCart(state, sku)
    maybeExpireSession(state, "cart")
    return redirect(res, withRun("/cart", state.runId))
  }

  if (path === "/cart/coupon") {
    const result = applyCoupon(state, form.get("code") ?? "")
    return redirect(res, withRun(result.ok ? "/cart" : "/cart?coupon=invalid", state.runId))
  }

  if (path === "/checkout") {
    setStage(state, "checkout")
    maybeExpireSession(state, "checkout")
    return redirect(res, withRun("/checkout", state.runId))
  }

  if (path === "/review") {
    setCheckoutDetails(state, { name: form.get("name") ?? "", city: form.get("city") ?? "" })
    setStage(state, "review")
    return redirect(res, withRun("/review", state.runId))
  }

  if (path === "/order") {
    submitPurchase(state)
    return redirect(res, withRun("/order", state.runId))
  }

  if (path === "/session/resume") {
    resumeSession(state)
    const back = state.stage === "browse" ? "/" : `/${state.stage}`
    return redirect(res, withRun(back, state.runId))
  }

  return sendHtml(res, 404, notFoundPage(state))
}

// ── control plane ────────────────────────────────────────────────────────────

async function controlRoute(
  store: FixtureStore,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  method: string,
): Promise<void> {
  if (path === "/__gauntlet/health") {
    return json(res, 200, {
      ok: true,
      runs: store.size(),
      uptimeMs: Math.round(process.uptime() * 1000),
    })
  }

  if (path === "/__gauntlet/session" && method === "POST") {
    const body = safeJson(await readBody(req)) as {
      runId?: string
      variant?: string
      seed?: number
      config?: FixtureConfig
    } | null
    if (!body?.runId) return json(res, 400, { error: "runId is required" })
    const state = store.register(
      body.runId,
      body.variant ?? "baseline",
      body.seed ?? 0,
      body.config ?? {},
    )
    return json(res, 201, { ok: true, runId: state.runId, variant: state.variant })
  }

  if (path === "/__gauntlet/session" && method === "DELETE") {
    const runId = url.searchParams.get("run")
    return json(res, 200, { ok: runId ? store.delete(runId) : false })
  }

  /**
   * The evaluator's endpoint. Read by the worker directly, never by the agent's
   * browser: the verdict must come from state the agent could only change by
   * genuinely performing the task.
   */
  if (path === "/__gauntlet/state" && method === "GET") {
    const runId = url.searchParams.get("run")
    if (!runId) return json(res, 400, { error: "run is required" })
    const state = store.get(runId)
    if (!state) return json(res, 404, { error: "unknown run" })
    return json(res, 200, publicState(state))
  }

  return json(res, 404, { error: "unknown control endpoint" })
}

// ── helpers ──────────────────────────────────────────────────────────────────

function withRun(path: string, runId: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}run=${encodeURIComponent(runId)}`
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  })
  res.end(body)
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  send(res, status, "text/html; charset=utf-8", html)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value))
}

/** 303 so the browser re-issues a GET; prevents a resubmit on reload. */
function redirect(res: ServerResponse, location: string): void {
  // Prefixed for the same reason links are: mounted under a base path, a bare
  // "/cart" Location sends the browser out of the store and into whatever else
  // is serving that origin. An external agent got as far as adding the product
  // and then looked for the coupon field on somebody else's 404 page.
  res.writeHead(303, { location: `${fixtureBasePath()}${location}`, "cache-control": "no-store" })
  res.end()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function parseForm(body: string): URLSearchParams {
  return new URLSearchParams(body)
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
