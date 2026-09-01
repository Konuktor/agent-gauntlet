import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { createGunzip } from "node:zlib"
import { getIndividualRun, getSuiteRun } from "@gauntlet/db"
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

    if (run.replayStatus !== "available" || !run.replayArtifactPath) {
      const suiteRun = await getSuiteRun(database, run.suiteRunId)
      return ok(
        {
          available: false,
          replayStatus: run.replayStatus,
          mode: suiteRun?.mode ?? "demo",
          reason:
            run.replayStatus === "none"
              ? "This run was not recorded."
              : "The replay never finished uploading. That does not affect the run's result.",
        },
        { status: 200 },
      )
    }

    await stat(run.replayArtifactPath)
    const ndjson = Readable.toWeb(
      createReadStream(run.replayArtifactPath).pipe(createGunzip()),
    ) as ReadableStream<Uint8Array>

    return new Response(ndjson, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "private, max-age=300",
      },
    })
  } catch (error) {
    return apiError(error)
  }
}
