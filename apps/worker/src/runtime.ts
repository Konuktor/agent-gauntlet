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
  AnthropicLlmProvider,
  HeuristicReferenceAgent,
  LlmAgent,
  NAIVE_CAPABILITIES,
  REFERENCE_CAPABILITIES,
  RESILIENT_CAPABILITIES,
  RepositoryAgent,
  type AgentCapabilities,
} from "@gauntlet/agents"
import { createEvaluator } from "@gauntlet/evaluators"
import { ExternalFixtureProvider, LocalBrowserProvider, LocalFixtureProvider } from "@gauntlet/local-runtime"
import { SolariBrowserProvider, SolariFixtureProvider, SolariSandboxProvider } from "@gauntlet/solari"

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

export function createRuntime(config: GauntletConfig, logger: Logger): Runtime {
  const artifacts = new ArtifactStore(config.GAUNTLET_ARTIFACT_DIR)

  if (config.resolvedMode === "solari") {
    const apiKey = config.SOLARI_API_KEY
    if (!apiKey) {
      throw new GauntletError({
        code: "config_invalid",
        message: "Solari mode requires SOLARI_API_KEY.",
      })
    }

    const browsers = new SolariBrowserProvider({
      apiKey,
      baseUrl: config.SOLARI_BASE_URL,
      logger: logger.child({ component: "solari-browser" }),
    })
    const sandboxes = new SolariSandboxProvider({
      apiKey,
      baseUrl: config.SOLARI_BASE_URL,
      logger: logger.child({ component: "solari-sandbox" }),
    })

    // An operator-supplied fixture URL wins: it is the documented escape hatch
    // when a deployment has no preview domain (Solari answers 501 there).
    const fixtures: FixtureProvider = config.GAUNTLET_FIXTURE_URL
      ? new ExternalFixtureProvider(config.GAUNTLET_FIXTURE_URL)
      : new SolariFixtureProvider({ sandboxes, logger })

    return {
      mode: "solari",
      browsers,
      sandboxes,
      fixtures,
      artifacts,
      shutdown: async () => {
        // Order matters: release sessions and sandboxes before dropping the
        // clients that know how to release them.
        await sandboxes.shutdown().catch(() => {})
        await browsers.shutdown().catch(() => {})
      },
    }
  }

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

export function createAgent(spec: AgentSpec, config: GauntletConfig): AgentAdapter {
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
      if (config.LLM_PROVIDER !== "anthropic") {
        throw new GauntletError({
          code: "config_invalid",
          message: `LLM_PROVIDER="${config.LLM_PROVIDER}" is configured but only Anthropic is implemented.`,
        })
      }
      if (!config.ANTHROPIC_API_KEY) {
        throw new GauntletError({
          code: "config_invalid",
          message: "The LLM agent needs ANTHROPIC_API_KEY. The Reference Agent needs no credentials.",
        })
      }
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
