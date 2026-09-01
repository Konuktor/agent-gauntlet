import "server-only"
import { parseEnv, type GauntletConfig } from "@gauntlet/config"
import { createLogger, type Logger } from "@gauntlet/core"
import { getDb, loadDotEnv, type Database } from "@gauntlet/db"

loadDotEnv()

let cachedConfig: GauntletConfig | undefined

/**
 * Server-only accessors.
 *
 * The `server-only` import is load-bearing: it makes importing this module from
 * a client component a BUILD error rather than a runtime surprise, which is what
 * stops an API key from ever reaching a browser bundle.
 */
export function config(): GauntletConfig {
  cachedConfig ??= parseEnv()
  return cachedConfig
}

export function db(): Database {
  return getDb().db
}

export function logger(): Logger {
  return createLogger({ component: "web" }, { level: config().LOG_LEVEL })
}

/** The safe subset of configuration a browser is allowed to know. */
export interface ClientCapabilities {
  mode: "solari" | "local"
  hasSolari: boolean
  hasLlm: boolean
  maxConcurrency: number
  maxRunsPerSuite: number
  llmModel: string
}

export function clientCapabilities(): ClientCapabilities {
  const c = config()
  return {
    mode: c.resolvedMode,
    hasSolari: c.hasSolariCredentials,
    hasLlm: c.hasLlmCredentials,
    maxConcurrency: c.GAUNTLET_MAX_CONCURRENCY,
    maxRunsPerSuite: c.GAUNTLET_MAX_RUNS_PER_SUITE,
    llmModel: c.llmModel,
  }
}
