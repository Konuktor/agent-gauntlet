# Final release status

Recorded during the v1.0.0 release pass on 2026-09-02.
Node 22.22.2 · pnpm 11.7.0 · branch `chore/solari-submission-release`.

## Verification

Run locally against a real Postgres, before and after the release changes.

| Check                               | Result                                            |
| ----------------------------------- | ------------------------------------------------- |
| `pnpm typecheck`                    | 13/13 packages                                    |
| `pnpm lint`                         | 12/12 packages                                    |
| `pnpm format:check`                 | clean _(was failing on 103 files — see below)_    |
| `pnpm test`                         | 366 passed, 28 files                              |
| `pnpm build`                        | 4/4                                               |
| `pnpm test:e2e`                     | 36 passed                                         |
| `pnpm test:deploy`                  | 46 passed, 1 skipped                              |
| `pnpm gauntlet run ./gauntlet.yaml` | 14/16, reliability 87.5%, 0 infrastructure errors |
| `pnpm gauntlet demo`                | 33.9s, exit 1 — 87.5% against the demo's 90% gate |

The CLI gate reproduces the documented behaviour exactly: `baseline` 7 steps,
`unexpected_modal` 19 steps, `expired_session` 0/2.

`gauntlet demo` exits 1 on purpose — the bundled suite is configured with a 90%
threshold that the Reference Agent's 87.5% deliberately misses, so the gate can
be seen working rather than described. Before the concurrency fix below it could
not signal anything at all, because the process never returned.

## What the audit found

Five defects, none of them cosmetic. All are fixed on this branch.

### 1. CI had never run — not once

Both workflows triggered on `push: branches: [main]` while the default branch is
`master`. `gh run list` returned an empty array for the entire history of the
repository. Two workflows existed, looked reasonable, and had never executed.

Fixed by pointing them at `master`. Everything below was found by the first CI
run that ever happened.

### 2. A live capability was being served by the public API

Scanning production responses found two rows containing session endpoints,
including a real Solari composite id with its HMAC signature and an internal AWS
hostname. A Playwright connect failure quotes the endpoint it was handed, that
error was persisted as the run's failure message, and `/api/suite-runs/:id`
returned it.

Commit `15f4806` stopped new ones being written. Migration `0004` on this branch
cleans the rows that already existed, because a forward-only fix leaves a live
credential in a public response.

This also corrects a scope claim made earlier in development: the leak was never
specific to borrowed sessions. **Any** failed browser connect persisted the
endpoint, including the operator's own.

### 3. The documented CLI command had never worked

`pnpm gauntlet run ./gauntlet.yaml` — in the README, and the command the
reliability workflow runs — always failed with _"Could not read
./gauntlet.yaml"_. pnpm executes the script with its cwd set to `apps/cli`, so
the relative path resolved against the package rather than the repository root.

Fixed by resolving user-supplied paths against `INIT_CWD`. Only CI could have
caught this, and CI had never run.

### 4. CI could have spent Solari credits on every pull request

The reliability workflow passed `secrets.SOLARI_API_KEY` on `pull_request`. No
such secret is configured, so nothing was ever spent — but adding one would have
silently turned every PR into a browser-quota draw. Real browsers are now
opt-in: a `workflow_dispatch` with an explicit boolean, with automatic triggers
resolving the key to an empty string and running locally.

### 5. `pnpm format:check` failed on 103 files

Prettier was configured but had never been run, so anyone following the
contributing instructions hit a red check on code they had not touched. Fixed as
an isolated mechanical commit — reflow only, verified by diffing with whitespace
ignored — and `format:check` now runs in CI so it cannot drift again.

### 6. A secret scanner caught what my own audit missed

GitGuardian runs on this repository's pull requests and failed the release PR
twice.

The first was real and mine. The scrub-migration test fixture reused the actual
HMAC signature suffix and the actual internal hostname from the production
response it was copied from — a fragment of a live capability, committed into a
test _about_ credential leaks. Not exploitable: that session had expired hours
earlier, and the signature covers a composite id the fixture had already
altered, so it authorised nothing. It still had no business in a public
repository.

My own history scan missed it because I searched for API-key shapes and complete
endpoints, not for a signature fragment I had introduced myself minutes earlier.
That is a good argument for having a scanner that does not share your
assumptions.

