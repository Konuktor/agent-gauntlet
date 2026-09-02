import { z } from "zod"
import { deriveSeed, GauntletError } from "@gauntlet/core"
import { countActiveSuiteRuns, enqueueSuiteRun, getSuite } from "@gauntlet/db"
import { requirePerturbation } from "@gauntlet/perturbations"
import { apiError, notFound, ok, parseBody } from "@/lib/api"
import { checkRunAuthorization } from "@/lib/auth"
import { config, db } from "@/lib/server"

export const dynamic = "force-dynamic"

const runSchema = z.object({
  label: z.string().max(120).optional(),
  git: z
    .object({ repo: z.string().optional(), branch: z.string().optional(), sha: z.string().optional() })
    .optional(),
})

/**
 * Enqueue a gauntlet.
 *
 * This is the only endpoint that costs money, so it is explicitly a POST that a
 * human has to trigger — nothing here ever fires on page load (§35), and the UI
 * shows the exact browser-run count before the button is enabled.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const body = await parseBody(request, runSchema).catch(() => ({}) as z.infer<typeof runSchema>)

    const cfg = config()

    // Money is spent past this line. Everything above it — browsing the seeded
    // demo, inspecting a failure, comparing two runs — stays public.
    const auth = await checkRunAuthorization()
    if (!auth.authorized) {
      return ok(
        {
          error: {
            code: "unauthorized",
            title: "Real runs need an access code",
            message:
              "This deployment executes on Solari, and each run spends real credits. Enter the demo access code to start one.",
            hint: "The seeded demo results are fully browsable without it.",
          },
        },
        { status: 401 },
      )
    }

    const database = db()
    const suite = await getSuite(database, id)
    if (!suite) return notFound("Suite")

    // One suite at a time. Without this a visitor can queue faster than the
    // worker drains, and every queued run is a browser session somebody pays for.
    const active = await countActiveSuiteRuns(database)
    if (active > 0) {
      return ok(
        {
          error: {
            code: "busy",
            title: "A gauntlet is already running",
            message: "This deployment runs one suite at a time so it cannot outrun its Solari quota.",
            hint: "Wait for the current run to finish, then try again.",
          },
        },
        { status: 429 },
      )
    }

    // Repository agents clone and execute code we did not write. That is safe
    // because it happens inside a Solari Sandbox — but it still costs sandbox
    // credits, so it is never available anonymously.
    if (suite.agent.type === "repository" && auth.reason === "ungated" && cfg.runsAreGated) {
      return ok({ error: { code: "unauthorized", title: "Not permitted", message: "Repository agents require authorization.", hint: "" } }, { status: 401 })
    }
    if (cfg.resolvedMode === "solari" && !cfg.hasSolariCredentials) {
      throw new GauntletError({
        code: "config_invalid",
        message: "Real runs need a Solari API key. Add SOLARI_API_KEY to .env and restart.",
      })
    }
    // Local mode drives a real browser, and a production image ships none on
    // purpose: this service orchestrates runs, it never hosts one. Refusing
    // here beats enqueuing work the worker cannot possibly do.
    if (!cfg.canExecuteRuns) {
      throw new GauntletError({
        code: "config_invalid",
        message:
          "This deployment has no way to execute a run: there is no Solari key, and the " +
          "production image carries no browser by design. Add SOLARI_API_KEY to enable real runs.",
      })
    }

    const variants = suite.variants.map((v) => {
      const perturbation = requirePerturbation(v.perturbationType)
      return { id: perturbation.id, name: perturbation.name, category: perturbation.category }
    })

    const total = variants.length * suite.suite.runsPerVariant
    if (total > cfg.GAUNTLET_MAX_RUNS_PER_SUITE) {
      throw new GauntletError({
        code: "config_invalid",
        message: `This suite is ${total} browser runs, above the configured cap of ${cfg.GAUNTLET_MAX_RUNS_PER_SUITE}.`,
      })
    }

    const suiteRun = await enqueueSuiteRun(database, {
      suiteId: suite.suite.id,
      mode: cfg.resolvedMode,
      ...(body.label ? { label: body.label } : {}),
      variants,
      runsPerVariant: suite.suite.runsPerVariant,
      // Seeds are derived once, here, and persisted — so re-reading a run later
      // reproduces exactly the environment it faced.
      seedFor: (variant, repetition) => deriveSeed(suite.suite.id, variant, repetition),
      ...(body.git ? { git: body.git } : {}),
    })

    return ok(
      { id: suiteRun.id, totalRuns: total, mode: cfg.resolvedMode, status: suiteRun.status },
      { status: 202 },
    )
  } catch (error) {
    return apiError(error)
  }
}
