import { gunzip as gunzipCallback } from "node:zlib"
import { promisify } from "node:util"
import { getIndividualRun, getReplayArtifact, getSuiteRun } from "@gauntlet/db"
import { mintReplayUrl } from "@gauntlet/solari/replay-url"
import { apiError, notFound, ok } from "@/lib/api"
import { config, db } from "@/lib/server"

export const dynamic = "force-dynamic"

/**
 * Serve a run's session replay.
 *
 * Two things worth noting.
 *
 * We serve the stored ARTIFACT, not a stored URL. Solari's `getReplayUrl`
 * returns a presigned link that expires, so persisting one would persist
 * something that stops working; the recording itself does not expire.
 *
 * The artifact lives in Postgres rather than on local disk, because the
 * deployment target's filesystem is ephemeral and a replay on it would quietly
 * vanish between deploys.
 *
 * `?url=1` mints a fresh presigned Solari URL on demand — server-side, so the
 * API key never leaves this process and the browser only ever sees a
 * short-lived link it can open.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const database = db()
    const run = await getIndividualRun(database, id)
    if (!run) return notFound("Run")

    const wantsUrl = new URL(request.url).searchParams.get("url") === "1"
    if (wantsUrl) {
      const cfg = config()
      if (!cfg.SOLARI_API_KEY || !run.sessionId) {
        return ok({ url: null, reason: "This run has no Solari session to mint a URL for." })
      }
      const minted = await mintReplayUrl(
        { apiKey: cfg.SOLARI_API_KEY, baseUrl: cfg.SOLARI_BASE_URL },
        run.sessionId,
      )
      return ok(minted ?? { url: null, reason: "Solari has no replay for this session." })
    }

    const stored = run.replayStatus === "ready" ? await getReplayArtifact(database, id) : null

    if (!stored) {
      const suiteRun = await getSuiteRun(database, run.suiteRunId)
      return ok(
        {
          available: false,
          replayStatus: run.replayStatus,
          mode: suiteRun?.mode ?? "demo",
          reason:
            run.replayStatus === "not_requested"
              ? "This run was not recorded."
              : run.replayStatus === "processing"
                ? "Replay processing. Solari publishes recordings after the session is released; the run's result is already final."
                : run.replayStatus === "ready"
                  ? "The recording is no longer stored. Open the Solari replay instead."
                  : "Replay unavailable: the recording never finished publishing. That does not affect the run's result.",
        },
        { status: 200 },
      )
    }

    const ndjson = await gunzip(stored.compressed)

    return new Response(new Uint8Array(ndjson), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-length": String(ndjson.length),
        "cache-control": "private, max-age=300",
      },
    })
  } catch (error) {
    return apiError(error)
  }
}

const gunzip = promisify(gunzipCallback)
