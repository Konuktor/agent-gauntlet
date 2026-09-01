import { chromium } from "playwright"
const base = "http://127.0.0.1:3100"
const out = "/tmp/claude-1000/-home-erbol/91da8177-1a8a-49ec-9818-da15828ddb65/scratchpad/shots"
const runId = process.argv[2]
const detail = await (await fetch(`${base}/api/suite-runs/${runId}`)).json()
const failure = detail.runs.find((r) => r.status === "failed")
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
for (const [name, path] of [["live-dashboard", `/runs/${runId}`], ["live-detail", `/runs/${runId}/individual/${failure.id}`]]) {
  await page.goto(base + path, { waitUntil: "networkidle" })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
  console.log(name, "->", path)
}
if (errors.length) console.log("errors:", errors.slice(0,3))
await browser.close()
