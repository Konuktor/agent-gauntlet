import { parse as parseYaml } from "yaml"
import { z } from "zod"
import { GauntletError } from "@gauntlet/core"
import { LIMITS } from "@gauntlet/config"

/**
 * `agentgauntlet.yaml` — the contract a repository implements to be testable.
 *
 * Deliberately tiny. Anything more expressive would be a build system, and the
 * repository already has one; all AgentGauntlet needs to know is how to install
 * it and how to start it.
 */
const commandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
})

export const manifestSchema = z.object({
  version: z.literal(1),
  install: commandSchema.optional(),
  run: commandSchema,
  /** Working directory inside the clone. */
  workdir: z.string().optional(),
  installTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(LIMITS.maxInstallTimeoutMs)
    .default(300_000),
  timeoutMs: z.number().int().positive().max(LIMITS.maxRunTimeoutMs).default(120_000),
  /** Extra environment for the agent. Values are literal, never interpolated. */
  env: z.record(z.string()).default({}),
})

export type AgentManifest = z.infer<typeof manifestSchema>

export const MANIFEST_FILENAME = "agentgauntlet.yaml"

export function parseManifest(source: string): AgentManifest {
  let document: unknown
  try {
    document = parseYaml(source)
  } catch (error) {
    throw new GauntletError({
      code: "repository_manifest_invalid",
      message: `${MANIFEST_FILENAME} is not valid YAML.`,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  const parsed = manifestSchema.safeParse(document)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    throw new GauntletError({
      code: "repository_manifest_invalid",
      message: `${MANIFEST_FILENAME} is missing or malformed.`,
      detail: issues.join("\n"),
    })
  }
  return parsed.data
}

/** The stdout line a repository agent may print to report its own outcome. */
export const RESULT_PREFIX = "AGENT_GAUNTLET_RESULT="

export const agentClaimSchema = z.object({
  status: z.enum(["completed", "failed", "gave_up"]).optional(),
  message: z.string().max(2_000).optional(),
  steps: z.number().int().nonnegative().optional(),
})
export type AgentClaim = z.infer<typeof agentClaimSchema>

/**
 * Extract the agent's self-report from its stdout.
 *
 * Recorded as a CLAIM and nothing more. The evaluator reads server-side state
 * to decide whether the task was actually done, and no value parsed here can
 * change that verdict — it exists so the dashboard can show the gap between
 * what an agent said and what happened.
 */
export function parseAgentClaim(stdout: string): AgentClaim | null {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.trimStart().startsWith(RESULT_PREFIX))
  if (!line) return null

  const payload = line.trimStart().slice(RESULT_PREFIX.length).trim()
  try {
    const parsed = agentClaimSchema.safeParse(JSON.parse(payload))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

