# Security

AgentGauntlet executes third-party code and handles browser capability
credentials, so a few of its security properties are worth stating explicitly.

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/Konuktor/agent-gauntlet/security/advisories/new)
on this repository. It is the only private channel this project has; there is no
security mailing address.

**Do not open a public issue containing a live credential.** That includes
Solari API keys and session endpoints — see below for why an endpoint counts.
If you have already pasted one somewhere public, rotate it first and report
second.

Expect an acknowledgement within a few days. This is a solo project built for a
hiring challenge, not a staffed product, and the response time reflects that.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

Only the latest tag receives fixes.

## The capability model

**A session endpoint is a credential.** Solari's WebSocket endpoints carry an
HMAC-signed composite session id in the path and are authorised by that path
alone — there is no `Authorization` header. Solari's own documentation is
explicit: *anyone holding the URL can drive the browser*. So AgentGauntlet
treats `wss://…/cdp/…`, `/ws/…` and `/control/…` URLs exactly like API keys:

- no column stores one;
- none is sent to the browser or rendered in the UI;
- the logger scrubs them;
- **the persistence layer scrubs them too**, because a Playwright connect
  failure quotes the endpoint it was handed inside its error text, and that text
  is stored as a run's failure message. This was a real disclosure path, found
  by running against live infrastructure and fixed in `15f4806`; migration
  `0004` scrubs rows written before the fix.

**Third-party code never runs on the host.** A repository agent is cloned and
executed inside a Solari Sandbox. There is no `child_process` path for
third-party code anywhere in this repository.

**Third-party code never receives the operator's API key.** A repository agent
is given a scoped CDP endpoint for one session that AgentGauntlet created and
will release. An account key would let it create sessions, read saved profiles
and spend the owner's balance; a session endpoint lets it drive one browser.

**Repository URLs are allowlisted** before a clone is attempted: `https://` and
public hosts only. `file://`, SCP-style git URLs, credentials-in-URL, localhost,
RFC1918 and the link-local metadata range are all rejected.

**Borrowed credentials are sealed and short-lived.** When a visitor lends their
own session or key, it is encrypted with AES-256-GCM before it enters the
queue — that queue is a Postgres table shared by two services — opened once in
the worker, and wiped when the run reaches a terminal state. Anything left
behind by a crashed worker is swept on the next boot and again every 60 seconds,
by terminal status and by age. Without `GAUNTLET_CREDENTIAL_KEY` configured the
feature refuses outright rather than storing a secret in plaintext.

**A pasted endpoint is an instruction to connect somewhere**, so it is validated
like a repository URL: `wss://` only, no loopback, no RFC1918, no `.internal`.

## Known limitations

- The public demo protects the operator's balance with a shared access code, not
  per-user authentication. It is a demo control, not an authorisation system.
- A borrowed browser session provides **no sandbox**. It grants one browser and
  nothing else; running a repository agent still requires a Solari key, because
  cloning and executing someone's code needs a VM that a borrowed browser cannot
  provide.
- Replays are stored as artifacts on the worker's filesystem. On the deployed
  free plan that storage is ephemeral.
