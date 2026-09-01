import { notFound } from "next/navigation"
import { loadSuiteRun } from "@/lib/queries"
import { RunDashboard } from "@/components/run-dashboard"

export const dynamic = "force-dynamic"

export default async function SuiteRunPage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const view = await loadSuiteRun(id)
  if (!view) notFound()
  return <RunDashboard initial={view} />
}
