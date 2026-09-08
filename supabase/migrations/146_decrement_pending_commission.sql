-- 146 · decrement_pending_commission(): the RPC the admin override path has
--       called since the referral programme shipped, and which never existed.
--
-- lib/admin/overrides.ts (force-cancel accrual) calls
--   rpc('decrement_pending_commission', { p_referral_id, p_cents })
-- to bring referrals.pending_commission_cents back in line with the sum of
-- pending accruals after one is forfeited. The code comment says "RPC may
-- not exist yet (added in PR 9)" and falls back to a read-then-write through
-- the query builder. PR 9's migration never carried the function: the grant
-- audit (mig 143) listed every function in public and this one was not
-- there, so every forfeit has taken the fallback — a SELECT and an UPDATE
-- with a window between them in which a concurrent accrual write is lost.
--
-- This is the atomic version the call site expects: one UPDATE, clamped at
-- zero (a counter can drift below the sum after a fallback race; it must
-- not go negative), returning the new value so the caller can log it.
-- service_role only (mig 143's rule); the override route runs on the
-- service role. The fallback in the code stays as a belt-and-braces path.

-- STEP 1 — READ ONLY. Expect fn_present 0 and a handful of referrals with a
-- pending counter (whatever the programme currently holds).
SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'decrement_pending_commission') AS fn_present,
       (SELECT count(*) FROM public.referrals WHERE pending_commission_cents > 0) AS referrals_with_pending,
       (SELECT coalesce(sum(pending_commission_cents), 0) FROM public.referrals) AS pending_total_cents;

-- STEP 2 — THE CHANGE.
BEGIN;

CREATE OR REPLACE FUNCTION public.decrement_pending_commission(p_referral_id uuid, p_cents bigint)
RETURNS bigint
LANGUAGE sql
VOLATILE
AS $$
  UPDATE public.referrals
     SET pending_commission_cents = GREATEST(0, pending_commission_cents - GREATEST(p_cents, 0)),
         updated_at = now()
   WHERE id = p_referral_id
  RETURNING pending_commission_cents;
$$;

COMMENT ON FUNCTION public.decrement_pending_commission(uuid, bigint) IS
  'Atomically reduces referrals.pending_commission_cents by p_cents (clamped at 0) after an accrual is forfeited; returns the new value. Called by lib/admin/overrides.ts on the service role (mig 146).';

REVOKE EXECUTE ON FUNCTION public.decrement_pending_commission(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.decrement_pending_commission(uuid, bigint) TO service_role;

COMMIT;

-- STEP 3 — VERIFY. Expect fn_present 1 · anon false · authenticated false ·
-- service_role true, and the mig-143 AUDIT (anon-executable VOLATILE
-- application functions) still returning zero rows.
SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'decrement_pending_commission') AS fn_present,
       has_function_privilege('anon', 'public.decrement_pending_commission(uuid, bigint)', 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', 'public.decrement_pending_commission(uuid, bigint)', 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', 'public.decrement_pending_commission(uuid, bigint)', 'EXECUTE')  AS service_role;
SELECT p.proname
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype AND p.provolatile = 'v'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
   AND p.proname NOT IN ('generate_referral_code', 'generate_share_token')
   AND has_function_privilege('anon', p.oid, 'EXECUTE');
