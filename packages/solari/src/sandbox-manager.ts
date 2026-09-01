import { SolariClient } from "@solarisdk/sdk"
import type { Sandbox } from "@solarisdk/sdk"
import { LIMITS } from "@gauntlet/config"
import {
  GauntletError,
  nullLogger,
  retry,
  type BackgroundProcess,
  type CommandOptions,
  type CommandOutput,
  type GitCloneOptions,
  type Logger,
  type SandboxCreateOptions,
  type SandboxEnvironment,
  type SandboxProvider,
} from "@gauntlet/core"
import { isRetryableInfrastructure, mapSolariError } from "./errors.js"

export interface SolariSandboxProviderOptions {
  apiKey: string
  baseUrl?: string
  logger?: Logger
  /** Tag every sandbox so orphans are identifiable in the Solari console. */
  metadata?: Record<string, string>
}

const DEFAULT_TEMPLATE = "base"
const DEFAULT_IDLE_MS = 15 * 60_000

/**
 * The only place in AgentGauntlet that talks to Solari Sandbox.
 *
 * Two things about the SDK shape everything here:
 *
 *   `commands.run(cmd, { args })` is NOT shell-interpreted. `run("ls -la")`
 *   looks for a binary literally named "ls -la". Every shell construct we need
 *   goes through an explicit `run("sh", { args: ["-c", "..."] })`, which is
 *   also why there is no command-string interpolation anywhere below.
 *
 *   `close()` only drops the local control channel; the VM keeps running and
 *   billing until its idle timeout. `kill()` is what actually destroys it, and
 *   it is called from a `finally` without exception.
 */
export class SolariSandboxProvider implements SandboxProvider {
  readonly mode = "solari" as const

  private readonly client: SolariClient
  private readonly logger: Logger
  private readonly live = new Set<string>()

  constructor(private readonly options: SolariSandboxProviderOptions) {
    // SolariClient (from @solarisdk/sdk) defaults baseUrl to
    // https://api.getsolari.com. The standalone SandboxClient does NOT — its
    // `baseUrl` is a required field despite what its README shows — which is
    // the main reason we use the umbrella client here.
    this.client = new SolariClient({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    })
    this.logger = options.logger ?? nullLogger
  }

  async create(options: SandboxCreateOptions = {}): Promise<SandboxEnvironment> {
    let sandbox: Sandbox | undefined
    try {
      sandbox = await retry(
        () =>
          this.client.sandboxes.create({
            template: options.template ?? DEFAULT_TEMPLATE,
            // The idle window is ROLLING — it resets on every use, it is not a
            // hard deadline — and the documented default differs between pages
            // (30m vs 2h), so we always set it explicitly.
            timeoutMs: options.timeoutMs ?? DEFAULT_IDLE_MS,
            // Kill rather than pause: a paused sandbox still occupies a plan
            // slot conceptually and we never want to resume one.
            lifecycle: { onTimeout: "kill" },
            ...(options.cpu ? { cpu: options.cpu } : {}),
            ...(options.memMb ? { memMb: options.memMb } : {}),
            ...(options.envs ? { envs: options.envs } : {}),
            ...(options.fromSnapshot ? { fromSnapshot: options.fromSnapshot } : {}),
            metadata: { app: "agent-gauntlet", ...(this.options.metadata ?? {}), ...(options.metadata ?? {}) },
          }),
        {
          attempts: 3,
          baseDelayMs: 1_000,
          ...(options.signal ? { signal: options.signal } : {}),
          shouldRetry: (error) => isRetryableInfrastructure(error),
          onRetry: (error, attempt, delayMs) =>
            this.logger.warn("retrying sandbox create", {
              attempt,
              delayMs,
              error: error instanceof Error ? error.message : String(error),
            }),
        },
      )

      this.live.add(sandbox.sandboxId)
      // Required before files / git / commands.start. A plain commands.run can
      // take a warm HTTP fast path without it, but everything else throws
      // ConnectionError if the channel is not open.
      await sandbox.connect()

      return new SolariSandboxEnvironment(sandbox, this.logger, () => {
        this.live.delete(sandbox!.sandboxId)
      })
    } catch (error) {
      if (sandbox) await this.killQuietly(sandbox)
      throw mapSolariError(error, "sandbox_create_failed")
    }
  }

  /** Sandboxes this provider believes are still live. Used by the leak audit. */
  outstandingSandboxes(): string[] {
    return [...this.live]
  }

  /**
   * Every sandbox this app has ever tagged that is still running. Used by the
   * acceptance test to prove cleanup, and by `gauntlet doctor` to find orphans
   * left behind by a hard kill.
   */
  async listOrphans(): Promise<Array<{ sandboxId: string; state: string }>> {
    const found: Array<{ sandboxId: string; state: string }> = []
    for await (const view of this.client.sandboxes.listAll({ state: "running" })) {
      if (view.metadata?.app === "agent-gauntlet") {
        found.push({ sandboxId: view.sandboxId, state: view.state })
      }
    }
    return found
  }

