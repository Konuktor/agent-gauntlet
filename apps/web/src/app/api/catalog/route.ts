import { listAgents, listProjects, listTasks } from "@gauntlet/db"
import { apiError, ok } from "@/lib/api"
import { db } from "@/lib/server"
import { PERTURBATIONS } from "@gauntlet/perturbations"

export const dynamic = "force-dynamic"

/** Everything the "new suite" form needs, in one round trip. */
export async function GET() {
  try {
    const database = db()
    const projects = await listProjects(database)
    const project = projects[0]
    if (!project) return ok({ projects: [], agents: [], tasks: [], perturbations: [] })

    const [agents, tasks] = await Promise.all([
      listAgents(database, project.id),
      listTasks(database, project.id),
    ])

    return ok({
      projects,
      agents: agents.map((a) => ({ id: a.id, name: a.name, type: a.type, config: a.configJson })),
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
    })
  } catch (error) {
    return apiError(error)
  }
}
