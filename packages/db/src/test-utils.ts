import { createDb, type DbHandle } from "./client.js"
import { loadDotEnv } from "./dotenv.js"

loadDotEnv(new URL("../../..", import.meta.url).pathname)

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://gauntlet:gauntlet@localhost:5433/gauntlet"

/** True when a Postgres we may freely truncate is reachable. */
export async function databaseAvailable(): Promise<boolean> {
  let handle: DbHandle | undefined
  try {
    handle = createDb({ url: TEST_DATABASE_URL, max: 1 })
    await handle.sql`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
  }
}

export function testDb(max = 5): DbHandle {
  return createDb({ url: TEST_DATABASE_URL, max })
}

/** Wipe every table. Cascade from projects covers the whole graph. */
export async function truncateAll(handle: DbHandle): Promise<void> {
  await handle.sql`
    TRUNCATE TABLE projects, agents, task_definitions, suites, suite_variants,
                   suite_runs, individual_runs, run_events, evaluation_results
    RESTART IDENTITY CASCADE
  `
}
