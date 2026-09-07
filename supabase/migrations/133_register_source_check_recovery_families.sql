-- 133 · Widen predictions_register source CHECK: + 'firms-recovery', + 'blackmarble'
--
-- The two P1 claim families shipped in #472 (mig 127) and #473 (mig 128) write
-- source='firms-recovery' and source='blackmarble'. Neither is admitted by
-- predictions_register_source_check, so the first manual run of both crons on
-- 2026-09-07 issued NOTHING:
--
--   "new row for relation "predictions_register" violates check constraint
--    "predictions_register_source_check""
--
-- on 18 FIRMS candidates and 85 night-lights candidates, every plan eligible.
--
-- THIS IS MIGRATION 113 AGAIN, and it should not have been. 113 hit this exact
-- wall with 'ais-darkgap', widened the CHECK, and wrote the rule down: "verify
-- CHECK constraints ADMIT the values you are about to write —
-- pg_get_constraintdef before writing to someone else's table." It even
-- preempted 'firms'. The families then shipped under 'firms-recovery' and
-- 'blackmarble' — new strings, same wall, rule not applied. The build cannot
-- catch a CHECK; only a runtime error can, and it did.
--
-- Read before writing this: pg_get_constraintdef shows the constraint as
-- exactly the 113 list (manual, polymarket, eia, ofac, kalshi, ai, ais,
-- ais-darkgap, firms). The resolver dispatcher already routes both new
-- sources (resolvers/index.ts: case 'firms-recovery', case 'blackmarble'),
-- so widening the CHECK is sufficient — claims will issue AND resolve. The
-- other two CHECKs (track, visibility) are satisfied: the issuers write
-- track='machine' and leave visibility to its default.
--
-- Nothing is removed. Every source currently stored is retained.


-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Expect the current definition to list exactly the nine
-- 113 values, and sources_in_use to be a subset of them.
-- ─────────────────────────────────────────────────────────────────────
select pg_get_constraintdef(oid) as current_definition
from pg_constraint
where conrelid = 'public.predictions_register'::regclass
  and conname = 'predictions_register_source_check';

select string_agg(source || ':' || n::text, ', ' order by n desc) as sources_in_use
from (select source, count(*) n from predictions_register group by source) s;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE WRITE.
-- ─────────────────────────────────────────────────────────────────────
begin;

ALTER TABLE predictions_register
  DROP CONSTRAINT predictions_register_source_check;

ALTER TABLE predictions_register
  ADD CONSTRAINT predictions_register_source_check
  CHECK (source = ANY (ARRAY[
    'manual'::text,
    'polymarket'::text,
    'eia'::text,
    'ofac'::text,
    'kalshi'::text,
    'ai'::text,
    'ais'::text,
    'ais-darkgap'::text,
    'firms'::text,
    'firms-recovery'::text,   -- mig 127 family, #472
    'blackmarble'::text       -- mig 128 families, #473
  ]));

commit;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect admits_new = 2 and no existing row rejected (0).
-- Then re-run the two curls; expect recovery_claims.issued 18 and
-- nightlights_claims.issued 85, both with error null.
-- ─────────────────────────────────────────────────────────────────────
select
  (select count(*) from unnest(array['firms-recovery','blackmarble']) v(s)
    where pg_get_constraintdef((select oid from pg_constraint
      where conrelid='public.predictions_register'::regclass
        and conname='predictions_register_source_check')) like '%''' || v.s || '''%') as admits_new,
  (select count(*) from predictions_register r
    where r.source not in ('manual','polymarket','eia','ofac','kalshi','ai','ais',
                           'ais-darkgap','firms','firms-recovery','blackmarble')) as existing_rows_rejected;
