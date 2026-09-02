# LinkedIn post — final

Post as-is. Every number is from the live deployment; do not round them up.
Before posting, replace the two tags with the real profiles (see _Tagging_ at
the bottom) — LinkedIn only creates a mention when you pick the person from its
autocomplete, so typing the text alone does nothing.

---

Browser agents look great when they work once.

The harder question is whether they keep working when the environment changes.

For the Pinetree Research / Solari SWE challenge I built **AgentGauntlet** —
reliability CI for browser agents.

It runs the same task repeatedly across changing UI, network, viewport and
session conditions using real Solari cloud browsers, then independently checks
whether the agent actually finished.

One small live run:

Baseline → PASS, 7 steps
Cookie popup → PASS, 7 steps
Unexpected modal → PASS, 19 steps
Expired session → FAIL, 7 steps

The modal result is my favourite.

A normal benchmark would say both the baseline and the modal run passed, and
stop there. AgentGauntlet shows the agent's trajectory degraded from 7 steps to
19 — the kind of thing that turns into a timeout, a cost overrun or a rate limit
in production. And when the session expired, the agent failed outright.

The evaluator never trusts the agent's own "done" message. It reads the
benchmark site's server-side state, which the agent cannot fake.

I also added a path for external agents: your code is cloned and executed inside
an isolated Solari Sandbox, and connects to a scoped browser capability instead
of ever receiving the operator's API key. Least authority, applied to code you
did not write.

Building it against live infrastructure exposed bugs my local tests never did:
session lifecycle leaks, replay timing, concurrency behaviour under a plan cap,
an SDK that hides the public CDP endpoint behind a loopback proxy — and a
credential-disclosure path where a Playwright connect error quoted the session
endpoint it was handed, that text was stored as a run's failure message, and the
public API served it back.

That last one is the whole argument for testing outside clean environments,
demonstrated on myself.

Four runs is a demonstration, not a benchmark — the confidence interval is
30–95% and the product says so on the page.

Built heavily with Claude Code, as the challenge encourages.

Live demo: https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run
GitHub: https://github.com/Konuktor/agent-gauntlet
Solari cookbook fork: https://github.com/Konuktor/solari-cookbook/tree/main/examples/agent-gauntlet

[tag Harry Chow] [tag Solari]

---

## Tagging

- **Harry Chow** — type `@Harry Chow`, then select him from the dropdown.
- **Solari** — type `@Solari` and select the company page.

A mention only registers when picked from autocomplete; plain text does not
notify anyone.

## Notes

- Post the four-line result as plain lines, not a code block — LinkedIn renders
  code blocks as ordinary text and the monospace alignment is lost anyway.
- If you attach media, use the run matrix screenshot rather than the landing
  page: the matrix is the part that makes people stop scrolling.
