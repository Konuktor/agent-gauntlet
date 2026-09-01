import { HttpFixtureHost, type FixtureHost, type FixtureProvider } from "@gauntlet/core"
import { startFixtureServer, type FixtureServerHandle } from "@gauntlet/fixture"

/**
 * Hosts the Gauntlet Shop in this process, on localhost.
 *
 * Used by local mode, integration tests and product E2E. It speaks the same
 * HTTP control plane as the sandbox-hosted copy, so the orchestrator's code
 * path is identical either way.
 */
export class LocalFixtureProvider implements FixtureProvider {
  readonly kind = "local" as const

  constructor(private readonly options: { port?: number; host?: string } = {}) {}

  async start(): Promise<FixtureHost> {
    const handle = await startFixtureServer({
      port: this.options.port ?? 0,
      host: this.options.host ?? "127.0.0.1",
    })
    return new HttpFixtureHost("local", handle.url, handle.url, () => handle.close())
  }
}

/**
 * Points at an already-running fixture. This is the escape hatch when Solari's
 * port preview is unavailable (HTTP 501 where no preview domain is configured),
 * and the way to run a gauntlet against a fixture you host yourself.
 */
export class ExternalFixtureProvider implements FixtureProvider {
  readonly kind = "external" as const

  constructor(private readonly baseUrl: string) {}

  async start(signal?: AbortSignal): Promise<FixtureHost> {
    const host = new HttpFixtureHost("external", this.baseUrl, this.baseUrl, async () => {})
    await host.assertReachable(signal)
    return host
  }
}

export type { FixtureServerHandle }
