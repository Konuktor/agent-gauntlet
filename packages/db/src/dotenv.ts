import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * A 20-line .env loader, so scripts run without a dotenv dependency and without
 * Next.js's implicit loading being the only thing that works. Existing
 * environment variables always win, so `DATABASE_URL=... pnpm db:migrate`
 * behaves as expected.
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  for (const candidate of [resolve(cwd, ".env"), resolve(cwd, "../../.env")]) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, "utf8").split("\n")) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const eq = line.indexOf("=")
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      if (key in process.env) continue
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
    return
  }
}
