# Implementation status

`[x]` done and verified · `[ ]` pending · `[!]` blocked

## Phase 1 — scaffolding
- [x] pnpm workspaces + Turborepo, strict TypeScript, ESLint 9 flat config, Prettier
- [x] `packages/config`: Zod env schema, hard limits, secret redaction (20 tests)
- [x] `.env.example`, `docker-compose.yml`, `vitest`/`playwright` configs
- [x] Verified: `pnpm install`, `pnpm typecheck`

## Phase 2 — database
- [x] Drizzle schema, 9 tables, migration applied to Postgres 17
- [x] DB-backed queue: `FOR UPDATE SKIP LOCKED` claim + heartbeat reclaim
- [x] State-machine-guarded transitions, metrics refresh, event append
- [x] Verified: `pnpm db:migrate`, 16 integration tests against real Postgres

## Phase 3 — Gauntlet Shop fixture
- [x] Zero-dependency Node server, per-run isolation, server-authoritative state
- [x] `/__gauntlet/{health,session,state}` control plane
- [x] esbuild single-file bundle (33 KB) for sandbox delivery, verified standalone
- [x] Verified: 44 tests incl. full HTTP task walkthrough and XSS escaping

## Phase 4 — perturbation engine
- [x] 11 perturbations across ui / network / state / viewport / locale
- [x] Deterministic from `sha256(suiteRunId|variant|repetition)`
- [x] Compile-time contract between fixture config and domain config (verified to fail on drift)
- [x] Verified: 19 tests, incl. "every perturbation actually perturbs"

## Phase 5 — Solari + local adapters
- [x] `SolariBrowserProvider` — `sessions.create()` for raw CDP, recording, release, replay
- [x] `SolariSandboxProvider` — no-shell commands, preview URL, `kill()` in `finally`
- [x] `SolariFixtureProvider` — sandbox-hosted shop on a public preview URL
- [x] `LocalBrowserProvider` — real Playwright Chromium + rrweb capture (no credits)
- [x] Verified: 47 adapter tests incl. 25 resource-lifecycle contracts
- [ ] Real Solari smoke test (needs `SOLARI_API_KEY`)

## Phase 6 — reference agents
- [ ] Heuristic reference agent
- [ ] LLM agent + Anthropic provider

## Phase 7 — evaluators + failure classifier
- [x] Deterministic classifier, 13 categories, failure clustering (17 tests)
- [ ] `FixtureStateEvaluator` + generic web assertions

## Phase 8 — orchestration
- [ ] `GauntletRunner`, semaphores, cleanup

## Phases 9-15
- [ ] Repository agent contract, API + worker, dashboard, CLI, E2E, docs, QA
