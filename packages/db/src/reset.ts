import { loadDotEnv } from "./dotenv.js"
import { createDb } from "./client.js"

loadDotEnv()

if (process.env.NODE_ENV === "production" && process.env.GAUNTLET_ALLOW_RESET !== "1") {
  console.error("Refusing to drop the schema with NODE_ENV=production.")
  process.exit(1)
}

const handle = createDb({ max: 1 })
try {
  await handle.sql`DROP SCHEMA IF EXISTS public CASCADE`
  await handle.sql`CREATE SCHEMA public`
  await handle.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`
  console.log("schema dropped and recreated — run `pnpm db:migrate` next")
} finally {
  await handle.close()
}
