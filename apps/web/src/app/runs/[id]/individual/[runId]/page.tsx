import { notFound } from "next/navigation"
import { loadRunDetail } from "@/lib/queries"
import { RunDetail } from "@/components/run-detail"

export const dynamic = "force-dynamic"

export default async function IndividualRunPage(ctx: {
  params: Promise<{ id: string; runId: string }>
}) {
  const { id, runId } = await ctx.params
  const detail = await loadRunDetail(runId)
  if (!detail || detail.run.suiteRunId !== id) notFound()
  return <RunDetail detail={detail} suiteRunId={id} />
}
