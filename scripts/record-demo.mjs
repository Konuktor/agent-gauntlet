/**
 * Records the 60-second demo by driving the live deployment.
 *
 * It deliberately opens run data that already exists rather than starting a
 * gauntlet: a live run spends Solari credits and takes minutes, and the point of
 * the video is the result, not the wait.
 *
 *   node scripts/record-demo.mjs
 *
 * Output lands in docs/demo/. Captions are burned on separately — see
 * docs/demo/README.md.
 */
import { chromium } from "playwright"
import { readdirSync, renameSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.DEMO_BASE_URL ?? "https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run"

// Pinned so re-recording produces the same walkthrough. If the demo database is
// reseeded, these are the only things that need updating.
const RUN = "1e6db4ff-6e36-4876-8abf-ab39acd13a52" // the four-run real Solari gauntlet
const MODAL = "7a51403b-23af-4370-afdb-6948c446d7a6" // unexpected_modal — passed, 19 steps
const EXPIRED = "dfdbd181-6ef8-48db-a1fa-03f6de3be5bb" // expired_session — failed, auth

const outDir = new URL("../docs/demo/", import.meta.url).pathname
const tmpDir = join(outDir, ".raw")
rmSync(tmpDir, { recursive: true, force: true })
mkdirSync(tmpDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: tmpDir, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()

const t0 = Date.now()
/** Hold until this many seconds into the video, so beats land on the script's
 *  timings whatever the network did. */
const at = async (sec) => {
  const wait = t0 + sec * 1000 - Date.now()
  if (wait > 0) await page.waitForTimeout(wait)
}
const scrollTo = async (text, block = "center") => {
  await page.evaluate(
    ({ t, b }) => {
      const el = [...document.querySelectorAll("h2, h3, div, section")]
        .filter((n) => (n.textContent ?? "").includes(t))
        .pop()
      el?.scrollIntoView({ behavior: "smooth", block: b })
    },
    { t: text, b: block },
  )
  await page.waitForTimeout(1100)
}

await page.goto(BASE, { waitUntil: "networkidle" }) // 0:00 landing
await at(6)

await page.goto(`${BASE}/runs/${RUN}`, { waitUntil: "networkidle" }) // 0:06 reliability + interval
await at(13)

await scrollTo("Run matrix") // 0:13 three green, one red
await at(21)

await page.goto(`${BASE}/runs/${RUN}/individual/${MODAL}`, { waitUntil: "networkidle" }) // 0:21 19 steps
await at(30)

await page.goto(`${BASE}/runs/${RUN}/individual/${EXPIRED}`, { waitUntil: "networkidle" }) // 0:30 evaluator
await at(34)
await scrollTo("Evaluator evidence", "start")
await at(38)

await page.goto(`${BASE}/runs/${RUN}`, { waitUntil: "networkidle" }) // 0:38 classified failure
await scrollTo("Failure clusters")
await at(45)

await page.goto(`${BASE}/suites/new`, { waitUntil: "networkidle" }) // 0:45 bring your own agent
await at(52)

await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{background:#0b0d10;color:#e8eaed;font:400 16px/1.5 ui-sans-serif,system-ui,sans-serif;
       display:grid;place-items:center;text-align:center}
  h1{font-size:60px;margin:0 0 16px;letter-spacing:-.02em}
  p.tag{font-size:24px;color:#a1a1aa;margin:0 0 44px}
  .links{font:400 18px ui-monospace,SFMono-Regular,Menlo,monospace;color:#3987e5;line-height:2.1}
</style>
<div>
  <h1>AgentGauntlet</h1>
  <p class="tag">Crash-test your browser agent before production does.</p>
  <div class="links">
    github.com/Konuktor/agent-gauntlet<br>
    http--agent-gauntlet-web--hjwypxsqnrjv.code.run
  </div>
</div>`)
await at(60) // 0:52 close

await context.close()
await browser.close()

const raw = readdirSync(tmpDir).find((f) => f.endsWith(".webm"))
if (!raw) throw new Error("playwright produced no recording")
renameSync(join(tmpDir, raw), join(outDir, "demo-raw.webm"))
rmSync(tmpDir, { recursive: true, force: true })

console.log("recorded docs/demo/demo-raw.webm")
console.log("now: ffmpeg -i docs/demo/demo-raw.webm -t 60 -c:v libx264 -preset slow -crf 20 \\")
console.log("       -pix_fmt yuv420p -movflags +faststart -r 25 -y docs/demo/agentgauntlet-demo.mp4")
