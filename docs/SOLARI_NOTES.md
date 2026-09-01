# Solari integration notes

Everything here was verified against the **shipped `@solarisdk/*@0.1.2` type
definitions** and the official documentation, not recalled. Where the docs and
the published types disagree, the types won and the disagreement is recorded.

**Sources consulted**

- `@solarisdk/browser@0.1.2`, `@solarisdk/sandbox@0.1.2`, `@solarisdk/core@0.1.2`,
  `@solarisdk/sdk@0.1.2` — the shipped `.d.ts` files
- `docs.getsolari.com` — `/quickstart`, `/sessions`, `/browser-api`, `/profiles`,
  `/recording`, `/stealth`, `/proxies`, `/captcha`, `/sandboxes`, `/templates`,
  `/snapshots`, `/volumes`, `/regions`, `/pricing`, `/errors`, `/mcp`, and the
  authoritative `/sdk/typescript/sandboxes`, `/api-reference/browser`,
  `/api-reference/sandboxes`
- `github.com/solari-sdk/solari-cookbook` — every TypeScript example

---

## Packages used

| Package | Why |
|---|---|
| `@solarisdk/browser` | Cloud browser sessions, recording, replay, profiles |
| `@solarisdk/sdk` | `SolariClient` for sandboxes — it defaults `baseUrl`, the standalone client does not |
| `patchright-core@1.62.2` | The pinned client for Solari's wire protocol. Exact version, as the docs require |

All of it is confined to `packages/solari`. Nothing else in the repository
imports a Solari package, so the rest of the system is testable without one.

---

## The ten findings that shaped the architecture

### 1. `sessions.create()`, not `launch()` — because of where the CDP endpoint points

`launch()` is the ergonomic path, and the endpoints on the `BrowserSession` it
returns are documented as **"loopback-wrapped"**: they point at a proxy the SDK
runs on *your* machine.

That is invisible and harmless until you hand the endpoint to an agent running
inside a Solari Sandbox, which cannot reach your loopback interface. The failure
looks like a Solari outage and is not one.

`sessions.create()` returns the raw, publicly routable `wss://` endpoints:

```ts
const session = await solari.sessions.create({ recording: true, stealth: false })
const browser = await chromium.connect(session.wsEndpoint)   // patchright-core
// session.cdpEndpoint is the RAW endpoint a remote sandbox can reach
```

So AgentGauntlet uses `sessions.create()` for every run, connects itself, and
releases the session explicitly. One code path, and the remote case works.
→ `packages/solari/src/browser-manager.ts`

### 2. The session URL *is* the credential

> "WebSocket handshakes cannot reliably carry custom headers, so the HMAC-signed
> composite ID in the path _is_ the capability: anyone holding the URL can drive
> the browser." — `/api-reference/browser`

They also expire after 90 minutes. So `cdpEndpoint` and `wsEndpoint` are treated
as secrets: held in a module-level `WeakMap` rather than as properties on the
environment object (so `JSON.stringify` cannot leak one), never written to the
database — there is deliberately **no column for them** — and scrubbed by the
logger's redaction pass. Only the session id is persisted, because only the
session id is safe to display.

### 3. Recording is per session, and the replay arrives late

`recording: true` must be set at creation; a session created without it 404s on
its replay endpoint *forever*. The upload then happens **asynchronously after
release**, so the first poll usually 404s even for a perfectly good recording.

`getReplayUrl()` returns a **presigned** URL with an `expiresInSeconds`. Storing
that URL would be storing something that stops working, so AgentGauntlet:

1. releases the session with `releaseAndWait()` (the upload starts on release),
2. polls `downloadReplay()` with bounded backoff, treating 404 as "not yet",
3. stores the **rrweb NDJSON artifact**, gzipped, on disk,
4. mints a fresh presigned URL on demand when a user asks to open one.

A replay that never arrives is recorded as `replayStatus: "failed"` and changes
nothing about the run's verdict. Replay is evidence infrastructure, not truth.
→ `packages/solari/src/replay.ts`

### 4. `await solari.close()` is mandatory in Node

The browser client keeps a loopback proxy server open for its connection-retry
path, and that handle keeps the event loop alive. Skip it and the process prints
its last line and then hangs forever. Called in a `finally` in the worker, the
CLI, and every API route that constructs a client.

### 5. A 429 must not be retried

> "429 is not retryable, and no SDK retries it… A tight retry loop here burns
> quota against a wall." — `/errors`

