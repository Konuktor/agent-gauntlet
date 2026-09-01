import { CATALOG, formatPrice, type Product } from "./catalog.js"
import { labelsFor, type Labels } from "./labels.js"
import { totals } from "./state.js"
import type { RunState } from "./types.js"

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function href(state: RunState, path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}run=${encodeURIComponent(state.runId)}`
}

const STYLES = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#16181d;background:#f6f7f9}
a{color:#1f5fd6}
header.site{background:#fff;border-bottom:1px solid #e3e6ea}
.bar{max-width:960px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:16px}
.brand{font-weight:700;font-size:18px;letter-spacing:-.01em;text-decoration:none;color:#16181d}
.brand span{display:block;font-weight:400;font-size:12px;color:#6b7280}
.spacer{flex:1}
main{max-width:960px;margin:0 auto;padding:28px 20px 120px}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}
h2{font-size:18px;margin:0 0 12px}
.muted{color:#6b7280}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-top:20px}
.card{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px}
.thumb{height:110px;border-radius:8px}
.name{font-weight:600}
.price{font-variant-numeric:tabular-nums;font-weight:600}
button,.btn{font:inherit;border-radius:8px;border:1px solid transparent;padding:9px 14px;cursor:pointer;text-decoration:none;display:inline-block;text-align:center}
.primary{background:#1f5fd6;color:#fff}
.primary:hover{background:#1a51b8}
.secondary{background:#fff;border-color:#ccd2da;color:#16181d}
.link{background:none;border:none;color:#1f5fd6;padding:0;text-decoration:underline}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e6ea;border-radius:10px;overflow:hidden}
th,td{padding:12px 14px;text-align:left;border-bottom:1px solid #eef0f3}
tfoot td{border-bottom:none}
.num{text-align:right;font-variant-numeric:tabular-nums}
.panel{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:18px;margin-top:18px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input[type=text]{width:100%;padding:9px 11px;border:1px solid #ccd2da;border-radius:8px;font:inherit;background:#fff}
.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.row > div{flex:1;min-width:180px}
.error{color:#b42318;font-size:14px;margin-top:8px}
.ok{color:#067647;font-size:14px;margin-top:8px}
.steps{display:flex;gap:8px;font-size:13px;color:#6b7280;margin-bottom:18px}
.steps b{color:#16181d}
.skeleton{height:38px;border-radius:8px;background:linear-gradient(90deg,#eef0f3,#e3e6ea,#eef0f3);animation:pulse 1.2s infinite}
@keyframes pulse{0%{opacity:.7}50%{opacity:1}100%{opacity:.7}}
/* Cookie consent bar: fixed, tall enough to genuinely obstruct the primary
   call to action lower on the page. It is dismissible — the point is to test
   recovery, not to make the task impossible. */
#cookie-banner{position:fixed;left:0;right:0;bottom:0;z-index:9000;background:#111418;color:#f4f5f7;padding:22px 20px;box-shadow:0 -8px 30px rgba(0,0,0,.25)}
#cookie-banner .inner{max-width:960px;margin:0 auto;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
#cookie-banner p{margin:0;flex:1;min-width:240px;font-size:14px}
#cookie-banner strong{display:block;margin-bottom:2px}
/* Interstitial modal with a full-viewport backdrop that swallows clicks. */
#modal-backdrop{position:fixed;inset:0;z-index:9500;background:rgba(11,13,16,.55);display:flex;align-items:center;justify-content:center;padding:20px}
#modal{background:#fff;border-radius:12px;max-width:420px;width:100%;padding:24px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3)}
#modal-close{position:absolute;top:10px;right:10px;background:none;border:none;font-size:22px;line-height:1;cursor:pointer;color:#6b7280;padding:6px 10px}
.expired{max-width:460px;margin:60px auto;text-align:center}
@media (max-width:620px){
  .bar,main{padding-left:14px;padding-right:14px}
  .grid{grid-template-columns:1fr 1fr;gap:12px}
  th,td{padding:10px}
}
`

