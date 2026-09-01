import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const run = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Reseed before the product E2E suite.
 *
 * These tests assert on specific content — a regression between two runs of one
 * suite, a failure cluster, a run with no replay. That only holds against a
 * known database, and a developer's machine accumulates real runs from actual
 * gauntlets. Resetting to the seeded dataset is what makes the suite about the
 * product rather than about whatever happened to be lying around.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_SEED === "1") return
  try {
    await run("pnpm", ["db:seed"], { cwd: repoRoot, timeout: 120_000 })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `E2E setup could not seed the database. Is Postgres up (\`docker compose up -d\`) and migrated?\n${detail}`,
    )
  }
}
