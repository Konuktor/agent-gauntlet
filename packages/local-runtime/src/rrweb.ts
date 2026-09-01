import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

/**
 * Local-mode session recording.
 *
 * Solari records browser sessions server-side and hands back rrweb NDJSON.
 * Local mode has no such service, so we inject the same recorder ourselves and
 * emit the same format. That means one replay player in the dashboard serves
 * both, and the demo has something real to play without spending credits.
 *
 * The UI always labels which source a replay came from — a locally-captured
 * recording is never presented as a Solari session replay.
 */

let cachedBundle: string | undefined

/** The rrweb browser bundle, read from the installed package. */
export function rrwebBundle(): string {
  if (cachedBundle) return cachedBundle
  const require = createRequire(import.meta.url)
  const entry = require.resolve("rrweb/dist/rrweb.umd.cjs")
  cachedBundle = readFileSync(entry, "utf8")
  return cachedBundle
}

export const RRWEB_BINDING = "__gauntletRrwebEmit"

/** Init script: loads rrweb into every document and streams events out. */
export function rrwebInitScript(): string {
  return `
${rrwebBundle()}
;(function () {
  if (window.__gauntletRecording) return;
  window.__gauntletRecording = true;
  var record = (window.rrweb && window.rrweb.record) || window.rrwebRecord;
  if (!record) return;
  record({
    emit: function (event) {
      try { window.${RRWEB_BINDING}(JSON.stringify(event)); } catch (_) {}
    },
    // Inputs are masked: a replay is evidence, and evidence should not be a
    // second copy of whatever was typed into a form.
    maskAllInputs: true,
    recordCanvas: false,
    collectFonts: false,
  });
})();
`
}

export class RrwebCollector {
  private readonly lines: string[] = []
  private bytes = 0
  private truncated = false

  constructor(private readonly maxBytes: number) {}

  push(serializedEvent: string): void {
    if (this.truncated) return
    const size = Buffer.byteLength(serializedEvent) + 1
    if (this.bytes + size > this.maxBytes) {
      this.truncated = true
      return
    }
    this.bytes += size
    this.lines.push(serializedEvent)
  }

  get eventCount(): number {
    return this.lines.length
  }

  get wasTruncated(): boolean {
    return this.truncated
  }

  toNdjson(): Uint8Array {
    return Buffer.from(this.lines.join("\n"), "utf8")
  }
}
