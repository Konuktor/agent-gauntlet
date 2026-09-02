# Contributing

## Setup

```bash
pnpm install
cp .env.example .env          # works as-is for local development
docker compose up -d          # Postgres on 5433
pnpm db:migrate && pnpm db:seed
pnpm dev                      # web on :3000, worker alongside it
```

No Solari key is needed. Without one the project runs in **local mode**: real
Playwright Chromium against the bundled benchmark storefront. That is a genuine
measurement — it just is not Solari, and every screen says so.

## Verifying a change

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test          # unit and integration
pnpm build
pnpm test:e2e      # Playwright, against the real UI
pnpm test:deploy   # boots the production artifacts as two processes
```

CI runs all of these. None of them spends a Solari credit.

## Architecture boundary

The one rule worth internalising: **`packages/core` imports neither Playwright
nor `@solarisdk/*`.** It depends on narrow ports — `PageDriver`,
`BrowserProvider`, `SandboxProvider`, `FixtureProvider`, `AgentAdapter` — and
`packages/solari` is the only place the Solari SDK appears.

That is what makes the agent loop, the failure classifier and the metrics
testable with no browser at all, and it is why the same runner drives Solari and
local Chromium without knowing which it has.

## Adding a perturbation

1. Add it to `packages/perturbations/src/`, declaring `{ id, name, category,
   fixtureConfig?, browserOptions?, prepare, cleanup }`.
2. If it changes the page, teach `packages/fixture` to render it from the run's
   config.
3. Add a test asserting it **actually changes the rendered environment** and is
   reproducible from its seed. A perturbation that does not change anything is
   worse than none: it inflates reliability.

Keep it recoverable. Every perturbation here is survivable by a capable agent —
banners have an Accept button, the renamed CTA keeps its `aria-label`. A
perturbation that no agent can survive measures nothing.

## Adding an evaluator

Implement the `Evaluator` port in `packages/evaluators`. The rule that matters:
**an evaluator must not trust the agent's self-report.** The bundled one reads
server-side fixture state over HTTP from the worker, independently of whatever
the agent claimed. The agent's claim is recorded beside the verdict, never as
the verdict.

## Running against real Solari

Optional, and it spends credits.

```bash
echo "SOLARI_API_KEY=slr_live_..." >> .env
SOLARI_E2E=1 pnpm test:solari
```

The free plan allows 1 sandbox and 3 concurrent browsers. `429` is not
retryable — a tight retry loop burns quota against a wall — so the provider
waits on a slot instead.

## Credentials

- Never commit a key. `.env` is ignored; `.env.example` holds placeholders.
- **A CDP or WebSocket endpoint is a credential**, not a URL. Do not log one, do
  not persist one, do not paste one into an issue. See [SECURITY.md](SECURITY.md).
- If you add a code path that persists text produced by a browser or an SDK,
  route it through the store's `scrub()` — that boundary exists because an
  exception message once carried a live session endpoint into the public API.
