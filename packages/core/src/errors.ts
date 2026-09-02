/**
 * Errors are values here, not strings. Every failure that can reach a user
 * carries a stable `code` (used by the failure classifier and the UI's error
 * copy) plus optional technical `detail` that the UI hides behind a disclosure.
 */
export const errorCodes = [
  "config_invalid",
  "browser_launch_failed",
  "browser_disconnected",
  "sandbox_create_failed",
  "sandbox_command_failed",
  "fixture_unavailable",
  "preview_url_unavailable",
  "agent_timeout",
  "agent_crashed",
  "agent_loop_detected",
  "agent_max_steps",
  "evaluator_unavailable",
  "evaluator_failed",
  "replay_unavailable",
  "repository_invalid",
  "repository_manifest_invalid",
  "solari_auth",
  "solari_plan",
  "solari_concurrency",
  "solari_capacity",
  "solari_unavailable",
  "cancelled",
  "internal",
] as const

export type ErrorCode = (typeof errorCodes)[number]

export interface GauntletErrorOptions {
  code: ErrorCode
  /** Short, human, non-technical. Shown directly to the user. */
  message: string
  /** Technical detail for the expandable diagnostics panel. */
  detail?: string
  /** True when a retry of the *infrastructure* step could plausibly succeed.
   *  Never used to retry an agent — that would hide the unreliability we exist
   *  to measure. */
  retryable?: boolean
  cause?: unknown
}

export class GauntletError extends Error {
  readonly code: ErrorCode
  readonly detail?: string
  readonly retryable: boolean

  constructor(opts: GauntletErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = "GauntletError"
    this.code = opts.code
    this.detail = opts.detail
    this.retryable = opts.retryable ?? false
  }

  static from(error: unknown, fallback: ErrorCode = "internal"): GauntletError {
    if (error instanceof GauntletError) return error
    const message = error instanceof Error ? error.message : String(error)
    return new GauntletError({
      code: fallback,
      message,
      detail: error instanceof Error ? error.stack : undefined,
      cause: error,
    })
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail,
      retryable: this.retryable,
    }
  }
}

/**
 * User-facing copy for each error code. §45: never show a raw stack or a bare
 * HTTP status; say what happened and what to do about it.
 */
export const ERROR_COPY: Record<ErrorCode, { title: string; hint: string }> = {
  config_invalid: {
    title: "Configuration is incomplete",
    hint: "Check your .env against .env.example, then restart the worker.",
  },
  browser_launch_failed: {
    title: "Solari could not start this browser session",
    hint: "Check your account credits and concurrency limit at console.getsolari.com.",
  },
  browser_disconnected: {
    title: "The browser disconnected mid-run",
    hint: "This is usually a transient pool issue. The run is recorded as an infrastructure error, not an agent failure.",
  },
  sandbox_create_failed: {
    title: "Solari could not start the sandbox",
    hint: "Free plans allow one concurrent sandbox. Check for sandboxes left running in the console.",
  },
  sandbox_command_failed: {
    title: "A command failed inside the sandbox",
    hint: "Open the diagnostics below for the exit code and stderr.",
  },
  fixture_unavailable: {
    title: "The benchmark site did not come up",
    hint: "The Gauntlet Shop fixture failed to start or was unreachable from the browser.",
  },
  preview_url_unavailable: {
    title: "Solari could not expose the benchmark site publicly",
    hint: "Port preview may not be configured on this deployment. Set GAUNTLET_FIXTURE_URL to a reachable fixture instead.",
  },
  agent_timeout: {
    title: "The agent ran out of time",
    hint: "Raise the task timeout, or the agent is stuck.",
  },
  agent_crashed: {
    title: "The agent threw an error",
    hint: "See the action trace and agent output below.",
  },
  agent_loop_detected: {
    title: "The agent repeated the same action",
    hint: "It took the same action with no state change several times — usually a sign it cannot see a blocking overlay.",
  },
  agent_max_steps: {
    title: "The agent hit its step limit",
    hint: "It did not finish within maxSteps.",
  },
  evaluator_unavailable: {
    title: "The evaluator could not read the benchmark state",
    hint: "Without independent state we cannot judge the run, so it is an infrastructure error, not a failure.",
  },
  evaluator_failed: { title: "The evaluator errored", hint: "See diagnostics below." },
  replay_unavailable: {
    title: "The replay is not available",
    hint: "Replays upload asynchronously after a session is released. This does not affect the run's result.",
  },
  repository_invalid: {
    title: "That repository URL is not allowed",
    hint: "Use an https:// URL on a public host. Local and private-network addresses are rejected.",
  },
  repository_manifest_invalid: {
    title: "agentgauntlet.yaml is invalid",
    hint: "See docs/AGENT_CONTRACT.md for the expected shape.",
  },
  solari_auth: {
    title: "Solari rejected the API key",
    hint: "Rotate or re-copy SOLARI_API_KEY from console.getsolari.com.",
  },
  solari_plan: {
    title: "Your Solari plan does not include this feature",
    hint: "Stealth, proxies and captcha solving require a paid plan.",
  },
  solari_concurrency: {
    title: "Solari concurrency limit reached",
    hint: "Lower GAUNTLET_MAX_CONCURRENCY, or upgrade the plan. Retrying immediately cannot help — a slot only frees when a session ends.",
  },
  solari_capacity: {
    title: "No Solari capacity right now",
    hint: "The pool had no host available. Try again shortly.",
  },
  solari_unavailable: {
    title: "Solari is unreachable",
    hint: "Check status and your network connection.",
  },
  cancelled: {
    title: "The run was cancelled",
    hint: "The worker shut down or you stopped the suite.",
  },
  internal: { title: "Something went wrong", hint: "See diagnostics below." },
}
