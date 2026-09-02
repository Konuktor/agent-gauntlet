import {
  ArtifactStore,
  GauntletError,
  createLogger,
  type AgentAdapter,
  type BrowserProvider,
  type Evaluator,
  type FixtureProvider,
  type Logger,
  type SandboxProvider,
  type TaskDefinition,
} from "@gauntlet/core"
import type { GauntletConfig } from "@gauntlet/config"
import {
  HeuristicReferenceAgent,
  NAIVE_CAPABILITIES,
  REFERENCE_CAPABILITIES,
  RESILIENT_CAPABILITIES,
  RepositoryAgent,
  type AgentCapabilities,
} from "@gauntlet/agents"
import { createEvaluator } from "@gauntlet/evaluators"
import { SolariBrowserProvider, SolariFixtureProvider, SolariSandboxProvider } from "@gauntlet/solari"

// Type-only: erased at compile time, so naming the module here does not load it.
import type * as LocalRuntimeModule from "@gauntlet/local-runtime"

/**
 * Composition root.
 *
 * The one place that decides whether a suite runs on Solari or locally, and the
 * only place that reads credentials. Everything downstream sees ports.
 */
export interface Runtime {
  readonly mode: "solari" | "local"
  readonly browsers: BrowserProvider
  readonly sandboxes?: SandboxProvider
  readonly fixtures: FixtureProvider
  readonly artifacts: ArtifactStore
  shutdown(): Promise<void>
}

/**
 * A credential the visitor brought, already opened.
 *
 * `session` borrows one browser they created — we never see an account key.
 * `key` is their own Solari key, used for this run and then forgotten.
 */
export interface BorrowedCredential {
  kind: "session" | "key"
  value: string
}

export async function createRuntime(
  config: GauntletConfig,
  logger: Logger,
  borrowed?: BorrowedCredential,
): Promise<Runtime> {
  const artifacts = new ArtifactStore(config.GAUNTLET_ARTIFACT_DIR)

  // A borrowed credential IS a Solari session or key, so it settles the mode by
  // itself — a deployment with no key of its own still runs the visitor's run
  // on Solari rather than falling back to a local browser it does not ship.
  if (config.resolvedMode === "solari" || borrowed) {
    // A visitor's key pays for their own run; ours is the fallback. A borrowed
    // SESSION comes with no key at all — that is the point of it — so a key is
    // only genuinely required when we have to create something ourselves.
    const apiKey = borrowed?.kind === "key" ? borrowed.value : config.SOLARI_API_KEY
    const borrowingSession = borrowed?.kind === "session"
    if (!apiKey && !borrowingSession) {
      throw new GauntletError({
        code: "config_invalid",
        message: "Solari mode requires SOLARI_API_KEY.",
      })
    }

    const browsers = new SolariBrowserProvider({
      apiKey: apiKey ?? "",
      baseUrl: config.SOLARI_BASE_URL,
      logger: logger.child({ component: "solari-browser" }),
      // Borrowing means: create no session, release no session.
      ...(borrowingSession ? { borrowedCdpEndpoint: borrowed.value } : {}),
    })
    const sandboxes = apiKey
      ? new SolariSandboxProvider({
          apiKey,
          baseUrl: config.SOLARI_BASE_URL,
          logger: logger.child({ component: "solari-sandbox" }),
        })
      : undefined

    // An operator-supplied fixture URL wins: it is the documented escape hatch
    // when a deployment has no preview domain (Solari answers 501 there). It is
    // also the only option left when someone lends us a browser and nothing
    // else — a borrowed session cannot conjure a VM to host the benchmark site.
    const fixtures: FixtureProvider = config.GAUNTLET_FIXTURE_URL
      ? new (await localRuntime()).ExternalFixtureProvider(config.GAUNTLET_FIXTURE_URL)
      : sandboxes
        ? new SolariFixtureProvider({ sandboxes, logger })
        : (() => {
            throw new GauntletError({
              code: "config_invalid",
              message: "There is nowhere to host the benchmark site for this run.",
              detail:
                "A borrowed browser session drives a page; it cannot host one. This deployment " +
                "needs either GAUNTLET_FIXTURE_URL or a Solari key of its own.",
            })
          })()

    return {
      mode: "solari",
      browsers,
      ...(sandboxes ? { sandboxes } : {}),
      fixtures,
      artifacts,
      shutdown: async () => {
        // Order matters: release sessions and sandboxes before dropping the
        // clients that know how to release them.
        await sandboxes?.shutdown().catch(() => {})
        await browsers.shutdown().catch(() => {})
      },
    }
  }

  const { ExternalFixtureProvider, LocalBrowserProvider, LocalFixtureProvider } = await localRuntime()
  const browsers = new LocalBrowserProvider({
    headless: true,
    recording: true,
    logger: logger.child({ component: "local-browser" }),
  })
  const fixtures: FixtureProvider = config.GAUNTLET_FIXTURE_URL
    ? new ExternalFixtureProvider(config.GAUNTLET_FIXTURE_URL)
    : new LocalFixtureProvider()

  return {
    mode: "local",
    browsers,
    fixtures,
    artifacts,
    shutdown: () => browsers.shutdown(),
  }
}

