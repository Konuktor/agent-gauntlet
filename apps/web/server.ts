import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync } from "node:fs"
import { join } from "node:path"
import next from "next"
import { assertPublicDeploymentIsSafe, parseEnv, type GauntletConfig } from "@gauntlet/config"
import { createLogger, type Logger } from "@gauntlet/core"
import { createDb, loadDotEnv, runMigrations, type DbHandle } from "@gauntlet/db"
/**
 * The web entrypoint.
 *
 * A custom server rather than `next start`, for three reasons that all still
 * hold on Northflank: it binds 0.0.0.0 on the platform's $PORT, it keeps
 * server-sent events alive past Node's default header timeout, and it applies
 * the schema before serving a single request.
 *
 * The worker is a SEPARATE service and is not started here.
 *
 * Responsibilities, in order:
 *   1. migrate, and fail loudly if it breaks
 *   2. serve on 0.0.0.0:$PORT
 *   3. shut down cleanly on SIGTERM
 */
loadDotEnv()

const config: GauntletConfig = parseEnv()
assertPublicDeploymentIsSafe(config)

const logger: Logger = createLogger(
  { component: "server", mode: config.resolvedMode },
  { level: config.LOG_LEVEL },
)

const port = config.PORT
const hostname = "0.0.0.0"

let db: DbHandle | undefined

async function main(): Promise<void> {
  // Migrations first, and fatal on failure: a service that serves traffic
  // against a half-migrated schema fails in far more confusing ways than one
  // that refuses to start.
  db = createDb({ max: 5 })
  logger.info("applying migrations")
  await runMigrations(db.db)
  logger.info("migrations applied")

  const app = next({ dev: false, dir: resolveAppDir(), hostname, port })
  await app.prepare()
  const handle = app.getRequestHandler()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res)
  })

  // Server-sent events for the live run view are long-lived by design; the
  // default 2-minute header timeout would cut them off mid-suite.
  server.keepAliveTimeout = 120_000
  server.headersTimeout = 125_000
  server.requestTimeout = 0

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, hostname, () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  logger.info("listening", { url: config.publicUrl, port, hostname })

  installShutdown(server)
}

/**
 * Graceful shutdown inside Render's window.
 *
 * Render sends SIGTERM and then SIGKILLs after `maxShutdownDelaySeconds` (30 on
 * our Blueprint). The order matters: stop taking new HTTP work, let the worker
 * drain so its own `finally` blocks release Solari sessions, then close the
 * pool. Anything still unfinished stays recoverable — the heartbeat/reclaim
 * logic requeues it on the next boot.
 */
function installShutdown(server: ReturnType<typeof createServer>): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn("second signal; exiting immediately")
      process.exit(1)
    }
    shuttingDown = true
    logger.info(`${signal} received; shutting down`)

    const deadline = setTimeout(() => {
      logger.error("shutdown exceeded its budget; forcing exit")
      process.exit(1)
    }, SHUTDOWN_BUDGET_MS)
    deadline.unref()

    server.close()
    server.closeIdleConnections?.()

    // Bounded: a leaked browser session bills until the plan deadline, so it is
    // worth waiting for the runner's cleanup — but not past our own budget.
    await db?.close().catch(() => {})

    clearTimeout(deadline)
    logger.info("shutdown complete")
    process.exit(0)
  }

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void shutdown(signal))
  }
}

/**
 * The directory holding the Next build.
 *
 * Running from source that is this file's own directory; running from the
 * bundle at `dist/server.js` it is one level up. Resolved rather than assumed,
 * so the artifact works wherever it is placed.
 */
function resolveAppDir(): string {
  const candidates = [import.meta.dirname, join(import.meta.dirname, "..")]
  const found = candidates.find((dir) => existsSync(join(dir, ".next", "BUILD_ID")))
  if (found) return found
  throw new Error(
    `No Next.js build found. Looked in:\n  ${candidates.join("\n  ")}\nRun \`pnpm build\` first.`,
  )
}

/** Draining budget for in-flight HTTP, including long-lived SSE streams. */
const SHUTDOWN_BUDGET_MS = 20_000

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error: unknown) => {
  logger.error("server failed to start", { error: describe(error) })
  process.exit(1)
})
