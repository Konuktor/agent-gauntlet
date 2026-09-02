import { apiError, notFound, ok } from "@/lib/api"
import { loadComparison } from "@/lib/queries"

export const dynamic = "force-dynamic"

/** `id` is the baseline, `otherId` is the run being judged against it. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; otherId: string }> },
) {
  try {
    const { id, otherId } = await ctx.params
    const result = await loadComparison(id, otherId)
    if (!result) return notFound("Run")
    return ok({
      previous: summarise(result.previous),
      current: summarise(result.current),
      comparison: result.comparison,
    })
  } catch (error) {
    return apiError(error)
  }
}

function summarise(
  view: Awaited<ReturnType<typeof loadComparison>> extends null
    ? never
    : NonNullable<Awaited<ReturnType<typeof loadComparison>>>["previous"],
) {
  return {
    id: view.id,
    label: view.label,
    mode: view.mode,
    completedAt: view.completedAt,
    git: view.git,
    reliability: view.metrics.reliability,
    passedRuns: view.metrics.passedRuns,
    scoredRuns: view.metrics.scoredRuns,
  }
}
