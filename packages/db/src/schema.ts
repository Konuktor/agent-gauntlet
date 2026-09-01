import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"

/**
 * Postgres enums are deliberately avoided: adding a perturbation or a failure
 * category should be a code change, not a migration. Values are constrained by
 * Zod at every write path instead, and the TS types below are the contract.
 */

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "reference" | "llm" | "repository" */
    type: text("type").notNull(),
    /** Adapter-specific settings. For repository agents: url, ref, manifest overrides. */
    configJson: jsonb("config_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agents_project_idx").on(t.projectId)],
)

export const taskDefinitions = pgTable(
  "task_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** Relative path against the fixture, or an absolute authorized URL. */
    startUrl: text("start_url").notNull(),
    maxSteps: integer("max_steps").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    evaluatorConfigJson: jsonb("evaluator_config_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_definitions_project_idx").on(t.projectId)],
)

export const suites = pgTable(
  "suites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    taskDefinitionId: uuid("task_definition_id")
      .notNull()
      .references(() => taskDefinitions.id, { onDelete: "restrict" }),
    runsPerVariant: integer("runs_per_variant").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("suites_project_idx").on(t.projectId)],
)

export const suiteVariants = pgTable(
  "suite_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => suites.id, { onDelete: "cascade" }),
    /** Perturbation id from the registry, e.g. "cookie_popup". */
    perturbationType: text("perturbation_type").notNull(),
    /** Per-suite overrides layered on the perturbation's defaults. */
    configJson: jsonb("config_json").notNull().default({}),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("suite_variants_unique").on(t.suiteId, t.perturbationType)],
)

export const suiteRuns = pgTable(
  "suite_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => suites.id, { onDelete: "cascade" }),
    /** queued | preparing | running | evaluating | completed | failed | cancelled */
    status: text("status").notNull().default("queued"),
    /** solari | local | demo. Displayed on every screen: a seeded or local run
     *  must never be mistaken for a real Solari run. */
    mode: text("mode").notNull(),
    label: text("label"),

    totalRuns: integer("total_runs").notNull().default(0),
    passedRuns: integer("passed_runs").notNull().default(0),
    failedRuns: integer("failed_runs").notNull().default(0),
    infrastructureErrors: integer("infrastructure_errors").notNull().default(0),
    reliability: doublePrecision("reliability"),

    /** Snapshot of computed metrics, so a completed run renders without
     *  recomputing across thousands of rows. Recomputed on every write while
     *  the suite is live. */
    metricsJson: jsonb("metrics_json"),

    /** Sandbox hosting the fixture for this suite run, for leak auditing. */
    fixtureSandboxId: text("fixture_sandbox_id"),

    /** CI provenance (§Stretch 4). */
    gitRepo: text("git_repo"),
    gitBranch: text("git_branch"),
    gitSha: text("git_sha"),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    /** DB-backed queue bookkeeping. No Redis: a claim is FOR UPDATE SKIP LOCKED
     *  and a dead worker is detected by a stale heartbeat. */
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("suite_runs_suite_idx").on(t.suiteId, t.createdAt),
    index("suite_runs_queue_idx").on(t.status, t.createdAt),
  ],
)

