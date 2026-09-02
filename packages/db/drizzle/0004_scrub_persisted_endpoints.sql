-- Scrub capability credentials that were persisted before the redaction fix.
--
-- A Playwright connect failure quotes the endpoint it was handed, verbatim, and
-- that text was stored as a run's failure message and served by the public API.
-- Commit 15f4806 stopped new ones from being written; this cleans the rows that
-- already exist, because a fix that only applies going forward leaves a live
-- capability sitting in a public response.
--
-- The pattern is the one the application uses (packages/config/src/redact.ts):
-- a ws/wss URL whose path names a session — /ws/, /cdp/ or /control/. The host
-- does not matter, and must not: the SDK hands back a loopback-wrapped form
-- whose path carries the same signed composite id as the public URL.

UPDATE individual_runs
   SET failure_message = regexp_replace(
         failure_message,
         'wss?://[^[:space:]"'']*/(ws|cdp|control)/[^[:space:]"'']+',
         '[redacted-session-endpoint]',
         'gi')
 WHERE failure_message ~* 'wss?://[^[:space:]"'']*/(ws|cdp|control)/';

UPDATE individual_runs
   SET failure_explanation = regexp_replace(
         failure_explanation,
         'wss?://[^[:space:]"'']*/(ws|cdp|control)/[^[:space:]"'']+',
         '[redacted-session-endpoint]',
         'gi')
 WHERE failure_explanation ~* 'wss?://[^[:space:]"'']*/(ws|cdp|control)/';

UPDATE suite_runs
   SET error_message = regexp_replace(
         error_message,
         'wss?://[^[:space:]"'']*/(ws|cdp|control)/[^[:space:]"'']+',
         '[redacted-session-endpoint]',
         'gi')
 WHERE error_message ~* 'wss?://[^[:space:]"'']*/(ws|cdp|control)/';

-- Recorder payloads are JSON; scrubbing them as text preserves their shape.
UPDATE run_events
   SET payload_json = regexp_replace(
         payload_json::text,
         'wss?://[^[:space:]"'']*/(ws|cdp|control)/[^[:space:]"'']+',
         '[redacted-session-endpoint]',
         'gi')::jsonb
 WHERE payload_json::text ~* 'wss?://[^[:space:]"'']*/(ws|cdp|control)/';
