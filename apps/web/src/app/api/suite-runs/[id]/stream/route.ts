import { loadSuiteRun } from "@/lib/queries"

export const dynamic = "force-dynamic"

const POLL_INTERVAL_MS = 900
const MAX_STREAM_MS = 30 * 60_000

/**
 * Server-sent events for the live run view.
 *
 * The server polls Postgres and pushes only when something changed; the browser
 * holds one connection instead of hammering the API. Deliberately not
 * LISTEN/NOTIFY: that needs a dedicated connection per stream and a second code
 * path to maintain, for a page that at most a handful of people watch at once.
 * This is the boring option, and boring is right here.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now()
      let lastPayload = ""

      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // Comment frame first: it defeats proxy buffering and gets the browser's
      // onopen to fire promptly.
      controller.enqueue(encoder.encode(": connected\n\n"))

      while (!closed && Date.now() - started < MAX_STREAM_MS) {
        try {
          const view = await loadSuiteRun(id)
          if (!view) {
            send("error", { message: "That run no longer exists." })
            break
          }

          const payload = JSON.stringify(view)
          if (payload !== lastPayload) {
            lastPayload = payload
            send("update", view)
          }

          if (["completed", "failed", "cancelled"].includes(view.status)) {
            send("done", { status: view.status })
            break
          }
        } catch (error) {
          send("error", {
            message: error instanceof Error ? error.message : "The live feed dropped.",
          })
          break
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }

      if (!closed) controller.close()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
