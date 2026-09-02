import { randomUUID } from "node:crypto"
import type { GauntletConfig } from "@gauntlet/config"
import {
  GauntletError,
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
  reclaimStaleSuiteRuns,
  releaseClaim,
  transitionSuiteRun,
  type DbHandle,
  type SuiteRun,
} from "@gauntlet/db"
import { resolvePerturbation } from "@gauntlet/perturbations"
import { DrizzleRunStore } from "./store.js"
import type { Runtime } from "./runtime.js"
import { createAgent, createRuntime, createTaskEvaluator, createWorkerLogger } from "./runtime.js"

const POLL_INTERVAL_MS = 1_500

/** How often to sweep for suites abandoned by a dead or wedged claim. */
const RECLAIM_SWEEP_MS = 60_000

export interface WorkerRuntimeOptions {
  config: GauntletConfig
  /** Reuse an existing pool. The single-service deployment shares one with the
   *  web app rather than opening a second set of connections to a free
   *  Postgres, which has a small connection cap. */
  db?: DbHandle
  logger?: Logger
  workerId?: string
  pollIntervalMs?: number
}

export interface WorkerRuntime {
  readonly workerId: string
  /** Resolves when the loop exits, i.e. after `shutdown()`. */
  start(): Promise<void>
  /**
   * Stop claiming new work and let the in-flight suite finish, up to
   * `graceMs`. Past that the suite is cancelled so its Solari resources are
   * released rather than orphaned. Idempotent.
   */
  shutdown(graceMs?: number): Promise<void>
  readonly activeSuiteRunId: string | undefined
}

/**
 * The worker loop, as a controllable object rather than a script.
 *
 * Extracted so the single-service Render deployment can host it in the same
 * process as the web app WITHOUT a second copy of this logic. `apps/worker` is
 * now a thin binary around exactly the same runtime.
 */
