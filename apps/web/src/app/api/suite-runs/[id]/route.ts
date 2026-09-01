import { apiError, notFound, ok } from "@/lib/api"
import { loadSuiteRun } from "@/lib/queries"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const view = await loadSuiteRun(id)
    if (!view) return notFound("Run")
    return ok(view)
  } catch (error) {
    return apiError(error)
  }
}
