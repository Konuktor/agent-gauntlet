import { randomUUID } from "node:crypto"
import { parseEnv, type GauntletConfig } from "@gauntlet/config"
import {
  GauntletRunner,
  sleep,
  taskDefinitionSchema,
  type Logger,
  type PlannedRun,
  type TaskDefinition,
} from "@gauntlet/core"
import {
  cancelOpenRuns,
  claimNextSuiteRun,
  createDb,
  getSuite,
  loadDotEnv,
  reclaimStaleSuiteRuns,
  releaseClaim,
  transitionSuiteRun,
  type DbHandle,
  type SuiteRun,
} from "@gauntlet/db"
import { resolvePerturbation } from "@gauntlet/perturbations"
import { DrizzleRunStore } from "./store.js"
import { createAgent, createRuntime, createTaskEvaluator, createWorkerLogger } from "./runtime.js"

loadDotEnv()

const config: GauntletConfig = parseEnv()
const workerId = `worker-${randomUUID().slice(0, 8)}`
const logger: Logger = createWorkerLogger(config, workerId)

const POLL_INTERVAL_MS = 1_500

let handle: DbHandle | undefined
let shuttingDown = false
let activeSuiteRunId: string | undefined
let activeController: AbortController | undefined

async function main(): Promise<void> {
  handle = createDb({ max: 5 })
  logger.info("worker started", {
    mode: config.resolvedMode,
    concurrency: config.GAUNTLET_MAX_CONCURRENCY,
  })

  // A worker killed mid-suite leaves rows nobody will pick up. Reclaiming on
  // start is what stops a `kill -9` from wedging a suite in `running` forever.
  const reclaimed = await reclaimStaleSuiteRuns(handle.db)
  if (reclaimed > 0) logger.warn("requeued abandoned suite runs", { count: reclaimed })

  while (!shuttingDown) {
    const claimed = await claimNextSuiteRun(handle.db, workerId).catch((error: unknown) => {
      logger.error("could not poll the queue", { error: describe(error) })
      return null
    })

    if (!claimed) {
      await sleep(POLL_INTERVAL_MS).catch(() => {})
      continue
    }

    await executeSuiteRun(claimed)
  }
}

async function executeSuiteRun(suiteRun: SuiteRun): Promise<void> {
  const db = handle!.db
  const runLogger = logger.child({ suiteRunId: suiteRun.id })
  activeSuiteRunId = suiteRun.id
  activeController = new AbortController()

  const suite = await getSuite(db, suiteRun.suiteId)
  if (!suite) {
    runLogger.error("suite vanished before it could run")
    await transitionSuiteRun(db, suiteRun.id, "failed", {
      errorCode: "config_invalid",
      errorMessage: "The suite this run belongs to no longer exists.",
      completedAt: new Date(),
    })
    return
  }

  const runtime = createRuntime(config, runLogger)
  try {
    const task = toTaskDefinition(suite.task)
    const agent = createAgent(
      {
        type: suite.agent.type,
        name: suite.agent.name,
        config: (suite.agent.configJson ?? {}) as Record<string, unknown>,
      },
      config,
    )

    const store = new DrizzleRunStore(db, suiteRun.id, workerId, runtime.artifacts)
    const runner = new GauntletRunner(
      {
        browsers: runtime.browsers,
        ...(runtime.sandboxes ? { sandboxes: runtime.sandboxes } : {}),
        fixtures: runtime.fixtures,
        agent,
        evaluator: createTaskEvaluator(task),
        store,
        logger: runLogger,
        resolve: (run: PlannedRun) =>
          resolvePerturbation({
            suiteRunId: suiteRun.id,
            individualRunId: run.id,
            variant: run.variant,
            repetition: run.repetition,
            seed: run.seed,
          }),
      },
      {
        suiteRunId: suiteRun.id,
        task,
        maxConcurrency: config.GAUNTLET_MAX_CONCURRENCY,
        // Recording is only meaningful on Solari; local mode captures rrweb
        // itself and labels it as a local capture.
        browserDefaults: { recording: true, stealth: false },
      },
    )

    const report = await runner.execute(activeController.signal)
    runLogger.info("suite finished", {
      reliability: report.metrics.reliability,
      passed: report.metrics.passedRuns,
      scored: report.metrics.scoredRuns,
    })
  } catch (error) {
    runLogger.error("suite run failed", { error: describe(error) })
  } finally {
    await runtime.shutdown().catch((error: unknown) =>
      runLogger.warn("runtime shutdown failed", { error: describe(error) }),
    )
    await releaseClaim(db, suiteRun.id).catch(() => {})
    activeSuiteRunId = undefined
    activeController = undefined
  }
}

function toTaskDefinition(row: {
  id: string
  name: string
  description: string
  startUrl: string
  maxSteps: number
  timeoutMs: number
  evaluatorConfigJson: unknown
}): TaskDefinition {
  return taskDefinitionSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    startUrl: row.startUrl,
    maxSteps: row.maxSteps,
    timeoutMs: row.timeoutMs,
    evaluatorConfig: row.evaluatorConfigJson,
  })
}

/**
 * Shut down without leaking anything.
 *
 * On the first signal the in-flight suite is cancelled, its open runs are marked
 * cancelled rather than left mid-flight, and the runtime releases every browser
 * session and sandbox it holds. A second signal exits immediately — at that
 * point the operator has asked twice and cleanup is their problem, but the
 * common case is handled properly.
 */
function installSignalHandlers(): void {
  let forced = false
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (forced) {
        logger.warn("second signal received; exiting immediately")
        process.exit(1)
      }
      forced = true
      shuttingDown = true
      logger.info(`${signal} received; finishing up`)
      activeController?.abort()

      void (async () => {
        try {
          if (handle && activeSuiteRunId) {
            const cancelled = await cancelOpenRuns(handle.db, activeSuiteRunId)
            await transitionSuiteRun(handle.db, activeSuiteRunId, "cancelled", {
              errorCode: "cancelled",
              errorMessage: "The worker shut down while this suite was running.",
              completedAt: new Date(),
            }).catch(() => {})
            logger.info("marked in-flight runs cancelled", { cancelled })
          }
        } finally {
          await handle?.close().catch(() => {})
          process.exit(0)
        }
      })()
    })
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

installSignalHandlers()

main()
  .catch((error: unknown) => {
    logger.error("worker crashed", { error: describe(error) })
    process.exitCode = 1
  })
  .finally(async () => {
    await handle?.close().catch(() => {})
  })
