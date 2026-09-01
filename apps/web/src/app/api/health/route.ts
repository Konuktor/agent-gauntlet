import { pingDatabase } from "@gauntlet/db"
import { ok } from "@/lib/api"
import { config, db } from "@/lib/server"

export const dynamic = "force-dynamic"

/**
 * Render's health check.
 *
 * Deliberately cheap: one `SELECT 1`, and never a Solari call. A health check
 * that created a browser session would spend credits every time the platform
 * polled it, which is a memorable way to discover you have none left.
 *
 * The database is required for the app to do anything useful, so an
 * unreachable one reports 503 and lets Render mark the deploy unhealthy.
 */
export async function GET() {
  const cfg = config()
  let database = false
  try {
    database = await pingDatabase(db())
  } catch {
    database = false
  }

  return ok(
    {
      status: database ? "ok" : "degraded",
      database: database ? "ok" : "unavailable",
      deployment: cfg.GAUNTLET_DEPLOY_MODE === "single" ? "render-single" : "split",
      // Presence only. Never the key, and never a call that uses it.
      solariConfigured: cfg.hasSolariCredentials,
      mode: cfg.resolvedMode,
      runsGated: cfg.runsAreGated,
    },
    { status: database ? 200 : 503 },
  )
}
