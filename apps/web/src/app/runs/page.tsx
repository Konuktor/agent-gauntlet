import Link from "next/link"
import { ArrowRight, GitCompareArrows } from "lucide-react"
import { percent, relativeTime } from "@/lib/format"
import { loadRecentSuiteRuns } from "@/lib/queries"
import { EmptyState, ModeBadge } from "@/components/primitives"

export const dynamic = "force-dynamic"

export default async function RunsPage() {
  const runs = await loadRecentSuiteRuns(50)

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Every gauntlet, newest first. Two runs of the same suite can be compared.
          </p>
        </div>
        <Link className="btn btn-primary" href="/suites/new">
          Run the Gauntlet
          <ArrowRight size={15} aria-hidden />
        </Link>
      </header>

      {runs.length === 0 ? (
        <EmptyState title="No runs yet.">
          Run <code>pnpm db:seed</code> for a demo dataset, or start a gauntlet.
        </EmptyState>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <caption className="sr-only">Suite runs, newest first</caption>
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-3)]">
                <th scope="col" className="px-4 py-2.5 font-medium">Run</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Agent</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Mode</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Passed</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Reliability</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">When</th>
                <th scope="col" className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run, index) => {
                const previous = runs.slice(index + 1).find((r) => r.suiteId === run.suiteId)
                return (
                  <tr key={run.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-raised)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/runs/${run.id}`} className="font-medium hover:underline">
                        {run.label ?? run.suiteName}
                      </Link>
                      <div className="text-xs text-[var(--color-ink-3)]">{run.taskName}</div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-ink-2)]">{run.agentName}</td>
                    <td className="px-4 py-2.5"><ModeBadge mode={run.mode} /></td>
                    <td className="px-4 py-2.5 text-right tnum text-[var(--color-ink-2)]">
                      {run.passedRuns} / {run.totalRuns}
                    </td>
                    <td className="px-4 py-2.5 text-right text-base font-semibold tabular-nums">
                      {run.reliability === null ? "—" : percent(run.reliability)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-[var(--color-ink-3)]">
                      {relativeTime(run.completedAt ?? run.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {previous ? (
                        <Link
                          className="btn btn-ghost text-xs"
                          href={`/runs/${previous.id}/compare/${run.id}`}
                          title={`Compare against ${previous.label ?? previous.suiteName}`}
                        >
                          <GitCompareArrows size={13} aria-hidden />
                          Compare
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
