"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Play } from "lucide-react"
import { CATEGORY_LABELS, type PerturbationCategory } from "@gauntlet/core/shared"
import type { ClientCapabilities } from "@/lib/capabilities"
import { ErrorPanel, ModeBadge, Panel } from "./primitives"

interface Catalog {
  agents: Array<{ id: string; name: string; type: string; config: Record<string, unknown> }>
  tasks: Array<{ id: string; name: string; description: string; maxSteps: number; timeoutMs: number }>
  perturbations: Array<{ id: string; name: string; description: string; category: PerturbationCategory }>
}

const DEFAULT_SELECTED = new Set([
  "baseline",
  "cookie_popup",
  "slow_api",
  "unexpected_modal",
  "mobile_viewport",
  "renamed_cta",
  "expired_session",
  "network_delay",
])

export function NewSuiteForm({
  catalog,
  capabilities,
}: {
  catalog: Catalog
  capabilities: ClientCapabilities
}) {
  const router = useRouter()
  const [agentId, setAgentId] = useState(catalog.agents[0]?.id ?? "")
  const [taskId, setTaskId] = useState(catalog.tasks[0]?.id ?? "")
  const [variants, setVariants] = useState<Set<string>>(new Set(DEFAULT_SELECTED))
  const [repetitions, setRepetitions] = useState(2)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ title: string; message: string; hint?: string; detail?: string } | null>(null)

  const task = catalog.tasks.find((t) => t.id === taskId)
  const agent = catalog.agents.find((a) => a.id === agentId)
  const totalRuns = variants.size * repetitions
  const overCap = totalRuns > capabilities.maxRunsPerSuite

  const grouped = useMemo(() => {
    const map = new Map<PerturbationCategory, Catalog["perturbations"]>()
    for (const p of catalog.perturbations) {
      const list = map.get(p.category)
      if (list) list.push(p)
      else map.set(p.category, [p])
    }
    return [...map.entries()]
  }, [catalog.perturbations])

  const toggle = (id: string) => {
    setVariants((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const llmUnavailable = agent?.type === "llm" && !capabilities.hasLlm
  const repoUnavailable = agent?.type === "repository" && !capabilities.hasSolari
  const blocked = variants.size === 0 || overCap || !agentId || !taskId || llmUnavailable || repoUnavailable

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const suiteResponse = await fetch("/api/suites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${task?.name ?? "Suite"} · ${agent?.name ?? "Agent"}`,
          agentId,
          taskDefinitionId: taskId,
          variants: [...variants],
          runsPerVariant: repetitions,
        }),
      })
      if (!suiteResponse.ok) throw await toError(suiteResponse)

      const suite = (await suiteResponse.json()) as { id: string }
      const runResponse = await fetch(`/api/suites/${suite.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: `${agent?.name ?? "Agent"} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}` }),
      })
      if (!runResponse.ok) throw await toError(runResponse)

      const run = (await runResponse.json()) as { id: string }
      router.push(`/runs/${run.id}`)
    } catch (caught) {
      setError(
        caught && typeof caught === "object" && "title" in caught
          ? (caught as { title: string; message: string; hint?: string; detail?: string })
          : { title: "Could not start the gauntlet", message: String(caught) },
      )
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="space-y-6">
        {error ? <ErrorPanel {...error} /> : null}

        <Panel title="Agent" description="What is being tested.">
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.agents.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor: option.id === agentId ? "var(--color-accent)" : "var(--color-line)",
                  background: option.id === agentId ? "color-mix(in oklab, var(--color-accent) 8%, transparent)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="agent"
                  className="mt-1"
                  checked={option.id === agentId}
                  onChange={() => setAgentId(option.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{option.name}</span>
                  <span className="block text-xs text-[var(--color-ink-3)]">
                    {describeAgent(option)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {llmUnavailable ? (
            <p className="mt-3 text-sm" style={{ color: "var(--color-warning)" }}>
              The LLM agent needs <code>ANTHROPIC_API_KEY</code>. The Reference Agent needs no credentials.
            </p>
          ) : null}
          {repoUnavailable ? (
            <p className="mt-3 text-sm" style={{ color: "var(--color-warning)" }}>
              Repository agents run inside a Solari Sandbox, so they need <code>SOLARI_API_KEY</code>.
            </p>
          ) : null}
        </Panel>

        <Panel title="Task" description="What the agent has to accomplish, and how it will be judged.">
          <label className="label" htmlFor="task">Task</label>
          <select id="task" className="field" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {catalog.tasks.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          {task ? (
            <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-plane)] p-3">
              <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">{task.description}</p>
              <p className="mt-2 text-xs text-[var(--color-ink-3)] tnum">
                max {task.maxSteps} steps · {Math.round(task.timeoutMs / 1000)}s timeout
              </p>
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Environment variants"
          description="Each one changes the environment deterministically, seeded from the run's coordinates."
        >
          <div className="space-y-4">
            {grouped.map(([category, items]) => (
              <fieldset key={category}>
                <legend className="section-title mb-2">{CATEGORY_LABELS[category]}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((perturbation) => (
                    <label
                      key={perturbation.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5"
                      style={{
                        borderColor: variants.has(perturbation.id) ? "var(--color-accent)" : "var(--color-line)",
                      }}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={variants.has(perturbation.id)}
                        onChange={() => toggle(perturbation.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm">{perturbation.name}</span>
                        <span className="block text-xs leading-snug text-[var(--color-ink-3)]">
                          {perturbation.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </Panel>

        <Panel title="Repetitions" description="The same variant, run this many times. Repetition is where unreliability shows up.">
          <div className="flex items-center gap-4">
            <input
              id="repetitions"
              type="range"
              min={1}
              max={10}
              value={repetitions}
              onChange={(e) => setRepetitions(Number(e.target.value))}
              className="w-64"
              aria-describedby="repetitions-value"
            />
            <output id="repetitions-value" className="text-2xl font-semibold tabular-nums">{repetitions}</output>
          </div>
        </Panel>
      </div>

      <aside className="card sticky top-20 p-5">
        <div className="flex items-center justify-between">
          <span className="section-title">Before you start</span>
          <ModeBadge mode={capabilities.mode} />
        </div>

        <p className="mt-3 text-3xl font-semibold tabular-nums">{totalRuns}</p>
        <p className="text-sm text-[var(--color-ink-2)]">
          {variants.size} variant{variants.size === 1 ? "" : "s"} × {repetitions} repetition
          {repetitions === 1 ? "" : "s"} = {totalRuns} browser run{totalRuns === 1 ? "" : "s"}
        </p>

        <dl className="mt-4 space-y-1.5 text-xs text-[var(--color-ink-3)]">
          <div className="flex justify-between">
            <dt>Concurrency</dt>
            <dd className="tnum">{capabilities.maxConcurrency} at a time</dd>
          </div>
          <div className="flex justify-between">
            <dt>Cap per suite</dt>
            <dd className="tnum">{capabilities.maxRunsPerSuite} runs</dd>
          </div>
        </dl>

        {overCap ? (
          <p className="mt-3 text-sm" style={{ color: "var(--color-critical)" }}>
            That is above the configured cap of {capabilities.maxRunsPerSuite}. Reduce variants or repetitions.
          </p>
        ) : null}

        {capabilities.mode === "solari" ? (
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            Each run is one recorded Solari browser session. Nothing starts until you press the button.
          </p>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            Local mode: real Chromium on this machine, no Solari credits spent. Results are labelled LOCAL.
          </p>
        )}

        <button className="btn btn-primary mt-4 w-full" disabled={blocked || submitting} onClick={submit}>
          {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Play size={15} aria-hidden />}
          {submitting ? "Starting…" : "Run the Gauntlet"}
        </button>
        {variants.size === 0 ? (
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">Select at least one variant.</p>
        ) : null}
      </aside>
    </div>
  )
}

function describeAgent(agent: { type: string; config: Record<string, unknown> }): string {
  if (agent.type === "llm") return "Model-driven planner, one structured action per step"
  if (agent.type === "repository") return "Your repository, executed inside a Solari Sandbox"
  const capabilities = (agent.config.capabilities as string[] | undefined) ?? []
  if (capabilities.length === 0) return "Deterministic · no overlay handling, no waiting"
  return `Deterministic · ${capabilities.join(", ")}`
}

async function toError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: { title: string; message: string; hint?: string; detail?: string } } | null
  return (
    body?.error ?? {
      title: "Request failed",
      message: `The server returned HTTP ${response.status}.`,
    }
  )
}
