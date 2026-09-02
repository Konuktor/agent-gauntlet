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

## 14–22 · Deployment — LIVE
- [x] CLI authenticated; template `agent-gauntlet` created and run
- [x] Project, Postgres addon, secret group, web service, worker service, migration job — all created
- [x] **Public URL: https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run** — HTTPS, health `ok`, always-on
- [x] Worker running as its own service, no port, claiming from Postgres
- [x] Demo dataset seeded; landing page shows **DEMO DATA**
- [x] Production QA at 1440×900 and 390×844: 6 pages, all 200 in <1s,
      no horizontal overflow, no localhost links, no console errors
- [x] Unauthenticated run refused with 401; run token absent from `/api/capabilities`
- [x] **Real Solari smoke test PASSED** — sandbox, benchmark site, preview URL, recorded
      cloud browser, 7 agent steps, verdict from server state, replay (60 events / 70 KB),
      0 infrastructure errors, 0 sandboxes left running. Details in `REAL_SOLARI_TEST.md`.
- [x] **Small 4-variant gauntlet PASSED** — 4 real Solari sessions, 0 infrastructure errors.
      reliability 0.75, baseline 1.00, perturbed 0.667, 95% CI 30–95%.
      `expired_session` failed and was clustered as `auth`; `unexpected_modal` passed at
      19 steps instead of 7. Details in `REAL_SOLARI_TEST.md`.
- [ ] Full 8 x 2 gauntlet — not run; the small one is the meaningful proof and the rest is cost

## Submission QA (live URL, 1440x900 and 390x844)
- [x] Landing, runs list, real Solari result, expired_session failure detail, comparison,
      suite builder, health — all 200 in under a second
- [x] No localhost links, no console errors anywhere
- [x] Found and fixed: `expired_session` detail overflowed **3228px** at 390px — a long URL in the
      action trace had no `min-w-0` or word break on its row
- [x] Found and fixed: the storefront, once mounted under `/__fixture`, emitted root-relative links
      that navigated straight out of the store on the first click
- [x] Found and fixed: a repository agent's stdout/stderr was collected and then dropped, leaving
      "Agent exited 1." as the entire diagnosis for somebody else's failing code

### Things that only deploying could find
1. `${refs.database.id}` is undefined — node responses nest under `data`. It does
   not fail: the dependency silently vanishes and the services start with no
   `DATABASE_URL`.
2. `healthChecks[].successThreshold` is required for a readinessProbe.
3. `billing.buildPlan` is a separate plan class; a deployment-only id gives
   `404 Build plan not found`.
4. `context.projectId` resolves before the Project node runs.
5. The addon's non-admin user cannot run DDL, so migrations need one admin
   `GRANT CREATE ON DATABASE`.
6. A build is triggered with `{"commitSha": "..."}`, and only one build may be
   active per free object.
