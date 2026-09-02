import { parseEnv, assertPublicDeploymentIsSafe, type GauntletConfig } from "@gauntlet/config"
import { loadDotEnv } from "@gauntlet/db"
import { createWorkerLogger } from "./runtime.js"
import { createWorkerRuntime } from "./worker-runtime.js"

/**
 * The standalone worker binary.
 *
 * Deliberately thin: every line of queue and execution logic lives in
 * `worker-runtime.ts`, so the single-service Render deployment runs the exact
 * same code rather than a second implementation of it.
 */
loadDotEnv()

const config: GauntletConfig = parseEnv()
assertPublicDeploymentIsSafe(config)

const worker = createWorkerRuntime({ config })
const logger = createWorkerLogger(config, worker.workerId)

let stopping = false
let drainingSince = 0

/**
 * How long a repeat signal is ignored.
 *
 * A second Ctrl+C is a human saying "I mean it", and it should still work. A
 * platform that sends SIGTERM twice in the same instant is not saying that —
 * and honouring it cost us three live Solari browser sessions during a deploy,
 * which then held the free plan's whole concurrency budget until they expired
 * and failed the next suite with `solari_concurrency`. Draining is what
 * releases those sessions, so it gets a few seconds of protection.
 */
const PANIC_EXIT_AFTER_MS = 5_000

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) {
      const draining = Date.now() - drainingSince
      if (draining < PANIC_EXIT_AFTER_MS) {
        logger.info("already draining; ignoring repeat signal", { signal, drainingMs: draining })
        return
      }
      logger.warn("second signal received; exiting immediately", { drainingMs: draining })
      process.exit(1)
    }
    drainingSince = Date.now()
    stopping = true
    logger.info(`${signal} received; draining`)
    void worker
      .shutdown()
      .catch((error: unknown) =>
        logger.error("shutdown failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => process.exit(0))
  })
}

worker.start().catch((error: unknown) => {
  logger.error("worker crashed", { error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
