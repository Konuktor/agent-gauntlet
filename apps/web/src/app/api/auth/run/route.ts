import { z } from "zod"
import { apiError, ok, parseBody } from "@/lib/api"
import { checkRunAuthorization, grantRunSession, RUN_COOKIE } from "@/lib/auth"
import { config } from "@/lib/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({ token: z.string().min(1).max(512) })

/** Current authorization, so the UI can show the right call to action. */
export async function GET() {
  try {
    const auth = await checkRunAuthorization()
    return ok({ gated: config().runsAreGated, authorized: auth.authorized })
  } catch (error) {
    return apiError(error)
  }
}

/** Exchange the access code for an HttpOnly session cookie. */
export async function POST(request: Request) {
  try {
    if (!config().runsAreGated) {
      return ok({ gated: false, authorized: true })
    }

    const body = await parseBody(request, bodySchema)
    const granted = grantRunSession(body.token)
    if (!granted) {
      // Deliberately vague, and no hint about length or shape.
      return ok({ gated: true, authorized: false, error: "That access code is not valid." }, { status: 401 })
    }

    const response = ok({ gated: true, authorized: true })
    response.cookies.set(granted.name, granted.value, granted.options)
    return response
  } catch (error) {
    return apiError(error)
  }
}

/** Sign out. */
export async function DELETE() {
  const response = ok({ gated: config().runsAreGated, authorized: false })
  response.cookies.delete(RUN_COOKIE)
  return response
}