export const individualRuns = pgTable(
  "individual_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteRunId: uuid("suite_run_id")
      .notNull()
      .references(() => suiteRuns.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(),
    variantName: text("variant_name").notNull(),
    category: text("category").notNull(),
    repetition: integer("repetition").notNull(),
    /** Derived from suiteRunId|variant|repetition. Stored so a run's exact
     *  environment can be reproduced later. */
    seed: integer("seed").notNull(),

    /** queued | preparing_environment | running_agent | evaluating |
     *  collecting_replay | passed | failed | infrastructure_error | cancelled */
    status: text("status").notNull().default("queued"),

    /** Solari browser session id. Safe to display.
     *
     *  Note what is NOT here: cdpEndpoint and wsEndpoint. Those URLs ARE the
     *  credential — anyone holding one can drive the browser — so they live in
     *  memory for the duration of a run and are never written down. Nor is the
     *  presigned replay URL, which expires; we persist the artifact instead and
     *  re-mint the URL on demand. */
    sessionId: text("session_id"),
    sandboxId: text("sandbox_id"),
    geo: text("geo"),

    replayStatus: text("replay_status").notNull().default("none"),
    replayEventCount: integer("replay_event_count"),
    replayBytes: integer("replay_bytes"),
    replayArtifactPath: text("replay_artifact_path"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    steps: integer("steps"),

    errorCode: text("error_code"),
    failureCategory: text("failure_category"),
    /** Deterministic, evidence-derived. Never written by an LLM. */
    failureMessage: text("failure_message"),
    /** Optional LLM colour commentary. Stored separately so it can never
     *  overwrite the evidence-derived message (§14). */
    failureExplanation: text("failure_explanation"),

    metadataJson: jsonb("metadata_json").notNull().default({}),
  },
  (t) => [
    uniqueIndex("individual_runs_unique").on(t.suiteRunId, t.variant, t.repetition),
    index("individual_runs_status_idx").on(t.suiteRunId, t.status),
  ],
)

export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    individualRunId: uuid("individual_run_id")
      .notNull()
      .references(() => individualRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
  },
  (t) => [uniqueIndex("run_events_unique").on(t.individualRunId, t.sequence)],
)

export const evaluationResults = pgTable(
  "evaluation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    individualRunId: uuid("individual_run_id")
      .notNull()
      .references(() => individualRuns.id, { onDelete: "cascade" }),
    success: boolean("success").notNull(),
    score: doublePrecision("score").notNull(),
    assertionsJson: jsonb("assertions_json").notNull(),
    evidenceJson: jsonb("evidence_json").notNull(),
    /** What the agent claimed about itself. Recorded so the dashboard can show
     *  the gap between claim and verdict — never used to decide the verdict. */
    agentClaimJson: jsonb("agent_claim_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("evaluation_results_run_unique").on(t.individualRunId)],
)

export const projectsRelations = relations(projects, ({ many }) => ({
  agents: many(agents),
  taskDefinitions: many(taskDefinitions),
  suites: many(suites),
}))

export const suitesRelations = relations(suites, ({ one, many }) => ({
  project: one(projects, { fields: [suites.projectId], references: [projects.id] }),
  agent: one(agents, { fields: [suites.agentId], references: [agents.id] }),
  task: one(taskDefinitions, { fields: [suites.taskDefinitionId], references: [taskDefinitions.id] }),
  variants: many(suiteVariants),
  runs: many(suiteRuns),
}))

export const suiteRunsRelations = relations(suiteRuns, ({ one, many }) => ({
  suite: one(suites, { fields: [suiteRuns.suiteId], references: [suites.id] }),
  runs: many(individualRuns),
}))

export const individualRunsRelations = relations(individualRuns, ({ one, many }) => ({
  suiteRun: one(suiteRuns, { fields: [individualRuns.suiteRunId], references: [suiteRuns.id] }),
  events: many(runEvents),
  evaluation: one(evaluationResults),
}))

export type Project = typeof projects.$inferSelect
export type Agent = typeof agents.$inferSelect
export type TaskDefinitionRow = typeof taskDefinitions.$inferSelect
export type Suite = typeof suites.$inferSelect
export type SuiteVariant = typeof suiteVariants.$inferSelect
export type SuiteRun = typeof suiteRuns.$inferSelect
export type IndividualRun = typeof individualRuns.$inferSelect
export type RunEventRow = typeof runEvents.$inferSelect
export type EvaluationResultRow = typeof evaluationResults.$inferSelect

export type NewSuiteRun = typeof suiteRuns.$inferInsert
export type NewIndividualRun = typeof individualRuns.$inferInsert
export type NewRunEvent = typeof runEvents.$inferInsert
