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
5. **The session id was logged too late to be useful.** The SDK can
   `release(id)` but cannot enumerate sessions, so a stranded session is
   unrecoverable without its id — and the id was only logged for sessions that
   finished cleanly, which are exactly the ones that never need it.
6. **A 429 failed the suite instead of waiting.** The design called for waiting
   on a freed slot with jittered backoff; only the "do not hammer the wall"
   half was built. A four-variant suite died outright because two of three
   plan slots were briefly held, when it could have run narrower and finished.
   Creation now waits, bounded, and still surfaces the real error when the plan
   is genuinely exhausted.
7. **One abandoned sandbox blocked the entire plan.** The free plan allows a
   single sandbox, and a worker killed mid-suite cannot release its own — so
   one orphan blocked every later suite for the 30 minutes until it expired.
   `listOrphans()` already existed and its comment promised a sweeper; only the
   acceptance test called it. The worker now sweeps at the start of a suite,
   with an age floor so a sibling's live sandbox is never touched.

Three of these compound, which is why none of them is reachable from a laptop:
a hard kill strands the sandbox (3), the orphan holds the plan's only slot (7),
and the symptom presents as a browser concurrency error (6).

### Facts worth knowing

- Free-plan sessions carry a **60-minute** `expiresAt`, and auto-release at it.
- The SDK can `release(id)` but cannot **enumerate** sessions. A stranded
  session is therefore unrecoverable unless its id was logged, which is why the
  id and expiry are now logged the moment a session opens.
- `429` on concurrency is not retryable and is treated as a hard failure, which
  is correct: retrying burns quota against a wall.


---

## Small real gauntlet — 2026-09-02

Four variants, one repetition each, four real Solari browser sessions, zero
infrastructure errors. The first time the product measured anything other than
itself.

| Variant | Result | Steps | Duration | Replay |
|---|---|---|---|---|
| `baseline` | **passed** | 7 | 83.2s | not retrieved |
| `cookie_popup` | **passed** | 7 | 14.3s | 56 events |
| `unexpected_modal` | **passed** | 19 | 112.9s | not retrieved |
| `expired_session` | **failed** | 7 | 101.2s | not retrieved |

```
reliability 0.75    baseline 1.00    perturbed 0.667
95% CI 30.1% – 95.4%
```

Failure category `auth`, clustered: *"The shopping session expired mid-task and
the agent did not re-establish it."*

Three things worth reading off this:

- **The thesis holds on real infrastructure.** The agent is perfect on baseline
  and breaks when the environment changes — judged from server-side fixture
  state, not from anything the agent said about itself.
- **`unexpected_modal` passed at 19 steps instead of 7.** It survived and paid
  nearly triple. A pass/fail benchmark cannot see that; this is the degradation
  the product exists to surface.
- **The interval is 30–95%.** On four runs, 75% establishes very little, and the
  number is reported with the width that admits it.

### Still imperfect

Replay arrived for one run of four, despite the budget now being ~75s. Observed
publication latency varies widely — one session published in ~7s, others had not
after 75s. It never changes a verdict, since a replay is evidence rather than a
judgement, but "a replay of the exact failing run" is not yet reliably true, and
the run it was missing from was the failing one.


---

## The repository-agent contract, proved live — 2026-09-02

A **separate public repository**, cloned into a Solari Sandbox and executed
there. Not our code, not our machines.

`GitHub → Solari Sandbox → scoped CDP → Solari Browser → Gauntlet Shop → evaluator`

| Acceptance | Evidence |
|---|---|
| Repository cloned in a Solari Sandbox | `repository cloned` · `Konuktor/agent-gauntlet-example-agent` |
| Repository installed | `install finished, exitCode 0` |
| No host execution | everything after `sandbox created` |
| `SOLARI_API_KEY` not exposed | never in the agent's environment |
| Scoped CDP connection | `session_created`, publicly routable endpoint |
| Agent completed the browser task | **7 steps, exit 0** |
| Independent evaluator passed | **8/8 assertions**, score 1.0 |
| Run terminal | `completed`, reliability 1.0 |
| Browser released | `browser_released` |
| Sandbox killed | `cleanup_complete` |

The evaluator judged server-side state, not the agent's word: product in cart,
`SAVE20` applied, discount in the total, name "Ada Lovelace", city "London",
stage `review`, and the order **not** submitted.

Then the same external agent against `expired_session`:

```
baseline          PASS   7 steps    8.3s
expired_session   FAIL   6 steps   37.9s   category: auth
```

> *"The shopping session expired mid-task and the agent did not re-establish it."*

Somebody else's agent, perfect on baseline, broken by one environment change —
which is the entire product thesis, now demonstrated on code we did not write.

### Six failures, none of them flaky

Seven runs. Every failure was a real defect, and the step count climbed with
each fix: 0 → 0 → 0 → 4 → **7**.

1. **The path needs two sandboxes and the free plan gives one** — the benchmark
   site and the agent's code both want a VM. Solved with the documented
   `GAUNTLET_FIXTURE_URL` escape hatch, hosting the storefront from the web
   service.
2. **The mounted storefront emitted root-relative links** — the first click left
   the store.
3. **A failing agent's stdout was collected and dropped** — the entire diagnosis
   was "Agent exited 1.". Fixing this is what made the next three findable.
4. **The Solari `base` sandbox runs Node 18** — a caret on `playwright-core`
   resolved to a build demanding Node 20, and the agent died before acting.
5. **The SDK hides the CDP endpoint behind a loopback proxy.** `sessions.create()`
   computes the public URL and discards it, returning `127.0.0.1`. An agent in
   another VM cannot reach that. This one contradicted what these notes said
   from the docs, and made the whole feature impossible until it was found by
   reading the SDK source.
6. **Redirects were not prefixed with the mount** — links were fixed, `Location`
   headers were not, so a POST sent the browser out of the store. The agent
   added the product and then hunted for the coupon field on a 404 page.
