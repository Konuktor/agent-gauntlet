import { loadDotEnv } from "./dotenv.js"
import { migrateFromEnv } from "./migrate.js"

loadDotEnv()

try {
  await migrateFromEnv()
} catch (error) {
  console.error("migration failed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
}
