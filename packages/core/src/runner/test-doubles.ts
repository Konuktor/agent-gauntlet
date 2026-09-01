import { computeSuiteMetrics, type SuiteMetrics } from "../metrics/reliability.js"
import type { IndividualRunStatus, SuiteRunStatus } from "../domain/run.js"
import type { EvaluationResult } from "../domain/evaluation.js"
import type { RunEventInput } from "../domain/events.js"
import type { AgentAdapter, AgentRunContext } from "../ports/agent.js"
import type {
  BrowserEnvironment,
  BrowserEnvironmentOptions,
  BrowserProvider,
  ReplayArtifact,
} from "../ports/browser.js"
import type { Evaluator, EvaluationContext } from "../ports/evaluator.js"
import type { FixtureHost, FixtureProvider } from "../ports/fixture.js"
import type { PageDriver, PageSignals } from "../ports/page.js"
import type { AgentExecutionResult } from "../domain/agent.js"
import type { PlannedRun, RunPatch, RunStore } from "./store.js"

/** In-memory doubles for the orchestrator's ports, so a suite where the browser
 *  dies and the evaluator 500s is a few lines of setup rather than chaos
 *  engineering against real infrastructure. */

export class MemoryRunStore implements RunStore {
  readonly runs = new Map<string, PlannedRun & RunPatch>()
  readonly events = new Map<string, RunEventInput[]>()
  readonly evaluations = new Map<string, EvaluationResult>()
  readonly replays = new Map<string, Uint8Array>()
  readonly suiteStatuses: SuiteRunStatus[] = []
  heartbeats = 0
  suitePatch: Record<string, unknown> = {}

  constructor(planned: PlannedRun[]) {
    for (const run of planned) this.runs.set(run.id, { ...run })
  }

  async listPlannedRuns(): Promise<PlannedRun[]> {
    return [...this.runs.values()].map((r) => ({
      id: r.id,
      variant: r.variant,
      variantName: r.variantName,
      repetition: r.repetition,
      seed: r.seed,
      status: r.status as IndividualRunStatus,
    }))
  }

  async setSuiteStatus(status: SuiteRunStatus, patch: Record<string, unknown> = {}): Promise<void> {
    this.suiteStatuses.push(status)
    Object.assign(this.suitePatch, patch)
  }

  async updateRun(runId: string, patch: RunPatch): Promise<void> {
    const current = this.runs.get(runId)
    if (!current) throw new Error(`unknown run ${runId}`)
    this.runs.set(runId, { ...current, ...patch })
  }

  async appendEvents(runId: string, events: RunEventInput[]): Promise<void> {
    this.events.set(runId, [...(this.events.get(runId) ?? []), ...events])
  }

  async saveEvaluation(runId: string, result: EvaluationResult): Promise<void> {
    this.evaluations.set(runId, result)
  }

  async refreshMetrics(): Promise<SuiteMetrics> {
    return computeSuiteMetrics(
      [...this.runs.values()].map((r) => ({
        variant: r.variant,
        variantName: r.variantName,
        category: r.variant === "baseline" ? "none" : "ui",
        repetition: r.repetition,
        status: (r.status ?? "queued") as IndividualRunStatus,
        durationMs: r.durationMs ?? null,
        steps: r.steps ?? null,
        failureCategory: (r.failureCategory ?? null) as never,
      })),
    )
  }

  async heartbeat(): Promise<void> {
    this.heartbeats += 1
  }

  async saveReplay(runId: string, bytes: Uint8Array): Promise<string> {
    this.replays.set(runId, bytes)
    return `/artifacts/${runId}.ndjson.gz`
  }

  statusOf(runId: string): IndividualRunStatus {
    return (this.runs.get(runId)?.status ?? "queued") as IndividualRunStatus
  }

  lifecyclePhases(runId: string): string[] {
    return (this.events.get(runId) ?? [])
      .filter((e) => e.type === "lifecycle")
      .map((e) => String(e.payload.phase))
  }
}

export function fakePage(url = "https://shop.test/"): PageDriver {
  let current = url
  return {
    url: () => current,
    title: async () => "Fake",
    goto: async (next) => {
      current = next
    },
    evaluate: async <T,>() => false as T,
    clickSelector: async () => {},
    fillSelector: async () => {},
    press: async () => {},
    waitForTimeout: async () => {},
    screenshot: async () => new Uint8Array(),
    isClosed: () => false,
  }
}

const noopSignals: PageSignals = {
  onConsole: () => {},
  onPageError: () => {},
  onRequestFailed: () => {},
  onNavigation: () => {},
}

