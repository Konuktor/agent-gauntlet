import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createMemoryRecorder,
  createRng,
  nullLogger,
  type AgentRunContext,
  type TaskDefinition,
} from "@gauntlet/core"
import { RepositoryAgent } from "./repository-agent.js"

/**
 * The isolation guarantee.
 *
 * A repository agent runs code somebody else wrote. That is only acceptable
 * because it executes inside a Solari Sandbox and never on the machine hosting
 * AgentGauntlet. These tests exist because that property is easy to lose by
 * accident — one convenient `execSync` during debugging and a public deployment
 * becomes a remote code execution service.
 */

const repoRoot = resolve(import.meta.dirname, "../../../..")

const TASK: TaskDefinition = {
  id: "t",
  name: "Checkout",
  description: "Add Aurora Headphones to cart.",
  startUrl: "/",
  maxSteps: 10,
  timeoutMs: 30_000,
  evaluatorConfig: {
    kind: "fixture_state",
    expect: {
      productSku: "aurora-headphones",
      quantity: 1,
      coupon: "SAVE20",
      discountApplied: true,
      checkoutName: "Ada Lovelace",
      checkoutCity: "London",
      stage: "review",
      purchaseSubmitted: false,
    },
  },
}

function context(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    runId: "run-1",
    task: TASK,
    startUrl: "https://fixture.test/",
    page: {} as AgentRunContext["page"],
    maxSteps: 10,
    signal: new AbortController().signal,
    recorder: createMemoryRecorder(100),
    logger: nullLogger,
    rng: createRng(1),
    ...overrides,
  }
}

describe("repository agents never execute on this host", () => {
  it("refuses to run without a sandbox provider", async () => {
    const agent = new RepositoryAgent({ repository: "https://github.com/acme/agent" })
    await expect(agent.run(context())).rejects.toThrow(/Solari Sandbox/i)
  })

  it("refuses to run without a browser endpoint the sandbox can reach", async () => {
    const agent = new RepositoryAgent({ repository: "https://github.com/acme/agent" })
    // A sandbox but no CDP endpoint: there is nothing for the agent to drive,
    // and falling back to a local browser would defeat the isolation.
    const sandboxes = {
      mode: "solari",
      create: async () => {
        throw new Error("unused")
      },
      shutdown: async () => {},
    }
    await expect(
      agent.run(context({ sandboxes: sandboxes as unknown as AgentRunContext["sandboxes"] })),
    ).rejects.toThrow(/browser endpoint/i)
  })

  /**
   * The structural guard. Grepping the shipped source is cruder than a runtime
   * assertion and considerably harder to defeat by accident: there is no code
   * path to forget to cover.
   */
  it("has no host process-execution API anywhere in shipped source", () => {
    // Matches IMPORTS of the module, not the words. Prose explaining why the
    // module is absent should not trip the check that it is absent.
    const output = execSync(
      'git grep -nE "(from|require\\\\()\\\\s*[\\"\']node:child_process|(from|require\\\\()\\\\s*[\\"\']child_process" -- ' +
        "'packages/*/src/**/*.ts' 'apps/*/src/**/*.ts' 'apps/web/server.ts' " +
        "':!*.test.ts' ':!*/test-doubles.ts' || true",
      { cwd: repoRoot, encoding: "utf8" },
    ).trim()

    expect(
      output,
      `Found a host process-execution API in shipped source:\n${output}\n\n` +
        "Repository agents must run inside a Solari Sandbox. If this is a legitimate " +
        "non-agent use, add a narrow exclusion and say why.",
    ).toBe("")
  })

  it("keeps the sandbox contract in the agent implementation", () => {
    const source = readFileSync(resolve(import.meta.dirname, "repository-agent.ts"), "utf8")
    // Cloning and running both go through the sandbox port, never a local shell.
    expect(source).toContain("context.sandboxes.create")
    expect(source).toContain("sandbox.gitClone")
    expect(source).toContain("sandbox.run(")
    // No import of the module — checked as an import, so the comment above it
    // explaining its absence does not count as its presence.
    expect(source).not.toMatch(/(from|require\()\s*["']node:child_process["']/)
  })

  it("never hands a Solari API key to the agent process", () => {
    const source = readFileSync(resolve(import.meta.dirname, "repository-agent.ts"), "utf8")
    const envBlock = source.slice(
      source.indexOf("const env: Record<string, string>"),
      source.indexOf("let stdout"),
    )
    expect(envBlock).toContain("AGENT_GAUNTLET_CDP_ENDPOINT")
    // The scoped browser endpoint is the whole point: least authority that
    // still lets the agent do its job.
    expect(envBlock).not.toContain("SOLARI_API_KEY")
    expect(envBlock).not.toContain("apiKey")
  })
})
