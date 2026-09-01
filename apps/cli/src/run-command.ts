import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import pc from "picocolors"
import { parseEnv, type GauntletConfig } from "@gauntlet/config"
import {
  createLogger,
  deriveSeed,
  GauntletRunner,
  newId,
  taskDefinitionSchema,
  type FixtureProvider,
  type PlannedRun,
  type TaskDefinition,
} from "@gauntlet/core"
import {
  createNaiveAgent,
  createResilientAgent,
  HeuristicReferenceAgent,
  AnthropicLlmProvider,
  LlmAgent,
  RepositoryAgent,
} from "@gauntlet/agents"
import { createEvaluator } from "@gauntlet/evaluators"
import { ExternalFixtureProvider, LocalBrowserProvider, LocalFixtureProvider } from "@gauntlet/local-runtime"
import { SolariBrowserProvider, SolariFixtureProvider, SolariSandboxProvider } from "@gauntlet/solari"
import { requirePerturbation, resolvePerturbation } from "@gauntlet/perturbations"
import type { GauntletFileConfig } from "./config.js"
import { InMemoryRunStore } from "./memory-store.js"
import { evaluateThresholds, renderReport, type GauntletReport } from "./report.js"

export interface RunCommandOptions {
  config: GauntletFileConfig
  reportPath?: string
  quiet?: boolean
  label?: string
}

export interface RunCommandResult {
  report: GauntletReport
  exitCode: number
  reportPath?: string
}

export async function runGauntlet(options: RunCommandOptions): Promise<RunCommandResult> {
  const env: GauntletConfig = parseEnv()
  const logger = createLogger({ component: "cli" }, { level: options.quiet ? "warn" : env.LOG_LEVEL })
  const suiteRunId = newId()

  const task: TaskDefinition = taskDefinitionSchema.parse({
    id: newId(),
    name: options.config.task.name,
    description: options.config.task.description,
    startUrl: options.config.task.startUrl,
    maxSteps: options.config.task.maxSteps,
    timeoutMs: options.config.task.timeoutMs,
    evaluatorConfig: {
      kind: "fixture_state",
      expect: {
        productSku: "aurora-headphones",
        quantity: 1,
        coupon: "SAVE20",
        discountApplied: true,
        checkoutName: "Ada Lovelace",
        checkoutCity: "London",
        stage: "review",
        purchaseSubmitted: false,
      },
    },
  })

  const variants = options.config.variants.map((id) => requirePerturbation(id))
  const planned: PlannedRun[] = variants.flatMap((perturbation) =>
    Array.from({ length: options.config.repetitions }, (_, i) => ({
      id: newId(),
      variant: perturbation.id,
      variantName: perturbation.name,
      repetition: i + 1,
      seed: deriveSeed(suiteRunId, perturbation.id, i + 1),
      status: "queued" as const,
    })),
  )

  // §35: say what this will cost before spending anything.
  if (!options.quiet) {
    process.stdout.write(
      `\n${pc.bold("AgentGauntlet")}\n` +
        `  ${variants.length} variants × ${options.config.repetitions} repetitions = ` +
        `${pc.bold(String(planned.length))} browser runs\n` +
        `  mode: ${env.resolvedMode}${env.resolvedMode === "local" ? pc.dim(" (no Solari credits)") : ""}\n\n`,
    )
  }

  const artifactRoot = resolve(env.GAUNTLET_ARTIFACT_DIR, "cli", suiteRunId)
  const store = new InMemoryRunStore(
    planned,
    (variant) => requirePerturbation(variant).category,
    join(artifactRoot, "replays"),
  )

  const runtime = createRuntime(env, logger)
  const agent = createAgentFromConfig(options.config, env)

  try {
    const runner = new GauntletRunner(
      {
        browsers: runtime.browsers,
        ...(runtime.sandboxes ? { sandboxes: runtime.sandboxes } : {}),
        fixtures: runtime.fixtures,
        agent,
        evaluator: createEvaluator(task.evaluatorConfig),
        store,
        logger,
        resolve: (run) =>
          resolvePerturbation({
            suiteRunId,
            individualRunId: run.id,
            variant: run.variant,
            repetition: run.repetition,
            seed: run.seed,
          }),
      },
      {
        suiteRunId,
        task,
        maxConcurrency: env.GAUNTLET_MAX_CONCURRENCY,
        browserDefaults: { recording: true, stealth: false },
      },
    )

    const controller = new AbortController()
    const onSignal = () => controller.abort()
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)

    const result = await runner.execute(controller.signal)
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)

    const report: GauntletReport = {
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: env.resolvedMode,
      agent: agent.name,
      task: task.name,
      ...(options.label ? { label: options.label } : {}),
      thresholds: options.config.thresholds,
      metrics: result.metrics,
      failures: [...store.runs.values()]
        .filter((r) => r.status === "failed")
        .map((r) => ({
          variant: r.variant,
          repetition: r.repetition,
          category: (r.failureCategory ?? null) as GauntletReport["failures"][number]["category"],
          message: r.failureMessage ?? null,
        })),
    }

    const reportPath = options.reportPath ?? join(artifactRoot, "report.json")
    await mkdir(resolve(reportPath, ".."), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8")

    if (!options.quiet) {
      process.stdout.write(renderReport(report))
      process.stdout.write(pc.dim(`  report: ${reportPath}\n\n`))
    }

    const verdict = evaluateThresholds(report)
    return { report, reportPath, exitCode: verdict.pass ? 0 : 1 }
  } finally {
    // Always: sessions and sandboxes bill until they are released.
    await runtime.shutdown()
  }
}

