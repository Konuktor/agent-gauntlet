import { LIMITS } from "@gauntlet/config"
import type { AgentAdapter } from "../ports/agent.js"
import type { BrowserEnvironment, BrowserProvider } from "../ports/browser.js"
import type { Evaluator } from "../ports/evaluator.js"
import type { FixtureHost } from "../ports/fixture.js"
import type { SandboxProvider } from "../ports/sandbox.js"
import { createMemoryRecorder, type RunRecorder } from "../domain/events.js"
import type { AgentExecutionResult } from "../domain/agent.js"
import type { EvaluationResult } from "../domain/evaluation.js"
import type { TaskDefinition } from "../domain/task.js"
import type { BrowserPerturbationOptions, FixturePerturbationConfig } from "../domain/perturbation.js"
import { classifyFailure, type Classification, type FailureEvidence } from "../failure/classifier.js"
import { GauntletError } from "../errors.js"
import { createRng } from "../random.js"
import { sleep, withTimeout, type Semaphore } from "../concurrency.js"
import { overlayProbeScript } from "../browser/page-scripts.js"
import type { Logger } from "../logger.js"
import type { PlannedRun, RunPatch, RunStore } from "./store.js"

export interface RunPipelineDeps {
  browsers: BrowserProvider
  sandboxes?: SandboxProvider
  agent: AgentAdapter
  evaluator: Evaluator
  fixture: FixtureHost
  store: RunStore
  logger: Logger
  browserSlots: Semaphore
  suiteRunId: string
  task: TaskDefinition
  /** Resolved per-run environment, supplied by the perturbation registry. */
  resolve(run: PlannedRun): {
    fixtureConfig: FixturePerturbationConfig
    browserOptions: BrowserPerturbationOptions
  }
  browserDefaults: { recording: boolean; stealth: boolean; proxy?: string; captcha?: boolean }
}

export interface RunOutcome {
  runId: string
  status: "passed" | "failed" | "infrastructure_error" | "cancelled"
  durationMs: number
}

/**
 * One individual run, start to finish.
 *
 * Every resource acquired here is released in a `finally`, and every failure is
 * converted into a recorded outcome rather than an exception that escapes: a
 * single bad run must never take the suite down with it (§16).
 */
