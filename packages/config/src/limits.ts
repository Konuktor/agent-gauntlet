/**
 * Hard product limits. These are not configuration — they are the ceilings that
 * protect the user's Solari balance and this process's memory, and every
 * configurable value is clamped into them.
 */
export const LIMITS = {
  /** Runs in a single suite. A suite is variants x repetitions, and each run is
   *  one browser session, so this is the primary cost ceiling. */
  maxRunsPerSuite: 200,
  /** Concurrent browser sessions. Solari's Free plan allows 3. */
  maxConcurrency: 32,
  /** Concurrent sandboxes. Solari's Free plan allows 1. */
  maxSandboxes: 8,
  /** Repetitions per variant offered in the UI. */
  maxRepetitions: 10,
  /** Agent steps in a single run, whatever the task asks for. */
  maxSteps: 60,
  /** Wall-clock ceiling for one run, including environment setup. */
  maxRunTimeoutMs: 10 * 60_000,
  /** Wall-clock ceiling for a repository agent's install phase. */
  maxInstallTimeoutMs: 10 * 60_000,
  /** Characters of task description accepted from a user. */
  maxTaskDescriptionChars: 4_000,
  /** Bytes of stdout/stderr retained from a repository agent. Beyond this the
   *  stream is truncated with a marker rather than buffered. */
  maxAgentOutputBytes: 256 * 1024,
  /** Bytes of rrweb replay retained per run. Replays are evidence, not truth,
   *  so an oversized one is truncated rather than allowed to exhaust disk. */
  maxReplayBytes: 8 * 1024 * 1024,
  /** Events persisted per run. */
  maxEventsPerRun: 2_000,
  /**
   * Attempts when polling for an async replay upload (~3s apart).
   *
   * The docs suggest the first poll 404s for a second or two. A real 36s
   * session on Solari took longer than the old 10-attempt (~30s) budget and
   * the replay was recorded as `failed` on an otherwise perfect run. Waiting
   * costs nothing that matters: the browser session is already released, so
   * no credits accrue, and a replay is evidence rather than a verdict — if it
   * never arrives the run's pass/fail is untouched.
   */
  replayPollAttempts: 25,
  replayPollIntervalMs: 3_000,
} as const

export type Limits = typeof LIMITS
