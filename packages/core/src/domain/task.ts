import { z } from "zod"
import { LIMITS } from "@gauntlet/config"

/** The evaluator config stored on a task definition. Discriminated so new
 *  evaluator kinds can be added without loosening the existing ones. */
export const fixtureAssertionSchema = z.object({
  kind: z.literal("fixture_state"),
  expect: z.object({
    productSku: z.string(),
    quantity: z.number().int().positive().default(1),
    coupon: z.string().nullable(),
    discountApplied: z.boolean(),
    checkoutName: z.string().nullable(),
    checkoutCity: z.string().nullable(),
    stage: z.enum(["browse", "cart", "checkout", "review", "done"]),
    purchaseSubmitted: z.boolean(),
  }),
})

export const webAssertionSchema = z.object({
  kind: z.literal("web_assertions"),
  assertions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("url_contains"), value: z.string() }),
        z.object({ type: z.literal("url_equals"), value: z.string() }),
        z.object({ type: z.literal("text_visible"), value: z.string() }),
        z.object({ type: z.literal("selector_exists"), selector: z.string() }),
        z.object({ type: z.literal("selector_text_equals"), selector: z.string(), value: z.string() }),
        z.object({ type: z.literal("selector_text_contains"), selector: z.string(), value: z.string() }),
        z.object({ type: z.literal("expression_equals"), expression: z.string(), value: z.unknown() }),
      ]),
    )
    .min(1),
})

export const evaluatorConfigSchema = z.discriminatedUnion("kind", [
  fixtureAssertionSchema,
  webAssertionSchema,
])
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>
export type FixtureExpectation = z.infer<typeof fixtureAssertionSchema>["expect"]

export const taskDefinitionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(LIMITS.maxTaskDescriptionChars),
  /** Relative path appended to the fixture base URL, or an absolute URL for an
   *  authorized external target. */
  startUrl: z.string().min(1),
  maxSteps: z.number().int().min(1).max(LIMITS.maxSteps),
  timeoutMs: z.number().int().min(5_000).max(LIMITS.maxRunTimeoutMs),
  evaluatorConfig: evaluatorConfigSchema,
})
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>
