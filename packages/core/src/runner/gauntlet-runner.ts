import { LIMITS } from "@gauntlet/config"
import { GauntletError } from "../errors.js"
import { mapWithConcurrency, Semaphore } from "../concurrency.js"
import type { Logger } from "../logger.js"
import type { SuiteMetrics } from "../metrics/reliability.js"
import type { AgentAdapter } from "../ports/agent.js"
import type { BrowserProvider } from "../ports/browser.js"
import type { Evaluator } from "../ports/evaluator.js"
import type { FixtureHost, FixtureProvider } from "../ports/fixture.js"
import type { SandboxProvider } from "../ports/sandbox.js"
import type {
  BrowserPerturbationOptions,
  FixturePerturbationConfig,
} from "../domain/perturbation.js"
import type { TaskDefinition } from "../domain/task.js"
import { executeRun, type RunOutcome } from "./run-pipeline.js"
import type { PlannedRun, RunStore } from "./store.js"

export interface GauntletRunnerDeps {
  browsers: BrowserProvider
  fixtures: FixtureProvider
  sandboxes?: SandboxProvider
  agent: AgentAdapter
  evaluator: Evaluator
  store: RunStore
  logger: Logger
  resolve(run: PlannedRun): {
    fixtureConfig: FixturePerturbationConfig
    browserOptions: BrowserPerturbationOptions
  }
}

export interface GauntletRunnerOptions {
  suiteRunId: string
  task: TaskDefinition
  maxConcurrency: number
  browserDefaults?: { recording?: boolean; stealth?: boolean; proxy?: string; captcha?: boolean }
  heartbeatIntervalMs?: number
}

export interface SuiteRunReport {
  metrics: SuiteMetrics
  outcomes: RunOutcome[]
  fixtureSandboxId?: string
}

/**
 * Executes one gauntlet: the whole variant x repetition grid, with bounded
 * concurrency, against one shared benchmark site.
 *
 * Two rules shape the whole design.
 *
 * First, resource discipline. Every browser session and every sandbox costs
 * money for as long as it exists, and nothing here notices if one leaks. So the
 * fixture is torn down in a `finally`, the browser providers are shut down in a
 * `finally`, and each run releases its own session even when it fails
 * mid-construction.
 *
 * Second, no automatic agent retries (§17). Infrastructure may retry; the agent
 * never does. The entire product exists to measure how often an agent fails, so
 * quietly re-running a failed attempt would be measuring the wrong thing and
 * reporting a number that flatters the agent.
 */
export class GauntletRunner {
  constructor(
    private readonly deps: GauntletRunnerDeps,
    private readonly options: GauntletRunnerOptions,
  ) {}

  async execute(signal: AbortSignal): Promise<SuiteRunReport> {
    const logger = this.deps.logger.child({ suiteRunId: this.options.suiteRunId })
    const runs = await this.deps.store.listPlannedRuns()

    if (runs.length === 0) {
      throw new GauntletError({
        code: "config_invalid",
        message: "This suite has no runs to execute. Select at least one variant.",
      })
    }
    if (runs.length > LIMITS.maxRunsPerSuite) {
      throw new GauntletError({
        code: "config_invalid",
        message: `A suite may not exceed ${LIMITS.maxRunsPerSuite} runs. This one asks for ${runs.length}.`,
      })
    }

    const concurrency = Math.max(1, Math.min(this.options.maxConcurrency, LIMITS.maxConcurrency))
    logger.info("gauntlet starting", {
      runs: runs.length,
      concurrency,
      agent: this.deps.agent.name,
    })

    await this.deps.store.setSuiteStatus("preparing")

    let fixture: FixtureHost | undefined
    const stopHeartbeat = this.startHeartbeat(logger)

    try {
      fixture = await this.deps.fixtures.start(signal)
      logger.info("benchmark site ready", { kind: fixture.kind, sandboxId: fixture.sandboxId })
      await this.deps.store.setSuiteStatus("running", {
        ...(fixture.sandboxId ? { fixtureSandboxId: fixture.sandboxId } : {}),
      })

      const browserSlots = new Semaphore(concurrency)
      const scopedFixture = fixture

      const settled = await mapWithConcurrency(runs, concurrency, (run) =>
        executeRun(
          {
            browsers: this.deps.browsers,
            ...(this.deps.sandboxes ? { sandboxes: this.deps.sandboxes } : {}),
            agent: this.deps.agent,
            evaluator: this.deps.evaluator,
            fixture: scopedFixture,
            store: this.deps.store,
            logger,
            browserSlots,
            suiteRunId: this.options.suiteRunId,
            task: this.options.task,
            resolve: this.deps.resolve,
            browserDefaults: {
              recording: this.options.browserDefaults?.recording ?? true,
              stealth: this.options.browserDefaults?.stealth ?? false,
              ...(this.options.browserDefaults?.proxy
                ? { proxy: this.options.browserDefaults.proxy }
                : {}),
              ...(this.options.browserDefaults?.captcha ? { captcha: true } : {}),
            },
          },
          run,
          signal,
        ),
      )

      const outcomes: RunOutcome[] = []
      for (const [index, result] of settled.entries()) {
        if (result.status === "fulfilled") {
          outcomes.push(result.value)
          continue
        }
        // executeRun is written not to throw, so reaching here means a defect
        // in the pipeline itself. The run is still accounted for rather than
        // silently vanishing from the denominator.
        const run = runs[index]!
        logger.error("run threw out of the pipeline", {
          individualRunId: run.id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
        await this.deps.store
          .updateRun(run.id, {
            status: "infrastructure_error",
            completedAt: new Date(),
            errorCode: "internal",
            failureCategory: "unknown",
            failureMessage: "The run failed unexpectedly inside the orchestrator.",
          })
          .catch(() => {})
        outcomes.push({ runId: run.id, status: "infrastructure_error", durationMs: 0 })
      }

      // Finalisation happens even when individual runs failed — a suite where
      // half the runs broke is a result, not a crash.
      await this.deps.store.setSuiteStatus("evaluating")
      const metrics = await this.deps.store.refreshMetrics()
      await this.deps.store.setSuiteStatus("completed", { completedAt: new Date() })

      logger.info("gauntlet complete", {
        reliability: metrics.reliability,
        passed: metrics.passedRuns,
        scored: metrics.scoredRuns,
        infrastructureErrors: metrics.infrastructureErrors,
      })

      return {
        metrics,
        outcomes,
        ...(fixture.sandboxId ? { fixtureSandboxId: fixture.sandboxId } : {}),
      }
    } catch (error) {
      const mapped = GauntletError.from(error, "internal")
      logger.error("gauntlet failed", { code: mapped.code, message: mapped.message })
      await this.deps.store
        .setSuiteStatus(mapped.code === "cancelled" ? "cancelled" : "failed", {
          errorCode: mapped.code,
          errorMessage: mapped.message,
          completedAt: new Date(),
        })
        .catch(() => {})
      throw mapped
    } finally {
      stopHeartbeat()
      // The sandbox hosting the benchmark site bills until it is killed, and
      // nothing else in the system will notice if this is skipped.
      if (fixture) {
        await fixture.dispose().catch((error: unknown) =>
          logger.warn("could not tear down the benchmark site", {
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }
  }

  private startHeartbeat(logger: Logger): () => void {
    const interval = this.options.heartbeatIntervalMs ?? 15_000
    const timer = setInterval(() => {
      void this.deps.store.heartbeat().catch((error: unknown) =>
        logger.warn("heartbeat failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }, interval)
    timer.unref?.()
    return () => clearInterval(timer)
  }
}
