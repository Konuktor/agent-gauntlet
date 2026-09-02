# 60-second demo

Everything below is on the live deployment. Nothing is staged, and every number
is one AgentGauntlet actually measured.

**https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run**

---

### 0:00 – 0:07 · The claim

Land on the home page.

> "Benchmarks tell you whether your agent is smart. AgentGauntlet tells you
> whether it survives production."

Point at the badge in the header: **SOLARI LIVE**. Real cloud browsers, not a
simulation.

### 0:07 – 0:15 · The real run

Open **Runs → the four-run Solari suite**. The matrix, four real browser
sessions:

```
baseline           PASS    7 steps
cookie_popup       PASS    7 steps
unexpected_modal   PASS   19 steps
expired_session    FAIL    7 steps
```

### 0:15 – 0:25 · What the numbers say

Reliability **75%**, baseline **100%**, perturbed **66.7%**, **0** infrastructure
errors.

> "Perfect when nothing moves. Two thirds when the environment does."

Do not hide the interval: on four runs it is 30–95%. This is a demonstration of
the measurement, not a benchmark result.

### 0:25 – 0:35 · The failure, proved

Click the red cell — `expired_session`.

> "The shopping session expired mid-task and the agent did not re-establish it."

Show that the verdict came from the **benchmark site's server-side state**, not
from the agent's own report. The agent's claim is displayed next to what
actually happened; when they disagree, the state wins.

### 0:35 – 0:43 · The failure nobody else reports

Click `unexpected_modal`. It **passed** — in **19 steps against a baseline of 7**.

> "It survived, and paid nearly triple. A pass/fail benchmark shows you a green
> tick here. In production this is a timeout, a cost overrun, a rate limit."

This is the single most persuasive screen in the product.

### 0:43 – 0:50 · Evidence

Open the replay panel. If it is ready, play the rrweb recording of exactly what
the browser did. If it still says **Replay processing…**, say so plainly:

> "Recordings publish asynchronously, so they arrive after the verdict. The
> result never waits on evidence — and a missing recording never changes a
> pass into a fail."

### 0:50 – 0:57 · Somebody else's agent

Open the repository-agent run.

> "This one is not our agent. It is a separate public repository, cloned into a
> Solari Sandbox, installed there, and given a CDP endpoint scoped to one
> browser session. It never runs on our machines and never sees our Solari key."

```
GitHub → Solari Sandbox → scoped CDP → Solari Browser → Gauntlet Shop → evaluator
```

### 0:57 – 1:00 · Close

> "Crash-test your browser agent before production does."