export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const config = options.config
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`
  const logger = options.logger ?? createWorkerLogger(config, workerId)
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS

  // A pool we were handed belongs to the caller; one we opened is ours to close.
  const ownsDb = !options.db
  let handle: DbHandle | undefined = options.db
  let shuttingDown = false
  let activeSuiteRunId: string | undefined
  let activeController: AbortController | undefined
  let loop: Promise<void> | undefined

  /** Runs until {@link shutdown}. Callers launch it (`void start()`) rather
   *  than awaiting it: the returned promise settles only when the loop ends. */
  async function start(): Promise<void> {
    handle ??= createDb({ max: 5 })
    logger.info("worker started", {
      mode: config.resolvedMode,
      concurrency: config.GAUNTLET_MAX_CONCURRENCY,
    })

    // A worker killed mid-suite leaves rows nobody will pick up. Reclaiming on
    // start is what stops a `kill -9` from wedging a suite in `running` forever.
    const reclaimed = await reclaimStaleSuiteRuns(handle.db)
    if (reclaimed > 0) logger.warn("requeued abandoned suite runs", { count: reclaimed })

    loop = (async () => {
      let sinceLastSweep = 0

      while (!shuttingDown) {
        // Reclaiming only at boot is not enough: a suite abandoned while this
        // process keeps running would stay wedged until the next deploy, and
        // the one-suite-at-a-time limit would block everything behind it.
        sinceLastSweep += pollIntervalMs
        if (sinceLastSweep >= RECLAIM_SWEEP_MS) {
          sinceLastSweep = 0
          const requeued = await reclaimStaleSuiteRuns(handle!.db).catch((error: unknown) => {
            logger.warn("reclaim sweep failed", { error: describe(error) })
            return 0
          })
          if (requeued > 0) logger.warn("requeued abandoned suite runs", { count: requeued })
        }

        const claimed = await claimNextSuiteRun(handle!.db, workerId).catch((error: unknown) => {
          logger.error("could not poll the queue", { error: describe(error) })
          return null
        })

        if (!claimed) {
          await sleep(pollIntervalMs).catch(() => {})
          continue
        }

        await executeSuiteRun(claimed).catch((error: unknown) => {
          // executeSuiteRun already handles its own failures; this is the
          // last line of defence so one bad suite can never kill the worker.
          logger.error("suite execution escaped its handler", {
            suiteRunId: claimed.id,
            error: describe(error),
          })
        })
      }
    })()

    await loop
  }

  async function shutdown(graceMs = 15_000): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    logger.info("worker draining", { activeSuiteRunId })

    if (activeSuiteRunId) {
      // Give the in-flight suite a bounded chance to land on its own; its own
      // finally blocks release Solari resources far more cleanly than we can
      // from out here.
      const finished = await Promise.race([
        loop?.then(() => true) ?? Promise.resolve(true),
        sleep(graceMs).then(() => false),
      ])

      if (!finished && activeSuiteRunId) {
        logger.warn("grace period elapsed; cancelling the in-flight suite", { activeSuiteRunId })
        activeController?.abort()
        await loop?.catch(() => {})
        await markCancelled(activeSuiteRunId)
      }
    }

    if (ownsDb) await handle?.close().catch(() => {})
    logger.info("worker stopped")
  }

  async function markCancelled(suiteRunId: string): Promise<void> {
    if (!handle) return
    try {
      const cancelled = await cancelOpenRuns(handle.db, suiteRunId)
      await transitionSuiteRun(handle.db, suiteRunId, "cancelled", {
        errorCode: "cancelled",
        errorMessage: "The worker shut down while this suite was running.",
        completedAt: new Date(),
      }).catch(() => {})
      logger.info("marked in-flight runs cancelled", { cancelled })
    } catch (error) {
      logger.warn("could not mark the interrupted suite cancelled", { error: describe(error) })
    }
  }

  async function executeSuiteRun(suiteRun: SuiteRun): Promise<void> {
    const db = handle!.db
    const runLogger = logger.child({ suiteRunId: suiteRun.id })
    activeSuiteRunId = suiteRun.id
    activeController = new AbortController()

    // Everything below is inside the try. Building the runtime can fail for
    // ordinary environment reasons — no Playwright browser installed, a Solari
    // key that turns out to be invalid — and a throw from outside the
    // try/finally would leave the claim held, the suite stuck in `preparing`,
    // and (because the loop awaits this) the whole worker dead.
    let runtime: Runtime | undefined
    try {
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

      runtime = await createRuntime(config, runLogger)
      const task = toTaskDefinition(suite.task)
      const agent = await createAgent(
        {
          type: suite.agent.type,
          name: suite.agent.name,
          config: (suite.agent.configJson ?? {}) as Record<string, unknown>,
        },
        config,
      )

      const store = new DrizzleRunStore(db, suiteRun.id, workerId, runtime.mode)
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
      // The GauntletRunner marks its own failures terminal, but a failure
      // BEFORE it starts — building the runtime, resolving the agent — would
      // otherwise leave the suite stuck in `preparing` forever. With
      // one-suite-at-a-time limiting, one such wedge blocks every future run.
      await transitionSuiteRun(db, suiteRun.id, "failed", {
        errorCode: error instanceof GauntletError ? error.code : "internal",
        errorMessage: describe(error),
        completedAt: new Date(),
      }).catch((cause: unknown) => {
        // Usually benign: the runner already reached a terminal state and the
        // state machine refused the second write. Anything else means the run
        // really is stuck, so it must not be swallowed silently.
        runLogger.warn("could not mark the failed suite terminal", { error: describe(cause) })
      })
      // A terminal suite must leave nothing alive behind it. Observed for real:
      // a suite failed with `solari_concurrency` while four individual runs
      // stayed in `running_agent` forever, so the dashboard showed a finished
      // suite whose runs were still going.
      const stranded = await cancelOpenRuns(db, suiteRun.id).catch(() => 0)
      if (stranded > 0) runLogger.warn("cancelled runs stranded by the failure", { count: stranded })
    } finally {
      await runtime?.shutdown().catch((error: unknown) =>
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

  return {
    workerId,
    start,
    shutdown,
    get activeSuiteRunId() {
      return activeSuiteRunId
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
