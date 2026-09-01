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
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) {
      logger.warn("second signal received; exiting immediately")
      process.exit(1)
    }
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