function createRuntime(env: GauntletConfig, logger: ReturnType<typeof createLogger>) {
  if (env.resolvedMode === "solari" && env.SOLARI_API_KEY) {
    const browsers = new SolariBrowserProvider({
      apiKey: env.SOLARI_API_KEY,
      baseUrl: env.SOLARI_BASE_URL,
      logger,
    })
    const sandboxes = new SolariSandboxProvider({
      apiKey: env.SOLARI_API_KEY,
      baseUrl: env.SOLARI_BASE_URL,
      logger,
    })
    const fixtures: FixtureProvider = env.GAUNTLET_FIXTURE_URL
      ? new ExternalFixtureProvider(env.GAUNTLET_FIXTURE_URL)
      : new SolariFixtureProvider({ sandboxes, logger })
    return {
      browsers,
      sandboxes,
      fixtures,
      shutdown: async () => {
        await sandboxes.shutdown().catch(() => {})
        await browsers.shutdown().catch(() => {})
      },
    }
  }

  const browsers = new LocalBrowserProvider({ headless: true, recording: true, logger })
  const fixtures: FixtureProvider = env.GAUNTLET_FIXTURE_URL
    ? new ExternalFixtureProvider(env.GAUNTLET_FIXTURE_URL)
    : new LocalFixtureProvider()
  return { browsers, sandboxes: undefined, fixtures, shutdown: () => browsers.shutdown() }
}

function createAgentFromConfig(config: GauntletFileConfig, env: GauntletConfig) {
  switch (config.agent.type) {
    case "reference":
      if (config.agent.preset === "naive") return createNaiveAgent()
      if (config.agent.preset === "resilient") return createResilientAgent()
      return new HeuristicReferenceAgent()
    case "llm": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("The LLM agent needs ANTHROPIC_API_KEY. The reference agent needs no key.")
      }
      return new LlmAgent({
        provider: new AnthropicLlmProvider({
          apiKey: env.ANTHROPIC_API_KEY,
          model: config.agent.model ?? env.llmModel,
        }),
        ...(config.agent.name ? { name: config.agent.name } : {}),
      })
    }
    case "repository":
      return new RepositoryAgent({
        repository: config.agent.repository,
        ...(config.agent.branch ? { branch: config.agent.branch } : {}),
      })
  }
}
