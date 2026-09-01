import type { AgentExecutionResult } from "../domain/agent.js"
import type { EvaluationResult } from "../domain/evaluation.js"
import type { TaskDefinition } from "../domain/task.js"
import type { Logger } from "../logger.js"
import type { PageDriver } from "./page.js"

export interface EvaluationContext {
  runId: string
  task: TaskDefinition
  /** Where the fixture's authoritative state can be read from. Absent for
   *  external targets, which are evaluated through the page instead. */
  fixtureBaseUrl?: string
  /** May be null when the browser died before evaluation. */
  page: PageDriver | null
  /** The agent's own report. Available as *evidence*, never as the verdict. */
  agentResult: AgentExecutionResult
  signal: AbortSignal
  logger: Logger
}

export interface Evaluator {
  readonly kind: string
  evaluate(context: EvaluationContext): Promise<EvaluationResult>
}
