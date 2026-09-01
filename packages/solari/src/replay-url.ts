import { Solari } from "@solarisdk/browser"

/**
 * Minting a presigned replay URL, and nothing else.
 *
 * Deliberately its own module. The full browser manager imports
 * `patchright-core` — a whole browser-automation runtime with native optional
 * dependencies — and a Next.js route that only needs a signed link has no
 * business pulling that into its bundle. This module's dependency footprint is
 * one HTTP client.
 */
export interface ReplayUrlResult {
  url: string
  expiresInSeconds: number
}

export async function mintReplayUrl(
  options: { apiKey: string; baseUrl?: string },
  sessionId: string,
): Promise<ReplayUrlResult | null> {
  const client = new Solari({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  })
  try {
    const { url, expiresInSeconds } = await client.sessions.getReplayUrl(sessionId)
    return { url, expiresInSeconds }
  } catch {
    // A 404 here means the session was never recorded, or the upload has not
    // landed. Neither is an error worth surfacing as a 500.
    return null
  } finally {
    // Required even on this path: the client keeps a loopback proxy handle that
    // would otherwise accumulate one per request.
    await client.close().catch(() => {})
  }
}
