# Northflank deployment status

`[x]` done and verified · `[ ]` pending · `[!]` blocked

## 0 · Audit (baseline before any change)
- [x] Clean tree at `bc904cb`, remote `github.com/Konuktor/agent-gauntlet`
- [x] `pnpm typecheck` 14/14 · `lint` 12/12 · `test` 325 passed · `build` 4/4
- [x] No Dockerfile existed; web start was `node dist/server.js`, worker `tsx src/index.ts`

## 1 · Render removal
- [x] Deleted `render.yaml`, `render-tests/`, `vitest.render.config.ts`, `docs/RENDER_NOTES.md`, `docs/DEPLOYMENT_STATUS.md`
- [x] Removed `GAUNTLET_DEPLOY_MODE` and the single-process mode; web no longer imports `@gauntlet/worker`
- [x] Removed `RENDER_EXTERNAL_URL`; `GAUNTLET_PUBLIC_URL` is now the only public-origin knob
- [x] Kept: dynamic `PORT`, `0.0.0.0` binding, graceful SIGTERM, health endpoint, startup migrations, run-token gate, secret redaction

## 2 · Research
- [x] `docs/NORTHFLANK_NOTES.md` written from current docs + the live JSON schema at `api.northflank.com/v1/schemas/template`
- [x] Sandbox allowance confirmed: **2 services, 2 jobs, 1 addon**, always-on

## 3–4 · Images
- [x] One multi-stage `Dockerfile`, three targets: `web`, `worker`, `migrate`
- [x] `.dockerignore` excludes node_modules, `.next`, `.git`, `.env`, artifacts, tests
- [x] `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — no browser ships in a production image
- [x] Runs as `node`, not root

## 5–7 · Services and database
- [x] Web: public port 3000, `/api/health` readiness probe
- [x] Worker: `ports: []` — no port at all, no fake HTTP server
- [x] Postgres addon: `externalAccessEnabled: false`, TLS on, version 17
- [x] Secret group aliases `POSTGRES_URI` → `DATABASE_URL`

## 8–13 · Template
- [x] `northflank/template.json`, `apiVersion: v1.2`, validated against the live schema
- [x] Secrets are `argumentOverrides`; `GAUNTLET_RUN_TOKEN` uses `${fn.randomSecret(48)}`; no value committed

## 25 · Verification
- [x] `pnpm typecheck` 13/13 · `lint` 12/12 · `test` 324 passed · `build` 4/4 · `test:e2e` 36 passed
- [x] `pnpm test:deploy` — 26 passed, 1 skipped, including a job enqueued by the web service and claimed by a **separate** worker process
- [x] `pnpm gauntlet demo` — 16/16 scored, 0 infrastructure errors, 87.5% against a 90% threshold
- [x] All three images build; container smoke test against an empty database:
      migration job created 10 tables · web healthy in 4s · worker claimed nothing to do and idled ·
      worker had **0 listening sockets** · both run as uid 1000 (`node`) · no Playwright browsers in the image ·
      unauthenticated run refused with 401 · run token absent from `/api/capabilities` ·
      **web 153 MiB, worker 110 MiB** — comfortably inside a 0.5 GB plan · SIGTERM → exit 0 in ≤1s
- [x] Secret audit: working tree and history clean (the only match is the fake string in `redact.test.ts`)

## 14–22 · Deployment
- [!] **Northflank CLI is not authenticated** — `northflank context ls` reports `No contexts found`. This needs a browser login.
- [ ] Project, addon, secret group, services, migration job created
- [ ] Public HTTPS URL reachable
- [ ] Real Solari smoke test (needs `SOLARI_API_KEY`)