export async function executeRun(
  deps: RunPipelineDeps,
  run: PlannedRun,
  signal: AbortSignal,
): Promise<RunOutcome> {
  const logger = deps.logger.child({
    individualRunId: run.id,
    variant: run.variant,
    repetition: run.repetition,
  })
  const recorder = createMemoryRecorder(LIMITS.maxEventsPerRun)
  const startedAt = Date.now()

  let environment: BrowserEnvironment | undefined
  let agentResult: AgentExecutionResult | null = null
  let evaluation: EvaluationResult | null = null
  let errorCode: string | null = null
  let errorDetail: string | undefined
  const urlHistory: string[] = []
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const networkErrors: Array<{ url: string; failure: string }> = []
  let overlayPresentAtEnd = false

  const finishAs = async (
    status: RunOutcome["status"],
    patch: RunPatch = {},
  ): Promise<RunOutcome> => {
    const durationMs = Date.now() - startedAt
    recorder.lifecycle("cleanup_complete")
    await deps.store.appendEvents(run.id, recorder.drain()).catch((error: unknown) =>
      logger.warn("could not persist run events", { error: describe(error) }),
    )
    await deps.store.updateRun(run.id, {
      status,
      completedAt: new Date(),
      durationMs,
      ...(agentResult ? { steps: agentResult.steps } : {}),
      ...patch,
    })
    return { runId: run.id, status, durationMs }
  }

  try {
    recorder.lifecycle("run_queued")
    await deps.store.updateRun(run.id, { status: "preparing_environment", startedAt: new Date() })
    recorder.lifecycle("environment_preparing")

    const resolved = deps.resolve(run)
    await deps.fixture.registerRun({
      runId: run.id,
      variant: run.variant,
      seed: run.seed,
      config: resolved.fixtureConfig as Record<string, unknown>,
      signal,
    })
    recorder.lifecycle("fixture_ready", { baseUrl: deps.fixture.baseUrl })

    // The browser slot is held only for as long as a browser actually exists.
    environment = await deps.browserSlots.run(
      () =>
        deps.browsers.create({
          recording: deps.browserDefaults.recording,
          stealth: deps.browserDefaults.stealth,
          ...(deps.browserDefaults.proxy ? { proxy: deps.browserDefaults.proxy } : {}),
          ...(deps.browserDefaults.captcha ? { captcha: true } : {}),
          perturbation: resolved.browserOptions,
          signal,
        }),
      signal,
    )
    recorder.lifecycle("session_created", { sessionId: environment.sessionId, mode: environment.mode })
    await deps.store.updateRun(run.id, { sessionId: environment.sessionId })

    wireSignals(environment, recorder, { urlHistory, consoleErrors, pageErrors, networkErrors })

    // ── agent ────────────────────────────────────────────────────────────────
    await deps.store.updateRun(run.id, { status: "running_agent" })
    recorder.lifecycle("agent_started", { agent: deps.agent.name })

    const startUrl = buildStartUrl(deps.fixture.baseUrl, deps.task.startUrl, run.id)
    const cdpEndpoint = deps.browsers.rawCdpEndpoint?.(environment)
    try {
      agentResult = await withTimeout(
        (timeoutSignal) =>
          deps.agent.run({
            runId: run.id,
            task: deps.task,
            startUrl,
            page: environment!.page,
            ...(deps.sandboxes ? { sandboxes: deps.sandboxes } : {}),
            // Only materialised here, only for the agent that needs it, and
            // never written to the store or the log.
            ...(cdpEndpoint ? { cdpEndpoint } : {}),
            maxSteps: deps.task.maxSteps,
            signal: timeoutSignal,
            recorder,
            logger,
            rng: createRng(run.seed),
          }),
        deps.task.timeoutMs,
        () =>
          new GauntletError({ code: "agent_timeout", message: "The agent ran out of time." }),
        signal,
      )
    } catch (error) {
      const mapped = GauntletError.from(error, "agent_crashed")
      if (mapped.code === "cancelled") throw mapped
      // A timed-out or crashed agent still gets evaluated: the point of the
      // product is that the evaluator decides, and "it crashed at step 9 with
      // the cart already correct" is a materially different result from "it
      // crashed having done nothing".
      agentResult = {
        finishReason: mapped.code === "agent_timeout" ? "timeout" : "error",
        steps: 0,
        actions: [],
        message: mapped.message,
        errorCode: mapped.code,
      }
      logger.warn("agent did not finish cleanly", { code: mapped.code })
    }
    recorder.lifecycle("agent_finished", {
      finishReason: agentResult.finishReason,
      steps: agentResult.steps,
    })

    overlayPresentAtEnd = await probeOverlay(environment)

    // ── evaluation ───────────────────────────────────────────────────────────
    await deps.store.updateRun(run.id, { status: "evaluating" })
    recorder.lifecycle("evaluation_started")
    try {
      evaluation = await deps.evaluator.evaluate({
        runId: run.id,
        task: deps.task,
        fixtureBaseUrl: deps.fixture.controlUrl,
        page: environment.page,
        agentResult,
        signal,
        logger,
      })
      recorder.evaluator({ success: evaluation.success, score: evaluation.score })
      await deps.store.saveEvaluation(run.id, evaluation)
    } catch (error) {
      const mapped = GauntletError.from(error, "evaluator_failed")
      errorCode = mapped.code
      errorDetail = mapped.detail
      logger.error("evaluation failed", {
        code: mapped.code,
        message: mapped.message,
        detail: mapped.detail?.slice(0, 1_000),
      })
    }
    recorder.lifecycle("evaluation_finished", { success: evaluation?.success ?? null })
  } catch (error) {
    const mapped = GauntletError.from(error, "internal")
    errorCode = mapped.code
    errorDetail = mapped.detail
    logger.error("run failed before it could be judged", {
      code: mapped.code,
      message: mapped.message,
      // The detail is the difference between a diagnosable failure and a shrug.
      detail: mapped.detail?.slice(0, 1_000),
    })
  } finally {
    // Release the browser BEFORE fetching the replay: the recording upload only
    // begins once the session is released.
    if (environment) {
      await environment.dispose().catch((error: unknown) =>
        logger.warn("browser dispose failed", { error: describe(error) }),
      )
      recorder.lifecycle("browser_released")
    }
    await deps.fixture.unregisterRun(run.id).catch(() => {})
  }

  if (errorCode === "cancelled") return finishAs("cancelled", { errorCode })

  // An infrastructure failure is OUR fault. Scoring it against the agent would
  // slander it, so it is recorded separately and excluded from reliability.
  if (!evaluation) {
    const classification = classifyFailure(
      buildEvidence(agentResult, null, errorCode, consoleErrors, pageErrors, networkErrors, urlHistory, overlayPresentAtEnd),
    )
    return finishAs("infrastructure_error", {
      errorCode: errorCode ?? "internal",
      failureCategory: classification.category,
      failureMessage: errorDetail ?? classification.message,
    })
  }

  // ── replay ───────────────────────────────────────────────────────────────
  const replay = await collectReplay(deps, run, environment, recorder, logger, signal)

  if (evaluation.success) {
    return finishAs("passed", { ...replay, errorCode: null, failureCategory: null, failureMessage: null })
  }

  const classification: Classification = classifyFailure(
    buildEvidence(agentResult, evaluation, null, consoleErrors, pageErrors, networkErrors, urlHistory, overlayPresentAtEnd),
  )
  logger.info("run failed", { category: classification.category, rule: classification.rule })
  return finishAs("failed", {
    ...replay,
    failureCategory: classification.category,
    failureMessage: classification.message,
  })
}

