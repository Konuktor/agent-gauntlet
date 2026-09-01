import { migrate } from "drizzle-orm/postgres-js/migrator"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { createDb, type Database } from "./client.js"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the generated SQL.
 *
 * Bundling breaks the obvious answer. Running from source this module sits in
 * `packages/db/src`, so the migrations are one level up. Bundled into a deploy
 * artifact it sits in `apps/web/dist`, where `../drizzle` is nothing at all —
 * which is why the deploy build copies the folder next to the bundle and this
 * resolver checks both. An explicit env var wins over either.
 */
export function resolveMigrationsFolder(): string {
  const candidates = [
    process.env.GAUNTLET_MIGRATIONS_DIR,
    resolve(here, "../drizzle"),
    join(here, "drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate))

  const found = candidates.find((candidate) => existsSync(join(candidate, "meta", "_journal.json")))
  if (found) return found

  throw new Error(
    `Could not find database migrations. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "Set GAUNTLET_MIGRATIONS_DIR, or run `pnpm db:generate`.",
  )
}

/**
 * Apply pending migrations.
 *
 * Exported as a function because Render's free plan has no `preDeployCommand`,
 * so the single-service deployment must migrate from inside its start command,
 * before it serves any traffic. Drizzle records what it has applied, so running
 * this on every boot is safe and idempotent.
 */
export async function runMigrations(db: Database, migrationsFolder?: string): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder ?? resolveMigrationsFolder() })
}

/** Standalone entrypoint: `pnpm db:migrate`. */
export async function migrateFromEnv(log: (message: string) => void = console.log): Promise<void> {
  const handle = createDb({ max: 1 })
  const folder = resolveMigrationsFolder()
  try {
    log(`applying migrations from ${folder}`)
    await runMigrations(handle.db, folder)
    log("migrations applied")
  } finally {
    await handle.close()
  }
}
