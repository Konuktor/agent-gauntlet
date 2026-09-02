import { readFile } from "node:fs/promises"
import pc from "picocolors"
import { runSessionCommand } from "./session-command.js"
import { compareSuites, GauntletError, ERROR_COPY } from "@gauntlet/core"
import { loadDotEnv } from "@gauntlet/db"
import { parseEnv } from "@gauntlet/config"
import { DEMO_CONFIG, loadConfigFile } from "./config.js"
import { fromInvocationDir } from "./cwd.js"
import { runGauntlet } from "./run-command.js"
import { renderComparison, type GauntletReport } from "./report.js"

loadDotEnv()

const USAGE = `${pc.bold("gauntlet")} — crash-test your browser agent

  ${pc.bold("gauntlet demo")}                     run the bundled demo suite
  ${pc.bold("gauntlet run")} <config.yaml>        run a gauntlet from a config file
  ${pc.bold("gauntlet compare")} <a.json> <b.json>  compare two run reports
  ${pc.bold("gauntlet doctor")}                   check this machine's configuration
  ${pc.bold("gauntlet session")}                  open a browser session on YOUR Solari account,
                                    and print an endpoint a hosted gauntlet can drive

Options
  --report <path>   where to write the JSON report (run/demo)
  --label <text>    label this run in the report
  --quiet           only print the verdict
  --json            print the endpoint as one JSON line (session)

Exit codes
  0  every configured threshold met
  1  a threshold was missed, or the run could not complete
`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const flags = parseFlags(rest)

  switch (command) {
    case "demo":
      return (
        await runGauntlet({
          config: DEMO_CONFIG,
          ...(flags.report ? { reportPath: fromInvocationDir(flags.report) } : {}),
          ...(flags.label ? { label: flags.label } : {}),
          quiet: flags.quiet,
        })
      ).exitCode

    case "session":
      return runSessionCommand({ json: flags.json })

    case "run": {
      const path = flags.positional[0]
      if (!path) {
        process.stderr.write(`${pc.red("gauntlet run needs a config file.")}\n\n${USAGE}`)
        return 1
      }
      return (
        await runGauntlet({
          config: await loadConfigFile(fromInvocationDir(path)),
          ...(flags.report ? { reportPath: fromInvocationDir(flags.report) } : {}),
          ...(flags.label ? { label: flags.label } : {}),
          quiet: flags.quiet,
        })
      ).exitCode
    }

    case "compare": {
      const [a, b] = flags.positional
      if (!a || !b) {
        process.stderr.write(`${pc.red("gauntlet compare needs two report files.")}\n\n${USAGE}`)
        return 1
      }
      const [previous, current] = await Promise.all([readReport(a), readReport(b)])
      const comparison = compareSuites(previous.metrics, current.metrics)
      process.stdout.write(
        renderComparison(comparison, {
          previous: previous.label ?? a,
          current: current.label ?? b,
        }),
      )
      // A regression is a failing condition: that is the entire point of
      // running this in CI.
      return comparison.regressed ? 1 : 0
    }

    case "doctor":
      return doctor()

    case "--help":
    case "-h":
    case "help":
    case undefined:
      process.stdout.write(USAGE)
      return 0

    default:
      process.stderr.write(`${pc.red(`Unknown command "${command}".`)}\n\n${USAGE}`)
      return 1
  }
}

function doctor(): number {
  try {
    const env = parseEnv()
    const rows: Array<[string, string, boolean]> = [
      ["mode", env.resolvedMode, true],
      ["SOLARI_API_KEY", env.hasSolariCredentials ? "set" : "not set", env.hasSolariCredentials],
      ["optional LLM key", env.hasLlmCredentials ? "set" : "not set — not required", true],
      ["real runs gated", env.runsAreGated ? "yes (GAUNTLET_RUN_TOKEN set)" : "no", true],
      ["concurrency", String(env.GAUNTLET_MAX_CONCURRENCY), true],
      ["runs per suite cap", String(env.GAUNTLET_MAX_RUNS_PER_SUITE), true],
      ["artifact dir", env.GAUNTLET_ARTIFACT_DIR, true],
      ["fixture override", env.GAUNTLET_FIXTURE_URL ?? "none (a sandbox will host it)", true],
    ]
    process.stdout.write(`\n${pc.bold("gauntlet doctor")}\n\n`)
    for (const [label, value, ok] of rows) {
      process.stdout.write(
        `  ${ok ? pc.green("✓") : pc.yellow("!")} ${label.padEnd(20)} ${pc.dim(value)}\n`,
      )
    }
    if (!env.hasSolariCredentials) {
      process.stdout.write(
        `\n  ${pc.dim("Without a Solari key, runs execute locally against the bundled fixture.")}\n` +
          `  ${pc.dim("Everything works; it is simply not a Solari run, and reports say so.")}\n`,
      )
    }
    process.stdout.write("\n")
    return 0
  } catch (error) {
    reportError(error)
    return 1
  }
}

async function readReport(rawPath: string): Promise<GauntletReport> {
  const path = fromInvocationDir(rawPath)
  try {
    return JSON.parse(await readFile(path, "utf8")) as GauntletReport
  } catch (error) {
    throw new GauntletError({
      code: "config_invalid",
      message: `Could not read the report at ${path}.`,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

interface Flags {
  positional: string[]
  report?: string
  label?: string
  quiet: boolean
  /** `gauntlet session --json`, for scripting. */
  json: boolean
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { positional: [], quiet: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--quiet") flags.quiet = true
    else if (arg === "--json") flags.json = true
    else if (arg === "--report") flags.report = argv[++i]
    else if (arg === "--label") flags.label = argv[++i]
    else if (!arg.startsWith("-")) flags.positional.push(arg)
  }
  return flags
}

/** §45 in the terminal: what happened and what to do, not a stack trace. */
function reportError(error: unknown): void {
  if (error instanceof GauntletError) {
    const copy = ERROR_COPY[error.code]
    process.stderr.write(
      `\n${pc.red(pc.bold(copy.title))}\n  ${error.message}\n  ${pc.dim(copy.hint)}\n`,
    )
    if (error.detail) process.stderr.write(`\n${pc.dim(error.detail)}\n`)
    process.stderr.write("\n")
    return
  }
  process.stderr.write(`\n${pc.red(pc.bold("Something went wrong"))}\n  ${String(error)}\n\n`)
}

// pnpm's `run start --` forwards a bare "--" separator; strip it so
// `pnpm gauntlet doctor` and `gauntlet doctor` behave identically.
main(process.argv.slice(2).filter((arg) => arg !== "--"))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    reportError(error)
    process.exitCode = 1
  })