/**
 * Load the local Playwright adapters ONLY when something actually needs them.
 *
 * A static import would pull Playwright into memory on every boot, including a
 * production deployment that runs entirely on Solari and must never launch a
 * browser of its own. On a 512 MB instance that is not a rounding error.
 */
function localRuntime(): Promise<typeof LocalRuntimeModule> {
  return import("@gauntlet/local-runtime")
}

export interface AgentSpec {
  type: string
  name: string
  config: Record<string, unknown>
}

const CAPABILITY_PRESETS: Record<string, AgentCapabilities> = {
  naive: NAIVE_CAPABILITIES,
  reference: REFERENCE_CAPABILITIES,
  resilient: RESILIENT_CAPABILITIES,
}

export async function createAgent(spec: AgentSpec, config: GauntletConfig): Promise<AgentAdapter> {
  switch (spec.type) {
    case "reference": {
      const preset = String(spec.config.preset ?? "reference")
      const capabilities = CAPABILITY_PRESETS[preset]
      if (!capabilities) {
        throw new GauntletError({
          code: "config_invalid",
          message: `Unknown reference-agent preset "${preset}". Use naive, reference or resilient.`,
        })
      }
      return new HeuristicReferenceAgent(capabilities, spec.name)
    }

    case "llm": {
      // Optional, experimental adapter. It is never on the default path:
      // AgentGauntlet's job is to measure agents, not to be one.
      if (!config.ANTHROPIC_API_KEY) {
        throw new GauntletError({
          code: "config_invalid",
          message:
            "The optional LLM agent needs ANTHROPIC_API_KEY. The Reference Agent needs no credentials, " +
            "and external agents bring their own model.",
        })
      }
      // Optional adapter, loaded on demand so its SDK is not resident in a
      // deployment that never uses it.
      const { AnthropicLlmProvider, LlmAgent } = await import("@gauntlet/agents")
      return new LlmAgent({
        provider: new AnthropicLlmProvider({
          apiKey: config.ANTHROPIC_API_KEY,
          model: config.llmModel,
          effort: (spec.config.effort as "low" | undefined) ?? "low",
        }),
        name: spec.name,
      })
    }

    case "repository":
      return new RepositoryAgent({
        repository: String(spec.config.repository ?? ""),
        ...(spec.config.branch ? { branch: String(spec.config.branch) } : {}),
        ...(spec.config.manifest ? { manifest: spec.config.manifest as never } : {}),
      })

    default:
      throw new GauntletError({
        code: "config_invalid",
        message: `Unknown agent type "${spec.type}".`,
      })
  }
}

export function createTaskEvaluator(task: TaskDefinition): Evaluator {
  return createEvaluator(task.evaluatorConfig)
}

export function createWorkerLogger(config: GauntletConfig, workerId: string): Logger {
  return createLogger({ worker: workerId, mode: config.resolvedMode }, { level: config.LOG_LEVEL })
}
