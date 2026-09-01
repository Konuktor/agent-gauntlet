CREATE TABLE "replay_artifacts" (
	"individual_run_id" uuid PRIMARY KEY NOT NULL,
	"compressed" "bytea" NOT NULL,
	"event_count" integer NOT NULL,
	"raw_bytes" integer NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replay_artifacts" ADD CONSTRAINT "replay_artifacts_individual_run_id_individual_runs_id_fk" FOREIGN KEY ("individual_run_id") REFERENCES "public"."individual_runs"("id") ON DELETE cascade ON UPDATE no action;