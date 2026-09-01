# Deployment status

Productionization + public deployment pass. `[x]` done and verified · `[ ]` pending · `[!]` blocked

## Audit (before changing anything)
- [x] Working tree clean, branch `master`, no git remote, 8 commits
- [x] Baseline `pnpm test` → **309 passed** (21 files)
- [x] Read `docs/SOLARI_NOTES.md`; env vars inventoried; web/worker separation mapped
- [x] Found: replay artifacts write to local disk (breaks on Render's ephemeral FS)
- [x] Found: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` referenced in config schema, agents, CLI, worker, README

## 1 · Agent-agnostic product
- [ ] `SOLARI_API_KEY` is the ONLY credential the product needs
- [ ] Remove OpenAI entirely; keep the Anthropic adapter as clearly-optional/experimental
- [ ] Never surface a missing model key as an error
- [ ] UI copy: Reference Agent (default) / Repository Agent, agent-agnostic narrative

## 2 · Render platform
- [ ] `docs/RENDER_NOTES.md` from the current official docs
- [ ] `render.yaml` Blueprint (web service + Postgres), no hardcoded secrets
- [ ] Bind `0.0.0.0:$PORT`; no localhost in production output
- [ ] `healthCheckPath: /api/health`, cheap, no Solari session
- [ ] Node 22 + pnpm pinned deterministically

## 3 · Single-service deploy mode
- [ ] `GAUNTLET_DEPLOY_MODE=single` runs Next + the worker in ONE process
- [ ] Worker loop is EXTRACTED and REUSED, never duplicated
- [ ] Graceful SIGTERM: stop claiming, drain, release Solari, close pool, exit
- [ ] Migrations run before serving; failure is fatal; seeding is opt-in and idempotent

## 4 · Ephemeral filesystem
- [ ] Replays durable in Postgres, not on local disk
- [ ] Nothing important depends on the container's filesystem

## 5 · Public-demo safety
- [ ] Real runs require `GAUNTLET_RUN_TOKEN` (HttpOnly cookie, constant-time compare)
- [ ] Seeded demo stays fully public and read-only
- [ ] Repository agents gated behind the same authorization
- [ ] DB-backed limits: one active suite per session, caps on runs/variants/repetitions

## 6 · Never run untrusted code on Render
- [ ] Regression test asserting repository agents cannot execute on the host

## 7 · Verification
- [ ] `pnpm typecheck` / `lint` / `test` / `build` / `test:e2e` / `test:render`
- [ ] `pnpm gauntlet demo`
- [ ] Secret audit over working tree AND git history
- [ ] Public GitHub repository pushed
- [ ] Render deployment live, health green
- [ ] Real Solari acceptance test executed (needs a key)
- [ ] Production screenshots at 1440×900 and 390×844
