-- 119_pass_grant_conflict_targets.sql
--
-- Week Pass and Query Pack could never be granted. Both grants upsert
-- with ON CONFLICT (purchase_id), and both target tables carry that
-- uniqueness as a PARTIAL index:
--
--   CREATE UNIQUE INDEX uq_tier_overrides_purchase
--     ON tier_overrides (purchase_id) WHERE (purchase_id IS NOT NULL);
--
-- Postgres cannot infer a partial index from a bare conflict target.
-- ON CONFLICT (purchase_id) only matches an index whose predicate is
-- ALSO stated in the statement, and PostgREST emits no predicate. So
-- every grant failed with 42P10:
--
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- Found 2026-09-06, immediately after migration-free PR #459 fixed the
-- IPN idempotency key. That fix let execution reach the grant code for
-- the FIRST TIME EVER, and it failed instantly on this second, entirely
-- independent defect. One bug was hiding another — §16.9. Neither
-- could have been found by reading: the first made the second
-- unreachable.
--
-- WHY DROPPING THE PREDICATE IS SAFE:
--   The WHERE clause was redundant. A plain UNIQUE index already
--   permits many NULLs, because SQL treats NULLs as distinct — that is
--   the default and this database does not use NULLS NOT DISTINCT
--   (PG15+ opt-in). tier_overrides currently holds 2 rows, BOTH with
--   purchase_id NULL (founder-granted fp_test plans); they remain legal
--   under a plain unique constraint for that reason.
--
-- A CONSTRAINT rather than a bare index, deliberately: ON CONFLICT can
-- infer a constraint by its columns, and a named constraint is what the
-- next person will look for when they read `onConflict: 'purchase_id'`.
--
-- Read-only rehearsal before writing this (§3.3): confirmed both
-- indexes are partial, confirmed the NULL counts above, and confirmed
-- no existing UNIQUE constraint on either column that this would
-- duplicate.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
--
-- STEP 1: apply this migration.
-- STEP 2: merge the PR.
-- STEP 3: resend the IPN for payment 4740423731.

-- ── tier_overrides (Week Pass) ───────────────────────────────────
drop index if exists public.uq_tier_overrides_purchase;

alter table public.tier_overrides
  add constraint tier_overrides_purchase_id_key unique (purchase_id);

-- ── usage_bonuses (Query Pack) ───────────────────────────────────
-- Same defect, same shape. Broken since mig 075; never surfaced because
-- no pass purchase ever reached the grant.
drop index if exists public.uq_usage_bonuses_purchase;

alter table public.usage_bonuses
  add constraint usage_bonuses_purchase_id_key unique (purchase_id);

comment on constraint tier_overrides_purchase_id_key on public.tier_overrides is
  'One override per purchase. NOT partial — a partial index cannot be inferred by ON CONFLICT (purchase_id), which is what broke every Week Pass grant until 2026-09-06. Multiple NULLs remain legal (NULLs are distinct), which is what non-purchase grants such as fp_test rely on.';

comment on constraint usage_bonuses_purchase_id_key on public.usage_bonuses is
  'One bonus per purchase. NOT partial — see tier_overrides_purchase_id_key.';
