# Launch posts

Both are written to be posted as-is. Numbers are the real ones from the live
deployment; do not round them up.

---

## LinkedIn

**Your browser agent passes its benchmark. That tells you almost nothing.**

A benchmark asks: can the agent do the task once, on a good day, on a page that
never changes?

Production asks something else. A cookie banner appears. A modal steals focus.
The session expires. The CTA gets renamed by a marketing team that never heard
of your agent.

So I built AgentGauntlet: it runs the same task repeatedly across changing UI,
network and session conditions, on real cloud browsers, and judges completion
from the site's **server-side state** — never from what the agent says about
itself.

Here is a real run, on real infrastructure:

```
baseline           PASS    7 steps
cookie_popup       PASS    7 steps
unexpected_modal   PASS   19 steps
expired_session    FAIL    7 steps

Reliability 75%   Baseline 100%   Perturbed 66.7%
```

Look at the third line before the fourth.

`unexpected_modal` **passed** — and took **19 steps instead of 7**. Unexpected UI
did not break the agent. It nearly tripled its trajectory. A pass/fail benchmark
shows you a green tick there. In production that is a timeout, a cost overrun, a
rate limit, a support ticket.

The failure it did find, classified from evidence:

> "The shopping session expired mid-task and the agent did not re-establish it."

Two things I want to be honest about. Four runs is a demonstration, not a
benchmark — the confidence interval on that 75% is 30–95%, and the product shows
it rather than hiding it. And the agent under test is my own reference
implementation; the more interesting result will be the first time someone
points it at theirs.

It is agent-agnostic on purpose. Bring your own from a git repository: it is
cloned into an isolated sandbox, handed a browser session scoped to that run,
and never given my API keys.

Built on Solari for cloud browsers and sandboxes. Live, free, no signup to look
around:

🔗 https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run
💻 https://github.com/Konuktor/agent-gauntlet

---

## X

**Your agent passed its benchmark. Congratulations — that measured almost nothing.**

I ran one agent through the same checkout task under changing conditions, on
real cloud browsers:

```
baseline           PASS    7 steps
cookie_popup       PASS    7 steps
unexpected_modal   PASS   19 steps  ←
expired_session    FAIL    7 steps
```

The interesting line isn't the failure.

`unexpected_modal` **passed** — in 19 steps instead of 7. It survived and paid
nearly 3×. Your pass/fail benchmark prints a green tick. Production prints a
timeout.

Verdicts come from server-side state, not the agent's self-report. It can claim
success all it likes; the store knows what actually happened.

75% reliability on 4 runs — CI 30–95%, which the tool shows you, because 4 runs
is a demo and not a benchmark.

Bring your own agent from a git repo. It runs in an isolated sandbox with a
browser scoped to that run, and never sees my keys.

Live 👉 https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run
