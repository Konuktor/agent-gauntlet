# X post — final

A three-post thread. Post 1 carries the link so the preview card renders on the
post people actually see.

Verify both handles before posting — see _Tagging_ below.

---

## 1/3

Browser agents often look reliable because we only test them once.

For the @getsolari challenge I built AgentGauntlet: reliability CI for browser
agents.

Same task. Changing environments. Independent evaluation.

https://http--agent-gauntlet-web--hjwypxsqnrjv.code.run

## 2/3

A real run on Solari cloud browsers:

baseline ✅ 7 steps
cookie popup ✅ 7
unexpected modal ✅ 19
expired session ❌ 7

The modal didn't break the agent — it made the trajectory ~3x longer.

A pass/fail benchmark records that as identical to baseline.

## 3/3

The evaluator reads the site's server-side state, never the agent's own "done".

External agents run inside a Solari Sandbox and get a scoped browser capability
instead of the account key.

Built heavily with Claude Code.

https://github.com/Konuktor/agent-gauntlet

---

## Tagging

- **Solari** — `@getsolari` (confirm on x.com before posting).
- **Harry Chow** — confirm the handle on his profile and add it to post 1
  alongside `@getsolari`. Do not guess it; a wrong handle tags a stranger.

## Notes

- Post 2 is the one that gets quoted. Keep the four result lines exactly as they
  are — the asymmetry between ✅ 19 and ✅ 7 is the whole point.
- Don't claim four runs prove anything general. If someone asks, the Wilson
  interval is 30–95% and the product displays it.