The second was a false positive worth fixing anyway: the redaction module's own
test used `slr_live_`-shaped fixtures, which a redactor cannot be tested without.
They are now low-entropy and self-describing, because a fixture that looks like a
real key trains people to wave scanner alerts through.

Both were purged from all commits on this unmerged branch rather than only from
the tip, so the pull request scans clean. `master` was not rewritten.

### 7. The reliability gate had never completed a run — found and fixed

The `AgentGauntlet` workflow is the product's own reliability gate, and until
this pass it had never once finished. Every earlier run in the repository's
history is `cancelled`, most of them by the 25-minute job timeout. It was invisible before this pass
because the workflow targeted a branch that does not exist, so it had never run
at all.

Reproduced locally. `pnpm gauntlet demo` prints a correct verdict — 87.5%,
14/16, and a deliberate `FAIL` against the demo's 90% threshold — and is then
killed at exactly the timeout.

What was measured, before the fix:

| Shape                                             | Result                         |
| ------------------------------------------------- | ------------------------------ |
| One `baseline` run                                | 2.1s, clean exit               |
| Each of the seven perturbations, one process each | ~52s total, all exit cleanly   |
| Eight variants in **one** process                 | killed at the 600s timeout     |
| Sixteen runs (`demo`)                             | verdict printed, killed at 25m |

So no single perturbation hangs, and the perturbation config is correctly scoped
per `runId` — concurrent runs do not contaminate each other, and the numbers the
product reports are sound. The pathology is specific to many runs inside one
process, which is exactly what both the demo and the CI gate do.

**Root cause: an async race in lazy initialisation.** `LocalBrowserProvider`
memoised the _browser_ rather than the promise:

```ts
if (this.browser?.isConnected()) return this.browser
this.browser = await chromium.launch(...)
```

With concurrency N, all N runs reach that check before the first launch
resolves, so every one of them launches its own Chromium. The last assignment
wins the field and the rest are orphaned — never closed, and holding the
process open. One run was always fine; that is why nothing ever caught it.

Memoising the promise fixes it. Eight variants in one process went from _killed
at the 600s timeout_ to **28.8 seconds, clean exit**.

The regression test counts launches rather than inspecting the result, because
asserting on the returned environments passes against the broken version too.
Verified by restoring the racy implementation: `expected "spy" to be called 1
times, but got 4 times`.

**Result.** `pnpm gauntlet demo` went from a 25-minute `SIGTERM` to **33.9s and
exit 1** — the exit code is meaningful again, since the process now returns at
all. And the reliability gate completed in CI for the first time in the
repository's history: **89 seconds**, reliability 87.5% against an 85% threshold,
baseline 100%, `expired_session` 0/2.

Nothing here changed a measurement. Perturbation config is scoped per run id,
concurrent runs never contaminated each other, and the verdicts were correct
throughout — the demo printed an accurate 87.5% before hanging. Only process
exit was broken.

## Secret audit

| Scope                       | Result                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Working tree                | Clean. `.env` ignored; `.env.example` holds only local defaults and public URLs.                                                                                                                       |
| Git history, all 45 commits | Clean. Every value ever assigned to `SOLARI_API_KEY` in any commit is one of a docs ellipsis, a redaction-test fixture, or that fixture's expected redacted output. No real key appears in any commit. |
| Endpoint shapes in history  | 10 matches, all test fixtures (`deploy-test.invalid`, `theirs.signature`, `abc.signature`).                                                                                                            |
| Database URLs in history    | 4 distinct, all localhost or fixtures (`user:hunter2@db`).                                                                                                                                             |
| Production API responses    | Two findings before the fix, described above; clean after.                                                                                                                                             |

No history rewriting was performed. Nothing in it warranted the risk.

## Deliberately not done

- **`master` was not renamed to `main`.** Northflank tracks `master` for both
  services, and the rename buys nothing a reviewer can see. The workflows were
  corrected to match reality instead.
- **The full 8×2 real-Solari gauntlet was not run.** The small one is the
  meaningful proof; the rest is credits.
- **Unused screenshots were left in place.** 2.9 MB of QA evidence for the
  responsive pass. Removing them would tidy the tree and delete the record.
