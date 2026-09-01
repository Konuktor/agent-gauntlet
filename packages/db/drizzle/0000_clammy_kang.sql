CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"individual_run_id" uuid NOT NULL,
	"success" boolean NOT NULL,
	"score" double precision NOT NULL,
	"assertions_json" jsonb NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"agent_claim_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "individual_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_run_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"variant_name" text NOT NULL,
	"category" text NOT NULL,
	"repetition" integer NOT NULL,
	"seed" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"session_id" text,
	"sandbox_id" text,
	"geo" text,
	"replay_status" text DEFAULT 'none' NOT NULL,
	"replay_event_count" integer,
	"replay_bytes" integer,
	"replay_artifact_path" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"steps" integer,
	"error_code" text,
	"failure_category" text,
	"failure_message" text,
	"failure_explanation" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"individual_run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suite_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"mode" text NOT NULL,
	"label" text,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"passed_runs" integer DEFAULT 0 NOT NULL,
	"failed_runs" integer DEFAULT 0 NOT NULL,
	"infrastructure_errors" integer DEFAULT 0 NOT NULL,
	"reliability" double precision,
	"metrics_json" jsonb,
	"fixture_sandbox_id" text,
	"git_repo" text,
	"git_branch" text,
	"git_sha" text,
	"error_code" text,
	"error_message" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suite_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"perturbation_type" text NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_definition_id" uuid NOT NULL,
	"runs_per_variant" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"start_url" text NOT NULL,
	"max_steps" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"evaluator_config_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_individual_run_id_individual_runs_id_fk" FOREIGN KEY ("individual_run_id") REFERENCES "public"."individual_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individual_runs" ADD CONSTRAINT "individual_runs_suite_run_id_suite_runs_id_fk" FOREIGN KEY ("suite_run_id") REFERENCES "public"."suite_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_individual_run_id_individual_runs_id_fk" FOREIGN KEY ("individual_run_id") REFERENCES "public"."individual_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suite_runs" ADD CONSTRAINT "suite_runs_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suite_variants" ADD CONSTRAINT "suite_variants_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suites" ADD CONSTRAINT "suites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suites" ADD CONSTRAINT "suites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suites" ADD CONSTRAINT "suites_task_definition_id_task_definitions_id_fk" FOREIGN KEY ("task_definition_id") REFERENCES "public"."task_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_definitions" ADD CONSTRAINT "task_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_project_idx" ON "agents" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_results_run_unique" ON "evaluation_results" USING btree ("individual_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "individual_runs_unique" ON "individual_runs" USING btree ("suite_run_id","variant","repetition");--> statement-breakpoint
CREATE INDEX "individual_runs_status_idx" ON "individual_runs" USING btree ("suite_run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_unique" ON "run_events" USING btree ("individual_run_id","sequence");--> statement-breakpoint
CREATE INDEX "suite_runs_suite_idx" ON "suite_runs" USING btree ("suite_id","created_at");--> statement-breakpoint
CREATE INDEX "suite_runs_queue_idx" ON "suite_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suite_variants_unique" ON "suite_variants" USING btree ("suite_id","perturbation_type");--> statement-breakpoint
CREATE INDEX "suites_project_idx" ON "suites" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_definitions_project_idx" ON "task_definitions" USING btree ("project_id");