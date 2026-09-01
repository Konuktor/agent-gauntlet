import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

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

/**
 * The rrweb browser bundle, read from the installed package.
 *
 * Resolved via the package's own entry point rather than by reaching straight
 * for `rrweb/dist/rrweb.umd.cjs`: rrweb 2.1's `exports` map publishes only "."
 * and "./dist/style.css", so a deep subpath import throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED even though the file is sitting right there.
 * Resolving "." and walking to its sibling works whatever the exports map says.
 */
export function rrwebBundle(): string {
  if (cachedBundle) return cachedBundle
  const require = createRequire(import.meta.url)
  const entry = require.resolve("rrweb")
  // The minified UMD build: this string is injected into every page of every
  // run, so the ~200 KB saved over the unminified build is worth having.
  const umd = join(dirname(entry), "rrweb.umd.min.cjs")
  cachedBundle = readFileSync(umd, "utf8")
  return cachedBundle
}

export const RRWEB_BINDING = "__gauntletRrwebEmit"

/**
 * Init script: loads rrweb into every document and streams events out.
 *
 * The deferral matters. An init script is evaluated on `about:blank` before the
 * real document exists, and calling `rrweb.record()` at that point CRASHES the
 * renderer outright ("Target crashed") — not an exception you can catch, the
 * whole tab. So recording starts on DOMContentLoaded, and only for documents
 * that are actually pages.
 */
export function rrwebInitScript(): string {
  return `
${rrwebBundle()}
;(function () {
  // about: and blob: documents have nothing worth recording and are exactly
  // where starting the recorder takes the renderer down with it.
  if (location.protocol === "about:" || location.protocol === "blob:") return;

  function start() {
    if (window.__gauntletRecording) return;
    if (!document.body) return;
    window.__gauntletRecording = true;
    var record = window.rrweb && window.rrweb.record;
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
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
