-- 141 · Alert transitions for the Calibration Ledger Monitor — "since when?"
--
-- The monitor's rules (lib/admin/calibration-monitor.ts · evaluateAlerts)
-- are evaluated on every read, so a red badge has no start time: the one
-- question in build-prompt §2.1 the page could not answer was "and since
-- when?". An hourly evaluator (/api/cron/evaluate-ledger-alerts) now records
-- state and transitions here, with the dedup discipline of mig 089's
-- live_feed_alerts: one row per open alert, escalation bypasses the re-alert
-- clock, recovery is said once and closes the loop. The page reads
-- first_fired_at and shows "firing since"; Discord gets fired / escalated /
-- re-alerted (crit, every LEDGER_REALERT_HOURS) / cleared, through the same
-- NEWSJACK_ALERT_WEBHOOK the feed-health alerts use.
--
-- Rendering the page NEVER writes here (the ingest-health rule): displaying
-- an alert must not advance its clock or post it.

CREATE TABLE IF NOT EXISTS public.ledger_alert_state (
  alert_id         text PRIMARY KEY,
  severity         text NOT NULL CHECK (severity IN ('warn', 'crit')),
  text             text NOT NULL,
  rule             text,
  first_fired_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz
);
ALTER TABLE public.ledger_alert_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ledger_alert_events (
  id         bigserial PRIMARY KEY,
  alert_id   text NOT NULL,
  transition text NOT NULL CHECK (transition IN ('fired', 'escalated', 'de-escalated', 're-alerted', 'cleared')),
  severity   text NOT NULL,
  text       text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  notified   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ledger_alert_events_at_idx ON public.ledger_alert_events (at DESC);
ALTER TABLE public.ledger_alert_events ENABLE ROW LEVEL SECURITY;
-- No policies on either: the service role reads and writes them, nothing else.

-- VERIFY (read-only). Both tables exist and are empty until the first
-- evaluator tick; the CHECK literals must equal the ones the code writes
-- ('warn' | 'crit'; the five transitions) — pasted in the PR body.
SELECT c.conrelid::regclass AS "table", c.conname, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
 WHERE c.conrelid IN ('public.ledger_alert_state'::regclass, 'public.ledger_alert_events'::regclass)
   AND c.contype = 'c'
 ORDER BY 1, 2;
SELECT (SELECT count(*) FROM public.ledger_alert_state) AS open_alerts,
       (SELECT count(*) FROM public.ledger_alert_events) AS transitions;
