# Deployment status

Productionization + public deployment pass. `[x]` done and verified · `[ ]` pending · `[!]` blocked

## Audit (before changing anything)
- [x] Working tree clean, branch `master`, no git remote, 8 commits
- [x] Baseline `pnpm test` → **309 passed** (21 files)
- [x] Read `docs/SOLARI_NOTES.md`; env vars inventoried; web/worker separation mapped
- [x] Found: replay artifacts write to local disk (breaks on Render's ephemeral FS)
- [x] Found: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` referenced in config schema, agents, CLI, worker, README

## 1 · Agent-agnostic product
- [x] `SOLARI_API_KEY` is the ONLY credential the product needs
- [x] OpenAI removed; Anthropic adapter is optional, experimental and lazily imported
- [x] A missing model key reads as a note, never an error
- [x] UI copy: Reference Agent first, Repository Agent second, optional adapter last

## 2 · Render platform
- [x] `docs/RENDER_NOTES.md` from the current official docs
- [x] `render.yaml` Blueprint (web service + Postgres), no hardcoded secrets
- [x] Binds `0.0.0.0:$PORT`; asserted by a deployment test
- [x] `/api/health` — one `SELECT 1`, never a Solari call
- [x] Node 22 pinned via `NODE_VERSION` + `.node-version`; pnpm pinned via corepack in the build command

## 3 · Single-service deploy mode
- [x] `GAUNTLET_DEPLOY_MODE=single` runs Next + the worker in ONE process
- [x] Worker loop extracted to `createWorkerRuntime`; the standalone binary is now a thin wrapper
- [x] Graceful SIGTERM verified: exits in ~1s, well inside the free plan's 30s window
- [x] Migrations run before listening, are idempotent across restarts, and are fatal on failure

## 4 · Ephemeral filesystem
- [x] Replays stored gzipped in a `replay_artifacts` table
- [x] Nothing important depends on the container's filesystem

## 5 · Public-demo safety
- [x] Real runs require `GAUNTLET_RUN_TOKEN`; cookie is an HMAC, not the token; constant-time compare
- [x] Seeded demo stays fully public and read-only
- [x] Repository agents gated behind the same authorization
- [x] One active suite at a time (429 `busy`), plus the existing caps

## 6 · Never run untrusted code on Render
- [x] Isolation tests, including a source scan verified to fail on an injected `execSync`

## 6b · Worker resilience (found while testing, not from the brief)
A suite was observed stuck in `preparing` with its claim released and no worker
running. The cause was structural, not incidental: in `executeSuiteRun`,
`getSuite` and `createRuntime` sat *outside* the `try`, so an ordinary
environment failure — no Playwright browser installed, which is exactly the
Render case — escaped past the `finally`. The claim was never released, the
suite never reached a terminal state, and because the loop awaited the call, the
whole worker died. The new one-suite-at-a-time limit then turned that into a
deployment-wide outage: one wedged run blocks every later one until a redeploy.

- [x] All setup moved inside the `try`; `runtime` is optional and shut down only if built
- [x] A failure before the runner starts now marks the suite `failed`, preserving the real `GauntletError.code`
- [x] The loop catches anything that escapes, so one bad suite cannot kill the worker
- [x] Reclaim runs on a 60s sweep, not only at boot — a wedge self-heals without a redeploy
- [x] 3 regression tests, verified to fail when the fix is removed

## 7 · Verification
- [x] `pnpm typecheck` 14/14 · `lint` 12/12 · `test` 325 passed (23 files) · `build` 4/4 · `test:e2e` 36 passed · `test:render` 13 passed, 1 skipped
- [x] `pnpm gauntlet demo` — 16/16 runs in 33s, 0 infrastructure errors, baseline 100%, perturbed 85.7%, overall 87.5% vs a 90% threshold, exit 1 (the gate firing, as designed)
- [x] Secret audit over working tree AND all history blobs — only fake redaction fixtures
- [ ] Public GitHub repository pushed (repo created: Konuktor/agent-gauntlet)
- [ ] Render deployment live, health green
- [ ] Real Solari acceptance test executed (needs a key)
- [ ] Production screenshots at 1440×900 and 390×844
