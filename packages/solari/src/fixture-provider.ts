import {
  GauntletError,
  HttpFixtureHost,
  nullLogger,
  sleep,
  type FixtureHost,
  type FixtureProvider,
  type Logger,
  type SandboxEnvironment,
  type SandboxProvider,
} from "@gauntlet/core"
import { getFixtureBundle } from "@gauntlet/fixture/bundle"

export interface SolariFixtureProviderOptions {
  sandboxes: SandboxProvider
  logger?: Logger
  /** In-guest port the shop listens on. */
  port?: number
  /** How long to wait for the preview URL to serve traffic. */
  readyTimeoutMs?: number
  metadata?: Record<string, string>
}

const INSTALL_DIR = "/opt/gauntlet"
const NODE_TARBALL =
  "https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz"

/**
 * USE CASE A — the controlled benchmark site, hosted by Solari Sandbox.
 *
 *   create sandbox → write the shop bundle → start it → expose the port on a
 *   public preview URL → run every browser in the suite against that URL →
 *   kill the sandbox when the suite is done.
 *
 * One sandbox serves the whole suite. That is not just thrift: Solari's free
 * plan allows exactly ONE concurrent sandbox, so a design that wanted one per
 * run would not run at all for most people. The shop isolates concurrent runs
 * by run id instead of by process.
 */
export class SolariFixtureProvider implements FixtureProvider {
  readonly kind = "sandbox" as const

  private readonly logger: Logger

  constructor(private readonly options: SolariFixtureProviderOptions) {
    this.logger = options.logger ?? nullLogger
  }

  async start(signal?: AbortSignal): Promise<FixtureHost> {
    const port = this.options.port ?? 3000
    let sandbox: SandboxEnvironment | undefined

    try {
      sandbox = await this.options.sandboxes.create({
        template: "base",
        // The idle window is rolling and resets on use, but a suite can be
        // quiet between runs, so it is generous.
        timeoutMs: 30 * 60_000,
        metadata: { role: "fixture", ...(this.options.metadata ?? {}) },
        ...(signal ? { signal } : {}),
      })

      const log = this.logger.child({ sandboxId: sandbox.sandboxId, phase: "fixture" })
      const nodeBinary = await this.ensureNode(sandbox, log)

      const bundle = await getFixtureBundle()
      await sandbox.run("mkdir", { args: ["-p", INSTALL_DIR] })
      await sandbox.writeFile(`${INSTALL_DIR}/gauntlet-shop.mjs`, bundle.code)
      log.info("uploaded the benchmark site", { bytes: bundle.bytes, hash: bundle.hash })

      // Backgrounded through an explicit shell: `commands.run` waits for exit,
      // so a foreground server would block until the sandbox idles out.
      await sandbox.run("sh", {
        args: [
          "-c",
          `cd ${INSTALL_DIR} && nohup ${nodeBinary} gauntlet-shop.mjs ${port} > ${INSTALL_DIR}/shop.log 2>&1 & echo started`,
        ],
      })

      const previewUrl = await sandbox.previewUrl(port)
      log.info("benchmark site exposed", { previewUrl })

      const host = new HttpFixtureHost("sandbox", previewUrl, previewUrl, async () => {
        await sandbox?.dispose()
      }, sandbox.sandboxId)

      await this.waitUntilServing(host, sandbox, log, signal)
      return host
    } catch (error) {
      await sandbox?.dispose()
      throw error instanceof GauntletError
        ? error
        : new GauntletError({
            code: "fixture_unavailable",
            message: "Could not stand up the benchmark site in a Solari sandbox.",
            detail: error instanceof Error ? error.message : String(error),
            cause: error,
          })
    }
  }

  /**
   * The `base` template's exact contents are not documented, so we probe rather
   * than assume. If Node is missing we fetch a pinned build — slower, but it
   * keeps the demo working on a template we do not control.
   */
  private async ensureNode(sandbox: SandboxEnvironment, log: Logger): Promise<string> {
    const probe = await sandbox.run("node", { args: ["--version"], timeoutMs: 20_000 })
    if (probe.exitCode === 0) {
      log.info("node is present in the sandbox template", { version: probe.stdout.trim() })
      return "node"
    }

    log.warn("node is not in the sandbox template; installing a pinned build", {
      probeExit: probe.exitCode,
    })
    const install = await sandbox.run("sh", {
      args: [
        "-c",
        `set -e; mkdir -p /opt/node; curl -fsSL ${NODE_TARBALL} -o /tmp/node.tar.xz; tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1; /opt/node/bin/node --version`,
      ],
      timeoutMs: 180_000,
    })
    if (install.exitCode !== 0) {
      throw new GauntletError({
        code: "fixture_unavailable",
        message: "The sandbox has no Node runtime and one could not be installed.",
        detail: install.stderr.slice(0, 2_000),
      })
    }
    log.info("installed node into the sandbox", { version: install.stdout.trim() })
    return "/opt/node/bin/node"
  }

  /** Poll the PUBLIC url — proving the browser can reach it, not just us. */
  private async waitUntilServing(
    host: FixtureHost,
    sandbox: SandboxEnvironment,
    log: Logger,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 60_000)
    let lastStatus = 0

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new GauntletError({ code: "cancelled", message: "Cancelled." })
      try {
        const res = await fetch(`${host.controlUrl}/__gauntlet/health`, { signal: signal ?? null })
        lastStatus = res.status
        if (res.ok) {
          log.info("benchmark site is serving", { url: host.baseUrl })
          return
        }
      } catch {
        // Preview routing takes a moment to propagate; keep waiting.
      }
      await sleep(1_500, signal)
    }

    // Pull the server's own log before giving up — it is the difference between
    // "the site crashed" and "the preview URL never routed".
    const serverLog = await sandbox
      .readFile(`${INSTALL_DIR}/shop.log`)
      .catch(() => "(no log available)")

    throw new GauntletError({
      code: "fixture_unavailable",
      message: "The benchmark site did not start inside the sandbox.",
      detail: `last HTTP status ${lastStatus || "none"}\n--- shop.log ---\n${serverLog.slice(0, 4_000)}`,
    })
  }
}
