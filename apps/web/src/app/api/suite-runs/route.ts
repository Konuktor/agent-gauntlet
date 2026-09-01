import { apiError, ok } from "@/lib/api"
import { loadRecentSuiteRuns } from "@/lib/queries"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20)
    const runs = await loadRecentSuiteRuns(Number.isFinite(limit) ? Math.min(limit, 100) : 20)
    return ok({
      runs: runs.map((r) => ({
        id: r.id,
        suiteName: r.suiteName,
        agentName: r.agentName,
        taskName: r.taskName,
        status: r.status,
        mode: r.mode,
        label: r.label,
        reliability: r.reliability,
        totalRuns: r.totalRuns,
        passedRuns: r.passedRuns,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        git: { repo: r.gitRepo, branch: r.gitBranch, sha: r.gitSha },
      })),
    })
  } catch (error) {
    return apiError(error)
  }
}
