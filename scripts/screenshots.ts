/**
 * Regenerate the screenshots used in the README and the demo script.
 *
 *   pnpm --filter @gauntlet/web run start   # or pnpm dev
 *   pnpm tsx scripts/screenshots.ts [baseUrl]
 *
 * Shoots the seeded demo dataset, so the images stay reproducible rather than
 * being whatever happened to be on screen.
 */
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "playwright"

const base = process.argv[2] ?? "http://127.0.0.1:3000"
const outDir = resolve("docs/images")

interface RunRow {
  id: string
  mode: string
  label: string | null
}

const runs = (await (await fetch(`${base}/api/suite-runs`)).json()) as { runs: RunRow[] }
const demo = runs.runs.filter((r) => r.mode === "demo")
if (demo.length < 2) {
  console.error("Expected two seeded demo runs. Run `pnpm db:seed` first.")
  process.exit(1)
}
const [current, previous] = demo as [RunRow, RunRow]

const detail = (await (await fetch(`${base}/api/suite-runs/${current.id}`)).json()) as {
  runs: Array<{ id: string; status: string }>
}
const failure = detail.runs.find((r) => r.status === "failed")
if (!failure) {
  console.error("The seeded run has no failure to screenshot.")
  process.exit(1)
}

const pages: Array<[string, string]> = [
  ["landing", "/"],
  ["runs-list", "/runs"],
  ["dashboard", `/runs/${current.id}`],
  ["run-detail", `/runs/${current.id}/individual/${failure.id}`],
  ["compare", `/runs/${previous.id}/compare/${current.id}`],
  ["new-suite", "/suites/new"],
]

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const [width, height, suffix] of [
    [1440, 900, ""],
    [390, 844, "-mobile"],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    })
    const page = await context.newPage()
    const problems: string[] = []
    page.on("pageerror", (error) => problems.push(String(error)))
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text())
    })

    for (const [name, path] of pages) {
      await page.goto(base + path, { waitUntil: "networkidle" })
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${outDir}/${name}${suffix}.png`, fullPage: true })
      console.log(`  ${name}${suffix}`)
    }

    if (problems.length > 0) {
      console.warn(`  ! console errors at ${width}px:`, [...new Set(problems)].slice(0, 3))
    }
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(`\nwrote ${pages.length * 2} images to ${outDir}`)
