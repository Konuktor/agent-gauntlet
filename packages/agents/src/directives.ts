/**
 * Turn a plain-English task description into an ordered list of intents.
 *
 * This is what lets the reference agent work without an LLM. It is a small
 * grammar, not natural-language understanding, and that is the honest framing:
 * it reads instructions of the shape a QA engineer would write, and it does not
 * pretend to generalise beyond them.
 */

export type Directive =
  | { kind: "click"; candidates: string[]; describe: string }
  | { kind: "type"; fieldCandidates: string[]; value: string; describe: string }
  | { kind: "stop"; describe: string }

const CART_WORDS = "cart|basket|bag"

export function parseDirectives(description: string): Directive[] {
  const text = description.replace(/\s+/g, " ").trim()
  const directives: Directive[] = []

  // "Add Aurora Headphones to the cart"
  const add = text.match(new RegExp(`add\\s+(.+?)\\s+to\\s+(?:the\\s+)?(?:${CART_WORDS})`, "i"))
  if (add?.[1]) {
    const product = add[1].trim()
    directives.push({
      kind: "click",
      // Ordered from most specific to most generic. The specific forms survive
      // a page with several products; the generic ones survive a renamed CTA.
      candidates: [`Add to cart: ${product}`, `Add ${product}`, product, "Add to cart", "Add"],
      describe: `add ${product} to the cart`,
    })
  }

  // "apply coupon SAVE20" / "use code SAVE20"
  const coupon = text.match(
    /(?:apply|use|enter|redeem)\s+(?:the\s+)?(?:coupon|discount|promo)?\s*(?:code\s+)?([A-Z0-9][A-Z0-9_-]{2,})/i,
  )
  if (coupon?.[1]) {
    const code = coupon[1].toUpperCase()
    directives.push({
      kind: "type",
      fieldCandidates: ["Coupon code", "Coupon", "Discount code", "Promo code", "code"],
      value: code,
      describe: `enter coupon ${code}`,
    })
    directives.push({
      kind: "click",
      candidates: ["Apply coupon", "Apply", "Redeem"],
      describe: "apply the coupon",
    })
  }

  if (/(?:proceed|continue|go|move)\s+to\s+(?:the\s+)?checkout|checkout/i.test(text)) {
    directives.push({
      kind: "click",
      candidates: ["Proceed to checkout", "Checkout", "Continue"],
      describe: "go to checkout",
    })
  }

  // "enter Name: Ada Lovelace and City: London"
  //
  // The lookahead is the load-bearing part. A naive `[^,;.]+` for the value
  // swallows the next field whole when the two are joined by "and" rather than
  // a comma, and the agent then types "Ada Lovelace and City: London" into the
  // name box — a failure that looks like an agent bug but is a parser bug.
  for (const match of text.matchAll(FIELD_PATTERN)) {
    const field = stripLeadingVerb(match[1]?.trim() ?? "")
    const value = trimDanglingConjunction(match[2]?.trim() ?? "")
    if (!field || !value) continue
    if (/^(coupon|code|url|step|note)$/i.test(field)) continue
    directives.push({
      kind: "type",
      fieldCandidates: fieldSynonyms(field),
      value,
      describe: `enter ${field} "${value}"`,
    })
  }

  if (/review/i.test(text)) {
    directives.push({
      kind: "click",
      candidates: ["Continue to review", "Review", "Review order", "Continue"],
      describe: "continue to the review step",
    })
  }

  directives.push({
    kind: "stop",
    describe: /(?:stop|do not|don't|without)\b/i.test(text)
      ? "stop before the final action, as instructed"
      : "task steps complete",
  })

  return directives
}

const FIELD_PATTERN =
  /\b([A-Z][A-Za-z ]{1,20}?)\s*[:=]\s*(.+?)(?=\s*(?:,|;|\.|$|\band\b\s+[A-Z][A-Za-z ]{1,20}\s*[:=]|\b(?:and|then|but)\b\s+(?:stop|do not|don't|finally|continue|proceed|submit|click)))/g

/** "Enter Name" is an instruction plus a field, not a field called "Enter Name". */
function stripLeadingVerb(field: string): string {
  return field.replace(/^(?:enter|set|type|fill(?:\s+in)?|input|with|use|provide)\s+/i, "").trim()
}

function trimDanglingConjunction(value: string): string {
  return value.replace(/[\s,]+(?:and|then|but)$/i, "").trim()
}

/** Forms a checkout page is likely to label a field with. */
function fieldSynonyms(field: string): string[] {
  const base = field.trim()
  const lower = base.toLowerCase()
  const out = [base]
  if (lower === "name") out.push("Full name", "Your name", "Name", "Vollständiger Name")
  if (lower === "city") out.push("City", "Town", "Stadt")
  if (lower.includes("email")) out.push("Email", "Email address")
  if (lower.includes("address")) out.push("Address", "Street address")
  return [...new Set(out)]
}
