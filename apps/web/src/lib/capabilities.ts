/**
 * The safe subset of configuration a browser is allowed to know.
 *
 * Lives outside `lib/server.ts` so that client components can name the type
 * without importing — even type-only — from a module marked `server-only`. The
 * boundary should be obvious from the import path, not from knowing which
 * imports the compiler erases.
 */
export interface ClientCapabilities {
  mode: "solari" | "local"
  /** Whether a key is present. Never the key. */
  hasSolari: boolean
  hasLlm: boolean
  maxConcurrency: number
  maxRunsPerSuite: number
  llmModel: string
}
