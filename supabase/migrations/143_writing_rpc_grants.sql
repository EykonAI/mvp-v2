-- 143 · Every application RPC that writes: EXECUTE for service_role only.
--
-- The audit mig 140 owed. Method, so it can be repeated (the query is at the
-- bottom): every function in `public` that is VOLATILE or SECURITY DEFINER,
-- with its ACL, joined to a map of every `.rpc('…')` call site in apps/web
-- and the client each site uses. Findings on 2026-09-08 16:10 UTC:
--
--   · The browser never calls an RPC. Every call site is server code using
--     createServerSupabase() (the service role), directly or through an
--     `admin` parameter. No function below reads auth.uid() or the JWT.
--     Nothing user-facing depends on anon/authenticated EXECUTE on any of
--     them — so nothing breaks when it is removed.
--   · 15 writing application functions were callable with the public anon
--     key through /rest/v1/rpc/<name>. Three of them are SECURITY DEFINER,
--     which means RLS did not stand between the anon key and the write:
--       derive_port_calls (rewrites port_calls), increment_user_query_run_count,
--       prune_user_queries_older_than_90_days (deletes).
--     The other twelve run as the caller and RLS would have refused the row
--     writes — but an exposed write path that "would have been refused" is
--     still an exposed write path, and several are expensive (the FIRMS
--     derivations, the shadow-fleet refresh) or consequential
--     (complete_crypto_purchase marks a purchase paid).
--   · debit_credit and grant_fp_test_plan were already restricted — the
--     credits migration did this right; this file makes it the rule.
--
-- Deliberately NOT touched here:
--   · PostGIS management functions living in public (addauth, lockrow,
--     addgeometrycolumn, postgis_extensions_upgrade, …) — extension-owned;
--     they need table ownership or superuser to do anything, and extension
--     upgrades manage their own grants.
--   · generate_referral_code() / generate_share_token() — column DEFAULTs;
--     the inserting role needs EXECUTE on a default's function.
--   · The SECURITY DEFINER *readers* (nightlights_bbox_nightly_radiance,
--     firms_match_facility_alerts, cascade_node_sensor_status, …): they
--     expose feed data to the anon key without an account. That is a
--     tier-gating decision, not a write, and is listed for the founder.
--
-- RULE, now procedural: a function that writes is declared with
--   REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role;
-- in the migration that creates it, and this file's audit query is re-run
-- after any migration that adds a function.

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Expect every row anon = true, authenticated = true
-- (except debit_credit / grant_fp_test_plan, already false), 15 rows + 2.
-- ─────────────────────────────────────────────────────────────────────
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('derive_port_calls','prune_user_queries_older_than_90_days','increment_user_query_run_count',
                     'claim_creator_pro_free_slot','complete_crypto_purchase','firms_derive_facility_observations',
                     'firms_detect_significant_events','firms_prune_thermal_anomalies','firms_tag_facility_proximity',
                     'increment_usage_counter','refresh_ais_box_liveness','refresh_vessel_cadence','close_dark_contact_events',
                     'claim_founding_seat','claim_lifetime_seat','debit_credit','grant_fp_test_plan')
 ORDER BY p.prosecdef DESC, p.proname;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE CHANGE. Signatures are the identity arguments read from
-- pg_proc on 2026-09-08; a mismatch errors loudly rather than silently
-- revoking the wrong overload.
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- SECURITY DEFINER writers: RLS never applied
REVOKE EXECUTE ON FUNCTION public.derive_port_calls(timestamp with time zone)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_user_queries_older_than_90_days()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_user_query_run_count(uuid, uuid)             FROM PUBLIC, anon, authenticated;

-- SECURITY INVOKER writers, called only by server code with the service role
REVOKE EXECUTE ON FUNCTION public.claim_creator_pro_free_slot(uuid)                                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_crypto_purchase(uuid, text, text, text, integer)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_derive_facility_observations(date, numeric, numeric, jsonb)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_detect_significant_events(date, integer, integer, numeric, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_prune_thermal_anomalies(integer, integer, numeric, numeric)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firms_tag_facility_proximity(date, numeric, numeric)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_usage_counter(uuid, text, integer)                               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_ais_box_liveness()                                                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_vessel_cadence()                                                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_dark_contact_events(jsonb)                                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_founding_seat()                                                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_lifetime_seat()                                                      FROM PUBLIC, anon, authenticated;

-- Restated so the file is complete on its own (idempotent). pg_cron runs
-- refresh_vessel_cadence as postgres and needs no grant.
GRANT EXECUTE ON FUNCTION public.derive_port_calls(timestamp with time zone)                                TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_user_queries_older_than_90_days()                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_query_run_count(uuid, uuid)                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_creator_pro_free_slot(uuid)                                          TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_crypto_purchase(uuid, text, text, text, integer)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_derive_facility_observations(date, numeric, numeric, jsonb)          TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_detect_significant_events(date, integer, integer, numeric, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_prune_thermal_anomalies(integer, integer, numeric, numeric)          TO service_role;
GRANT EXECUTE ON FUNCTION public.firms_tag_facility_proximity(date, numeric, numeric)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage_counter(uuid, text, integer)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_ais_box_liveness()                                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_vessel_cadence()                                                   TO service_role;
GRANT EXECUTE ON FUNCTION public.close_dark_contact_events(jsonb)                                           TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_founding_seat()                                                      TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_lifetime_seat()                                                      TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect all 17 rows: anon false · authenticated false ·
-- service_role true. Then the AUDIT below must return zero rows.
-- ─────────────────────────────────────────────────────────────────────
SELECT p.proname, p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('derive_port_calls','prune_user_queries_older_than_90_days','increment_user_query_run_count',
                     'claim_creator_pro_free_slot','complete_crypto_purchase','firms_derive_facility_observations',
                     'firms_detect_significant_events','firms_prune_thermal_anomalies','firms_tag_facility_proximity',
                     'increment_usage_counter','refresh_ais_box_liveness','refresh_vessel_cadence','close_dark_contact_events',
                     'claim_founding_seat','claim_lifetime_seat','debit_credit','grant_fp_test_plan')
 ORDER BY p.prosecdef DESC, p.proname;

-- AUDIT — re-run after any migration that adds a function. Lists every
-- application-owned (non-extension) VOLATILE function in public that the
-- anon key can execute, excluding the two column-default generators.
-- Expect: zero rows.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype
   AND p.provolatile = 'v'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')   -- not extension-owned
   AND p.proname NOT IN ('generate_referral_code', 'generate_share_token')
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
 ORDER BY p.prosecdef DESC, p.proname;
