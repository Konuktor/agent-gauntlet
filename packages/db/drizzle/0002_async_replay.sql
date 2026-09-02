-- Replay becomes an asynchronously enriched artefact.
--
-- Solari publishes a recording after the session is released, and the latency
-- was observed to range from ~7s to beyond 75s. Waiting for it inside the run
-- held a finished run open and delayed metrics that the replay cannot affect.
-- The run now goes terminal at once and a sweeper enriches it afterwards.

ALTER TABLE "individual_runs" ADD COLUMN IF NOT EXISTS "replay_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "individual_runs" ADD COLUMN IF NOT EXISTS "replay_next_attempt_at" timestamp with time zone;

-- Old vocabulary -> new. `pending` and `skipped` existed but were never
-- terminal states anybody read; they map to the nearest honest equivalent.
UPDATE "individual_runs" SET "replay_status" = 'not_requested' WHERE "replay_status" IN ('none', 'skipped');
UPDATE "individual_runs" SET "replay_status" = 'ready'         WHERE "replay_status" = 'available';
UPDATE "individual_runs" SET "replay_status" = 'unavailable'   WHERE "replay_status" = 'failed';
UPDATE "individual_runs" SET "replay_status" = 'processing'    WHERE "replay_status" = 'pending';

ALTER TABLE "individual_runs" ALTER COLUMN "replay_status" SET DEFAULT 'not_requested';

-- The sweeper's hot path: everything due, oldest first.
CREATE INDEX IF NOT EXISTS "individual_runs_replay_due_idx"
  ON "individual_runs" ("replay_next_attempt_at")
  WHERE "replay_status" = 'processing';
