-- A visitor may bring their own Solari session or API key, so a run spends
-- their credits instead of the operator's.
--
-- Both are live capabilities, and this table is the queue between the web
-- service and the worker — so they are stored sealed (AES-256-GCM) and wiped
-- as soon as the run reaches a terminal state. The operator never becomes the
-- long-term custodian of somebody else's secret.

ALTER TABLE "suite_runs" ADD COLUMN IF NOT EXISTS "byo_kind" text;
ALTER TABLE "suite_runs" ADD COLUMN IF NOT EXISTS "byo_ciphertext" text;
ALTER TABLE "suite_runs" ADD COLUMN IF NOT EXISTS "byo_iv" text;
ALTER TABLE "suite_runs" ADD COLUMN IF NOT EXISTS "byo_tag" text;
