# syntax=docker/dockerfile:1

# AgentGauntlet — one multi-stage build, three runtime targets.
#
#   --target web      the Next.js app and its API      (public)
#   --target worker   the queue consumer               (no port)
#   --target migrate  a one-shot schema migration      (a job)
#
# All three share one dependency install and one compile, so the worker can
# never drift from the web app's idea of the domain.
#
# What deliberately is NOT here: a browser. AgentGauntlet orchestrates runs, it
# does not execute them. Real browsers are Solari Browser sessions and
# untrusted repository agents run in Solari Sandbox — never on this host.
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD enforces that at build time.

ARG NODE_VERSION=22.22.2
ARG PNPM_VERSION=11.7.0

# ---------------------------------------------------------------- base
FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------- deps
# Only the manifests, so a source-only change does not re-resolve the tree.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/cli/package.json          apps/cli/
COPY apps/web/package.json          apps/web/
COPY apps/worker/package.json       apps/worker/
COPY examples/custom-agent/package.json examples/custom-agent/
COPY packages/agents/package.json       packages/agents/
COPY packages/config/package.json       packages/config/
COPY packages/core/package.json         packages/core/
COPY packages/db/package.json           packages/db/
COPY packages/evaluators/package.json   packages/evaluators/
COPY packages/fixture/package.json      packages/fixture/
COPY packages/local-runtime/package.json packages/local-runtime/
COPY packages/perturbations/package.json packages/perturbations/
COPY packages/solari/package.json       packages/solari/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM deps AS build
COPY . .
# NODE_ENV stays unset here: `next build` needs the dev toolchain, and a
# production heap cap starves it.
RUN pnpm --filter @gauntlet/fixture run build \
 && pnpm --filter @gauntlet/web run build \
 && pnpm --filter @gauntlet/worker run build

# ---------------------------------------------------------------- prune
# tsup inlines every @gauntlet/* package into the bundles, so runtime needs
# only the external npm dependencies.
FROM build AS prune
# A fresh production install rather than `pnpm prune --prod`: prune strips the
# workspace symlinks along with the dev tree, leaving a node_modules that only
# looks populated (`.pnpm` full, every link gone) and a runtime that cannot
# resolve drizzle-orm. Reinstalling is also cheap — the store is already warm.
# CI=true: pnpm will not purge a modules directory without a TTY otherwise.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    CI=true pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------------------------------------------------------------- runtime
FROM base AS runtime
ENV NODE_ENV=production
# This image carries no browser on purpose (see PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
# above). Saying so explicitly lets the app refuse local runs it cannot perform,
# instead of offering a button that would fail in the worker.
ENV GAUNTLET_LOCAL_BROWSER=false
# Northflank runs containers as-is; an unprivileged user costs nothing here.
USER node

# ---------------------------------------------------------------- web
FROM runtime AS web
COPY --from=prune --chown=node:node /app/node_modules            ./node_modules
COPY --from=prune --chown=node:node /app/apps/web/node_modules   ./apps/web/node_modules
COPY --from=prune --chown=node:node /app/apps/web/.next          ./apps/web/.next
COPY --from=prune --chown=node:node /app/apps/web/dist           ./apps/web/dist
COPY --from=prune --chown=node:node /app/apps/web/package.json   ./apps/web/package.json
COPY --from=prune --chown=node:node /app/package.json            ./package.json
WORKDIR /app/apps/web
# The free Sandbox service is small; cap the heap so V8 collects early rather
# than letting the container OOM-killer take the process mid-request.
ENV NODE_OPTIONS=--max-old-space-size=384
EXPOSE 3000
CMD ["node", "dist/server.js"]

# ---------------------------------------------------------------- worker
FROM runtime AS worker
COPY --from=prune --chown=node:node /app/node_modules             ./node_modules
COPY --from=prune --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=prune --chown=node:node /app/apps/worker/dist         ./apps/worker/dist
COPY --from=prune --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=prune --chown=node:node /app/package.json             ./package.json
WORKDIR /app/apps/worker
ENV NODE_OPTIONS=--max-old-space-size=320
# No EXPOSE and no port: the worker takes work from Postgres, not from HTTP.
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------- migrate
# The same image as the worker, with a different command: the migration job
# and the service it unblocks can then never run different code. The SQL files
# travel inside dist/drizzle.
FROM worker AS migrate
CMD ["node", "dist/migrate.js"]
