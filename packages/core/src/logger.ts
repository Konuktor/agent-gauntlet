import { redactValue } from "@gauntlet/config"

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
}

/** Identifiers attached to every log line so a failure is traceable end to end. */
export interface LogContext {
  suiteRunId?: string
  individualRunId?: string
  sandboxId?: string
  sessionId?: string
  variant?: string
  repetition?: number
  phase?: string
  mode?: string
  [key: string]: unknown
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  child(context: LogContext): Logger
  readonly context: LogContext
}

export interface LoggerOptions {
  level?: LogLevel
  /** Injected for tests; defaults to writing JSON lines to stdout. */
  sink?: (line: string) => void
  pretty?: boolean
}

export function createLogger(context: LogContext = {}, options: LoggerOptions = {}): Logger {
  const level = options.level ?? (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info"
  const sink = options.sink ?? ((line: string) => process.stdout.write(line + "\n"))
  const pretty = options.pretty ?? process.env.NODE_ENV === "development"

  const emit = (
    lvl: Exclude<LogLevel, "silent">,
    message: string,
    fields?: Record<string, unknown>,
  ) => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return
    const record = {
      ts: new Date().toISOString(),
      level: lvl,
      msg: message,
      ...context,
      ...(fields ?? {}),
    }
    // Secrets must never survive into a log file. Redaction is the last gate.
    const safe = redactValue(record) as Record<string, unknown>
    sink(pretty ? formatPretty(safe) : JSON.stringify(safe))
  }

  return {
    context,
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) => createLogger({ ...context, ...extra }, options),
  }
}

const LEVEL_TAG: Record<string, string> = {
  debug: "\x1b[2mDBG\x1b[0m",
  info: "\x1b[36mINF\x1b[0m",
  warn: "\x1b[33mWRN\x1b[0m",
  error: "\x1b[31mERR\x1b[0m",
}

function formatPretty(record: Record<string, unknown>): string {
  const { ts, level, msg, ...rest } = record
  const time = typeof ts === "string" ? ts.slice(11, 23) : ""
  const tag = LEVEL_TAG[String(level)] ?? String(level)
  const context = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `\x1b[2m${k}=\x1b[0m${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ")
  return `\x1b[2m${time}\x1b[0m ${tag} ${String(msg)}${context ? "  " + context : ""}`
}

/** A logger that drops everything — the default for library code under test. */
export const nullLogger: Logger = createLogger({}, { level: "silent" })
