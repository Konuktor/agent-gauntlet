import { readFile } from "node:fs/promises"
import { parse as parseYaml } from "yaml"
import { z } from "zod"
import { LIMITS } from "@gauntlet/config"
import { GauntletError } from "@gauntlet/core"

/**
 * `gauntlet.yaml` — the config a repository checks in so CI can run the same
 * gauntlet a developer runs locally.
 */
export const gauntletConfigSchema = z.object({
  version: z.literal(1),
  agent: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("reference"),
      preset: z.enum(["naive", "reference", "resilient"]).default("reference"),
      name: z.string().optional(),
    }),
    z.object({ type: z.literal("llm"), model: z.string().optional(), name: z.string().optional() }),
    z.object({
      type: z.literal("repository"),
      repository: z.string(),
      branch: z.string().optional(),
      name: z.string().optional(),
    }),
  ]),
  task: z.object({
    name: z.string().default("Gauntlet task"),
    description: z.string().min(1).max(LIMITS.maxTaskDescriptionChars),
    startUrl: z.string().default("/"),
    maxSteps: z.number().int().min(1).max(LIMITS.maxSteps).default(25),
    timeoutMs: z.number().int().min(5_000).max(LIMITS.maxRunTimeoutMs).default(90_000),
  }),
  variants: z.array(z.string().min(1)).min(1),
  repetitions: z.number().int().min(1).max(LIMITS.maxRepetitions).default(2),
  thresholds: z
    .object({
      /** Suite fails below this. 0-1. */
      reliability: z.number().min(0).max(1).optional(),
      /** Baseline must be at least this reliable, else the task itself is broken. */
      baseline: z.number().min(0).max(1).optional(),
    })
    .default({}),
})

export type GauntletFileConfig = z.infer<typeof gauntletConfigSchema>

export async function loadConfigFile(path: string): Promise<GauntletFileConfig> {
  let source: string
  try {
    source = await readFile(path, "utf8")
  } catch {
    throw new GauntletError({
      code: "config_invalid",
      message: `Could not read ${path}. Create one, or run \`gauntlet demo\`.`,
    })
  }

  let document: unknown
  try {
    document = path.endsWith(".json") ? JSON.parse(source) : parseYaml(source)
  } catch (error) {
    throw new GauntletError({
      code: "config_invalid",
      message: `${path} is not valid ${path.endsWith(".json") ? "JSON" : "YAML"}.`,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  const parsed = gauntletConfigSchema.safeParse(document)
  if (!parsed.success) {
    throw new GauntletError({
      code: "config_invalid",
      message: `${path} is not a valid gauntlet config.`,
      detail: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n"),
    })
  }
  return parsed.data
}

/** The config `gauntlet demo` runs: the bundled task and the default variants. */
export const DEMO_CONFIG: GauntletFileConfig = {
  version: 1,
  agent: { type: "reference", preset: "reference" },
  task: {
    name: "Complete Demo Checkout",
    description:
      "Add Aurora Headphones to cart, apply coupon SAVE20, proceed to checkout, enter Name: Ada Lovelace and City: London, continue to review, and stop before submitting payment.",
    startUrl: "/",
    maxSteps: 25,
    timeoutMs: 90_000,
  },
  variants: [
    "baseline",
    "cookie_popup",
    "slow_api",
    "unexpected_modal",
    "mobile_viewport",
    "renamed_cta",
    "expired_session",
    "network_delay",
  ],
  repetitions: 2,
  thresholds: { reliability: 0.9 },
}
