# Launch post

Two drafts. The first is the main one; the second is a shorter variant for X.

---

## LinkedIn / X — long form

> Browser agents demo beautifully.
>
> The problem is they don't fail consistently.
>
> The same task works on Monday and breaks on Tuesday because a cookie banner
> appeared, an API got slower, someone renamed a button, or the session expired
> halfway through checkout. None of that shows up in a benchmark score, because a
> benchmark asks whether the agent can do it *once*.
>
> So I built AgentGauntlet.
>
> It runs the same task many times, across changing UI, network, session and
> browser conditions, and judges completion from the site's own server-side
> state — never from what the agent says about itself. An agent can print
> "status: completed". The dashboard records that as a claim and shows it next to
> what actually happened.
>
> The result isn't a score. It's a reliability rate with a confidence interval,
> a breakdown by perturbation, and a replay of the exact run that broke.
>
> The clearest thing it produced: three agents differing by one capability each,
> same task, same sixteen runs.
>
> · no overlay handling, no patience → 75.0%
> · dismisses overlays, waits for late elements → 87.5%
> · also recovers an interrupted session → 100%
>
> Overlay handling is worth 12.5 points. Session recovery is worth another 12.5.
> That's measured, not asserted — and it's the kind of thing you can only learn
> by running the same task over and over in conditions you control.
>
> It's built on Solari, and not incidentally. The product needs many independent
> recorded cloud browsers running in parallel, a controlled benchmark site hosted
> in an isolated VM on a public URL, and somewhere safe to execute agent
> repositories I didn't write. Solari Browser and Solari Sandbox are exactly that
> shape. Third-party agent code never touches my machine, and it gets a scoped
> CDP endpoint rather than an API key.
>
> Reliability belongs in CI. `gauntlet run` exits non-zero when the rate drops
> below your threshold, so a pull request that makes the agent worse fails like
> any other regression.
>
> Repo: [link]
> 60-second demo: [link]
>
> Built for the @Solari / Pinetree Research challenge. Feedback very welcome —
> particularly on which perturbations you'd add.

---

## X — short form

> Browser agents don't fail consistently. The same task works, then breaks —
> a cookie banner, a slow API, a renamed button, an expired session.
>
> AgentGauntlet runs the task 16 times across changing conditions and reports a
> reliability rate instead of a score.
>
> Three agents, one capability apart:
> 75% → 87.5% → 100%
>
> Completion is judged from the site's server-side state, never from the agent's
> own report. Built on @Solari: parallel recorded cloud browsers, and sandboxes
> to run agent repos I didn't write.
>
> [link]

---

## Notes for posting

- Replace `[link]` with the repository and the demo video.
- The three reliability figures are real, measured against the bundled
  benchmark storefront — `pnpm gauntlet demo` reproduces them. Do not round them
  into something rosier.
- Good first comment: the run-detail screenshot showing expected vs actual next
  to the agent's own claim. It makes the "never trust the self-report" point
  faster than any sentence does.
- Tag Solari / Pinetree Research. Mention the challenge; don't lead with it.
