import { LIMITS } from "@gauntlet/config"
import {
  GauntletError,
  type AgentAdapter,
  type AgentExecutionResult,
  type AgentRunContext,
  type SandboxEnvironment,
} from "@gauntlet/core"
import { MANIFEST_FILENAME, parseAgentClaim, parseManifest, type AgentManifest } from "./manifest.js"
import { validateRepositoryUrl } from "./repo-url.js"

export interface RepositoryAgentConfig {
  repository: string
  branch?: string
  /** Overrides the manifest, for repositories that do not ship one. */
  manifest?: Partial<AgentManifest>
  /** Personal access token for a private repository. Held in memory only. */
  token?: string
}

const CLONE_PATH = "/workspace/agent"

/**
 * USE CASE B — run somebody else's agent, from their git repository.
 *
 * The whole feature rests on one rule: repository code NEVER executes on the
 * AgentGauntlet host. It is cloned into a fresh Solari Sandbox, installed
 * there, run there, and the machine is destroyed afterwards. There is no
 * `child_process` anywhere in this file, and that is deliberate — a reliability
 * harness that ran arbitrary repositories locally would be a remote code
 * execution vector wearing a lab coat.
 *
 * The agent is handed the RAW, publicly routable CDP endpoint for its browser
 * session, so it drives a real Solari browser from inside the sandbox. It is
 * NOT handed a Solari API key: the endpoint is a capability scoped to exactly
 * one browser session that we already created and will release, which is the
 * least authority that makes the feature work.
 */
export class RepositoryAgent implements AgentAdapter {
  readonly type = "repository" as const
  readonly name: string

  constructor(private readonly config: RepositoryAgentConfig) {
    this.name = `Repository Agent (${shortRepo(config.repository)})`
  }

  async run(context: AgentRunContext): Promise<AgentExecutionResult> {
    if (!context.sandboxes) {
      throw new GauntletError({
        code: "config_invalid",
        message: "Repository agents need Solari Sandbox. Set SOLARI_API_KEY to run them.",
      })
    }
    if (!context.cdpEndpoint) {
      throw new GauntletError({
        code: "config_invalid",
        message:
          "Repository agents need a browser endpoint they can reach. This is only available in Solari mode.",
      })
    }

    const repo = validateRepositoryUrl(this.config.repository)
    const logger = context.logger.child({ phase: "repository-agent" })

    let sandbox: SandboxEnvironment | undefined
    try {
      sandbox = await context.sandboxes.create({
        template: "base",
        timeoutMs: 20 * 60_000,
        metadata: { role: "agent", runId: context.runId },
        signal: context.signal,
      })
      logger.info("sandbox ready for the agent repository", { sandboxId: sandbox.sandboxId })
      context.recorder.log("sandbox created", { sandboxId: sandbox.sandboxId })

      await sandbox.run("mkdir", { args: ["-p", CLONE_PATH] })
      await sandbox.gitClone(repo.url, {
        path: CLONE_PATH,
        ...(this.config.branch ? { branch: this.config.branch } : {}),
        depth: 1,
      })
      context.recorder.log("repository cloned", { repository: repo.url, host: repo.host })

      const manifest = await this.loadManifest(sandbox)
      const workdir = manifest.workdir ? `${CLONE_PATH}/${manifest.workdir}` : CLONE_PATH

      if (manifest.install) {
        const install = await sandbox.run(manifest.install.command, {
          args: manifest.install.args,
          cwd: workdir,
          timeoutMs: manifest.installTimeoutMs,
        })
        context.recorder.log("install finished", { exitCode: install.exitCode })
        if (install.exitCode !== 0) {
          return {
            finishReason: "error",
            steps: 0,
            actions: [],
            message: `Install failed with exit code ${install.exitCode}.`,
            output: tail(install.stderr || install.stdout),
            errorCode: "install_failed",
          }
        }
      }

      // The task, the target and the browser endpoint — and nothing else. In
      // particular, no SOLARI_API_KEY: a repository we did not write has no
      // business being able to create sessions on the user's account.
      const env: Record<string, string> = {
        ...manifest.env,
        AGENT_GAUNTLET_TASK: context.task.description,
        AGENT_GAUNTLET_START_URL: context.startUrl,
        AGENT_GAUNTLET_CDP_ENDPOINT: context.cdpEndpoint,
        AGENT_GAUNTLET_RUN_ID: context.runId,
        AGENT_GAUNTLET_MAX_STEPS: String(context.maxSteps),
      }

      let stdout = ""
      const result = await sandbox.run(manifest.run.command, {
        args: manifest.run.args,
        cwd: workdir,
        env,
        timeoutMs: Math.min(manifest.timeoutMs, context.task.timeoutMs),
        onStdout: (chunk) => {
          stdout += chunk
        },
      })

      const claim = parseAgentClaim(result.stdout || stdout)
      context.recorder.log("agent process exited", { exitCode: result.exitCode, claimed: claim?.status })

      return {
        // Where the process ended, not whether the task succeeded — the
        // evaluator decides that, from state this agent cannot touch.
        finishReason: result.exitCode === 0 ? "finished" : "error",
        steps: claim?.steps ?? 0,
        actions: [],
        message: claim?.message ?? (result.exitCode === 0 ? "Agent exited cleanly." : `Agent exited ${result.exitCode}.`),
        output: tail(joinStreams(result.stdout, result.stderr)),
        ...(result.exitCode === 0 ? {} : { errorCode: "nonzero_exit" }),
      }
    } finally {
      // The VM bills until it is destroyed, and `close()` would only drop our
      // control channel.
      if (sandbox) {
        await sandbox.dispose().catch((error: unknown) =>
          logger.warn("could not destroy the agent sandbox", {
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }
  }

  private async loadManifest(sandbox: SandboxEnvironment): Promise<AgentManifest> {
    if (this.config.manifest?.run) {
      // An explicit override lets a repository without a manifest still be
      // tested, which matters for evaluating something you did not write.
      return parseManifest(JSON.stringify({ version: 1, ...this.config.manifest }))
    }
    let source: string
    try {
      source = await sandbox.readFile(`${CLONE_PATH}/${MANIFEST_FILENAME}`)
    } catch {
      throw new GauntletError({
        code: "repository_manifest_invalid",
        message: `The repository has no ${MANIFEST_FILENAME}. See docs/AGENT_CONTRACT.md.`,
      })
    }
    return parseManifest(source)
  }
}

function joinStreams(stdout: string, stderr: string): string {
  return stderr ? `${stdout}\n--- stderr ---\n${stderr}` : stdout
}

/** Output is capped: a chatty agent must not be able to exhaust our memory. */
function tail(text: string): string {
  const cap = LIMITS.maxAgentOutputBytes
  if (text.length <= cap) return text
  return `... (${text.length - cap} bytes truncated)\n${text.slice(-cap)}`
}

function shortRepo(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/|\.git$/g, "")
  } catch {
    return url
  }
}
