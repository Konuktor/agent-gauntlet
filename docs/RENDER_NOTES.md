# Render deployment notes

Verified against the current official docs (render.com/docs) before writing
`render.yaml`. Every constraint below shaped a decision; the ones that changed
the architecture are marked **→**.

## The three findings that decided the design

**→ Background Workers have no free plan.** Free compute exists only for web
services, static sites, Render Postgres and Render Key Value; background workers
start at `0.5c-512mb`. A free public demo therefore *cannot* run the worker as a
separate service. Hence `GAUNTLET_DEPLOY_MODE=single`, which hosts the existing
worker runtime inside the web service's process — reusing the same code, not a
second copy of it.

**→ `preDeployCommand` is not available on free plans.** The docs are explicit:
"The pre-deploy command is available for paid web services, private services, and
background workers." So migrations cannot be a pre-deploy step. They run inside
the start command (`pnpm render:start`), before the server begins serving, and a
migration failure exits non-zero so Render marks the deploy unhealthy.

**→ The filesystem is ephemeral and free plans cannot mount a disk.** "Any
changes you make to a service's local files are lost every time the service
redeploys or restarts." Session replays used to be gzipped to local disk; they
now live in a `replay_artifacts` table in Postgres. Nothing that matters depends
on the container's filesystem.

## Blueprint schema (as used here)

| Field | Note |
|---|---|
| `runtime:` | The current field. `env:` is **deprecated** — do not use it. |
| `autoDeployTrigger:` | `commit` \| `checksPass` \| `off`. Replaces the deprecated `autoDeploy:`. |
| `plan: free` | Web service: 0.1 CPU / 512 MB. Postgres: 1 GB, no backups, no pooling. |
| `healthCheckPath:` | Web services only; must start with `/`. |
| `maxShutdownDelaySeconds:` | Integer 1–300, **default 30**. Render sends `SIGTERM`, then `SIGKILL` when it elapses. **Rejected on the free plan** — a Blueprint carrying it fails validation with *"max shutdown delay is not supported for free tier services"*, so a free service is fixed at the 30s default. Found by submitting the Blueprint, not in the docs. |
| `fromDatabase: { name, property: connectionString }` | Resolves to the **internal** URL. There is no `externalConnectionString` property. Requires the same region and workspace. |
| `sync: false` | Render prompts the deployer on first apply and never overwrites. Used for `SOLARI_API_KEY`. |
| `generateValue: true` | Random value generated once. Used for `GAUNTLET_RUN_TOKEN`. |
| `region:` | Defaults to `oregon`, **immutable**. The DB and the service must match for the internal URL to work. |
| `postgresMajorVersion:` | Quote it (`"17"`) or YAML reads it as a number. |

No top-level `version:` key exists in the Blueprint spec.

## Runtime environment

- **`PORT` defaults to `10000`** and is injected automatically. The server must
  bind **`0.0.0.0`** — binding `localhost` yields a 502. Reserved ports: 18012,
  18013, 19099.
- **`RENDER_EXTERNAL_URL`** and `RENDER_EXTERNAL_HOSTNAME` are injected for web
  services, at **runtime only**. The config reads `RENDER_EXTERNAL_URL` to derive
  the public origin, so nothing emits a localhost URL in production. It is *not*
  documented as available at build time, so no `NEXT_PUBLIC_*` value depends on it.
- Also injected: `RENDER`, `RENDER_SERVICE_ID/NAME/TYPE`, `RENDER_INSTANCE_ID`,
  `RENDER_GIT_COMMIT/BRANCH/REPO_SLUG`, `RENDER_CPU_COUNT`.

## Node and pnpm

- **The default Node is now 24.x** for services created after 2026-04-21, so Node
  22 must be pinned explicitly. Precedence: `NODE_VERSION` env var → `.node-version`
  → `.nvmrc` → `engines`. This repo sets `NODE_VERSION` in the Blueprint *and*
  ships a `.node-version` file, so a manually-created service behaves the same.
- **Corepack is not documented anywhere on render.com.** `packageManager` in
  package.json is not documented as honoured. pnpm *is* preinstalled in the native
  runtime, but at an unpublished version. The build command therefore activates a
  pinned pnpm itself rather than trusting the image.

## Free-plan behaviour the UX has to accept

- A free web service **spins down after 15 minutes without inbound traffic**, and
  the next request takes about a minute to wake it. The landing page says so in
  one quiet line. No artificial keep-alive traffic — that would burn the 750
  free instance-hours per month for nothing.
- **Free Postgres expires 30 days after creation**, with a 14-day grace period
  before deletion. Fine for a challenge demo, called out in the README.
- Free web services have no shell access, no persistent disk, no scaling beyond
  one instance, and cannot run one-off jobs.

## Three ways the build fails that nothing local catches

Found by deploying, then reproduced in a clean clone (`git clone` + `NODE_ENV=production`,
no `.env`) — which is the only local setup that reproduces any of them.

| Symptom | Cause | Fix |
|---|---|---|
| `EACCES: permission denied, symlink ... -> /usr/bin/pnpm` | `corepack enable` cannot write to the Node prefix as the build user. | Drop corepack. Render supplies pnpm from `pnpm-lock.yaml` and honours `packageManager`. |
| `FATAL ERROR: Reached heap limit` during `next build` | Render applies **service env vars to the build as well as the run**, so a `NODE_OPTIONS=--max-old-space-size=384` sized for the 512 MB instance also starves the build. | Keep `NODE_OPTIONS` out of the Blueprint; put the cap in `render:start`. |
| `Invalid environment: DATABASE_URL: Required` prerendering `/_not-found` | The root layout reads runtime config for the mode badge, and `/_not-found` is the one route Next prerenders on its own. | `export const dynamic = "force-dynamic"` in the root layout. Every real page already declared it. |

`pnpm test:render` now asserts all three, so they fail in the repo rather than on Render.

## Shutdown contract

Render sends `SIGTERM` and waits `maxShutdownDelaySeconds` before `SIGKILL`.
The free plan does not accept that field, so the window is the 30s default and
the budgets are sized for it: 20s overall, 12s of that for the worker. On that signal the single-service runtime stops claiming new
jobs, gives the in-flight suite a bounded window to land on its own — its own
`finally` blocks release Solari sessions far more cleanly than we could from
outside — then cancels it, closes the Solari clients, closes the pool and exits.
Anything still unfinished is left recoverable: the existing heartbeat/reclaim
logic requeues it on the next boot.

## Monorepo

`buildFilter.paths` are relative to the **repository root**, not to `rootDir`,
and omitting shared `packages/` paths from a service's filter is the classic
mistake. This deployment keeps `rootDir` at the repo root so the lockfile and
workspace manifest are reachable, and scopes work with `pnpm --filter`.

## Sources

Blueprint spec · infrastructure-as-code · web-services · deploy-nextjs-app ·
postgresql-creating-connecting · free · background-workers ·
environment-variables · health-checks · deploys · monorepo-support ·
node-version · native-runtimes · compute-plans · disks · deploy-to-render
