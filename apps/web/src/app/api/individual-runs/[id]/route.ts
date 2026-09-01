import { apiError, notFound, ok } from "@/lib/api"
import { loadRunDetail } from "@/lib/queries"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const detail = await loadRunDetail(id)
    if (!detail) return notFound("Run")
    return ok(detail)
  } catch (error) {
    return apiError(error)
  }
}
