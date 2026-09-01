/**
 * The controlled benchmark site, however it happens to be hosted.
 *
 * Three implementations exist and the orchestrator cannot tell them apart:
 *   - a Solari Sandbox serving it on a public preview URL (real mode)
 *   - an in-process server on localhost (local mode and tests)
 *   - an already-running instance the operator pointed us at
 */
export interface FixtureHost {
  readonly kind: "sandbox" | "local" | "external"
  /** Base URL the BROWSER navigates to. Must be reachable from the browser,
   *  which in Solari mode is a remote machine — localhost will not do. */
  readonly baseUrl: string
  /** Base URL the WORKER reads authoritative state from. Usually the same, but
   *  kept separate so a sandbox could expose a private control path later. */
  readonly controlUrl: string
  readonly sandboxId?: string

  /** Tell the fixture how to behave for one run, before its browser starts. */
  registerRun(input: {
    runId: string
    variant: string
    seed: number
    config: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<void>

  /** The evaluator's ground truth, read server-to-server. */
  readState(runId: string, signal?: AbortSignal): Promise<unknown>

  unregisterRun(runId: string): Promise<void>

  /** Stop the process and destroy the sandbox. Always called from a finally. */
  dispose(): Promise<void>
}

export interface FixtureProvider {
  readonly kind: FixtureHost["kind"]
  start(signal?: AbortSignal): Promise<FixtureHost>
}