  async shutdown(): Promise<void> {
    for (const sandboxId of [...this.live]) {
      try {
        await this.client.sandboxes.kill(sandboxId)
      } catch (error) {
        this.logger.warn("sandbox kill during shutdown failed", {
          sandboxId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        this.live.delete(sandboxId)
      }
    }
  }

  private async killQuietly(sandbox: Sandbox): Promise<void> {
    try {
      await sandbox.kill()
    } catch (error) {
      this.logger.warn("sandbox kill failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

class SolariSandboxEnvironment implements SandboxEnvironment {
  private killed = false

  constructor(
    private readonly sandbox: Sandbox,
    private readonly logger: Logger,
    private readonly onDisposed: () => void,
  ) {}

  get sandboxId(): string {
    return this.sandbox.sandboxId
  }

  async writeFile(path: string, content: string | Uint8Array, mode?: number): Promise<void> {
    try {
      await this.sandbox.files.write(path, content, mode)
    } catch (error) {
      throw mapSolariError(error, "sandbox_command_failed")
    }
  }

  async readFile(path: string): Promise<string> {
    try {
      return await this.sandbox.files.readText(path)
    } catch (error) {
      throw mapSolariError(error, "sandbox_command_failed")
    }
  }

  async run(command: string, options: CommandOptions = {}): Promise<CommandOutput> {
    let stdout = ""
    let stderr = ""
    let truncated = false
    const cap = LIMITS.maxAgentOutputBytes

    const append = (target: "out" | "err", chunk: string) => {
      const current = target === "out" ? stdout : stderr
      if (current.length >= cap) {
        truncated = true
        return
      }
      const room = cap - current.length
      const next = current + (chunk.length > room ? chunk.slice(0, room) : chunk)
      if (chunk.length > room) truncated = true
      if (target === "out") stdout = next
      else stderr = next
    }

    try {
      const result = await this.sandbox.commands.run(command, {
        ...(options.args ? { args: options.args } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        onStdout: (chunk) => {
          append("out", chunk)
          options.onStdout?.(chunk)
        },
        onStderr: (chunk) => {
          append("err", chunk)
          options.onStderr?.(chunk)
        },
      })

      // A non-zero exit RESOLVES; it does not throw. A 200 from the gateway
      // means the call worked, not that the command did.
      return {
        exitCode: result.exitCode,
        stdout: stdout || result.stdout.slice(0, cap),
        stderr: stderr || result.stderr.slice(0, cap),
        truncated,
      }
    } catch (error) {
      throw mapSolariError(error, "sandbox_command_failed")
    }
  }

  async startBackground(command: string, options: CommandOptions = {}): Promise<BackgroundProcess> {
    try {
      const handle = await this.sandbox.commands.start(command, {
        ...(options.args ? { args: options.args } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.onStdout || options.onStderr
          ? {
              onStdout: options.onStdout ?? (() => {}),
              onStderr: options.onStderr ?? (() => {}),
            }
          : {}),
      })
      return {
        id: handle.cmdId,
        wait: () => handle.wait(),
        kill: async () => {
          await handle.kill()
        },
      }
    } catch (error) {
      throw mapSolariError(error, "sandbox_command_failed")
    }
  }

  async gitClone(url: string, options: GitCloneOptions): Promise<void> {
    try {
      await this.sandbox.git.clone(url, {
        path: options.path,
        ...(options.branch ? { branch: options.branch } : {}),
        depth: options.depth ?? 1,
      })
    } catch (error) {
      throw new GauntletError({
        code: "repository_invalid",
        message: "Could not clone that repository into the sandbox.",
        detail: error instanceof Error ? error.message : String(error),
        cause: error,
      })
    }
  }

  async previewUrl(port: number): Promise<string> {
    try {
      const { url } = await this.sandbox.previewUrl(port)
      return url
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      // A 501 here means the deployment has no preview domain configured; that
      // is a configuration fact, not a transient failure, and the user needs a
      // different instruction than "try again".
      throw new GauntletError({
        code: "preview_url_unavailable",
        message:
          "Solari could not expose the benchmark site publicly. Set GAUNTLET_FIXTURE_URL to a reachable fixture instead.",
        detail,
        cause: error,
      })
    }
  }

  async snapshot(name?: string): Promise<string> {
    try {
      return await this.sandbox.snapshot(name)
    } catch (error) {
      throw mapSolariError(error, "sandbox_command_failed")
    }
  }

  async dispose(): Promise<void> {
    if (this.killed) return
    this.killed = true
    try {
      // kill(), not close(). close() would drop our control channel and leave
      // the VM running — and billing — until its idle timeout.
      await this.sandbox.kill()
    } catch (error) {
      this.logger.warn("sandbox kill failed", {
        sandboxId: this.sandbox.sandboxId,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.onDisposed()
    }
  }
}
