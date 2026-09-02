import { computeSuiteMetrics, type RunSummary } from "@gauntlet/core"
import { createDb } from "../client.js"
import { loadDotEnv } from "../dotenv.js"
import {
  agents,
  evaluationResults,
  individualRuns,
  projects,
  runEvents,
  suiteRuns,
  suiteVariants,
  suites,
  taskDefinitions,
} from "../schema.js"
import { buildDemoRuns, REFERENCE_OUTCOMES, REGRESSED_OUTCOMES, type DemoRun } from "./demo-data.js"

loadDotEnv()

const DEMO_TASK_DESCRIPTION =
  "Add Aurora Headphones to cart, apply coupon SAVE20, proceed to checkout, enter Name: Ada Lovelace and City: London, continue to review, and stop before submitting payment."

const VARIANTS = REFERENCE_OUTCOMES.map((v, i) => ({
  perturbationType: v.variant,
  position: i,
}))

const handle = createDb({ max: 2 })

try {
  await handle.sql`
    TRUNCATE TABLE projects, agents, task_definitions, suites, suite_variants,
                   suite_runs, individual_runs, run_events, evaluation_results
    RESTART IDENTITY CASCADE
  `

  const [project] = await handle.db
    .insert(projects)
    .values({ name: "Demo Project", slug: "demo" })
    .returning()

  // The three built-in agents differ by ONE capability each, which is what makes
  // comparing them informative rather than arbitrary.
  const agentRows = await handle.db
    .insert(agents)
    .values([
      {
        projectId: project!.id,
        name: "Reference Agent",
        type: "reference",
        configJson: {
          preset: "reference",
          capabilities: ["dismissOverlays", "waitForLateElements"],
        },
      },
      {
        projectId: project!.id,
        name: "Naive Agent",
        type: "reference",
        configJson: { preset: "naive", capabilities: [] },
      },
      {
        projectId: project!.id,
        name: "Resilient Agent",
        type: "reference",
        configJson: {
          preset: "resilient",
          capabilities: ["dismissOverlays", "waitForLateElements", "recoverSessions"],
        },
      },
      {
        projectId: project!.id,
        name: "LLM Agent",
        type: "llm",
        configJson: { effort: "low" },
      },
      {
        // A genuinely separate repository, cloned and executed inside a Solari
        // Sandbox. It is here so the external-agent path is one click away
        // rather than a thing you have to construct by hand.
        projectId: project!.id,
        name: "Example Repository Agent",
        type: "repository",
        configJson: {
          repository: "https://github.com/Konuktor/agent-gauntlet-example-agent",
          branch: "master",
        },
      },
    ])
    .returning()

  const referenceAgent = agentRows.find((a) => a.name === "Reference Agent")!

  const [task] = await handle.db
    .insert(taskDefinitions)
    .values({
      projectId: project!.id,
      name: "Complete Demo Checkout",
      description: DEMO_TASK_DESCRIPTION,
      startUrl: "/",
      maxSteps: 25,
      timeoutMs: 90_000,
      evaluatorConfigJson: {
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
    .returning()

  const [suite] = await handle.db
    .insert(suites)
    .values({
      projectId: project!.id,
      name: "Checkout gauntlet",
      agentId: referenceAgent.id,
      taskDefinitionId: task!.id,
      runsPerVariant: 2,
    })
    .returning()

  await handle.db.insert(suiteVariants).values(VARIANTS.map((v) => ({ suiteId: suite!.id, ...v })))

  // Two runs of the SAME suite so the regression view has something real to
  // compare: the earlier one is the agent with overlay handling, the later one
  // is the same agent after that capability regressed out.
  const earlier = await insertSuiteRun({
    suiteId: suite!.id,
    label: "main @ a1b4c7e",
    outcomes: REFERENCE_OUTCOMES,
    completedMinutesAgo: 180,
    git: { repo: "acme/checkout-agent", branch: "main", sha: "a1b4c7e" },
  })

  const later = await insertSuiteRun({
    suiteId: suite!.id,
    label: "PR #82 @ 9f2d13a",
    outcomes: REGRESSED_OUTCOMES,
    completedMinutesAgo: 12,
    git: { repo: "acme/checkout-agent", branch: "pr-82-refactor-waits", sha: "9f2d13a" },
  })

  console.log("seeded demo dataset")
  console.log(`  project      ${project!.slug}`)
  console.log(`  agents       ${agentRows.length}`)
  console.log(`  suite        ${suite!.name} (${VARIANTS.length} variants x 2 repetitions)`)
  console.log(
    `  baseline run ${earlier.id}  reliability ${(earlier.reliability * 100).toFixed(1)}%`,
  )
  console.log(`  regressed    ${later.id}  reliability ${(later.reliability * 100).toFixed(1)}%`)
  console.log("")
  console.log("  This is DEMO DATA. Outcomes were measured against the real fixture;")
  console.log("  timings and traces are generated. It is never shown as a Solari run.")
} finally {
  await handle.close()
}

async function insertSuiteRun(input: {
  suiteId: string
  label: string
  outcomes: typeof REFERENCE_OUTCOMES
  completedMinutesAgo: number
  git: { repo: string; branch: string; sha: string }
}) {
  const completedAt = new Date(Date.now() - input.completedMinutesAgo * 60_000)
  const demoRuns = buildDemoRuns(`${input.suiteId}:${input.label}`, input.outcomes)
  const startedAt = new Date(completedAt.getTime() - estimateWallClock(demoRuns))

  const summaries: RunSummary[] = demoRuns.map((r) => ({
    variant: r.variant,
    variantName: r.variantName,
    category: r.category as RunSummary["category"],
    repetition: r.repetition,
    status: r.status,
    durationMs: r.durationMs,
    steps: r.steps,
    failureCategory: r.failureCategory as RunSummary["failureCategory"],
  }))
  const metrics = computeSuiteMetrics(summaries)

  const [suiteRun] = await handle.db
    .insert(suiteRuns)
    .values({
      suiteId: input.suiteId,
      status: "completed",
      mode: "demo",
      label: input.label,
      totalRuns: demoRuns.length,
      passedRuns: metrics.passedRuns,
      failedRuns: metrics.failedRuns,
      infrastructureErrors: 0,
      reliability: metrics.reliability,
      metricsJson: metrics as unknown as object,
      gitRepo: input.git.repo,
      gitBranch: input.git.branch,
      gitSha: input.git.sha,
      createdAt: startedAt,
      startedAt,
      completedAt,
    })
    .returning()

  for (const run of demoRuns) {
    const runStartedAt = new Date(startedAt.getTime() + Math.floor(Math.random() * 1_000))
    const [inserted] = await handle.db
      .insert(individualRuns)
      .values({
        suiteRunId: suiteRun!.id,
        variant: run.variant,
        variantName: run.variantName,
        category: run.category,
        repetition: run.repetition,
        seed: run.seed,
        status: run.status,
        sessionId: run.sessionId,
        replayStatus: "not_requested",
        startedAt: runStartedAt,
        completedAt: new Date(runStartedAt.getTime() + run.durationMs),
        durationMs: run.durationMs,
        steps: run.steps,
        failureCategory: run.failureCategory,
        failureMessage: run.failureMessage,
        metadataJson: { demo: true },
      })
      .returning()

    await handle.db.insert(runEvents).values(
      run.events.map((event, index) => ({
        individualRunId: inserted!.id,
        sequence: index,
        timestamp: new Date(runStartedAt.getTime() + event.offsetMs),
        type: event.type,
        payloadJson: event.payload,
      })),
    )

    await handle.db.insert(evaluationResults).values({
      individualRunId: inserted!.id,
      success: run.evaluation.success,
      score: run.evaluation.score,
      assertionsJson: run.evaluation.assertions,
      evidenceJson: run.evaluation.evidence,
      agentClaimJson: (run.evaluation.evidence as { agentClaim?: object }).agentClaim ?? null,
    })
  }

  return { id: suiteRun!.id, reliability: metrics.reliability }
}

/** Rough wall clock for a suite at the default concurrency, for plausible timestamps. */
function estimateWallClock(runs: DemoRun[]): number {
  const total = runs.reduce((sum, r) => sum + r.durationMs, 0)
  return Math.round(total / 3) + 20_000
}
