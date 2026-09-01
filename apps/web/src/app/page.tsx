import Link from "next/link"
import { ArrowRight, Repeat2, ShieldAlert, Wrench } from "lucide-react"
import { percent } from "@/lib/format"
import { loadRecentSuiteRuns } from "@/lib/queries"
import { clientCapabilities } from "@/lib/server"
import { ModeBadge } from "@/components/primitives"

export const dynamic = "force-dynamic"

export default async function LandingPage() {
  const capabilities = clientCapabilities()
  const runs = await loadRecentSuiteRuns(4).catch(() => [])
  const latest = runs[0]

  return (
    <div className="space-y-16">
      <section className="pt-8">
        <p className="section-title">Reliability testing for browser agents</p>
        <h1 className="mt-3 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Crash-test your browser agent
          <br />
          before production does.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-2)]">
          A browser agent passing once proves almost nothing. AgentGauntlet repeats the same task
          across changing UI, network, session and browser conditions — then shows exactly where your
          agent breaks.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link className="btn btn-primary text-base" href="/suites/new">
            Run the Gauntlet
            <ArrowRight size={16} aria-hidden />
          </Link>
          {latest ? (
            <Link className="btn btn-secondary text-base" href={`/runs/${latest.id}`}>
              View demo results
            </Link>
          ) : (
            <span className="text-sm text-[var(--color-ink-3)]">
              Run <code className="text-[var(--color-ink-2)]">pnpm db:seed</code> for a demo dataset.
            </span>
          )}
        </div>

        {!capabilities.hasSolari ? (
          <p className="mt-4 max-w-2xl text-sm text-[var(--color-ink-3)]">
            No <code>SOLARI_API_KEY</code> is configured, so runs execute in{" "}
            <strong className="font-medium text-[var(--color-ink-2)]">local mode</strong>: real
            Chromium on this machine, against the bundled benchmark storefront. Everything works and
            nothing is simulated — it simply is not a Solari run, and the UI says so on every screen.
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <ValueProp
          Icon={Repeat2}
          title="Repeat"
          body="Run identical tasks many times. One success is an anecdote; a rate is a measurement."
        />
        <ValueProp
          Icon={ShieldAlert}
          title="Perturb"
          body="Change UI, timing, viewport, locale and session state — deterministically, from a seed."
        />
        <ValueProp
          Icon={Wrench}
          title="Debug"
          body="Open the failed run: the exact assertion, the action trace, and the session replay."
        />
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            A benchmark asks whether the agent can do it once.
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">
            AgentGauntlet asks whether it still works when a cookie banner appears, when the API is
            slow, when the button is renamed, when the viewport is a phone, or when the session
            quietly expires halfway through.
          </p>
          <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">
            Completion is judged from the benchmark site&apos;s own server-side state — never from
            the agent&apos;s report about itself. An agent can say &ldquo;done&rdquo;; only the state
            decides.
          </p>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
            <h3 className="text-sm font-semibold">Reliability belongs in CI</h3>
            <span className="chip">gauntlet run</span>
          </div>
          <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed text-[var(--color-ink-2)]">
{`AgentGauntlet

  ✓ baseline           2/2
  ✓ cookie popup       2/2
  ✓ slow API           2/2
  ✗ unexpected modal   0/2
  ✓ mobile viewport    2/2
  ✓ renamed CTA        2/2
  ✗ expired session    0/2
  ✓ network delay      2/2

  Reliability   75.0%   (12/16)
  Required      90.0%

  FAIL  exit 1`}
          </pre>
        </div>
      </section>

      {runs.length > 0 ? (
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Recent runs</h2>
            <Link className="text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]" href="/runs">
              All runs →
            </Link>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  className="card flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--color-raised)]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{run.label ?? run.suiteName}</div>
                    <div className="truncate text-xs text-[var(--color-ink-3)]">
                      {run.agentName} · {run.taskName}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ModeBadge mode={run.mode} />
                    <span className="text-lg font-semibold tabular-nums">
                      {run.reliability === null ? "—" : percent(run.reliability)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function ValueProp({
  Icon,
  title,
  body,
}: {
  Icon: typeof Repeat2
  title: string
  body: string
}) {
  return (
    <div className="card p-5">
      <Icon size={18} style={{ color: "var(--color-accent)" }} aria-hidden />
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-2)]">{body}</p>
    </div>
  )
}
