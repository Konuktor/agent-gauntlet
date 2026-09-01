/**
 * A minimal AgentGauntlet repository agent.
 *
 * It connects to the browser session AgentGauntlet created for this run, over
 * the CDP endpoint handed to it in the environment, and drives the task with
 * plain Playwright. Roughly 80 lines — the contract is deliberately small.
 *
 * Note what this process is NOT given: a Solari API key. The CDP endpoint is a
 * capability scoped to exactly one browser session that AgentGauntlet already
 * created and will release. That is the least authority that makes the job
 * possible, which is the point.
 */
import { chromium } from "playwright-core"

const {
  AGENT_GAUNTLET_TASK: task,
  AGENT_GAUNTLET_START_URL: startUrl,
  AGENT_GAUNTLET_CDP_ENDPOINT: cdpEndpoint,
  AGENT_GAUNTLET_RUN_ID: runId,
} = process.env

function report(status, message, steps) {
  // AgentGauntlet records this as a CLAIM. It never decides the verdict —
  // that comes from the benchmark site's own server-side state.
  console.log(`AGENT_GAUNTLET_RESULT=${JSON.stringify({ status, message, steps })}`)
}

if (!cdpEndpoint || !startUrl) {
  report("failed", "Missing AGENT_GAUNTLET_CDP_ENDPOINT or AGENT_GAUNTLET_START_URL", 0)
  process.exit(1)
}

console.log(`run ${runId}: ${task}`)

let browser
let steps = 0

const step = async (label, fn) => {
  steps += 1
  console.log(`  ${steps}. ${label}`)
  await fn()
}

try {
  browser = await chromium.connectOverCDP(cdpEndpoint)
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = context.pages()[0] ?? (await context.newPage())

  await step("open the store", () => page.goto(startUrl, { waitUntil: "domcontentloaded" }))

  // Dismiss anything covering the page before trying to click through it.
  await step("clear overlays", async () => {
    for (const label of ["Accept all", "Close", "No thanks"]) {
      const control = page.getByRole("button", { name: label })
      if (await control.count()) await control.first().click({ timeout: 2_000 }).catch(() => {})
    }
  })

  await step("add Aurora Headphones", () =>
    page.getByRole("button", { name: /aurora headphones/i }).first().click({ timeout: 15_000 }),
  )

  await step("apply the coupon", async () => {
    await page.getByLabel(/coupon/i).fill("SAVE20")
    await page.getByRole("button", { name: /apply/i }).click()
  })

  await step("go to checkout", () =>
    page.getByRole("button", { name: /checkout|continue/i }).first().click(),
  )

  await step("fill in the details", async () => {
    await page.getByLabel(/name/i).fill("Ada Lovelace")
    await page.getByLabel(/city/i).fill("London")
  })

  await step("continue to review", () =>
    page.getByRole("button", { name: /review|continue/i }).first().click(),
  )

  // The task says stop before paying. Stopping is the last step, not an
  // omission — an agent that "helpfully" places the order has failed.
  report("completed", "Reached the review step without submitting the order.", steps)
} catch (error) {
  report("failed", error instanceof Error ? error.message : String(error), steps)
  process.exitCode = 1
} finally {
  // Disconnect only. The session belongs to AgentGauntlet, which releases it.
  await browser?.close().catch(() => {})
}
