import { describe, expect, it } from "vitest"
import { assertPublicDeploymentIsSafe, ConfigError, parseEnv } from "./env.js"

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

  // The product is agent-agnostic: a model key is never required, and its
  // absence must never read as a misconfiguration.
  it("treats a model key as optional", () => {
    const withoutKey = parseEnv(base)
    expect(withoutKey.hasLlmCredentials).toBe(false)
    expect(withoutKey.resolvedMode).toBe("local")
    expect(parseEnv({ ...base, ANTHROPIC_API_KEY: "sk-ant-x" }).hasLlmCredentials).toBe(true)
  })

  it("needs only SOLARI_API_KEY to reach real mode", () => {
    const config = parseEnv({ ...base, SOLARI_API_KEY: "slr_live_x" })
    expect(config.resolvedMode).toBe("solari")
    expect(config.hasSolariCredentials).toBe(true)
    // Explicitly: no model credential involved in getting there.
    expect(config.hasLlmCredentials).toBe(false)
  })

  it("defaults the optional model and honours an override", () => {
    expect(parseEnv(base).llmModel).toBe("claude-opus-5")
    expect(parseEnv({ ...base, LLM_MODEL: "claude-sonnet-5" }).llmModel).toBe("claude-sonnet-5")
  })

  describe("deployment", () => {
    it("defaults to the split web + worker topology", () => {
      expect(parseEnv(base).GAUNTLET_DEPLOY_MODE).toBe("split")
      expect(parseEnv({ ...base, GAUNTLET_DEPLOY_MODE: "single" }).GAUNTLET_DEPLOY_MODE).toBe("single")
    })

    it("derives the public origin from Render, then from an override, then localhost", () => {
      expect(parseEnv(base).publicUrl).toBe("http://localhost:3000")
      expect(parseEnv({ ...base, PORT: "10000" }).publicUrl).toBe("http://localhost:10000")
      expect(parseEnv({ ...base, RENDER_EXTERNAL_URL: "https://x.onrender.com" }).publicUrl).toBe(
        "https://x.onrender.com",
      )
      // An explicit setting wins over the platform's guess.
      expect(
        parseEnv({
          ...base,
          RENDER_EXTERNAL_URL: "https://x.onrender.com",
          GAUNTLET_PUBLIC_URL: "https://gauntlet.example.com/",
        }).publicUrl,
      ).toBe("https://gauntlet.example.com")
    })

    it("reports whether real runs are gated", () => {
      expect(parseEnv(base).runsAreGated).toBe(false)
      expect(parseEnv({ ...base, GAUNTLET_RUN_TOKEN: "s3cret" }).runsAreGated).toBe(true)
    })
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

describe("assertPublicDeploymentIsSafe", () => {
  const publicProd = {
    ...base,
    NODE_ENV: "production",
    RENDER_EXTERNAL_URL: "https://demo.onrender.com",
  }

  // The failure this prevents: a public URL, a real Solari key, and no gate —
  // i.e. anyone who finds the deployment can spend the operator's money.
  it("refuses a public deployment that can spend credits without a token", () => {
    expect(() => assertPublicDeploymentIsSafe(parseEnv({ ...publicProd, SOLARI_API_KEY: "slr_live_x" }))).toThrow(
      /GAUNTLET_RUN_TOKEN/,
    )
  })

  it("allows it once a run token is set", () => {
    expect(() =>
      assertPublicDeploymentIsSafe(
        parseEnv({ ...publicProd, SOLARI_API_KEY: "slr_live_x", GAUNTLET_RUN_TOKEN: "s3cret" }),
      ),
    ).not.toThrow()
  })

  // Demo-only deployments have nothing to spend, so they need no gate.
  it("allows a public deployment with no Solari key at all", () => {
    expect(() => assertPublicDeploymentIsSafe(parseEnv(publicProd))).not.toThrow()
  })

  it("never blocks local development", () => {
    expect(() =>
      assertPublicDeploymentIsSafe(parseEnv({ ...base, SOLARI_API_KEY: "slr_live_x" })),
    ).not.toThrow()
  })
})