export interface FakeBrowserOptions {
  /** Throw on create for runs whose index is in this set. */
  failCreateFor?: Set<number>
  /** Throw on dispose, to prove teardown errors never mask a result. */
  throwOnDispose?: boolean
  replay?: ReplayArtifact | null
  replayThrows?: boolean
  recording?: boolean
}

export class FakeBrowserProvider implements BrowserProvider {
  readonly mode = "local" as const
  readonly created: BrowserEnvironment[] = []
  readonly disposed: string[] = []
  /** Peak simultaneous live environments — asserts the concurrency cap. */
  peakConcurrent = 0
  private live = 0
  private index = 0
  shutdownCalls = 0

  constructor(private readonly options: FakeBrowserOptions = {}) {}

  async create(options: BrowserEnvironmentOptions): Promise<BrowserEnvironment> {
    const index = this.index++
    if (this.options.failCreateFor?.has(index)) {
      throw new Error(`browser create failed for run ${index}`)
    }
    this.live += 1
    this.peakConcurrent = Math.max(this.peakConcurrent, this.live)
    const id = `env-${index}`
    const self = this
    const environment: BrowserEnvironment = {
      id,
      sessionId: `sess-${index}`,
      mode: "local",
      recordingEnabled: this.options.recording ?? options.recording,
      page: fakePage(),
      signals: noopSignals,
      dispose: async () => {
        if (!self.disposed.includes(id)) {
          self.disposed.push(id)
          self.live -= 1
        }
        if (self.options.throwOnDispose) throw new Error("dispose exploded")
      },
    }
    this.created.push(environment)
    return environment
  }

  async fetchReplay(): Promise<ReplayArtifact | null> {
    if (this.options.replayThrows) throw new Error("replay service is down")
    return this.options.replay ?? null
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1
  }
}

export class FakeFixtureProvider implements FixtureProvider {
  readonly kind = "local" as const
  host: FakeFixtureHost | undefined

  constructor(private readonly options: { failStart?: boolean; sandboxId?: string } = {}) {}

  async start(): Promise<FixtureHost> {
    if (this.options.failStart) throw new Error("fixture would not start")
    this.host = new FakeFixtureHost(this.options.sandboxId)
    return this.host
  }
}

export class FakeFixtureHost implements FixtureHost {
  readonly kind = "local" as const
  readonly baseUrl = "https://fixture.test"
  readonly controlUrl = "https://fixture.test"
  readonly registered: string[] = []
  readonly unregistered: string[] = []
  disposeCalls = 0

  constructor(readonly sandboxId?: string) {}

  async registerRun(input: { runId: string }): Promise<void> {
    this.registered.push(input.runId)
  }
  async readState(): Promise<unknown> {
    return {}
  }
  async unregisterRun(runId: string): Promise<void> {
    this.unregistered.push(runId)
  }
  async dispose(): Promise<void> {
    this.disposeCalls += 1
  }
}

export class FakeAgent implements AgentAdapter {
  readonly type = "reference" as const
  readonly name = "Fake Agent"
  readonly seen: string[] = []

  constructor(
    private readonly behaviour: (context: AgentRunContext) => Promise<AgentExecutionResult> = async () => ({
      finishReason: "finished",
      steps: 5,
      actions: [],
      message: "done",
    }),
  ) {}

  async run(context: AgentRunContext): Promise<AgentExecutionResult> {
    this.seen.push(context.runId)
    return this.behaviour(context)
  }
}

export class FakeEvaluator implements Evaluator {
  readonly kind = "fake"
  calls = 0

  constructor(
    private readonly behaviour: (context: EvaluationContext) => Promise<EvaluationResult> = async () => ({
      success: true,
      score: 1,
      assertions: [],
      evidence: {},
    }),
  ) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    this.calls += 1
    return this.behaviour(context)
  }
}

export function plannedRuns(variants: string[], repetitions: number): PlannedRun[] {
  return variants.flatMap((variant) =>
    Array.from({ length: repetitions }, (_, i) => ({
      id: `${variant}-${i + 1}`,
      variant,
      variantName: variant,
      repetition: i + 1,
      seed: 1000 + i,
      status: "queued" as IndividualRunStatus,
    })),
  )
}

export function failedEvaluation(): EvaluationResult {
  return {
    success: false,
    score: 0.5,
    assertions: [
      {
        name: "coupon_applied",
        description: "coupon SAVE20 is applied",
        expected: "SAVE20",
        actual: null,
        passed: false,
        weight: 1,
      },
    ],
    evidence: {},
  }
}
