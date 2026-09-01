# Northflank — verified notes

Read from the current official docs on 2026-09-02. Every claim below is quoted
or derived from a page linked inline; nothing here is inferred from the Render
work that preceded it.

## The three facts that decided the architecture

1. **The free Developer Sandbox allows exactly `2 services, 2 jobs, 1 addon,
   up to 1 BYOC cluster`** ([pricing-on-northflank]). That is precisely the
   shape AgentGauntlet already has: web service + worker service + Postgres
   addon, with a job spare for migrations. Nothing needs to be merged.
2. **Sandbox compute is always-on** — the pricing page states
   *"Always-on-compute – no sleeping :)"*. This is the reason we moved off
   Render's free web service, which spins down after 15 minutes of inactivity
   and costs ~50s on the next request.
3. **A secret group can link an addon and alias its keys**, so
   `POSTGRES_URI` is exposed to the application as `DATABASE_URL` without any
   code change and without credentials ever entering git.

## Sandbox allowances

| Resource | Free allowance | Source |
|---|---|---|
| Services | 2 | [pricing-on-northflank] |
| Jobs | 2 | [pricing-on-northflank] |
| Addons (databases) | 1 | [pricing-on-northflank] |
| BYOC clusters | up to 1 | [pricing-on-northflank] |
| Sleeping / scale-to-zero | none — always-on | [pricing] |

`nf-compute-20` is 0.2 vCPU / 0.5 GB ([instances/nf-compute-20]). The docs do
not publish which compute plan the Sandbox grants for free, so the template
takes it as an argument (`computePlan`, default `nf-compute-20`) rather than
hard-coding a guess.

## Template (Infrastructure as Code)

- `"$schema": "https://api.northflank.com/v1/schemas/template"`, and
  **`apiVersion` must be `v1.2`** — the docs state it is the only supported
  version ([write-a-template]).
- Top level: `apiVersion`, `name`, `description`, `arguments`,
  `argumentOverrides`, `options`, `spec`.
- Arguments are referenced as `${args.NAME}`; node outputs as
  `${refs.<ref>.<property>}` ([make-a-template-dynamic]).
- **Secrets belong in `argumentOverrides`, never in `arguments` or the spec.**
  The docs are explicit: *"All sensitive secrets should be stored as argument
  overrides, not within the template or as template arguments."* Overrides are
  stored on Northflank, not in the file. `${fn.randomSecret(n)}` generates one
  in place — used here for `GAUNTLET_RUN_TOKEN`.
- Node kinds ([template-nodes]): `Workflow` (flow control), `Project`, `Addon`,
  `SecretGroup`, `CombinedService`, `DeploymentService`, `ManualJob`,
  `CronJob`. Every node takes `kind`, `ref`, `spec`, and optional
  `updateMode` / `skipNodeExecution`.

### What the published schema actually says

`northflank/template.json` was validated field-by-field against the live schema
at `https://api.northflank.com/v1/schemas/template`, not against the prose docs.
Three things differ from what the guides show, and each cost a revision:

1. **The top level allows only `apiVersion`, `arguments` and `spec`**
   (`additionalProperties: false`). `name`, `description`, `options` and
   `argumentOverrides` — all of which the written guide shows in a template
   file — are rejected there. They belong to the API request that *runs* the
   template. That is convenient rather than annoying: it means secrets have no
   place in the committed artefact at all.
2. **Most nodes require `updateMode`.** The create variants accept
   `put` or `create`; `patch` selects a different, stricter variant.
3. **`healthChecks[].path` and `.port` reject literal values.** Their schema is
   `{"oneOf": [{"not": {}}, {"type": "string", "pattern": ".*\${.*}.*"}]}` —
   and `{"not": {}}` matches nothing, so only a `${...}` template string is
   accepted. `ports[].internalPort` next to it accepts a plain integer, so this
   looks like a generation artefact rather than an intent. The probe therefore
   reads `"${args.healthPath}"` and `"${args.healthPort}"`, which satisfies the
   schema and happens to make it configurable.

One caveat, stated plainly: a `${args.x}` string satisfies *both* branches of
the schema's `oneOf` for templated values (the template-pattern branch and the
literal branch), which strict JSON Schema counts as a failure. Every node here
validates once that ambiguity is discounted; nothing validates under an
unmodified strict `oneOf`, and no parameterised template could.