interface LayoutOptions {
  state: RunState
  labels: Labels
  title: string
  body: string
  /** Suppresses the shell chrome (used by the expired-session page). */
  bare?: boolean
}

export function layout({ state, labels, title, body, bare }: LayoutOptions): string {
  const cfg = state.config
  const count = state.cart.reduce((n, l) => n + l.quantity, 0)

  const cookieBanner = cfg.cookieBanner
    ? `<div id="cookie-banner" role="region" aria-label="${escapeHtml(labels.cookieTitle)}">
        <div class="inner">
          <p><strong>${escapeHtml(labels.cookieTitle)}</strong>${escapeHtml(labels.cookieBody)}</p>
          <button type="button" class="secondary" data-testid="cookie-reject" onclick="__dismissCookies()">${escapeHtml(labels.cookieReject)}</button>
          <button type="button" class="primary" data-testid="cookie-accept" onclick="__dismissCookies()">${escapeHtml(labels.cookieAccept)}</button>
        </div>
      </div>`
    : ""

  // The interstitial is rendered up front but hidden, and revealed a beat after
  // load. Building it this way (rather than injecting a serialised HTML string
  // from script) keeps the markup readable, escapable and directly assertable.
  const modal = cfg.unexpectedModal
    ? `<div id="modal-backdrop" hidden>
        <div id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button id="modal-close" type="button" aria-label="${escapeHtml(labels.modalClose)}" data-testid="modal-close" onclick="__closeModal()">&times;</button>
          <h2 id="modal-title">${escapeHtml(labels.modalTitle)}</h2>
          <p class="muted">${escapeHtml(labels.modalBody)}</p>
          <button type="button" class="secondary" data-testid="modal-dismiss" onclick="__closeModal()">${escapeHtml(labels.modalDismiss)}</button>
        </div>
      </div>
      <script>
        function __closeModal(){var b=document.getElementById('modal-backdrop');if(b)b.remove();}
        setTimeout(function(){
          var b = document.getElementById('modal-backdrop');
          if (b) b.hidden = false;
        }, ${cfg.unexpectedModal.afterMs});
      </script>`
    : ""

  const delayScript = cfg.delayedElement
    ? `<script>
        setTimeout(function () {
          // querySelectorAll, not querySelector: the store lists several
          // products and each one wraps its own delayed control. Revealing only
          // the first would leave every other product permanently unbuyable,
          // which is an impossible task rather than a hard one.
          document.querySelectorAll('[data-delayed-skeleton="${cfg.delayedElement.target}"]')
            .forEach(function (s) { s.remove(); });
          document.querySelectorAll('[data-delayed-target="${cfg.delayedElement.target}"]')
            .forEach(function (t) { t.hidden = false; });
        }, ${cfg.delayedElement.delayMs});
      </script>`
    : ""

  const chrome = bare
    ? ""
    : `<header class="site">
        <div class="bar">
          <a class="brand" href="${href(state, "/")}" data-testid="brand">${escapeHtml(labels.storeName)}<span>${escapeHtml(labels.tagline)}</span></a>
          <div class="spacer"></div>
          <a class="btn secondary" href="${href(state, "/cart")}" data-testid="nav-cart">${escapeHtml(labels.cart)} (${count})</a>
        </div>
      </header>`

  return `<!doctype html>
<html lang="${cfg.locale === "de-DE" ? "de" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(labels.storeName)}</title>
<meta name="gauntlet-run" content="${escapeHtml(state.runId)}">
<meta name="gauntlet-variant" content="${escapeHtml(state.variant)}">
<style>${STYLES}</style>
</head>
<body data-stage="${state.stage}">
${chrome}
<main>${body}</main>
${cookieBanner}
${cfg.cookieBanner ? `<script>function __dismissCookies(){var b=document.getElementById('cookie-banner');if(b)b.remove();}</script>` : ""}
${modal}
${delayScript}
</body>
</html>`
}

