import {
  GauntletError,
  scoreAssertions,
  type Assertion,
  type EvaluationContext,
  type EvaluationResult,
  type Evaluator,
  type PageDriver,
} from "@gauntlet/core"
import { z } from "zod"

export const webAssertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url_contains"), value: z.string() }),
  z.object({ type: z.literal("url_equals"), value: z.string() }),
  z.object({ type: z.literal("text_visible"), value: z.string() }),
  z.object({ type: z.literal("selector_exists"), selector: z.string() }),
  z.object({ type: z.literal("selector_text_equals"), selector: z.string(), value: z.string() }),
  z.object({ type: z.literal("selector_text_contains"), selector: z.string(), value: z.string() }),
  z.object({ type: z.literal("expression_equals"), expression: z.string(), value: z.unknown() }),
])
export type WebAssertion = z.infer<typeof webAssertionSchema>

/**
 * Assertions evaluated against the live page, for targets that are not the
 * built-in fixture.
 *
 * Use with care, and only against sites you own or are authorised to automate.
 * Page-derived evidence is strictly weaker than server-side state: an agent
 * that changes the DOM can influence the outcome, which is exactly what the
 * fixture evaluator is designed to prevent. Prefer a state endpoint you control
 * whenever one exists, and treat these as a pragmatic fallback rather than an
 * equivalent.
 *
 * `expression_equals` evaluates caller-supplied JavaScript in the page. It is
 * a suite-author capability, not a user-input one — never build a UI that feeds
 * untrusted text into it.
 */
export class WebAssertionEvaluator implements Evaluator {
  readonly kind = "web_assertions"

  constructor(private readonly assertions: WebAssertion[]) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const page = context.page
    if (!page) {
      throw new GauntletError({
        code: "evaluator_unavailable",
        message: "The browser closed before the run could be judged.",
      })
    }

    const results: Assertion[] = []
    for (const assertion of this.assertions) {
      results.push(await this.check(page, assertion))
    }

    const { success, score } = scoreAssertions(results)
    return {
      success,
      score,
      assertions: results,
      evidence: {
        url: page.url(),
        agentClaim: {
          finishReason: context.agentResult.finishReason,
          message: context.agentResult.message,
        },
      },
    }
  }

  private async check(page: PageDriver, assertion: WebAssertion): Promise<Assertion> {
    const base = { name: assertion.type, weight: 1 }
    try {
      switch (assertion.type) {
        case "url_contains": {
          const url = page.url()
          return {
            ...base,
            description: `URL contains "${assertion.value}"`,
            expected: assertion.value,
            actual: url,
            passed: url.includes(assertion.value),
          }
        }
        case "url_equals": {
          const url = page.url()
          return {
            ...base,
            description: `URL equals "${assertion.value}"`,
            expected: assertion.value,
            actual: url,
            passed: url === assertion.value,
          }
        }
        case "text_visible": {
          const found = await page.evaluate<boolean>(
            `(() => (document.body ? document.body.innerText : "").includes(${JSON.stringify(assertion.value)}))()`,
          )
          return {
            ...base,
            description: `page shows "${assertion.value}"`,
            expected: true,
            actual: found,
            passed: found,
          }
        }
        case "selector_exists": {
          const found = await page.evaluate<boolean>(
            `(() => Boolean(document.querySelector(${JSON.stringify(assertion.selector)})))()`,
          )
          return {
            ...base,
            description: `${assertion.selector} exists`,
            expected: true,
            actual: found,
            passed: found,
          }
        }
        case "selector_text_equals":
        case "selector_text_contains": {
          const text = await page.evaluate<string | null>(
            `(() => { const el = document.querySelector(${JSON.stringify(assertion.selector)}); return el ? (el.textContent || "").trim() : null })()`,
          )
          const passed =
            text !== null &&
            (assertion.type === "selector_text_equals"
              ? text === assertion.value
              : text.includes(assertion.value))
          return {
            ...base,
            description: `${assertion.selector} text ${assertion.type === "selector_text_equals" ? "equals" : "contains"} "${assertion.value}"`,
            expected: assertion.value,
            actual: text,
            passed,
          }
        }
        case "expression_equals": {
          const actual = await page.evaluate<unknown>(`(() => (${assertion.expression}))()`)
          return {
            ...base,
            description: `${assertion.expression} evaluates to ${JSON.stringify(assertion.value)}`,
            expected: assertion.value,
            actual,
            passed: JSON.stringify(actual) === JSON.stringify(assertion.value),
          }
        }
      }
    } catch (error) {
      // A page that cannot be queried is a failed assertion, not a crashed
      // evaluation: the run still gets a verdict, with the reason recorded.
      return {
        ...base,
        description: `${assertion.type} could not be evaluated`,
        expected: "evaluable",
        actual: error instanceof Error ? error.message : String(error),
        passed: false,
      }
    }
  }
}
