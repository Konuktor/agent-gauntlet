export const runEventTypes = [
  "lifecycle",
  "navigation",
  "agent_action",
  "console",
  "page_error",
  "network_error",
  "screenshot",
  "evaluator",
  "log",
] as const
export type RunEventType = (typeof runEventTypes)[number]

export interface RunEventInput {
  type: RunEventType
  timestamp: Date
  payload: Record<string, unknown>
}

export interface RunEvent extends RunEventInput {
  id: string
  individualRunId: string
  sequence: number
}

/** The lifecycle beats we always record, so a run's timeline is comparable. */
export const lifecyclePhases = [
  "run_queued",
  "environment_preparing",
  "session_created",
  "fixture_ready",
  "agent_started",
  "agent_finished",
  "evaluation_started",
  "evaluation_finished",
  "replay_pending",
  "replay_available",
  "replay_failed",
  "browser_released",
  "cleanup_complete",
] as const
export type LifecyclePhase = (typeof lifecyclePhases)[number]

/** Collector interface the run pipeline writes through. Implementations
 *  persist to Postgres; tests use an in-memory one. */
export interface RunRecorder {
  lifecycle(phase: LifecyclePhase, payload?: Record<string, unknown>): void
  navigation(url: string): void
  action(record: unknown): void
  console(level: string, text: string, url?: string): void
  pageError(message: string, stack?: string): void
  networkError(url: string, failure: string, method?: string): void
  screenshot(label: string, path: string): void
  evaluator(payload: Record<string, unknown>): void
  log(message: string, payload?: Record<string, unknown>): void
  /** Everything buffered so far, in order. */
  drain(): RunEventInput[]
}

export function createMemoryRecorder(maxEvents: number): RunRecorder {
  const events: RunEventInput[] = []
  let dropped = 0

  const push = (type: RunEventType, payload: Record<string, unknown>) => {
    if (events.length >= maxEvents) {
      dropped += 1
      return
    }
    events.push({ type, timestamp: new Date(), payload })
  }

  return {
    lifecycle: (phase, payload) => push("lifecycle", { phase, ...(payload ?? {}) }),
    navigation: (url) => push("navigation", { url }),
    action: (record) => push("agent_action", record as Record<string, unknown>),
    console: (level, text, url) => push("console", { level, text, url }),
    pageError: (message, stack) => push("page_error", { message, stack }),
    networkError: (url, failure, method) => push("network_error", { url, failure, method }),
    screenshot: (label, path) => push("screenshot", { label, path }),
    evaluator: (payload) => push("evaluator", payload),
    log: (message, payload) => push("log", { message, ...(payload ?? {}) }),
    drain: () => {
      const out = events.slice()
      if (dropped > 0) {
        out.push({
          type: "log",
          timestamp: new Date(),
          payload: { message: `${dropped} further events dropped (per-run cap reached)` },
        })
      }
      return out
    },
  }
}