function thumb(product: Product): string {
  return `<div class="thumb" style="background:linear-gradient(135deg,hsl(${product.hue} 70% 62%),hsl(${(product.hue + 40) % 360} 70% 45%))" role="img" aria-label="${escapeHtml(product.name)}"></div>`
}

/**
 * Wraps a control so the delayed_element perturbation can hold it back. The
 * real markup is parked in a data attribute and injected by the timer, so the
 * element genuinely does not exist until then — an agent that assumes the page
 * is complete on load will miss it.
 */
function delayable(state: RunState, target: "add-to-cart" | "checkout", html: string, labels: Labels): string {
  if (state.config.delayedElement?.target !== target) return html
  // The control is present in the DOM but `hidden`, so it is invisible to a
  // snapshot until the timer fires — the same observable behaviour as a widget
  // that hydrates late, without the fragility of injecting escaped HTML.
  return `<div data-delayed-skeleton="${target}" class="skeleton" aria-label="${escapeHtml(labels.loading)}" role="status"></div>
    <div data-delayed-target="${target}" hidden>${html}</div>`
}

export function storePage(state: RunState): string {
  const labels = labelsFor(state.config.locale)
  const renamed = state.config.renamedCta

  const cards = CATALOG.map((product) => {
    // Under renamed_cta the visible label changes and the accessible name is
    // product-scoped rather than the canonical phrase. A brittle agent looking
    // for the literal string "Add to cart" fails; an agent that understands
    // "Add <product>" on a product card still succeeds (§31).
    const buttonLabel = renamed ? labels.addToCartShort : labels.addToCart
    const ariaLabel = renamed ? `${labels.addToCartShort} ${product.name}` : `${labels.addToCart}: ${product.name}`
    const button = `<form method="post" action="${href(state, "/cart/add")}">
        <input type="hidden" name="sku" value="${product.sku}">
        <button type="submit" class="primary" data-testid="add-${product.sku}" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(buttonLabel)}</button>
      </form>`

    return `<article class="card" data-sku="${product.sku}">
      ${thumb(product)}
      <div class="name">${escapeHtml(product.name)}</div>
      <div class="muted" style="font-size:13px">${escapeHtml(product.tagline)}</div>
      <div class="price">${formatPrice(product.priceCents, state.config.locale ?? "en-US")}</div>
      ${delayable(state, "add-to-cart", button, labels)}
      <a class="link" href="${href(state, `/product/${product.sku}`)}">${escapeHtml(labels.viewProduct)}</a>
    </article>`
  }).join("\n")

  return layout({
    state,
    labels,
    title: labels.storeName,
    body: `<h1>${escapeHtml(labels.storeName)}</h1>
      <p class="muted">${escapeHtml(labels.tagline)}</p>
      <div class="grid">${cards}</div>`,
  })
}

export function productPage(state: RunState, product: Product): string {
  const labels = labelsFor(state.config.locale)
  const renamed = state.config.renamedCta
  const button = `<form method="post" action="${href(state, "/cart/add")}">
      <input type="hidden" name="sku" value="${product.sku}">
      <button type="submit" class="primary" data-testid="add-${product.sku}" aria-label="${escapeHtml(renamed ? `${labels.addToCartShort} ${product.name}` : `${labels.addToCart}: ${product.name}`)}">${escapeHtml(renamed ? labels.addToCartShort : labels.addToCart)}</button>
    </form>`

  return layout({
    state,
    labels,
    title: product.name,
    body: `<a class="link" href="${href(state, "/")}">&larr; ${escapeHtml(labels.backToStore)}</a>
      <div class="panel" style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:220px">${thumb(product)}</div>
        <div style="flex:2;min-width:260px">
          <h1>${escapeHtml(product.name)}</h1>
          <p class="muted">${escapeHtml(product.tagline)}</p>
          <p class="price" style="font-size:22px">${formatPrice(product.priceCents, state.config.locale ?? "en-US")}</p>
          ${delayable(state, "add-to-cart", button, labels)}
        </div>
      </div>`,
  })
}