async function collectReplay(
  deps: RunPipelineDeps,
  run: PlannedRun,
  environment: BrowserEnvironment | undefined,
  recorder: RunRecorder,
  logger: Logger,
  signal: AbortSignal,
): Promise<RunPatch> {
  if (!environment?.recordingEnabled) return { replayStatus: "none" }

  await deps.store.updateRun(run.id, { status: "collecting_replay" })
  recorder.lifecycle("replay_pending")
  try {
    const artifact = await deps.browsers.fetchReplay(environment, signal)
    if (!artifact) {
      recorder.lifecycle("replay_failed")
      // Explicitly NOT a run failure. A replay is evidence infrastructure, and
      // its absence says nothing about whether the agent did the task (§34).
      return { replayStatus: "failed" }
    }
    const path = await deps.store.saveReplay(run.id, artifact.bytes)
    recorder.lifecycle("replay_available", { eventCount: artifact.eventCount })
    return {
      replayStatus: "available",
      replayEventCount: artifact.eventCount,
      replayBytes: artifact.bytes.length,
      replayArtifactPath: path,
    }
  } catch (error) {
    logger.warn("replay collection failed", { error: describe(error) })
    recorder.lifecycle("replay_failed")
    return { replayStatus: "failed" }
  }
}

function wireSignals(
  environment: BrowserEnvironment,
  recorder: RunRecorder,
  sinks: {
    urlHistory: string[]
    consoleErrors: string[]
    pageErrors: string[]
    networkErrors: Array<{ url: string; failure: string }>
  },
): void {
  environment.signals.onNavigation((url) => {
    // about:blank fires whenever a context spins up a page; it is browser
    // plumbing, not somewhere the agent went, and it drowns the real
    // navigations in the run timeline.
    if (url === "about:blank" || url.startsWith("chrome-error://")) return
    if (sinks.urlHistory.at(-1) !== url) {
      sinks.urlHistory.push(url)
      recorder.navigation(url)
    }
  })
  environment.signals.onConsole((level, text, url) => {
    if (level === "error") sinks.consoleErrors.push(text)
    recorder.console(level, text, url)
  })
  environment.signals.onPageError((message, stack) => {
    sinks.pageErrors.push(message)
    recorder.pageError(message, stack)
  })
  environment.signals.onRequestFailed((url, failure, method) => {
    sinks.networkErrors.push({ url, failure })
    recorder.networkError(url, failure, method)
  })
}

/** Was something painted over the page when the run ended? */
async function probeOverlay(environment: BrowserEnvironment): Promise<boolean> {
  try {
    if (environment.page.isClosed()) return false
    return await environment.page.evaluate<boolean>(overlayProbeScript())
  } catch {
    return false
  }
}

function buildEvidence(
  agentResult: AgentExecutionResult | null,
  evaluation: EvaluationResult | null,
  errorCode: string | null,
  consoleErrors: string[],
  pageErrors: string[],
  networkErrors: Array<{ url: string; failure: string }>,
  urlHistory: string[],
  overlayPresentAtEnd: boolean,
): FailureEvidence {
  const sessionExpired =
    evaluation?.evidence &&
    typeof evaluation.evidence === "object" &&
    (evaluation.evidence as { observed?: { sessionExpired?: boolean } }).observed?.sessionExpired === true

  return {
    agentResult,
    evaluation,
    errorCode: errorCode as FailureEvidence["errorCode"],
    consoleErrors,
    pageErrors,
    networkErrors,
    urlHistory,
    ...(sessionExpired ? { sessionExpired: true } : {}),
    overlayPresentAtEnd,
  }
}

/** Join the fixture's base URL with the task's start path and the run id. */
export function buildStartUrl(baseUrl: string, startPath: string, runId: string): string {
  if (/^https?:\/\//i.test(startPath)) return startPath
  const base = baseUrl.replace(/\/$/, "")
  const path = startPath.startsWith("/") ? startPath : `/${startPath}`
  const separator = path.includes("?") ? "&" : "?"
  return `${base}${path}${separator}run=${encodeURIComponent(runId)}`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { sleep }
