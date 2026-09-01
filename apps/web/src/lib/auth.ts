import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { config } from "./server.js"

/**
 * Authorization for runs that spend real money.
 *
 * The threat is mundane and expensive: this app is deployed at a public URL
 * with a Solari key, so without a gate anyone who finds it can start suites
 * until the credits are gone. Exploring the seeded demo stays completely open —
 * it costs nothing — and only *starting a run* is gated.
 *
 * Deliberately not OAuth. One shared token, exchanged once for an HttpOnly
 * cookie, is proportionate to "stop strangers spending my money on a challenge
 * submission" and adds no dependencies.
 */
export const RUN_COOKIE = "gauntlet_run"

/**
 * The cookie is NOT the token.
 *
 * It carries an HMAC derived from it, so a stolen cookie cannot be turned back
 * into the shared secret, and rotating `GAUNTLET_RUN_TOKEN` invalidates every
 * outstanding cookie at once.
 */
function sessionValue(token: string): string {
  return createHmac("sha256", token).update("agentgauntlet:run-session:v1").digest("hex")
}

/** Constant-time comparison; length is compared first because timingSafeEqual throws on a mismatch. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export type RunAuthorization =
  | { authorized: true; reason: "ungated" | "cookie" }
  | { authorized: false; reason: "missing" | "invalid" }

/** Whether the caller may start a run that spends credits. */
export async function checkRunAuthorization(): Promise<RunAuthorization> {
  const token = config().GAUNTLET_RUN_TOKEN
  // No token configured means no gate — the right behaviour on a laptop, and
  // refused at startup for a public deployment that could spend money.
  if (!token) return { authorized: true, reason: "ungated" }

  const cookie = (await cookies()).get(RUN_COOKIE)?.value
  if (!cookie) return { authorized: false, reason: "missing" }
  return matches(cookie, sessionValue(token))
    ? { authorized: true, reason: "cookie" }
    : { authorized: false, reason: "invalid" }
}

export interface GrantedSession {
  name: string
  value: string
  options: {
    httpOnly: true
    secure: boolean
    sameSite: "lax"
    path: string
    maxAge: number
  }
}

/** Validate a submitted access code and mint the session cookie. */
export function grantRunSession(submitted: string): GrantedSession | null {
  const token = config().GAUNTLET_RUN_TOKEN
  if (!token) return null
  if (!matches(submitted.trim(), token)) return null

  return {
    name: RUN_COOKIE,
    value: sessionValue(token),
    options: {
      httpOnly: true,
      // Render terminates TLS; locally there is no HTTPS, and a Secure cookie
      // there would simply never be stored.
      secure: config().NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    },
  }
}
