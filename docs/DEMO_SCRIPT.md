# Demo script — 60 seconds

For the submission video. Everything shown is on the live deployment
(https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run) using run data that
already exists — **record this without starting a new gauntlet.** A live run
spends Solari credits and takes minutes; the point of the video is the result,
not the waiting.

Narrate at a normal pace. The timings assume roughly 150 words per minute.

---

### 0:00–0:06 — Landing page

> "Browser agents look reliable when we test whether they work once. I built
> AgentGauntlet to test whether they survive production."

Show the landing page. Don't scroll yet.

---

### 0:06–0:13 — The run matrix

Open the real Solari run.

> "Same task. Same agent. Four environments. Real Solari cloud browsers."

Let the matrix sit on screen for a beat. It reads at a glance: three green, one
red.

---

### 0:13–0:21 — Baseline, then the failure

Point at `baseline`, then `expired_session`.

> "Baseline passes in seven steps. Then the session expires mid-task — and the
> agent fails. It works perfectly right up until the environment stops
> cooperating."

---

### 0:21–0:30 — The interesting one

Point at `unexpected_modal`.

> "This one passed. It also went from seven steps to nineteen. A pass/fail
> benchmark records that as identical to baseline — but tripling the trajectory
> is how you get a timeout, a rate limit, or a bill you didn't plan for."

This is the beat that makes the product make sense. Don't rush it.

---

### 0:30–0:38 — Independent evaluation

Open the failed run's detail: expected vs actual per assertion, with the agent's
own claim shown beside it.

> "We never trust the agent saying it's done. The evaluator reads the benchmark
> site's server-side state — which the agent can't fake — and the agent's own
> claim is recorded next to the verdict, not as the verdict."

---

### 0:38–0:45 — Evidence

Show the failure classification and the replay panel.

> "Every failure is classified from evidence and carries a replay you can
> inspect. This one is an auth failure: the session expired and the agent never
> re-established it."

---

### 0:45–0:52 — Bring your own agent

Show the new-suite page with the repository agent selected, or the architecture
diagram in the README.

> "Bring your own agent. Your repository is cloned and executed inside an
> isolated Solari Sandbox, and it receives a scoped browser endpoint — never the
> account key."

---

### 0:52–1:00 — Close

> "Four runs is a demonstration, not a benchmark, and the product shows the
> confidence interval to prove it. AgentGauntlet: crash-test your browser agent
> before production does."

Final frame:

```
AgentGauntlet
Crash-test your browser agent before production does.

github.com/Konuktor/agent-gauntlet
http--agent-gauntlet-web--hjwypxsqnrjv.code.run
```

---

## Recording notes

- **Do not start a live run on camera.** Use the existing real Solari run.
- 1440×900 or 1920×1080. The dashboard is designed for width; a phone recording
  loses the matrix.
- Dark theme, which is the default.
- Check the top-right badge reads what you expect before recording — the UI
  labels seeded data **DEMO DATA** and that badge will be in frame.
- No terminal, no code, no architecture lecture. The result is the story.
- If a take runs long, cut the "bring your own agent" beat before cutting the
  19-steps beat. The modal is the thesis; the sandbox is a feature.
