import { z } from "zod"
import { LIMITS } from "@gauntlet/config"
import { GauntletError } from "@gauntlet/core"
import { getProjectBySlug, suiteVariants, suites } from "@gauntlet/db"
import { requirePerturbation } from "@gauntlet/perturbations"
import { apiError, ok, parseBody } from "@/lib/api"
import { config, db } from "@/lib/server"

export const dynamic = "force-dynamic"

const createSuiteSchema = z.object({
  name: z.string().min(1).max(120),
  agentId: z.string().uuid(),
  taskDefinitionId: z.string().uuid(),
  variants: z.array(z.string().min(1)).min(1).max(20),
  runsPerVariant: z.number().int().min(1).max(LIMITS.maxRepetitions),
})

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, createSuiteSchema)

    // Validate the variant ids before touching the database, so an unknown
    // perturbation is a 400 rather than a suite that fails at execution time.
    for (const variant of body.variants) requirePerturbation(variant)

    const total = body.variants.length * body.runsPerVariant
    const cap = config().GAUNTLET_MAX_RUNS_PER_SUITE
    if (total > cap) {
      throw new GauntletError({
        code: "config_invalid",
        message: `${body.variants.length} variants x ${body.runsPerVariant} repetitions is ${total} browser runs, above the configured cap of ${cap}.`,
      })
    }

    const database = db()
    const project = await getProjectBySlug(database, "demo")
    if (!project) {
      throw new GauntletError({
        code: "config_invalid",
        message: "No project exists yet. Run `pnpm db:seed` first.",
      })
    }

    const suite = await database.transaction(async (tx) => {
      const [created] = await tx
        .insert(suites)
        .values({
          projectId: project.id,
          name: body.name,
          agentId: body.agentId,
          taskDefinitionId: body.taskDefinitionId,
          runsPerVariant: body.runsPerVariant,
        })
        .returning()
      if (!created) throw new Error("suite insert returned nothing")

      await tx.insert(suiteVariants).values(
        body.variants.map((variant, position) => ({
          suiteId: created.id,
          perturbationType: variant,
          position,
        })),
      )
      return created
    })

    return ok({ id: suite.id, totalRuns: total }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
