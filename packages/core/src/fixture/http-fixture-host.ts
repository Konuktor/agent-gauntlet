import { GauntletError } from "../errors.js"
import type { FixtureHost } from "../ports/fixture.js"

/** Shared HTTP client for the fixture control plane, whoever is hosting it. */
export class HttpFixtureHost implements FixtureHost {
  constructor(
    readonly kind: FixtureHost["kind"],
    readonly baseUrl: string,
    readonly controlUrl: string,
    private readonly onDispose: () => Promise<void>,
    readonly sandboxId?: string,
  ) {}

  async assertReachable(signal?: AbortSignal): Promise<void> {
    try {
      const res = await fetch(`${this.controlUrl}/__gauntlet/health`, { signal })
      if (!res.ok) throw new Error(`health check returned HTTP ${res.status}`)
    } catch (error) {
      throw new GauntletError({
        code: "fixture_unavailable",
        message: `The benchmark site at ${this.baseUrl} did not respond.`,
        detail: error instanceof Error ? error.message : String(error),
        cause: error,
      })
    }
  }

  async registerRun(input: {
    runId: string
    variant: string
    seed: number
    config: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<void> {
    const res = await fetch(`${this.controlUrl}/__gauntlet/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: input.runId,
        variant: input.variant,
        seed: input.seed,
        config: input.config,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    })
    if (!res.ok) {
      throw new GauntletError({
        code: "fixture_unavailable",
        message: "Could not configure the benchmark site for this run.",
        detail: `HTTP ${res.status} from ${this.controlUrl}/__gauntlet/session`,
      })
    }
  }

  async readState(runId: string, signal?: AbortSignal): Promise<unknown> {
    const res = await fetch(
      `${this.controlUrl}/__gauntlet/state?run=${encodeURIComponent(runId)}`,
      signal ? { signal } : {},
    )
    if (!res.ok) {
      throw new GauntletError({
        code: "evaluator_unavailable",
        message: "Could not read the benchmark site's state, so this run cannot be judged.",
        detail: `HTTP ${res.status} reading /__gauntlet/state`,
      })
    }
    return res.json()
  }

  async unregisterRun(runId: string): Promise<void> {
    // Best effort: a leaked run entry is evicted by the fixture's own retention
    // window, and failing teardown must not fail the run.
    try {
      await fetch(`${this.controlUrl}/__gauntlet/session?run=${encodeURIComponent(runId)}`, {
        method: "DELETE",
      })
    } catch {
      /* ignored */
    }
  }

  async dispose(): Promise<void> {
    await this.onDispose()
  }
}
