# The repository-agent contract

Bring your own agent. Put a file at the root of its repository, and
AgentGauntlet will run it through the gauntlet.

Your code is cloned and executed **inside a Solari Sandbox** — never on the
AgentGauntlet host. That isolation is the reason this feature can exist at all.

## `agentgauntlet.yaml`

```yaml
version: 1

install: # optional
  command: npm
  args: ["install", "--omit=dev"]

run: # required
  command: node
  args: ["agent.mjs"]

workdir: . # optional, relative to the clone
installTimeoutMs: 300000 # optional, clamped to the product limit
timeoutMs: 120000 # optional, clamped to the task's own timeout
env: # optional, literal values only
  AGENT_LOG_LEVEL: info
```

`command` is a binary and `args` is its argv. **There is no shell.** If you need
one, ask for it: `command: sh, args: ["-c", "…"]`.

## What your process receives

| Variable                      | Meaning                                    |
| ----------------------------- | ------------------------------------------ |
| `AGENT_GAUNTLET_TASK`         | The task, in plain English                 |
| `AGENT_GAUNTLET_START_URL`    | Where to begin, already scoped to this run |
| `AGENT_GAUNTLET_CDP_ENDPOINT` | A live Chrome DevTools Protocol endpoint   |
| `AGENT_GAUNTLET_RUN_ID`       | This run's id                              |
| `AGENT_GAUNTLET_MAX_STEPS`    | The step budget the task declares          |

Connect with anything that speaks CDP:

```js
import { chromium } from "playwright-core"
const browser = await chromium.connectOverCDP(process.env.AGENT_GAUNTLET_CDP_ENDPOINT)
const context = browser.contexts()[0] ?? (await browser.newContext())
const page = context.pages()[0] ?? (await context.newPage())
```

### On credentials

**You are not given `SOLARI_API_KEY`, and you never will be.**

The CDP endpoint is a capability scoped to exactly one browser session that
AgentGauntlet created and will release. That is the least authority that makes
the job possible. An account-wide key handed to third-party code would let it
create sessions, read every saved profile, and spend the owner's balance — a bad
trade for saving one line of connection code.

Two consequences worth knowing:

- **The endpoint is itself a secret while you hold it.** Anyone with the URL can
  drive that browser. Do not log it, and do not send it anywhere.
- **It expires**, and the session is released when your process exits. Do your
  work inside the run.

The same reasoning runs in the other direction, and that is worth stating
because it is the same idea twice. AgentGauntlet asks untrusted code for the
least authority that works — a scoped endpoint, not a key. So a hosted
AgentGauntlet asks _you_ for the least authority that works, too: run
`gauntlet session` on your own machine and paste the endpoint it prints, and the
deployment drives one browser you created without ever seeing your account. A
key is only needed when the run has to create something itself — a repository
agent needs a sandbox — and that key is sealed, used once, and wiped.

## Reporting your result

Print one line to stdout, any time before you exit:

```
AGENT_GAUNTLET_RESULT={"status":"completed","message":"reached review","steps":7}
```

`status` is `completed`, `failed` or `gave_up`. The last such line wins.

### This is a claim, not a verdict

AgentGauntlet decides whether the task was done by reading the benchmark site's
**server-side state**, which your agent can only change by genuinely performing
the actions. If you report `completed` and the state disagrees, the run fails —
and the dashboard shows your claim next to what actually happened.

That gap is one of the more useful things the tool surfaces, so report honestly;
you are not being graded on it.

## What the sandbox gives you

The Solari `base` template currently runs **Node 18**. That is worth checking
against your dependencies before you spend a run: a caret range on
`playwright-core` resolved to a version demanding Node 20, and the agent exited
immediately having done nothing. The failure looked like a bug in the agent
until its own stderr was read.

If you need a newer runtime, install it yourself in `install` — you have a full
VM and a `command`/`args` of your choosing.

## Limits

| Limit                    | Value                                                       |
| ------------------------ | ----------------------------------------------------------- |
| Install time             | 10 minutes, or your `installTimeoutMs`                      |
| Run time                 | 10 minutes, or the lower of your `timeoutMs` and the task's |
| stdout + stderr retained | 256 KB, then truncated with a marker                        |
| Repository URL           | `https://` on a public host only                            |

Rejected before any clone is attempted: `file://`, SCP-style (`git@host:org/repo`),
credentials embedded in the URL, `localhost`, RFC1918 ranges, `.local`/`.internal`,
and the `169.254.0.0/16` link-local range (cloud instance metadata).

## Speed

Dependencies are installed once and the sandbox is snapshotted; subsequent
repetitions boot from that snapshot. A 90-second `npm install` is paid once per
suite, not once per run.

## A complete example

[`examples/custom-agent`](../examples/custom-agent) — about 80 lines of
Playwright, implementing every part of this contract.

The same agent as a **separate public repository**, which is what a real run
clones into a sandbox:
[`Konuktor/agent-gauntlet-example-agent`](https://github.com/Konuktor/agent-gauntlet-example-agent).
