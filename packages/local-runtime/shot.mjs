import { chromium } from "playwright"

const base = "http://127.0.0.1:3100"
const out = "/tmp/claude-1000/-home-erbol/91da8177-1a8a-49ec-9818-da15828ddb65/scratchpad/shots"

const runs = await (await fetch(`${base}/api/suite-runs`)).json()
const regressed = runs.runs.find((r) => r.label?.includes("PR #82"))
const main = runs.runs.find((r) => r.label?.includes("main"))
const detail = await (await fetch(`${base}/api/suite-runs/${regressed.id}`)).json()
const failure = detail.runs.find((r) => r.status === "failed")

const pages = [
  ["landing", "/"],
  ["runs-list", "/runs"],
  ["dashboard", `/runs/${regressed.id}`],
  ["run-detail", `/runs/${regressed.id}/individual/${failure.id}`],
  ["compare", `/runs/${main.id}/compare/${regressed.id}`],
  ["new-suite", "/suites/new"],
]

const browser = await chromium.launch()
for (const [width, height, tag] of [[1440, 900, ""], [390, 844, "-mobile"]]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
  for (const [name, path] of pages) {
    await page.goto(base + path, { waitUntil: "networkidle" })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/${name}${tag}.png`, fullPage: true })
    console.log(`${name}${tag}  ${path}`)
  }
  if (errors.length) console.log(`  !! console/page errors at ${width}px:`, [...new Set(errors)].slice(0, 5))
  await context.close()
}
await browser.close()
console.log("done")
