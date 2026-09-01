import { listAgents, listProjects, listTasks } from "@gauntlet/db"
import { PERTURBATIONS } from "@gauntlet/perturbations"
import { clientCapabilities, db } from "@/lib/server"
import { EmptyState } from "@/components/primitives"
import { NewSuiteForm } from "@/components/new-suite-form"

export const dynamic = "force-dynamic"

export default async function NewSuitePage() {
  const database = db()
  const [project] = await listProjects(database)

  if (!project) {
    return (
      <EmptyState title="No project exists yet.">
        Run <code>pnpm db:migrate &amp;&amp; pnpm db:seed</code> to create the demo project.
      </EmptyState>
    )
  }

  const [agents, tasks] = await Promise.all([listAgents(database, project.id), listTasks(database, project.id)])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New suite</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Pick an agent, a task and the environments to test it in. Nothing runs until you say so.
        </p>
      </header>

      <NewSuiteForm
        capabilities={clientCapabilities()}
        catalog={{
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            config: (a.configJson ?? {}) as Record<string, unknown>,
          })),
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            maxSteps: t.maxSteps,
            timeoutMs: t.timeoutMs,
          })),
          perturbations: PERTURBATIONS.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            category: p.category,
          })),
        }}
      />
    </div>
  )
}
