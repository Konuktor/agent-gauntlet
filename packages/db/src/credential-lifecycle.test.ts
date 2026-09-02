import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { deriveSeed } from "@gauntlet/core"
import type { DbHandle } from "./client.js"
import {
  CREDENTIAL_MAX_AGE_MS,
  attachRunCredential,
  enqueueSuiteRun,
  readRunCredential,
  transitionSuiteRun,
  wipeRunCredential,
  wipeStaleCredentials,
} from "./queries.js"
import { agents, projects, suiteRuns, suiteVariants, suites, taskDefinitions } from "./schema.js"
import { databaseAvailable, testDb, truncateAll } from "./test-utils.js"
import { eq } from "drizzle-orm"

const available = await databaseAvailable()

/**
 * The lifetime of a credential somebody lent us.
 *
 * This table is the queue between two services, so a borrowed secret
 * unavoidably passes through it. What must never happen is that it *stays* —
 * so every path out of a run has to end with the credential gone, including
 * the paths where the run never happened at all.
 */
describe.skipIf(!available)("borrowed credential lifecycle", () => {
  let handle: DbHandle
  let suiteId: string

  beforeAll(() => {
    handle = testDb()
  })
  afterAll(async () => {
    await handle?.close()
  })

  beforeEach(async () => {
    await truncateAll(handle)
    const db = handle.db
    const [project] = await db.insert(projects).values({ name: "Demo", slug: "demo" }).returning()
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
        name: "Checkout gauntlet",
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

  const sealed = { kind: "session" as const, ciphertext: "Y2lwaGVy", iv: "aXY=", tag: "dGFn" }

  async function runWithCredential(): Promise<string> {
    const suiteRun = await enqueueSuiteRun(handle.db, {
      suiteId,
      mode: "solari",
      variants: [{ id: "baseline", name: "Baseline", category: "none" }],
      runsPerVariant: 1,
      seedFor: (v, r) => deriveSeed("credentials", v, r),
    })
    await attachRunCredential(handle.db, suiteRun.id, sealed)
    return suiteRun.id
  }

  it("hands back exactly what was sealed into it", async () => {
    const id = await runWithCredential()
    expect(await readRunCredential(handle.db, id)).toEqual(sealed)
  })

  it("reports nothing for a run that brought nothing", async () => {
    const suiteRun = await enqueueSuiteRun(handle.db, {
      suiteId,
      mode: "local",
      variants: [{ id: "baseline", name: "Baseline", category: "none" }],
      runsPerVariant: 1,
      seedFor: (v, r) => deriveSeed("credentials", v, r),
    })
    expect(await readRunCredential(handle.db, suiteRun.id)).toBeNull()
  })

  it("is gone after the run wipes it", async () => {
    const id = await runWithCredential()
    await wipeRunCredential(handle.db, id)
    expect(await readRunCredential(handle.db, id)).toBeNull()
  })

  // The worker that dies mid-run cannot wipe what it borrowed; the next one does.
  it("sweeps a credential left on a finished run", async () => {
    const id = await runWithCredential()
    await transitionSuiteRun(handle.db, id, "failed")
    expect(await wipeStaleCredentials(handle.db)).toBe(1)
    expect(await readRunCredential(handle.db, id)).toBeNull()
  })

  // A run that never happened still holds a secret. The session behind it has
  // expired on Solari's side long before this bound, so keeping it is all cost.
  it("sweeps a credential whose run never started, once it is old enough", async () => {
    const id = await runWithCredential()

    expect(await wipeStaleCredentials(handle.db), "still fresh, still queued").toBe(0)
    expect(await readRunCredential(handle.db, id)).toEqual(sealed)

    await handle.db
      .update(suiteRuns)
      .set({ createdAt: new Date(Date.now() - CREDENTIAL_MAX_AGE_MS - 60_000) })
      .where(eq(suiteRuns.id, id))

    expect(await wipeStaleCredentials(handle.db)).toBe(1)
    expect(await readRunCredential(handle.db, id)).toBeNull()
  })
})
