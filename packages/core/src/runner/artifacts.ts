import { mkdir, writeFile } from "node:fs/promises"
import { createGzip } from "node:zlib"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { createWriteStream } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Where run artifacts live on disk.
 *
 * Replays are stored as the artifact, not as a URL. Solari's `getReplayUrl`
 * returns a PRESIGNED url with an expiry, so persisting one would persist
 * something that stops working; the recording behind it does not expire, and a
 * fresh url can be minted whenever anyone actually wants to open it.
 */
export class ArtifactStore {
  private readonly root: string

  constructor(directory: string) {
    this.root = resolve(directory)
  }

  async writeReplay(suiteRunId: string, runId: string, bytes: Uint8Array): Promise<string> {
    const dir = join(this.root, "replays", suiteRunId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${runId}.ndjson.gz`)
    // Gzipped on disk: rrweb NDJSON is highly compressible and a suite can
    // produce dozens of these.
    await pipeline(Readable.from(Buffer.from(bytes)), createGzip(), createWriteStream(path))
    return path
  }

  async writeJson(relativePath: string, value: unknown): Promise<string> {
    const path = join(this.root, relativePath)
    await mkdir(join(path, ".."), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 2), "utf8")
    return path
  }

  get directory(): string {
    return this.root
  }
}
