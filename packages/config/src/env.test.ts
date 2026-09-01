import { describe, expect, it } from "vitest"
import { ConfigError, parseEnv } from "./env.js"

const base = { DATABASE_URL: "postgres://u:p@localhost:5433/gauntlet" }

describe("parseEnv", () => {
  it("applies defaults", () => {
    const c = parseEnv(base)
    expect(c.GAUNTLET_MAX_CONCURRENCY).toBe(3)
    expect(c.GAUNTLET_MAX_SANDBOXES).toBe(1)
    expect(c.GAUNTLET_MAX_RUNS_PER_SUITE).toBe(50)
    expect(c.SOLARI_BASE_URL).toBe("https://api.getsolari.com")
    expect(c.LOG_LEVEL).toBe("info")
  })

  it("requires a postgres DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(ConfigError)
    expect(() => parseEnv({ DATABASE_URL: "mysql://x" })).toThrow(/postgres/)
  })

  it("reports every problem at once rather than the first", () => {
    try {
      parseEnv({ DATABASE_URL: "nope", GAUNTLET_MODE: "wat", LOG_LEVEL: "loud" })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).issues.length).toBeGreaterThanOrEqual(3)
    }
  })

  it("resolves auto mode from credential presence", () => {
    expect(parseEnv(base).resolvedMode).toBe("local")
    expect(parseEnv({ ...base, SOLARI_API_KEY: "slr_live_x" }).resolvedMode).toBe("solari")
  })

  // An explicitly requested real mode must never silently downgrade to a fake
  // one — that is the failure §26 exists to prevent.
  it("refuses GAUNTLET_MODE=solari without a key instead of falling back", () => {
    expect(() => parseEnv({ ...base, GAUNTLET_MODE: "solari" })).toThrow(/requires SOLARI_API_KEY/)
  })

  it("treats blank strings as absent credentials", () => {
    const c = parseEnv({ ...base, SOLARI_API_KEY: "   ", ANTHROPIC_API_KEY: "" })
    expect(c.hasSolariCredentials).toBe(false)
    expect(c.hasLlmCredentials).toBe(false)
    expect(c.resolvedMode).toBe("local")
  })

  it("tracks LLM credentials per selected provider", () => {
    expect(parseEnv({ ...base, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-x" }).hasLlmCredentials).toBe(true)
    expect(parseEnv({ ...base, LLM_PROVIDER: "openai", ANTHROPIC_API_KEY: "sk-ant-x" }).hasLlmCredentials).toBe(false)
    expect(parseEnv({ ...base, LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-x" }).hasLlmCredentials).toBe(true)
  })

  it("defaults the model per provider and honours an override", () => {
    expect(parseEnv({ ...base }).llmModel).toBe("claude-opus-5")
    expect(parseEnv({ ...base, LLM_PROVIDER: "openai" }).llmModel).toBe("gpt-4.1-mini")
    expect(parseEnv({ ...base, LLM_MODEL: "claude-opus-5" }).llmModel).toBe("claude-opus-5")
  })

  it("clamps cost limits into the hard ceilings", () => {
    expect(() => parseEnv({ ...base, GAUNTLET_MAX_CONCURRENCY: "9999" })).toThrow(ConfigError)
    expect(() => parseEnv({ ...base, GAUNTLET_MAX_CONCURRENCY: "0" })).toThrow(ConfigError)
    expect(parseEnv({ ...base, GAUNTLET_MAX_CONCURRENCY: "8" }).GAUNTLET_MAX_CONCURRENCY).toBe(8)
  })

  it("falls back to the default for an unparseable numeric", () => {
    expect(parseEnv({ ...base, GAUNTLET_MAX_CONCURRENCY: "many" }).GAUNTLET_MAX_CONCURRENCY).toBe(3)
  })

  it("parses booleans loosely", () => {
    expect(parseEnv({ ...base, SOLARI_E2E: "1" }).SOLARI_E2E).toBe(true)
    expect(parseEnv({ ...base, SOLARI_E2E: "true" }).SOLARI_E2E).toBe(true)
    expect(parseEnv({ ...base, SOLARI_E2E: "0" }).SOLARI_E2E).toBe(false)
    expect(parseEnv({ ...base }).SOLARI_E2E).toBe(false)
  })
})