export function cartPage(state: RunState, options: { couponError?: boolean } = {}): string {
  const labels = labelsFor(state.config.locale)
  const locale = state.config.locale ?? "en-US"
  const { subtotalCents, discountCents, totalCents } = totals(state)
  const renamed = state.config.renamedCta

  const rows = state.cart
    .map(
      (line) => `<tr data-sku="${line.sku}">
        <td>${escapeHtml(line.name)}</td>
        <td class="num" data-testid="qty-${line.sku}">${line.quantity}</td>
        <td class="num">${formatPrice(line.unitPriceCents * line.quantity, locale)}</td>
        <td class="num"><a class="link" href="${href(state, `/cart/remove?sku=${line.sku}`)}">${escapeHtml(labels.removeItem)}</a></td>
      </tr>`,
    )
    .join("\n")

  const table = state.cart.length
    ? `<table data-testid="cart-table">
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="2">${escapeHtml(labels.subtotal)}</td><td class="num" data-testid="subtotal">${formatPrice(subtotalCents, locale)}</td><td></td></tr>
          ${discountCents > 0 ? `<tr><td colspan="2">${escapeHtml(labels.discount)} (${escapeHtml(state.coupon ?? "")})</td><td class="num" data-testid="discount">-${formatPrice(discountCents, locale)}</td><td></td></tr>` : ""}
          <tr><td colspan="2"><strong>${escapeHtml(labels.total)}</strong></td><td class="num" data-testid="total"><strong>${formatPrice(totalCents, locale)}</strong></td><td></td></tr>
        </tfoot>
      </table>`
    : `<p class="muted" data-testid="cart-empty">${escapeHtml(labels.cartEmpty)}</p>`

  const couponPanel = `<div class="panel">
      <form method="post" action="${href(state, "/cart/coupon")}" class="row">
        <div>
          <label for="coupon">${escapeHtml(labels.couponLabel)}</label>
          <input type="text" id="coupon" name="code" data-testid="coupon-input" placeholder="${escapeHtml(labels.couponPlaceholder)}" value="${escapeHtml(state.coupon ?? "")}" autocomplete="off">
        </div>
        <button type="submit" class="secondary" data-testid="apply-coupon">${escapeHtml(labels.applyCoupon)}</button>
      </form>
      ${options.couponError ? `<p class="error" data-testid="coupon-error">${escapeHtml(labels.couponInvalid)}</p>` : ""}
      ${state.discountApplied ? `<p class="ok" data-testid="coupon-applied">${escapeHtml(state.coupon ?? "")} &check;</p>` : ""}
    </div>`

  const checkoutButton = state.cart.length
    ? `<form method="post" action="${href(state, "/checkout")}" style="margin-top:18px">
        <button type="submit" class="primary" data-testid="to-checkout" aria-label="${escapeHtml(renamed ? `${labels.proceedToCheckoutShort} — ${labels.checkout}` : labels.proceedToCheckout)}">${escapeHtml(renamed ? labels.proceedToCheckoutShort : labels.proceedToCheckout)}</button>
      </form>`
    : ""

  // reordered_layout moves the coupon form below the summary and lifts the
  // primary CTA above the item list — same controls, different reading order.
  const sections = state.config.reorderedLayout
    ? [delayable(state, "checkout", checkoutButton, labels), table, couponPanel]
    : [table, couponPanel, delayable(state, "checkout", checkoutButton, labels)]

  return layout({
    state,
    labels,
    title: labels.cart,
    body: `<h1>${escapeHtml(labels.cart)}</h1>${sections.join("\n")}`,
  })
}

