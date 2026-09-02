# Implementation status

`[x]` done and verified · `[ ]` pending · `[!]` blocked

Verification commands and their real output are recorded in the final report.

## Core product

- [x] **Phase 1** — pnpm + Turborepo monorepo, strict TypeScript, ESLint 9, Prettier, Zod env schema, secret redaction
- [x] **Phase 2** — Drizzle schema (9 tables), migrations, DB-backed queue (`FOR UPDATE SKIP LOCKED` + heartbeat reclaim), state-machine-guarded transitions
- [x] **Phase 3** — Gauntlet Shop fixture: zero-dependency, per-run isolation, server-authoritative state endpoint, single-file bundle verified standalone
- [x] **Phase 4** — 11 perturbations across ui/network/state/viewport/locale, deterministic from a derived seed, with a compile-time contract against the fixture's config shape
- [x] **Phase 5** — Solari browser + sandbox + fixture providers; local Playwright providers with rrweb capture
- [x] **Phase 6** — Reference Agent in three capability presets, plus an Anthropic-backed LLM agent
- [x] **Phase 7** — Fixture-state evaluator, generic web assertions, 13-category deterministic failure classifier, failure clustering
- [x] **Phase 8** — `GauntletRunner`: bounded concurrency, per-run pipeline, cleanup in `finally`, no automatic agent retries
- [x] **Phase 9** — Repository agent contract, URL allowlist, sandbox execution, example agent
- [x] **Phase 10** — Next.js API (Zod-validated), SSE live stream, worker with signal-safe shutdown
- [x] **Phase 11** — Dashboard: landing, new suite, live run, results, run detail, regression comparison
- [x] **Phase 12** — `gauntlet` CLI (demo/run/compare/doctor), database-free, threshold exit codes; GitHub Actions workflows
- [x] **Phase 13** — 17 Playwright product E2E tests with deterministic seeding
- [x] **Phase 14** — README, `SOLARI_NOTES.md`, `AGENT_CONTRACT.md`, `DEMO_SCRIPT.md`, `LAUNCH_POST.md`, cookbook pointer stub
- [x] **Phase 15** — Final QA sweep

## Final verification (all green)

| Command              | Result                                               |
| -------------------- | ---------------------------------------------------- |
| `pnpm install`       | ok                                                   |
| `pnpm typecheck`     | 13/13 packages                                       |
| `pnpm lint`          | 12/12 packages                                       |
| `pnpm test`          | **309 passed**, 21 files                             |
| `pnpm build`         | 4/4 apps                                             |
| `pnpm test:e2e`      | **34 passed** (desktop + phone viewport)             |
| `pnpm test:solari`   | skipped, with an explanatory message (no credential) |
| `pnpm gauntlet demo` | **87.5%**, exits `1` against its 90% threshold       |

## Verified end to end

- [x] 16-run gauntlet executed in local mode: **87.5%**, 14/16, 0 infrastructure errors, 16 rrweb replays captured
- [x] Failure classification correct on real runs (`session_expired` → auth, `blocked_by_overlay` → unexpected_ui)
- [x] CLI exit codes: `0` when thresholds are met, `1` when missed
- [x] Dashboard inspected at 1440×900 and 390×844 from real screenshots
- [x] Capability ladder measured: Naive 75.0% · Reference 87.5% · Resilient 100%

## Not executed

- [!] **Real Solari acceptance test** — no `SOLARI_API_KEY` was available. The test
  is written and skips with an explanatory message; see `docs/REAL_SOLARI_TEST.md`
  for exactly what it does and how to run it.

## Stretch features

- [x] Automatic failure clustering
- [x] Agent comparison (three built-in capability presets on the same suite)
- [x] Git provenance on a suite run (repo / branch / sha)
- [ ] Live browser mosaic during a run
- [ ] Reliability history across commits
- [ ] Shareable read-only report
