import { z } from "zod"
import { deriveSeed, GauntletError } from "@gauntlet/core"
import { enqueueSuiteRun, getSuite } from "@gauntlet/db"
import { requirePerturbation } from "@gauntlet/perturbations"
import { apiError, notFound, ok, parseBody } from "@/lib/api"
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

    const database = db()
    const suite = await getSuite(database, id)
    if (!suite) return notFound("Suite")

    const cfg = config()
    if (cfg.resolvedMode === "solari" && !cfg.hasSolariCredentials) {
      throw new GauntletError({
        code: "config_invalid",
        message: "Real runs need a Solari API key. Add SOLARI_API_KEY to .env and restart.",
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
