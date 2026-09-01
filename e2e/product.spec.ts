import { expect, test, type Page } from "@playwright/test"

/**
 * Product E2E.
 *
 * Runs against a built app with the seeded demo dataset, so it exercises the
 * real pages, the real API and the real database — no mocks. It deliberately
 * does NOT start a gauntlet: that spends browser time (or Solari credits), and
 * the orchestration path is already covered by the runner's own suite.
 */

/**
 * The newest SEEDED run. Selected by mode rather than by position: a developer's
 * database also holds real local runs, and those have different content.
 */
async function firstDemoRun(page: Page): Promise<string> {
  const response = await page.request.get("/api/suite-runs")
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as {
    runs: Array<{ id: string; mode: string; label: string | null }>
  }
  const demo = body.runs.filter((r) => r.mode === "demo")
  expect(demo.length, "seed the database first: pnpm db:seed").toBeGreaterThan(0)
  return demo[0]!.id
}

/** The two seeded runs of one suite, oldest first, for the comparison view. */
async function demoRunPair(page: Page): Promise<[string, string]> {
  const body = (await (await page.request.get("/api/suite-runs")).json()) as {
    runs: Array<{ id: string; mode: string }>
  }
  const demo = body.runs.filter((r) => r.mode === "demo")
  expect(demo.length, "the seed creates two comparable runs").toBeGreaterThanOrEqual(2)
  return [demo[1]!.id, demo[0]!.id]
}

test.describe("landing", () => {
  test("states the product's claim and offers both calls to action", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Crash-test your browser agent")
    // Two obvious paths: exploring costs nothing, running spends credits.
    await expect(page.getByRole("link", { name: /Explore the demo/i })).toBeVisible()
    await expect(page.getByRole("link", { name: /Run a real gauntlet/i })).toBeVisible()
  })

  // The product measures agents; it is not one. The pitch must not read as if
  // it ships a particular model.
  test("frames itself as agent-agnostic and names no model vendor", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText(/Bring any agent/i)).toBeVisible()
    const body = (await page.locator("body").innerText()).toLowerCase()
    expect(body).not.toContain("anthropic")
    expect(body).not.toContain("openai")
  })

  test("shows which execution mode a new run would use", async ({ page }) => {
    await page.goto("/")
    // The mode badge is on every screen; a seeded or local run must never be
    // mistakable for a Solari run.
    await expect(page.locator("header .chip").first()).toHaveText(/SOLARI|LOCAL/)
  })

  test("has no horizontal overflow at the demo viewport", async ({ page }) => {
    await page.goto("/")
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflow).toBe(false)
  })
})

test.describe("runs list", () => {
  test("lists the seeded runs with their reliability", async ({ page }) => {
    await page.goto("/runs")
    await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible()
    await expect(page.locator("tbody tr").first()).toBeVisible()
    await expect(page.getByText("DEMO DATA").first()).toBeVisible()
  })
})

