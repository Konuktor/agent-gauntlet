import { ok } from "@/lib/api"
import { clientCapabilities } from "@/lib/server"

export const dynamic = "force-dynamic"

/** Only the safe subset: which mode we are in and what the UI may offer.
 *  No credentials, ever — just whether one is present. */
export async function GET() {
  return ok(clientCapabilities())
}
