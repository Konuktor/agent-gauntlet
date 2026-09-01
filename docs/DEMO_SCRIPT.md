# Demo script — 60 seconds

The point to land: **a browser agent that works once has told you nothing.**

Setup before recording:

```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev
```

Browser at 1440×900, dark theme, `http://localhost:3000`.

---

### 0:00 – 0:06 · The question

**Landing page.**

> "Your browser agent worked once. Would you deploy it?"

Let the headline sit for a beat: *Crash-test your browser agent before
production does.*

### 0:06 – 0:14 · Configure

Click **Run the Gauntlet**.

> "Pick an agent. Pick a task. Pick the ways the world can change underneath it."

Scroll the variants: cookie popup, unexpected modal, slow API, renamed CTA,
mobile viewport, expired session. Point at the sidebar:

> "Eight variants, two repetitions — sixteen browser runs. It tells you the cost
> before it spends anything, and nothing starts until you press the button."

Press **Run the Gauntlet**.

### 0:14 – 0:26 · Watch it run

The live dashboard. Cells fill in as runs complete.

> "Sixteen browsers, three at a time. Each one gets a different environment,
> deterministic from a seed — so re-running this reproduces exactly these
> conditions."

Cells land green. Two land red.

### 0:26 – 0:36 · The number

Settle on the result.

> "Eighty-seven and a half percent. Baseline is a hundred — it always works on a
> clean page. Perturbed is eighty-six."

Point at the confidence interval.

> "Sixteen runs, so the interval is wide, and it says so. It won't pretend three
> runs is proof."

Scroll to the run matrix.

> "Every cell is one run. Expired session failed both times — that's not
> flakiness, that's a missing capability."

### 0:36 – 0:48 · Why it failed

Click the failed **Expired session** cell.

> "Here's the evidence. Cart correct. Coupon applied. Checkout name: expected Ada
> Lovelace, got null. Stage: expected review, got checkout."

Point at the agent's own claim.

> "And here's what the agent said about itself. The verdict doesn't come from
> that — it comes from the site's server-side state, which the agent can only
> change by actually doing the work."

Scroll to the action trace.

> "It hit the expired-session page, couldn't find the name field, tried three
> more times, and gave up. And there's the session replay."

### 0:48 – 0:57 · The regression

Back to **Runs** → **Compare**.

> "Same suite, two commits. Main was eighty-seven point five. This PR is
> seventy-five. Unexpected modal went from a hundred percent to zero."

Point at REGRESSION DETECTED.

> "That's a CI gate. `gauntlet run` exits non-zero and the pull request fails."

### 0:57 – 1:00 · Close

Back to the landing page.

> "AgentGauntlet. Crash-test your browser agent before production does."

---

## If you have another twenty seconds

The capability ladder is the strongest single argument in the product:

| Agent | Reliability |
|---|---|
| Naive — no overlay handling, no patience | **75.0%** |
| Reference — dismisses overlays, waits for late elements | **87.5%** |
| Resilient — also recovers interrupted sessions | **100%** |

> "Same task, same sixteen runs, three agents differing by one capability each.
> Overlay handling is worth twelve and a half points. Session recovery is worth
> another twelve and a half. That's not a guess — you can measure it."

## Terminal shot, if you want one

```bash
pnpm gauntlet demo
```

It prints the matrix, the reliability, the threshold, and exits non-zero when the
gate fails.
