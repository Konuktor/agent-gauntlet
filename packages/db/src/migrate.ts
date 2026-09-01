import { migrate } from "drizzle-orm/postgres-js/migrator"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { loadDotEnv } from "./dotenv.js"
import { createDb } from "./client.js"

loadDotEnv()

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(here, "../drizzle")

const handle = createDb({ max: 1 })
try {
  console.log(`applying migrations from ${migrationsFolder}`)
  await migrate(handle.db, { migrationsFolder })
  console.log("migrations applied")
} catch (error) {
  console.error("migration failed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await handle.close()
}
