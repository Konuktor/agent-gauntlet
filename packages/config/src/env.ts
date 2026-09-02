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

  /**
   * Gate for runs that spend real money.
   *
   * When set, starting a gauntlet requires this token; the seeded demo stays
   * fully public. Unset means unrestricted, which is right for a laptop and
   * wrong for a public URL — `assertPublicDeploymentIsSafe` enforces that.
   */
  GAUNTLET_RUN_TOKEN: optionalString,

  /**
   * OPTIONAL, EXPERIMENTAL. AgentGauntlet is agent-agnostic: the built-in
   * Reference Agent is deterministic and needs no model at all, and external
   * agents bring their own. This only powers the optional LLM agent adapter.
   */
  ANTHROPIC_API_KEY: optionalString,
  LLM_MODEL: optionalString,

  GAUNTLET_MAX_CONCURRENCY: intInRange(1, LIMITS.maxConcurrency, 3),
  GAUNTLET_MAX_SANDBOXES: intInRange(1, LIMITS.maxSandboxes, 1),
  GAUNTLET_MAX_RUNS_PER_SUITE: intInRange(1, LIMITS.maxRunsPerSuite, 50),

  GAUNTLET_FIXTURE_URL: optionalString,
  GAUNTLET_ARTIFACT_DIR: z.string().default(".artifacts"),
  /** Public origin, when the app is not reached on localhost. */
  GAUNTLET_PUBLIC_URL: optionalString,
  PORT: intInRange(1, 65535, 3000),

  SOLARI_E2E: boolish.default(false),
})

export type RawEnv = z.infer<typeof envSchema>

export interface GauntletConfig extends RawEnv {
  /** The mode a *new* run would execute in, after resolving `auto`. */
  readonly resolvedMode: Exclude<ExecutionMode, "demo">
  readonly hasSolariCredentials: boolean
  /** Whether the OPTIONAL LLM agent adapter is usable. Never a requirement. */
  readonly hasLlmCredentials: boolean
  readonly llmModel: string
  /** True when starting a real run requires a token. */
  readonly runsAreGated: boolean
  /**
   * Whether this deployment can actually execute a run.
   *
   * Local mode drives real Chromium, and a production image deliberately ships
   * no browser — AgentGauntlet orchestrates runs, it does not host them. So a
   * production deployment can only run for real once Solari is configured, and
   * saying otherwise would promise something the container cannot do.
   */
  readonly canExecuteRuns: boolean
  /** The app's public origin, however it is reachable. */
  readonly publicUrl: string
}

/** Only used by the optional LLM adapter. */
const DEFAULT_LLM_MODEL = "claude-opus-5"

export function buildConfig(raw: RawEnv): GauntletConfig {
  const hasSolariCredentials = Boolean(raw.SOLARI_API_KEY)

  // `auto` never silently downgrades a configured real mode: an explicit
  // GAUNTLET_MODE=solari without a key is a startup error, not a fallback.
  const resolvedMode =
    raw.GAUNTLET_MODE === "auto" ? (hasSolariCredentials ? "solari" : "local") : raw.GAUNTLET_MODE

  return {
    ...raw,
    resolvedMode,
    hasSolariCredentials,
    hasLlmCredentials: Boolean(raw.ANTHROPIC_API_KEY),
    llmModel: raw.LLM_MODEL ?? DEFAULT_LLM_MODEL,
    runsAreGated: Boolean(raw.GAUNTLET_RUN_TOKEN),
    canExecuteRuns: hasSolariCredentials || raw.NODE_ENV !== "production",
    publicUrl: resolvePublicUrl(raw),
  }
}

/**
 * Where this app actually lives.
 *
 * An explicit setting wins; otherwise localhost. Nothing in production should
 * ever emit a localhost URL, so this is the single place that decides.
 */
function resolvePublicUrl(raw: RawEnv): string {
  const explicit = raw.GAUNTLET_PUBLIC_URL
  if (explicit) return explicit.replace(/\/$/, "")
  return `http://localhost:${raw.PORT}`
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

/**
 * Refuse to boot a public deployment that would let anonymous visitors spend
 * the operator's Solari credits.
 *
 * Deliberately a hard failure rather than a warning: the whole point of a run
 * token is that forgetting it is expensive, and a log line nobody reads is not
 * a control. A laptop with no Solari key is unaffected, because there is
 * nothing there to spend.
 */
export function assertPublicDeploymentIsSafe(config: GauntletConfig): void {
  const isPublic = config.NODE_ENV === "production" && Boolean(config.GAUNTLET_PUBLIC_URL)
  if (!isPublic) return
  if (!config.hasSolariCredentials) return
  if (config.runsAreGated) return

  throw new ConfigError(
    "This deployment is public and has a Solari key, but no GAUNTLET_RUN_TOKEN. " +
      "Anyone who finds the URL could spend your Solari credits. Set GAUNTLET_RUN_TOKEN " +
      "to a secret value, or remove SOLARI_API_KEY to run in demo-only mode.",
    ["GAUNTLET_RUN_TOKEN: required for a public deployment that can spend credits"],
  )
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
