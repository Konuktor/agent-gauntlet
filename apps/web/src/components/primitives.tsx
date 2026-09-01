import type { ReactNode } from "react"
import { clsx } from "clsx"
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Loader2, XCircle } from "lucide-react"

export type RunStatus =
  | "queued"
  | "preparing_environment"
  | "running_agent"
  | "evaluating"
  | "collecting_replay"
  | "passed"
  | "failed"
  | "infrastructure_error"
  | "cancelled"

/**
 * Status presentation, in one place.
 *
 * Every status carries a GLYPH and a LABEL, never colour alone. Red and green
 * are 4.1 ΔE apart under deuteranopia — indistinguishable — so colour here is
 * reinforcement, not the signal.
 */
export const STATUS_META: Record<
  RunStatus,
  { label: string; short: string; color: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  queued: { label: "Queued", short: "·", color: "var(--color-ink-3)", Icon: CircleDashed },
  preparing_environment: { label: "Preparing", short: "…", color: "var(--color-accent)", Icon: Loader2, spin: true },
  running_agent: { label: "Running", short: "…", color: "var(--color-accent)", Icon: Loader2, spin: true },
  evaluating: { label: "Evaluating", short: "…", color: "var(--color-accent)", Icon: Loader2, spin: true },
  collecting_replay: { label: "Replay", short: "…", color: "var(--color-accent)", Icon: Loader2, spin: true },
  passed: { label: "Passed", short: "✓", color: "var(--color-good)", Icon: CheckCircle2 },
  failed: { label: "Failed", short: "✗", color: "var(--color-critical)", Icon: XCircle },
  infrastructure_error: {
    label: "Infra error",
    short: "!",
    color: "var(--color-warning)",
    Icon: AlertTriangle,
  },
  cancelled: { label: "Cancelled", short: "—", color: "var(--color-ink-3)", Icon: CircleSlash },
}

export function StatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={clsx("chip", className)}
      style={{ color: meta.color, borderColor: `color-mix(in oklab, ${meta.color} 45%, transparent)` }}
    >
      <meta.Icon size={12} aria-hidden className={meta.spin ? "animate-spin" : undefined} />
      {meta.label}
    </span>
  )
}

/**
 * Which execution mode produced this data. Prominent on every screen: a seeded
 * or local run must never be mistaken for a real Solari run (§26).
 */
export function ModeBadge({ mode, className }: { mode: string; className?: string }) {
  const config: Record<string, { label: string; title: string; color: string }> = {
    solari: {
      label: "SOLARI",
      title: "Executed on Solari cloud browsers.",
      color: "var(--color-good)",
    },
    local: {
      label: "LOCAL",
      title: "Real browsers, running on this machine. Not a Solari run.",
      color: "var(--color-accent)",
    },
    demo: {
      label: "DEMO DATA",
      title:
        "Seeded dataset. Outcomes were measured against the real fixture; timings and traces are generated. Not a live run.",
      color: "var(--color-warning)",
    },
  }
  const meta = config[mode] ?? config.demo!
  return (
    <span
      className={clsx("chip", className)}
      title={meta.title}
      style={{ color: meta.color, borderColor: `color-mix(in oklab, ${meta.color} 45%, transparent)` }}
    >
      {meta.label}
    </span>
  )
}

export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: "default" | "good" | "critical"
}) {
  const color =
    tone === "good" ? "var(--color-good)" : tone === "critical" ? "var(--color-critical)" : "var(--color-ink)"
  return (
    <div className="card px-4 py-3">
      <div className="section-title">{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-tight" style={{ color }}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--color-ink-3)]">{sub}</div> : null}
    </div>
  )
}

export function Panel({
  title,
  actions,
  children,
  description,
  className,
}: {
  title: string
  actions?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={clsx("card", className)}>
      <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{description}</p>
          ) : null}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] px-4 py-8 text-center">
      <p className="text-sm font-medium text-[var(--color-ink-2)]">{title}</p>
      {children ? <div className="mt-1 text-xs text-[var(--color-ink-3)]">{children}</div> : null}
    </div>
  )
}

/**
 * §45 — a user sees what happened and what to do, never a raw stack. The
 * technical detail is preserved but folded away behind a disclosure.
 */
export function ErrorPanel({
  title,
  message,
  hint,
  detail,
}: {
  title: string
  message: string
  hint?: string
  detail?: string
}) {
  return (
    <div className="card border-[color-mix(in_oklab,var(--color-critical)_35%,transparent)] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: "var(--color-critical)" }} aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">{message}</p>
          {hint ? <p className="mt-1 text-xs text-[var(--color-ink-3)]">{hint}</p> : null}
          {detail ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]">
                Technical details
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-plane)] p-3 text-xs leading-relaxed text-[var(--color-ink-2)]">
                {detail}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  )
}
