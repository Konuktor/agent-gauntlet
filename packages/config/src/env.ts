import { z } from "zod"
import { LIMITS } from "./limits.js"

/** How a suite actually executes. Displayed prominently in the UI: a seeded or
 *  local run must never be mistaken for a real Solari run. */
export const executionModes = ["solari", "local", "demo"] as const
export type ExecutionMode = (typeof executionModes)[number]

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()),
  )

const optionalString = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()

const intInRange = (min: number, max: number, fallback: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return fallback
      const n = typeof v === "number" ? v : Number.parseInt(v, 10)
      return Number.isFinite(n) ? n : fallback
    })
    .pipe(z.number().int().min(min).max(max))

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required. Copy .env.example to .env, then run `docker compose up -d`.")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// connection string",
    }),

  SOLARI_API_KEY: optionalString,
  SOLARI_BASE_URL: z.string().url().default("https://api.getsolari.com"),

  GAUNTLET_MODE: z.enum(["auto", "solari", "local"]).default("auto"),

  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_MODEL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,

  GAUNTLET_MAX_CONCURRENCY: intInRange(1, LIMITS.maxConcurrency, 3),
  GAUNTLET_MAX_SANDBOXES: intInRange(1, LIMITS.maxSandboxes, 1),
  GAUNTLET_MAX_RUNS_PER_SUITE: intInRange(1, LIMITS.maxRunsPerSuite, 50),

  GAUNTLET_FIXTURE_URL: optionalString,
  GAUNTLET_ARTIFACT_DIR: z.string().default(".artifacts"),
  GAUNTLET_WEB_URL: z.string().url().default("http://localhost:3000"),

  SOLARI_E2E: boolish.default(false),
})

export type RawEnv = z.infer<typeof envSchema>

export interface GauntletConfig extends RawEnv {
  /** The mode a *new* run would execute in, after resolving `auto`. */
  readonly resolvedMode: Exclude<ExecutionMode, "demo">
  readonly hasSolariCredentials: boolean
  readonly hasLlmCredentials: boolean
  /** Model id for the configured provider, defaulted per provider. */
  readonly llmModel: string
}

const DEFAULT_MODELS: Record<RawEnv["LLM_PROVIDER"], string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1-mini",
}

export function buildConfig(raw: RawEnv): GauntletConfig {
  const hasSolariCredentials = Boolean(raw.SOLARI_API_KEY)
  const hasLlmCredentials =
    raw.LLM_PROVIDER === "anthropic" ? Boolean(raw.ANTHROPIC_API_KEY) : Boolean(raw.OPENAI_API_KEY)

  // `auto` never silently downgrades a configured real mode: an explicit
  // GAUNTLET_MODE=solari without a key is a startup error, not a fallback.
  const resolvedMode =
    raw.GAUNTLET_MODE === "auto" ? (hasSolariCredentials ? "solari" : "local") : raw.GAUNTLET_MODE

  return {
    ...raw,
    resolvedMode,
    hasSolariCredentials,
    hasLlmCredentials,
    llmModel: raw.LLM_MODEL ?? DEFAULT_MODELS[raw.LLM_PROVIDER],
  }
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message)
    this.name = "ConfigError"
  }
}

/**
 * Parse and validate an environment. Throws a ConfigError listing every problem
 * at once rather than failing on the first one, so a misconfigured .env is a
 * single readable message instead of a game of whack-a-mole.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): GauntletConfig {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    throw new ConfigError(`Invalid environment:\n  - ${issues.join("\n  - ")}`, issues)
  }

  const config = buildConfig(parsed.data)

  if (config.GAUNTLET_MODE === "solari" && !config.hasSolariCredentials) {
    throw new ConfigError("GAUNTLET_MODE=solari requires SOLARI_API_KEY to be set.", [
      "SOLARI_API_KEY: required when GAUNTLET_MODE=solari",
    ])
  }

  return config
}

let cached: GauntletConfig | undefined

/** Process-wide config, parsed once. */
export function getConfig(): GauntletConfig {
  cached ??= parseEnv()
  return cached
}

/** Test seam: drop the memoised config so a test can re-parse a fresh env. */
export function resetConfigCache(): void {
  cached = undefined
}
