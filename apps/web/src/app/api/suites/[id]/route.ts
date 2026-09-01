import { getSuite } from "@gauntlet/db"
import { apiError, notFound, ok } from "@/lib/api"
import { db } from "@/lib/server"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const suite = await getSuite(db(), id)
    if (!suite) return notFound("Suite")
    return ok({
      id: suite.suite.id,
      name: suite.suite.name,
      runsPerVariant: suite.suite.runsPerVariant,
      agent: { id: suite.agent.id, name: suite.agent.name, type: suite.agent.type },
      task: {
        id: suite.task.id,
        name: suite.task.name,
        description: suite.task.description,
        maxSteps: suite.task.maxSteps,
        timeoutMs: suite.task.timeoutMs,
      },
      variants: suite.variants.map((v) => v.perturbationType),
    })
  } catch (error) {
    return apiError(error)
  }
}
