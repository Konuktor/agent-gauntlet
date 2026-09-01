import { LIMITS } from "@gauntlet/config"
import { sleep, type Logger, type ReplayArtifact } from "@gauntlet/core"

export interface ReplayFetchDeps {
  downloadReplay(sessionId: string): Promise<Uint8Array>
  logger: Logger
}

export interface ReplayFetchOptions {
  attempts?: number
  intervalMs?: number
  maxBytes?: number
  signal?: AbortSignal
}

/**
 * Collect a session's replay after it has been released.
 *
 * Three facts from the Solari docs shape this:
 *
 *  1. The recording is uploaded ASYNCHRONOUSLY after release, so "the first
 *     poll usually 404s even on a perfectly good recording". We retry.
 *  2. `getReplayUrl` hands back a PRESIGNED url with an expiry, so persisting
 *     that url would be persisting something that stops working. We download
 *     the artifact instead and re-mint the url on demand if anyone wants one.
 *  3. The bytes arrive already decompressed — the HTTP client honours
 *     Content-Encoding. Do not gzip.decompress() them again.
 *
 * And one product rule: a replay is EVIDENCE, not a verdict. If it never
 * arrives we return null, and the run's pass/fail is untouched (§34).
 */
export async function fetchReplayWithBackoff(
  sessionId: string,
  deps: ReplayFetchDeps,
  options: ReplayFetchOptions = {},
): Promise<ReplayArtifact | null> {
  const attempts = options.attempts ?? LIMITS.replayPollAttempts
  const interval = options.intervalMs ?? LIMITS.replayPollIntervalMs
  const maxBytes = options.maxBytes ?? LIMITS.maxReplayBytes

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) return null
    try {
      await sleep(attempt === 1 ? Math.min(interval, 1_500) : interval, options.signal)
    } catch {
      return null // aborted
    }

    try {
      const bytes = await deps.downloadReplay(sessionId)
      if (bytes.length === 0) {
        deps.logger.debug("replay empty, retrying", { attempt })
        continue
      }
      return toArtifact(bytes, maxBytes)
    } catch (error) {
      if (isNotYetUploaded(error)) {
        deps.logger.debug("replay not uploaded yet", { attempt, attempts })
        continue
      }
      deps.logger.warn("replay download failed", {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  deps.logger.info("replay never became available", { attempts })
  return null
}

/** A 404 here means "not uploaded yet", not "no such session". */
function isNotYetUploaded(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  if (status === 404) return true
  const message = error instanceof Error ? error.message : String(error)
  return /\b404\b|not found/i.test(message)
}

export function toArtifact(bytes: Uint8Array, maxBytes: number): ReplayArtifact {
  const truncated = bytes.length > maxBytes
  const kept = truncated ? truncateToLastCompleteLine(bytes, maxBytes) : bytes
  return {
    source: "solari",
    bytes: kept,
    eventCount: countLines(kept),
    truncated,
  }
}

/** NDJSON must stay parseable, so a truncation cuts at a newline boundary. */
function truncateToLastCompleteLine(bytes: Uint8Array, maxBytes: number): Uint8Array {
  const slice = bytes.subarray(0, maxBytes)
  for (let i = slice.length - 1; i >= 0; i--) {
    if (slice[i] === 0x0a) return slice.subarray(0, i)
  }
  return slice
}

function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  let count = 1
  for (const byte of bytes) if (byte === 0x0a) count++
  return count
}
