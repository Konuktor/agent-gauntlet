# Real Solari acceptance test

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
