/**
 * One-shot schema migration, shipped inside the worker image so the migration
 * job and the services can never run different code.
 *
 * Idempotent: drizzle skips what is already applied. Exits non-zero on failure
 * so the platform marks the job failed instead of deploying against a
 * half-migrated schema. It never seeds and never drops anything.
 */
import { loadDotEnv, migrateFromEnv } from "@gauntlet/db"

loadDotEnv()

try {
  await migrateFromEnv()
  console.log("migrations applied")
} catch (error) {
  console.error("migration failed:", error instanceof Error ? error.message : error)
  process.exit(1)
}