test.describe("result dashboard", () => {
  test("shows reliability, the confidence interval and the baseline split", async ({ page }) => {
    await page.goto(`/runs/${await firstDemoRun(page)}`)
    await expect(page.getByText("Reliability", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/\d+ \/ \d+ runs passed/)).toBeVisible()
    await expect(page.getByText(/95% confidence interval/)).toBeVisible()
    await expect(page.getByText("Baseline", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Perturbed", { exact: true })).toBeVisible()
  })

  test("renders the run matrix as an accessible table", async ({ page }) => {
    await page.goto(`/runs/${await firstDemoRun(page)}`)
    const matrix = page.getByRole("table", { name: /Outcome of every run/i })
    await expect(matrix).toBeVisible()
    // Row headers name the perturbation; column headers name the repetition.
    await expect(matrix.getByRole("columnheader", { name: "Run 1" })).toBeVisible()
    await expect(matrix.getByRole("rowheader").first()).toBeVisible()
  })

  test("labels every cell so status is never colour-alone", async ({ page }) => {
    await page.goto(`/runs/${await firstDemoRun(page)}`)
    // Red and green are 4.1 ΔE apart under deuteranopia; the label is the
    // actual signal.
    const cell = page.getByRole("link", { name: /run \d+: (Passed|Failed)/ }).first()
    await expect(cell).toBeVisible()
  })

  test("groups repeated failures into clusters", async ({ page }) => {
    await page.goto(`/runs/${await firstDemoRun(page)}`)
    await expect(page.getByRole("heading", { name: "Failure clusters" })).toBeVisible()
  })
})

test.describe("individual failure", () => {
  test("shows the failing assertion, the agent's claim and the action trace", async ({ page }) => {
    await page.goto(`/runs/${await firstDemoRun(page)}`)
    await page.getByRole("link", { name: /run \d+: Failed/ }).first().click()
    await page.waitForURL(/\/individual\//)

    // The status chip in the page header, not the word "failed" wherever it
    // happens to appear.
    await expect(page.locator("header, h1").locator("..").getByText("Failed", { exact: true }).first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Evaluator evidence" })).toBeVisible()

    // The product's thesis, on screen: expected vs actual, from the site's own
    // state, next to what the agent claimed about itself.
    const evidence = page.getByRole("table", { name: /Assertions checked/i })
    await expect(evidence).toBeVisible()
    await expect(evidence.getByText("fail").first()).toBeVisible()
    await expect(page.getByText("What the agent said about itself")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Agent action trace" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Session replay" })).toBeVisible()
  })

  test("explains honestly when a seeded run has no replay", async ({ page }) => {
    await page.goto(`/runs/${await firstDemoRun(page)}`)
    await page.getByRole("link", { name: /run \d+: Failed/ }).first().click()
    await page.waitForURL(/\/individual\//)
    await expect(page.getByText(/Seeded demo runs carry no replay|not recorded/i)).toBeVisible()
  })
})

test.describe("regression comparison", () => {
  test("detects the seeded regression and attributes it to a perturbation", async ({ page }) => {
    const [previous, current] = await demoRunPair(page)
    await page.goto(`/runs/${previous}/compare/${current}`)

    await expect(page.getByRole("heading", { name: "Regression comparison" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Regression detected" })).toBeVisible()
    await expect(page.getByText("percentage points", { exact: true })).toBeVisible()
    await expect(page.getByRole("table", { name: /Reliability change per perturbation/i })).toBeVisible()
  })
})

test.describe("new suite", () => {
  test("previews the run count before anything can start", async ({ page }) => {
    await page.goto("/suites/new")
    await expect(page.getByRole("heading", { name: "New suite" })).toBeVisible()
    // §35: the cost is stated up front and nothing runs on page load.
    await expect(page.getByText(/8 variants × 2 repetitions = 16 browser runs/)).toBeVisible()
    await expect(page.getByRole("button", { name: /Run the Gauntlet/i })).toBeEnabled()
  })

  test("updates the run count when variants change", async ({ page }) => {
    await page.goto("/suites/new")
    await page.getByRole("checkbox", { name: /Baseline/i }).first().uncheck()
    await expect(page.getByText(/7 variants × 2 repetitions = 14 browser runs/)).toBeVisible()
  })

  test("refuses to start with no variants selected", async ({ page }) => {
    await page.goto("/suites/new")
    for (const checkbox of await page.getByRole("checkbox").all()) {
      if (await checkbox.isChecked()) await checkbox.uncheck()
    }
    await expect(page.getByRole("button", { name: /Run the Gauntlet/i })).toBeDisabled()
    await expect(page.getByText("Select at least one variant.")).toBeVisible()
  })
})

test.describe("api", () => {
  test("reports health and capabilities without leaking secrets", async ({ page }) => {
    const response = await page.request.get("/api/health")
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.status).toBe("ok")
    expect(body.database).toBe("ok")
    // Presence, never the value.
    expect(typeof body.solariConfigured).toBe("boolean")
    const raw = JSON.stringify(body)
    expect(raw).not.toMatch(/slr_live_|sk-ant-|postgres:\/\//)
  })

  test("rejects an invalid suite with a readable error", async ({ page }) => {
    const response = await page.request.post("/api/suites", {
      data: { name: "", agentId: "not-a-uuid", taskDefinitionId: "x", variants: [], runsPerVariant: 0 },
    })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.error.title).toBeTruthy()
    expect(body.error.hint).toBeTruthy()
  })

  test("404s an unknown run rather than erroring", async ({ page }) => {
    const response = await page.request.get("/api/suite-runs/00000000-0000-0000-0000-000000000000")
    expect(response.status()).toBe(404)
  })
})
