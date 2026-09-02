"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Check, ExternalLink, PlayCircle, X } from "lucide-react"
import { BORROWED_SESSION_ID, FAILURE_CATEGORY_META, type FailureCategory } from "@gauntlet/core/shared"
import type { RunDetailView } from "@/lib/queries"
import { duration, percent, shortId } from "@/lib/format"
import { EmptyState, ModeBadge, Panel, StatTile, StatusPill } from "./primitives"

const EVENT_LABELS: Record<string, string> = {
  lifecycle: "Lifecycle",
  navigation: "Navigation",
  agent_action: "Action",
  console: "Console",
  page_error: "Page error",
  network_error: "Network",
  screenshot: "Screenshot",
  evaluator: "Evaluator",
  log: "Log",
}

export function RunDetail({ detail, suiteRunId }: { detail: RunDetailView; suiteRunId: string }) {
  const { run, events, evaluation } = detail
  const failureMeta = run.failureCategory
    ? FAILURE_CATEGORY_META[run.failureCategory as FailureCategory]
    : null

  const actions = events.filter((e) => e.type === "agent_action")
  const consoleEvents = events.filter((e) => e.type === "console" || e.type === "page_error")
  const networkEvents = events.filter((e) => e.type === "network_error")
  // A repository agent's own stdout/stderr — the only account of why somebody
  // else's code failed, and worth a panel of its own when there is one.
  const agentOutput = events
    .filter((e) => e.type === "log" && (e.payload as { message?: string })?.message === "agent output")
    .map((e) => (e.payload as { output?: string }).output)
    .filter(Boolean)
    .join("\n")
  const agentClaim = (evaluation?.evidence as { agentClaim?: { finishReason?: string; message?: string } } | undefined)
    ?.agentClaim

  return (
    <div className="space-y-6">
      <Link className="btn btn-ghost -ml-2" href={`/runs/${suiteRunId}`}>
        <ArrowLeft size={15} aria-hidden />
        Back to the run
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {run.variantName} · run {run.repetition}
            </h1>
            <StatusPill status={run.status} />
            {failureMeta ? (
              <span
                className="chip"
                style={{
                  color: "var(--color-serious)",
                  borderColor: "color-mix(in oklab, var(--color-serious) 45%, transparent)",
                }}
                title={failureMeta.summary}
              >
                {run.failureCategory}
              </span>
            ) : null}
            <ModeBadge mode={run.mode} />
          </div>
          {run.failureMessage ? (
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-ink-2)]">{run.failureMessage}</p>
          ) : null}
          {failureMeta?.blame === "infrastructure" ? (
            <p className="mt-1 text-xs text-[var(--color-ink-3)]">
              This was our infrastructure failing, not the agent. It is excluded from the reliability score.
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Duration" value={duration(run.durationMs)} />
        <StatTile label="Steps" value={run.steps ?? "—"} />
        <StatTile
          label="Evaluator score"
          value={evaluation ? percent(evaluation.score) : "—"}
          sub={evaluation ? (evaluation.success ? "all assertions passed" : "partial credit") : "not evaluated"}
          tone={evaluation?.success ? "good" : evaluation ? "critical" : "default"}
        />
        <StatTile
          label="Session"
          value={run.mode === "solari" && run.sessionId ? shortId(run.sessionId) : "—"}
          sub={
            run.mode === "solari"
              ? run.sessionId
                ? "Solari session id"
                : "no session recorded"
              : run.mode === "local"
                ? "local browser — no Solari session"
                : "seeded demo — no session"
          }
        />
      </div>

      <ReplayPanel runId={run.id} replayStatus={run.replayStatus} mode={run.mode} sessionId={run.sessionId} />

      {evaluation ? (
        <Panel
          title="Evaluator evidence"
          description="Read from the benchmark site's server-side state, independently of the agent."
        >
          <table className="w-full text-sm">
            <caption className="sr-only">Assertions checked for this run</caption>
            <thead>
              <tr className="text-left text-xs text-[var(--color-ink-3)]">
                <th scope="col" className="pb-2 font-medium">Assertion</th>
                <th scope="col" className="pb-2 font-medium">Expected</th>
                <th scope="col" className="pb-2 font-medium">Actual</th>
                <th scope="col" className="pb-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.assertions.map((assertion) => (
                <tr key={assertion.name} className="border-t border-[var(--color-line)]">
                  <td className="py-2 pr-3">
                    <div>{assertion.description}</div>
                    <div className="font-mono text-[11px] text-[var(--color-ink-3)]">{assertion.name}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-[var(--color-ink-2)]">{render(assertion.expected)}</td>
                  <td className="py-2 pr-3 font-mono text-xs" style={{ color: assertion.passed ? "var(--color-ink-2)" : "var(--color-critical)" }}>
                    {render(assertion.actual)}
                  </td>
                  <td className="py-2 text-right">
                    {/* Glyph + text, never colour alone. */}
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium"
                      style={{ color: assertion.passed ? "var(--color-good)" : "var(--color-critical)" }}
                    >
                      {assertion.passed ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
                      {assertion.passed ? "pass" : "fail"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {agentClaim ? (
            <div className="mt-4 rounded border border-[var(--color-line)] bg-[var(--color-plane)] px-3 py-2.5">
              <div className="section-title">What the agent said about itself</div>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                <span className="font-mono text-xs">{agentClaim.finishReason}</span>
                {agentClaim.message ? ` — “${agentClaim.message}”` : null}
              </p>
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                Recorded as a claim. The verdict above comes from the site&apos;s own state.
              </p>
            </div>
          ) : null}
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Agent action trace" description={`${actions.length} actions`}>
          {actions.length === 0 ? (
            <EmptyState title="No actions were recorded." />
          ) : (
            <ol className="space-y-1.5">
              {actions.map((event, index) => {
                const payload = event.payload as {
                  step?: number
                  ok?: boolean
                  detail?: string
                  action?: { type?: string; text?: string; label?: string; ms?: number; url?: string; reason?: string }
                }
                const action = payload.action ?? {}
                return (
                  <li key={index} className="flex min-w-0 items-start gap-2.5 text-sm">
                    <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-[var(--color-ink-3)] tnum">
                      {payload.step ?? index + 1}
                    </span>
                    <span
                      className="mt-0.5 shrink-0"
                      style={{ color: payload.ok === false ? "var(--color-critical)" : "var(--color-good)" }}
                      aria-hidden
                    >
                      {payload.ok === false ? <X size={13} /> : <Check size={13} />}
                    </span>
                    <span className="min-w-0 break-words">
                      <span className="font-mono text-xs text-[var(--color-ink)]">{action.type}</span>{" "}
                      <span className="text-[var(--color-ink-2)]">
                        {action.text ?? action.label ?? action.url ?? (action.ms ? `${action.ms}ms` : "")}
                      </span>
                      <span className="sr-only">{payload.ok === false ? " failed" : " succeeded"}</span>
                      {payload.detail ? (
                        <span className="block text-xs text-[var(--color-ink-3)]">{payload.detail}</span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </Panel>

        {agentOutput ? (
          <Panel
            title="Agent output"
            description="Exactly what the agent's own process printed."
          >
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-plane)] p-3 font-mono text-xs text-[var(--color-ink-2)]">
              {agentOutput}
            </pre>
          </Panel>
        ) : null}

        <Panel title="Timeline" description="Every lifecycle beat, in order.">
          <ol className="space-y-1 font-mono text-xs">
            {events
              .filter((e) => e.type === "lifecycle" || e.type === "navigation" || e.type === "evaluator")
              .map((event, index) => (
                <li key={index} className="flex min-w-0 gap-3">
                  <span className="w-16 shrink-0 text-[var(--color-ink-3)] tnum">
                    {new Date(event.timestamp).toISOString().slice(14, 23)}
                  </span>
                  <span className="w-20 shrink-0 text-[var(--color-ink-3)]">{EVENT_LABELS[event.type] ?? event.type}</span>
                  <span className="min-w-0 truncate text-[var(--color-ink-2)]">
                    {String(event.payload.phase ?? event.payload.url ?? JSON.stringify(event.payload))}
                  </span>
                </li>
              ))}
          </ol>
        </Panel>
      </div>

      {consoleEvents.length > 0 || networkEvents.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Console and page errors">
            {consoleEvents.length === 0 ? (
              <EmptyState title="Nothing logged." />
            ) : (
              <ul className="space-y-1.5 font-mono text-xs">
                {consoleEvents.map((event, index) => (
                  <li key={index} className="flex gap-2">
                    <span
                      className="shrink-0 uppercase"
                      style={{
                        color:
                          event.payload.level === "error" || event.type === "page_error"
                            ? "var(--color-critical)"
                            : "var(--color-warning)",
                      }}
                    >
                      {event.type === "page_error" ? "error" : String(event.payload.level)}
                    </span>
                    <span className="min-w-0 break-words text-[var(--color-ink-2)]">
                      {String(event.payload.text ?? event.payload.message)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Failed requests">
            {networkEvents.length === 0 ? (
              <EmptyState title="No request failures." />
            ) : (
              <ul className="space-y-1.5 font-mono text-xs">
                {networkEvents.map((event, index) => (
                  <li key={index} className="text-[var(--color-ink-2)]">
                    <span style={{ color: "var(--color-critical)" }}>{String(event.payload.failure)}</span>{" "}
                    {String(event.payload.url)}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Session replay.
 *
 * The stored rrweb artifact is the source of truth; the presigned Solari URL is
 * minted on demand because it expires while the recording does not.
 */
function ReplayPanel({
  runId,
  replayStatus,
  mode,
  sessionId,
}: {
  runId: string
  replayStatus: string
  mode: string
  sessionId: string | null
}) {
  const [minting, setMinting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const mintUrl = async () => {
    setMinting(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/individual-runs/${runId}/replay?url=1`)
      const body = (await response.json()) as { url?: string | null; reason?: string }
      if (body.url) window.open(body.url, "_blank", "noopener,noreferrer")
      else setMessage(body.reason ?? "No replay URL is available for this run.")
    } catch {
      setMessage("Could not reach the server to mint a replay link.")
    } finally {
      setMinting(false)
    }
  }

  return (
    <Panel
      title="Session replay"
      description="A DOM-level rrweb recording of exactly what the browser did."
      actions={
        replayStatus === "ready" ? (
          <div className="flex gap-2">
            <a className="btn btn-secondary" href={`/api/individual-runs/${runId}/replay`} download={`${runId}.ndjson`}>
              Download NDJSON
            </a>
            {mode === "solari" && sessionId ? (
              <button className="btn btn-primary" onClick={mintUrl} disabled={minting}>
                <PlayCircle size={15} aria-hidden />
                {minting ? "Minting…" : "Watch Solari replay"}
                <ExternalLink size={13} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null
      }
    >
      {replayStatus === "ready" ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          {mode === "solari"
            ? "Recorded by Solari during the session and stored here as an artifact. The Solari link is minted fresh on demand, because presigned URLs expire while the recording does not."
            : "Captured locally with rrweb during the run. This is a local capture, not a Solari session replay."}
        </p>
      ) : replayStatus === "processing" ? (
        <EmptyState title="Replay processing…">
          Solari publishes a recording after the session is released, which can take minutes. The
          run&apos;s result is already final — this only adds evidence, so nothing waits for it.
          Refresh to check again.
        </EmptyState>
      ) : replayStatus === "unavailable" ? (
        <EmptyState title="Replay unavailable.">
          The recording never finished publishing. This says nothing about the agent: the verdict
          came from server-side state, and a replay is evidence rather than a judgement.
        </EmptyState>
      ) : mode === "demo" ? (
        <EmptyState title="Seeded demo runs carry no replay.">
          Replays come from real browser sessions. Start a run to record one.
        </EmptyState>
      ) : sessionId === BORROWED_SESSION_ID ? (
        <EmptyState title="A borrowed session carries no replay.">
          This run drove a browser somebody lent to the deployment, and recording can only be
          switched on when a session is created. The verdict is unaffected: it comes from
          server-side state, never from the recording.
        </EmptyState>
      ) : (
        <EmptyState title="This run was not recorded." />
      )}
      {message ? <p className="mt-3 text-sm text-[var(--color-ink-3)]">{message}</p> : null}
    </Panel>
  )
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return value === "" ? '""' : value
  return JSON.stringify(value)
}
