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
| `pnpm test`                         | 363 passed, 27 files                              |
| `pnpm build`                        | 4/4                                               |
| `pnpm test:e2e`                     | 36 passed                                         |
| `pnpm test:deploy`                  | 46 passed, 1 skipped                              |
| `pnpm gauntlet run ./gauntlet.yaml` | 14/16, reliability 87.5%, 0 infrastructure errors |

The CLI gate reproduces the documented behaviour exactly: `baseline` 7 steps,
`unexpected_modal` 19 steps, `expired_session` 0/2.

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