A concurrency limit clears only when somebody's session ends. So
`ConcurrencyLimitExceeded` maps to a **non-retryable** error, and the
orchestrator gates launches behind its own semaphore sized to
`GAUNTLET_MAX_CONCURRENCY` (default **3**, which fits the Free plan's cap).

Plan caps, for sizing: Free **3 browsers / 1 sandbox**, Starter 20 / 2,
Professional 150 / 10.

### 6. There is no session-level viewport, and no session-level timeout

Neither appears in `CreateSessionOptions` or in the `POST /sessions` body. So:

- `mobile_viewport` is applied through `browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, userAgent })`
- run deadlines are ours, enforced with `AbortSignal`

`expiresAt` is a plan-tier deadline, not an idle timeout — sessions persist until
it or until an explicit release.

### 7. Sandbox commands are not shell-interpreted

`run("ls -la")` looks for a binary literally named `ls -la`. Every shell
construct goes through an explicit `run("sh", { args: ["-c", "…"] })`, which is
also why there is no command-string interpolation anywhere in the sandbox
manager. A non-zero exit **resolves**; it does not throw.

### 8. `kill()`, not `close()`

`close()` drops the local control channel; the VM keeps running — and billing —
until its idle timeout. `kill()` destroys it. Called from a `finally` without
exception, and `SolariSandboxProvider.listOrphans()` exists to find anything a
hard kill left behind.

`timeoutMs` is a **rolling idle window** that resets on every use, and its
documented default differs between pages (30 min on `/sandboxes`, 2 h on
`/api-reference/sandboxes`), so AgentGauntlet always sets it explicitly.

### 9. One sandbox hosts the benchmark site for the whole suite

Not thrift — necessity. The Free plan allows exactly **one** concurrent sandbox,
so a design with one sandbox per run would not run at all for most people. The
Gauntlet Shop isolates concurrent runs by run id inside a single process, and 16
browsers hit one sandbox safely.

`previewUrl(port)` returns `https://<hash>-<port>.preview.getsolari.com`. It can
answer **501** where a deployment has no preview domain configured — a
configuration fact, not a transient — so that failure produces an actionable
message pointing at `GAUNTLET_FIXTURE_URL` rather than a retry.

### 10. `record: true` is rejected on a headless sandbox

400 `RecordingRequiresDesktop`. Sandbox recording is never requested; browser
sessions are where recording happens.

---

## Differences between the original specification and the current SDK

| Spec said | Reality in 0.1.2 | What we did |
|---|---|---|
| `new SandboxClient({ apiKey })` | `SandboxClientOptions.baseUrl` is **required** (`baseUrl: string`), despite the package README showing it omitted | Use `SolariClient` from `@solarisdk/sdk`, which defaults it |
| `sandbox.exec(...)` | Not on the headless `Sandbox` handle. The npm READMEs are stale; `exec` is an internal one-shot hook and a `Desktop` method | `sandbox.commands.run(cmd, { args })` |
| Configure viewport on the session | No such option exists | Applied on the browser context |
| `getReplayUrl()` returns a durable link | Presigned, with `expiresInSeconds` | Persist the artifact; mint URLs on demand |
| `GET /sessions/:id` to poll a session | Documented as **"This endpoint is dead. It always 404s. Do not build on it."** | Never polled |

---

## Gotchas that cost real debugging time here

**`rrweb.record()` inside a Playwright init script crashes the renderer.** Not an
exception — the tab dies with "Target crashed". Init scripts evaluate on
`about:blank` before a real document exists. Fixed by deferring the recorder
start to `DOMContentLoaded` and skipping `about:` and `blob:` documents.
(Local-mode capture only; Solari records server-side and is unaffected.)

**Bundlers rewrite functions before you stringify them.** esbuild's `keepNames`
— which `tsx` and Vitest both enable — wraps named functions as
`__name(function f(){}, "f")`. A page script authored as a real function and
passed to `evaluate()` then dies with `ReferenceError: __name is not defined`,
and *whether the agent can see the page depends on which bundler ran*. Every page
script is wrapped in a prelude that declares the helpers.

**`rrweb@2.1`'s `exports` map publishes only `"."` and `"./dist/style.css"`.**
Importing `rrweb/dist/rrweb.umd.cjs` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` even
though the file is right there. Resolve `"."` and walk to its sibling.

**Solari packages are dual-published under two error models.** The browser client
throws one `SolariError` carrying a `code` string; the sandbox client throws
typed subclasses (`AuthError`, `ConcurrencyLimitError`, `NoCapacityError`, …).
`packages/solari/src/errors.ts` is the only place that knows about either.

---

## What Solari makes possible here

Not "a browser API we happened to call". The product's shape depends on four
capabilities that are hard to get any other way:

1. **Many independent, disposable, recorded Chrome sessions in parallel** — the
   unit of measurement is a *repeated* run, so N sessions is the product.
2. **A public URL for a server running inside an isolated VM** — the benchmark
   site has to be reachable by cloud browsers, and controlled by us.
3. **Isolated execution of untrusted third-party repositories** — the repository
   agent contract is only safe because the code never touches our host.
4. **DOM-level session recordings** — a failed run is debuggable rather than just
   counted.