export function checkoutPage(state: RunState): string {
  const labels = labelsFor(state.config.locale)
  return layout({
    state,
    labels,
    title: labels.checkout,
    body: `<div class="steps"><b>1. ${escapeHtml(labels.cart)}</b> → <b>2. ${escapeHtml(labels.checkout)}</b> → 3. ${escapeHtml(labels.review)}</div>
      <h1>${escapeHtml(labels.checkout)}</h1>
      <form method="post" action="${href(state, "/review")}" class="panel">
        <div class="row">
          <div>
            <label for="name">${escapeHtml(labels.fullName)}</label>
            <input type="text" id="name" name="name" data-testid="checkout-name" value="${escapeHtml(state.checkout.name ?? "")}" autocomplete="off">
          </div>
          <div>
            <label for="city">${escapeHtml(labels.city)}</label>
            <input type="text" id="city" name="city" data-testid="checkout-city" value="${escapeHtml(state.checkout.city ?? "")}" autocomplete="off">
          </div>
        </div>
        <button type="submit" class="primary" data-testid="to-review" style="margin-top:16px">${escapeHtml(labels.continueToReview)}</button>
      </form>`,
  })
}

export function reviewPage(state: RunState): string {
  const labels = labelsFor(state.config.locale)
  const locale = state.config.locale ?? "en-US"
  const { subtotalCents, discountCents, totalCents } = totals(state)

  return layout({
    state,
    labels,
    title: labels.review,
    body: `<div class="steps">1. ${escapeHtml(labels.cart)} → 2. ${escapeHtml(labels.checkout)} → <b>3. ${escapeHtml(labels.review)}</b></div>
      <h1 data-testid="review-heading">${escapeHtml(labels.review)}</h1>
      <p class="muted">${escapeHtml(labels.reviewIntro)}</p>
      <div class="panel">
        <h2>${escapeHtml(labels.checkout)}</h2>
        <p data-testid="review-name">${escapeHtml(state.checkout.name ?? "—")}</p>
        <p data-testid="review-city">${escapeHtml(state.checkout.city ?? "—")}</p>
      </div>
      <table style="margin-top:18px">
        <tbody>
          ${state.cart.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td class="num">${l.quantity}</td><td class="num">${formatPrice(l.unitPriceCents * l.quantity, locale)}</td></tr>`).join("")}
        </tbody>
        <tfoot>
          <tr><td colspan="2">${escapeHtml(labels.subtotal)}</td><td class="num">${formatPrice(subtotalCents, locale)}</td></tr>
          ${discountCents > 0 ? `<tr><td colspan="2">${escapeHtml(labels.discount)}</td><td class="num">-${formatPrice(discountCents, locale)}</td></tr>` : ""}
          <tr><td colspan="2"><strong>${escapeHtml(labels.total)}</strong></td><td class="num" data-testid="review-total"><strong>${formatPrice(totalCents, locale)}</strong></td></tr>
        </tfoot>
      </table>
      <form method="post" action="${href(state, "/order")}" style="margin-top:18px">
        <button type="submit" class="primary" data-testid="place-order">${escapeHtml(labels.placeOrder)}</button>
      </form>`,
  })
}

export function orderPage(state: RunState): string {
  const labels = labelsFor(state.config.locale)
  return layout({
    state,
    labels,
    title: labels.orderPlaced,
    body: `<div class="panel"><h1 data-testid="order-placed">${escapeHtml(labels.orderPlaced)}</h1>
      <a class="link" href="${href(state, "/")}">${escapeHtml(labels.backToStore)}</a></div>`,
  })
}

export function expiredPage(state: RunState): string {
  const labels = labelsFor(state.config.locale)
  return layout({
    state,
    labels,
    bare: true,
    title: labels.sessionExpiredTitle,
    body: `<div class="expired panel">
      <h1 data-testid="session-expired">${escapeHtml(labels.sessionExpiredTitle)}</h1>
      <p class="muted">${escapeHtml(labels.sessionExpiredBody)}</p>
      <form method="post" action="${href(state, "/session/resume")}">
        <button type="submit" class="primary" data-testid="resume-session">${escapeHtml(labels.resumeSession)}</button>
      </form>
    </div>`,
  })
}

export function notFoundPage(state: RunState): string {
  const labels = labelsFor(state.config.locale)
  return layout({
    state,
    labels,
    title: "Not found",
    body: `<div class="panel"><h1>404</h1><a class="link" href="${href(state, "/")}">${escapeHtml(labels.backToStore)}</a></div>`,
  })
}
