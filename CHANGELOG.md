# Changelog

## 1.0.0 — 2026-09-02

First public release, built for the Pinetree Research / Solari SWE challenge.

### Added

- **Reliability measurement.** The same task run repeatedly across controlled
  environment changes, scored as reliability with a Wilson confidence interval,
  split into baseline vs perturbed, and broken down by perturbation and category.
- **Ten perturbations** across UI, network, viewport, state and locale, each
  seeded deterministically from `sha256(suiteRunId|variant|repetition)` so a run
  reproduces the environment it faced.
- **An independent evaluator.** The verdict comes from server-side benchmark
  state fetched by the worker, never from the agent's self-report. The agent's
  claim is recorded beside the verdict.
- **Deterministic failure classification** into 13 categories from evidence
  alone, plus failure clustering so one repeated defect reads as one problem.
- **Trajectory measurement** — step counts, durations and run-to-run flip rate,
  which is what catches an agent that passes but degrades.
- **Run matrix, regression comparison and replays** for evidence.
- **Asynchronous replay retrieval**, so a recording that publishes minutes after
  the fact never delays a verdict or a metric.
- **Three ways to submit an agent**: a deterministic built-in Reference Agent in
  three capability presets, an external repository agent, and a borrowed browser
  session. An optional LLM adapter exists to show the seam and is never on the
  default path.
- **Solari Sandbox isolation** for external repository code, which receives a
  scoped CDP endpoint and never the operator's API key.
- **Bring-your-own credentials**, so a visitor can spend their own Solari quota
  instead of the operator's.
- **CLI and CI gate** — `gauntlet run ./gauntlet.yaml` needs no database and
  exits non-zero when a reliability threshold is missed.
- **Two-service deployment** on Northflank: a web service and a separate worker,
  with Postgres as the queue (`FOR UPDATE SKIP LOCKED` plus heartbeat reclaim).

### Security

- **Session endpoints are treated as credentials.** Solari's WebSocket URLs are
  authorised by a signed path with no header, so holding one is holding the
  browser. They are never stored in a column, never rendered, and scrubbed by
  both the logger and the persistence layer.
- **Fixed a credential-disclosure path** found by testing against live
  infrastructure: a Playwright connect failure quotes the endpoint it was
  handed, that error was persisted as a run's failure message, and the public
  API served it. Scrubbing now happens on the way into the database
  (`15f4806`), and migration `0004` scrubs rows written before the fix.
- **Fixed `redactValue` flattening non-plain objects** — it turned every logged
  `Date` into `{}` and would have destroyed timestamps once used on a database
  patch.
- **Borrowed credentials are sealed** with AES-256-GCM before entering the
  queue, used for one run, and wiped at terminal state — plus swept by age,
  since the session behind one expires within the hour. Absent a sealing key the
  feature refuses rather than falling back to plaintext.
- **A pasted CDP endpoint is validated** like a repository URL: `wss://` only,
  no loopback, no RFC1918, no `.internal`.
- Repository agents receive a scoped session capability, never an account key.

### Validated

- **Real Solari end-to-end**: sandbox, benchmark site on a preview URL, recorded
  cloud browser, agent run, server-side verdict, replay, cleanup — 0 sandboxes
  left running.
- **A small real gauntlet** — 4 real Solari sessions, 0 infrastructure errors:

  | Variant | Result | Steps |
  | --- | --- | ---: |
  | `baseline` | PASS | 7 |
  | `cookie_popup` | PASS | 7 |
  | `unexpected_modal` | PASS | 19 |
  | `expired_session` | **FAIL** | 7 |

  Reliability 75%, baseline 100%, perturbed 66.7%. Four runs is a demonstration,
  not a benchmark; the Wilson interval is correspondingly wide (30.1–95.4%).
- **The repository-agent contract**, proved with a genuinely separate public
  repo cloned into a Solari Sandbox: 7 steps, 8/8 evaluator assertions, then
  `expired_session` FAIL at 6 steps, classified `auth`.
- **Bring-your-own credentials**, proved live: sealed by the web service, opened
  by the separate worker, driven over `connectOverCDP`, no replay promised, and
  failed as infrastructure rather than as an agent failure.