## Addon (PostgreSQL)

Create schema ([create-addon]): `name`, `type`, `version`, `billing`
(`deploymentPlan`, `storage` in MB, `replicas`, optional `storageClass`),
`tlsEnabled`, `externalAccessEnabled`, `vpcAccessible`.

Available Postgres versions: **18, 17, 16, 15, 14, 13, 12**
([deploy-a-database]). We pin 17 to match local development. Storage and
replica count can be increased later but **never decreased**.

`externalAccessEnabled: false` keeps the database reachable only inside the
project — which is what we want; only the two services talk to it.

## Secret group → DATABASE_URL

Create schema ([create-project-secret]):

```json
{
  "type": "secret",
  "secretType": "environment",
  "priority": 10,
  "addonDependencies": [
    { "addonId": "...", "keys": [{ "keyName": "POSTGRES_URI", "aliases": ["DATABASE_URL"] }] }
  ],
  "secrets": { "variables": { "...": "..." } }
}
```

Linked addon variables are otherwise named after the database, e.g.
`NF_MY-DATABASE_HOST` ([connect-database-secrets-to-workloads]); the alias is
what lets the app keep asking for `DATABASE_URL`. Direct service configuration
overrides anything inherited from a group, and `priority` breaks ties between
groups.

## Services

A **combined service** builds from git and deploys in one object, which suits a
repo that owns its own Dockerfile. Schema ([create-combined-service]):

- `billing.deploymentPlan`, `billing.buildPlan`
- `buildSource: "git"` with `vcsData` = `projectUrl`, `projectType`,
  `projectBranch`
- `buildSettings.dockerfile` = `dockerFilePath`, `dockerWorkDir`, `buildEngine`
  (`buildkit` | `kaniko`) — `dockerWorkDir` is the build context, which is what
  makes a monorepo work: context `/`, Dockerfile `/Dockerfile`.
- `deployment.instances`, `deployment.docker.configType`
  (`default` | `customCommand` | `customEntrypoint` |
  `customEntrypointCustomCommand`)
- `ports[]` = `name`, `internalPort`, `public`, `protocol`
  (`HTTP` | `HTTP/2` | `TCP` | `UDP`)
- `healthChecks[]` = `protocol`, `type` (`readinessProbe` | `livenessProbe`),
  `path`, `port`, `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`,
  `failureThreshold`

**The worker needs no port.** `ports` is an array; an empty one is a service
with no listener and no public URL. Nothing in the docs requires a service to
expose a port, so there is no fake HTTP server here.

## CLI

`npm i -g @northflank/cli`, then `northflank login` — *"a browser window will
open where you can select an API token"* — or `northflank login -t <token>`
for a non-interactive token ([use-the-cli]). `northflank context ls` lists
contexts; an unauthenticated machine prints `No contexts found`. The docs do
not document an API-token environment variable for the CLI, so the token flag
is the non-interactive path.

## Sources

- [pricing]: https://northflank.com/pricing
- [pricing-on-northflank]: https://northflank.com/docs/v1/application/billing/pricing-on-northflank
- [instances/nf-compute-20]: https://northflank.com/cloud/northflank/instances/nf-compute-20
- [write-a-template]: https://northflank.com/docs/v1/application/infrastructure-as-code/write-a-template
- [template-nodes]: https://northflank.com/docs/v1/application/infrastructure-as-code/template-nodes
- [make-a-template-dynamic]: https://northflank.com/docs/v1/application/infrastructure-as-code/make-a-template-dynamic
- [create-addon]: https://northflank.com/docs/v1/api/project/addons/create-addon
- [deploy-a-database]: https://northflank.com/docs/v1/application/databases-and-persistence/deploy-a-database
- [connect-database-secrets-to-workloads]: https://northflank.com/docs/v1/application/databases-and-persistence/connect-database-secrets-to-workloads
- [create-project-secret]: https://northflank.com/docs/v1/api/project/secrets/create-project-secret
- [create-combined-service]: https://northflank.com/docs/v1/api/project/services/create-combined-service
- [use-the-cli]: https://northflank.com/docs/v1/api/use-the-cli
