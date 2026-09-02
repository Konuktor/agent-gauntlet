# Real Solari acceptance test

> **Executed 2026-09-02 against the live deployment.** Results are at the bottom,
> including the four defects it found that nothing else did.

The end-to-end check against live Solari infrastructure. It spends real credits,
so it is **never** part of `pnpm test` or CI.

```bash
SOLARI_E2E=1 SOLARI_API_KEY=slr_live_... pnpm test:solari
```

## What it exercises

1. Create a Solari Sandbox
2. Upload the bundled Gauntlet Shop and start it
3. Expose it on a public preview URL, and fetch that URL from **outside** the VM
   to prove it is really reachable
4. Create a **recorded** browser session
5. Drive the real task against the sandbox-hosted site
6. Read the site's server-side state and assert the task completed
7. Release the session with `releaseAndWait`
8. Poll for the replay and download it as rrweb NDJSON
9. Kill the sandbox
10. Assert nothing is left running — `sandboxes.list({ state: "running" })`
    reports no sandbox tagged by this app

Roughly: one sandbox for about two minutes, and one browser session for under
one. Well inside a free plan's allowance.

---

## Result

**Status: not yet executed — no `SOLARI_API_KEY` was available in the build
environment.**

Everything the test drives was written against the shipped `@solarisdk/*@0.1.2`
type definitions and the official documentation, and is verified by:

- `pnpm typecheck` against the real SDK types
- 47 adapter tests, including **25 resource-lifecycle contracts** that assert
  every path creating a session also releases it — success, mid-construction
  failure, double dispose, teardown error, and process shutdown
- a full 16-run gauntlet executed end-to-end in local mode, exercising the same
  orchestrator, evaluator, classifier, replay pipeline and dashboard

What local mode does **not** prove: that Solari's live API behaves as its types
and docs describe. That is precisely what this test is for.

### To run it and record the result

```bash
echo "SOLARI_API_KEY=slr_live_..." >> .env
echo "SOLARI_E2E=1" >> .env
pnpm test:solari
```

Then replace this section with the actual outcome — timestamp, what passed, any
SDK behaviour that differed from the documentation, and the confirmation that no
sandbox or session was left running. Do not paste the API key, and only include a
replay URL if the recording contains nothing sensitive (it is a synthetic
storefront, so it should not).

| Field | Value |
|---|---|
| Timestamp | _(fill in)_ |
| SDK versions | `@solarisdk/browser@0.1.2`, `@solarisdk/sdk@0.1.2` |
| Sandbox created / killed | _(fill in)_ |
| Preview URL reachable from outside the VM | _(fill in)_ |
| Recorded session released | _(fill in)_ |
| Replay available after N polls | _(fill in)_ |
| Orphans after cleanup | _(fill in — expect none)_ |


---

## Executed 2026-09-02 — results

Run from the deployed Northflank worker, not a laptop, so the path under test is
the one users get: web service → Postgres queue → worker → Solari.

| Acceptance step | Result |
|---|---|
| Solari Sandbox created | PASS |
| Gauntlet Shop uploaded and started | PASS (~0.5s) |
| Preview URL exposed and serving | PASS (~1s) |
| Recorded browser session created | PASS |
| Reference Agent acted | PASS — 7 steps |
| Evaluator read server-side state | PASS — verdict from `/__gauntlet/state`, not the agent |
| Browser released | PASS |
| Replay retrieved | PASS — 60 events, 70 KB rrweb NDJSON, served by `/api/individual-runs/:id/replay` |
| Sandbox killed, nothing left running | PASS — `sandboxes.list()` returned 0 |
| Infrastructure errors | 0 |

Suite verdict: `completed`, reliability 1.0, 1/1 passed, mode `solari`.

### What it found that 326 unit tests, 36 e2e and a container smoke test did not

Every one of these is unreachable in local mode, which is the entire argument
for spending the credits.

1. **The fixture could not be built in a production image.** `@gauntlet/fixture`
   rebuilds the Gauntlet Shop from source when its dist output is missing, and
   resolves its own location from `import.meta.url` — but tsup inlines it into
   the worker binary, so it looked for sources under `apps/worker/src`, which a
   production image does not ship. Fixed by shipping the prebuilt bundle beside
   the binary.
2. **The replay budget was too short.** 10 attempts at 3s gave up ~30s after
   release; a real session needed longer. Raised to 25. Observed upload latency
   varies: one session published in ~7s, another had not published after 75s.
3. **A repeat signal abandoned live browser sessions.** The handler treated a
   second SIGTERM as "I mean it" and exited immediately, skipping the drain that
   releases sessions. A platform that sends SIGTERM twice in an instant is not
   saying that. Three live sessions were stranded during a deploy and held the
   free plan's whole concurrency budget until they expired an hour later.
4. **A terminal suite left its runs alive.** A suite that failed with
   `solari_concurrency` showed four individual runs stuck in `running_agent`
   forever. They are now cancelled — confirmed on the deployment.

### Facts worth knowing

- Free-plan sessions carry a **60-minute** `expiresAt`, and auto-release at it.
- The SDK can `release(id)` but cannot **enumerate** sessions. A stranded
  session is therefore unrecoverable unless its id was logged, which is why the
  id and expiry are now logged the moment a session opens.
- `429` on concurrency is not retryable and is treated as a hard failure, which
  is correct: retrying burns quota against a wall.
