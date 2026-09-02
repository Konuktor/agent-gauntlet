import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { deriveSeed } from "@gauntlet/core"
import type { DbHandle } from "./client.js"
import { databaseAvailable, testDb, truncateAll } from "./test-utils.js"
import {
  enqueueSuiteRun,
  getIndividualRun,
  listIndividualRuns,
  patchIndividualRun,
} from "./queries.js"
import { agents, projects, suiteVariants, suites, taskDefinitions } from "./schema.js"

const available = await databaseAvailable()

/**
 * The one-time scrub in migration 0004.
 *
 * Stopping new leaks is only half a fix: a capability already sitting in a
 * public API response stays there until something removes it. The sample below
 * mirrors the shape found on the live deployment — the SDK's loopback-wrapped
 * form, whose path carries the same signed composite id as the public URL,
 * which is why the pattern deliberately ignores the host.
 *
 * Every part of it is synthetic. An earlier version of this fixture kept the
 * real signature suffix and the real internal hostname from the production
 * response it was copied from; a secret scanner flagged it, correctly. A test
 * for a credential leak is a poor place to commit a fragment of one.
 */
describe.skipIf(!available)("migration 0004 — scrubbing persisted endpoints", () => {
  let handle: DbHandle
  let suiteId: string

  const LEAKED =
    "browserType.connectOverCDP: WebSocket error\nCall log:\n" +
    "  - <ws connecting> ws://127.0.0.1:44045/cdp/host-0%3Asession-0%3Aworker-0%3A1700000000000.EXAMPLESIGNATURE\n" +
    "  - <ws error> wss://api.getsolari.com/cdp/abc.signature error"

  beforeAll(() => {
    handle = testDb()
  })
  afterAll(async () => {
    await handle?.close()
  })

  beforeEach(async () => {
    await truncateAll(handle)
    const db = handle.db
    const [project] = await db.insert(projects).values({ name: "D", slug: "d" }).returning()
    const [agent] = await db
      .insert(agents)
      .values({ projectId: project!.id, name: "Reference Agent", type: "reference" })
      .returning()
    const [task] = await db
      .insert(taskDefinitions)
      .values({
        projectId: project!.id,
        name: "Checkout",
        description: "Add to cart and reach review",
        startUrl: "/",
        maxSteps: 20,
        timeoutMs: 90_000,
        evaluatorConfigJson: { kind: "fixture_state", expect: {} },
      })
      .returning()
    const [suite] = await db
      .insert(suites)
      .values({
        projectId: project!.id,
        name: "S",
        agentId: agent!.id,
        taskDefinitionId: task!.id,
        runsPerVariant: 1,
      })
      .returning()
    await db
      .insert(suiteVariants)
      .values([{ suiteId: suite!.id, perturbationType: "baseline", position: 0 }])
    suiteId = suite!.id
  })

  async function runWithMessage(failureMessage: string): Promise<string> {
    const suiteRun = await enqueueSuiteRun(handle.db, {
      suiteId,
      mode: "solari",
      variants: [{ id: "baseline", name: "Baseline", category: "none" }],
      runsPerVariant: 1,
      seedFor: (v, r) => deriveSeed("scrub", v, r),
    })
    const [run] = await listIndividualRuns(handle.db, suiteRun.id)
    await patchIndividualRun(handle.db, run!.id, { failureMessage })
    return run!.id
  }

  /** The migration body, applied to whatever rows exist right now. */
  const scrub = async () => {
    // Doubled single quotes are SQL escaping, so this lives in a template literal.
    const pattern = `wss?://[^[:space:]"'']*/(ws|cdp|control)/[^[:space:]"'']+`
    await handle.db.execute(
      sql.raw(
        `UPDATE individual_runs SET failure_message = regexp_replace(failure_message, '${pattern}', '[redacted-session-endpoint]', 'gi') WHERE failure_message ~* '${pattern}'`,
      ),
    )
  }

  it("removes a signed session id that was already stored", async () => {
    const runId = await runWithMessage(LEAKED)
    await scrub()

    const after = await getIndividualRun(handle.db, runId)
    const msg = after!.failureMessage ?? ""
    expect(msg).not.toContain("EXAMPLESIGNATURE")
    expect(msg).not.toContain("abc.signature")
    expect(msg).not.toContain("host-0")
    expect(msg).toContain("[redacted-session-endpoint]")
    // The diagnosis has to survive: scrubbing that destroys the error is a
    // different kind of failure.
    expect(msg).toContain("connectOverCDP")
  })

  it("leaves an ordinary failure message untouched", async () => {
    const plain = "The shopping session expired mid-task and the agent did not re-establish it."
    const runId = await runWithMessage(plain)
    await scrub()
    expect((await getIndividualRun(handle.db, runId))!.failureMessage).toBe(plain)
  })
})
