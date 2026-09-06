-- 123 · Close dark-contact events in ONE statement, and return how many rows
--       actually changed.
--
-- WHY
-- ---
-- The lifecycle loop in compute-shadow-fleet-scores issues one UPDATE per event,
-- sequentially, with NO error check:
--
--     await supabase.from('dark_contact_events').update({...}).eq('id', ev.id);
--     evReappeared++;
--
-- The counter increments whether or not the write landed, so the numbers the
-- route reports are increments, not effects. Observed on production 2026-09-06
-- at 22:54: the response said events_reappeared 128 / events_still_dark 0, while
-- 2,737 events sat open past their deadline in LIVE boxes (every one of them
-- 0.2 h silent), of which 1,540 qualify as reappeared and 1,197 as still_dark
-- when the same classification is run in SQL. The reported counts and the
-- database do not agree, and because errors are discarded there is no way from
-- the outside to tell which is wrong.
--
-- 9,876 sequential round-trips is also simply the wrong shape for a handler with
-- a 300 s ceiling and a Railway client that gives up at 110 s.
--
-- This replaces the loop with a single set-based UPDATE fed by a JSON array, and
-- returns the true affected row count so the caller can report an effect rather
-- than an intention.
--
-- The WHERE d.status = 'open' guard makes it idempotent: a retry cannot reopen,
-- re-close or overwrite an event another tick already settled.

BEGIN;

CREATE OR REPLACE FUNCTION public.close_dark_contact_events(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE dark_contact_events d
  SET status          = x.status,
      resolution      = x.resolution,
      closed_at       = x.closed_at,
      final_gap_hours = x.final_gap_hours,
      void_reason     = COALESCE(x.void_reason, d.void_reason)
  FROM jsonb_to_recordset(p_events) AS x(
    id              uuid,
    status          text,
    resolution      text,
    closed_at       timestamptz,
    final_gap_hours double precision,
    void_reason     text
  )
  WHERE d.id = x.id
    AND d.status = 'open';   -- idempotent: never re-close a settled event

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.close_dark_contact_events(jsonb) IS
  'Set-based close for the dark-contact lifecycle (mig 123). Replaces ~10k sequential unchecked single-row updates; returns rows actually changed so the cron reports effects, not increments.';

GRANT EXECUTE ON FUNCTION public.close_dark_contact_events(jsonb) TO service_role;

COMMIT;

-- VERIFY (after the next shadow-fleet tick):
--   SELECT count(*) FROM dark_contact_events WHERE status='open' AND deadline_at < now();
--   -- expect this to fall to ~0; anything left is a genuine open event within its window
