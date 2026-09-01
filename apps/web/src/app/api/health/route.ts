import { pingDatabase } from "@gauntlet/db"
import { apiError, ok } from "@/lib/api"
import { clientCapabilities, db } from "@/lib/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const database = await pingDatabase(db())
    return ok(
      { ok: database, database, ...clientCapabilities() },
      { status: database ? 200 : 503 },
    )
  } catch (error) {
    return apiError(error, 503)
  }
}
