# Example: a custom repository agent

The smallest thing that satisfies the AgentGauntlet repository-agent contract.

```
examples/custom-agent/
  agentgauntlet.yaml   how to install and run this agent
  agent.mjs            ~80 lines of Playwright
```

## How AgentGauntlet runs it

```
create a Solari Sandbox
  git clone <your repo>            (Solari's git API, shallow)
  npm install --omit=dev           (your `install` command)
  create a recorded browser session
  node agent.mjs                   (your `run` command, with the env below)
  read the benchmark site's state  ← the verdict comes from here
kill the sandbox
```

Your code never runs on the AgentGauntlet host. That is the entire reason
Solari Sandbox is in the architecture.

## Environment your agent receives

| Variable                      | What it is                                 |
| ----------------------------- | ------------------------------------------ |
| `AGENT_GAUNTLET_TASK`         | The task, in plain English                 |
| `AGENT_GAUNTLET_START_URL`    | Where to begin, already scoped to this run |
| `AGENT_GAUNTLET_CDP_ENDPOINT` | A live Chrome DevTools Protocol endpoint   |
| `AGENT_GAUNTLET_RUN_ID`       | This run's id, for your own logging        |
| `AGENT_GAUNTLET_MAX_STEPS`    | The step budget the task declares          |

**There is no `SOLARI_API_KEY` here, and there will not be.** The CDP endpoint
is a capability scoped to one browser session that AgentGauntlet created and
will release. Handing a third-party repository an account-wide key to accomplish
the same thing would be a poor trade.

Treat the endpoint as a secret while you hold it: anyone with the URL can drive
that browser.

## Reporting your result

Print one line to stdout:

```
AGENT_GAUNTLET_RESULT={"status":"completed","message":"reached review","steps":7}
```

`status` is one of `completed`, `failed`, `gave_up`.

**This is recorded as a claim, not a verdict.** AgentGauntlet decides whether
the task was done by reading the benchmark site's server-side state, which your
agent can only change by actually performing the actions. If your agent reports
`completed` and the state disagrees, the run fails — and the dashboard shows
both, side by side. That gap is one of the more useful things the tool surfaces.

## Trying it

```bash
gauntlet run ./gauntlet.yaml    # with agent.type: repository
```

Repository agents need `SOLARI_API_KEY`: they are the one part of AgentGauntlet
that genuinely cannot run locally, because the isolation is the feature.
