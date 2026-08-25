-- 113 · Widen predictions_register source CHECK: + 'ais-darkgap', + 'firms'
--
-- PR H (#398) shipped machine-track emission with source='ais-darkgap' — and
-- every insert has failed since the first post-merge tick (2026-08-25
-- 09:03 UTC), because predictions_register_source_check allows only
-- {manual, polymarket, eia, ofac, kalshi, ai, ais}. The build cannot catch a
-- CHECK constraint; only a runtime error can. The cron fails LOUD at the
-- emission step by design (scores, events and liveness commit first), so the
-- board stayed healthy while claims_issued read 0 — visibly partial, exactly
-- the intended failure shape, but claims cannot flow until this is applied.
--
-- The lesson extends the §3.2 discipline: verify not just that COLUMNS
-- exist, but that CHECK constraints ADMIT the values you are about to write.
-- `select pg_get_constraintdef(oid) from pg_constraint where conrelid =
-- '<table>'::regclass` before writing to someone else's table.
--
-- 'firms' is added in the same widening because the identical latent bug is
-- already sitting there: resolveBySource() has a case 'firms' and a full
-- resolver, but no issuer has ever written source='firms' — the first one
-- that tries hits this same wall. Preempted while the constraint is open.
--
-- WIDEN, never narrow: every existing value stays in the list, so the change
-- is safe on a populated table (verified read-only 2026-08-25: existing
-- sources are ais=32, eia=15, polymarket=2 — all retained below).
--
-- Apply MANUALLY in the Supabase SQL Editor. Takes effect on the next hourly
-- compute-shadow-fleet-scores tick with NO deploy needed — the emitting code
-- is already live.

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
    'firms'::text
  ]));
