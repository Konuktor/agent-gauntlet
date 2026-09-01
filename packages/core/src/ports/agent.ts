import type { AgentExecutionResult, AgentType } from "../domain/agent.js"
import type { RunRecorder } from "../domain/events.js"
import type { TaskDefinition } from "../domain/task.js"
import type { Logger } from "../logger.js"
import type { Rng } from "../random.js"
import type { PageDriver } from "./page.js"
import type { SandboxProvider } from "./sandbox.js"

export interface AgentRunContext {
  runId: string
  task: TaskDefinition
  /** Fully-qualified URL the agent should start from. */
  startUrl: string
  /**
   * Driver for the run's browser. Present for in-process agents.
   * A repository agent drives the browser itself over CDP, so it gets a page
   * only for post-hoc inspection — it must not be assumed to be untouched.
   */
  page: PageDriver
  /**
   * RAW, public CDP endpoint for the session, for agents that connect
   * themselves from inside a sandbox.
   *
   * This must come from `sessions.create()`, never from `launch()`: the
   * endpoint exposed on a launched BrowserSession is wrapped through a
   * loopback proxy on THIS machine and is unreachable from a remote VM.
   *
   * It is a credential — anyone holding it can drive the browser — so it is
   * passed through memory only and never persisted or logged.
   */
  cdpEndpoint?: string
  /** Available to repository agents for their execution sandbox. */
  sandboxes?: SandboxProvider
  maxSteps: number
  signal: AbortSignal
  recorder: RunRecorder
  logger: Logger
  rng: Rng
}

export interface AgentAdapter {
  readonly type: AgentType
  readonly name: string
  run(context: AgentRunContext): Promise<AgentExecutionResult>
}
