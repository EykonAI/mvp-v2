-- IMG-11 · On-demand VHR look, capped pass-through — acceptance checks for
-- migration 194.
--
-- Build-prompt line under test: "founder buys one Umbra look end to end
-- before any customer can; hard monthly cap enforced fail-closed". READ
-- ONLY and LIGHT: BEGIN … ROLLBACK — the founder look, caps and orders here
-- are throw-away. A clean run ends with ONE RESULT ROW ("IMG-11 guards:
-- PASS 1-7 …"); 'Success. No rows returned' means it did NOT run whole.

BEGIN;

DO $$
DECLARE
  r       record;
  n       integer;
  v_a     uuid := gen_random_uuid();   -- a Desk account
  v_b     uuid := gen_random_uuid();   -- a second Desk account
  v_ord   bigint;
BEGIN
  -- ── 1. Objects and access ──────────────────────────────────────────────
  IF to_regclass('public.imagery_orders') IS NULL OR (SELECT count(*) FROM public.imagery_price_list WHERE provider_id = 'umbra') <> 21 THEN
    RAISE EXCEPTION 'FAIL 1a: orders table or the 21 Umbra list prices missing — 194 not applied';
  END IF;
  IF has_function_privilege('anon', 'public.imagery_order_request(uuid,text,text,text,numeric,integer,double precision,double precision,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.imagery_order_request(uuid,text,text,text,numeric,integer,double precision,double precision,text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.imagery_orders', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL 1b: anon/authenticated can reach orders';
  END IF;
  IF has_function_privilege('service_role', 'public.imagery_order_record_founder_look(text,text,numeric,integer,double precision,double precision,numeric,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.imagery_order_set_cap(text,numeric,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.imagery_order_set_status(bigint,text,text,text,text,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 1c: the web app (service_role) could record a founder look, set a cap or move an order';
  END IF;
  RAISE NOTICE 'PASS 1: 21 Umbra prices · request is service_role only · founder functions are not';

  -- ── 2. Before the founder's real-money look, no customer can order ─────
  IF NOT EXISTS (SELECT 1 FROM public.imagery_orders WHERE provider_id = 'umbra' AND is_founder_test AND status = 'delivered') THEN
    SELECT * INTO r FROM public.imagery_order_request(v_a, 'desk', 'umbra', 'spotlight', 1.0, 1, 26.5, 56.4);
    IF r.status <> 'refused' OR r.reason NOT LIKE 'not open yet: no founder-bought umbra look%' THEN
      RAISE EXCEPTION 'FAIL 2a: a customer order was accepted before the founder look (%)', r.reason;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.imagery_orders WHERE id = r.order_id AND status = 'refused' AND refusal_reason = r.reason) THEN
      RAISE EXCEPTION 'FAIL 2b: the refusal was not recorded as a row';
    END IF;
  END IF;
  BEGIN
    PERFORM public.imagery_order_record_founder_look('umbra', 'spotlight', 1.0, 1, 26.5, 56.4, 675, NULL, NULL, 'img11 guard');
    RAISE EXCEPTION 'FAIL 2c: a founder look without an order id / asset was recorded' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS 2: closed until a founder look is delivered · refusals are rows · a look needs order id + asset';

  PERFORM public.imagery_order_record_founder_look('umbra', 'spotlight', 1.0, 1, 26.5, 56.4, 675, 'UMB-GUARD-1', 'imagery/umbra/guard.tif', 'img11 guard');

  -- ── 3. Tier and cap gates, fail-closed ─────────────────────────────────
  SELECT * INTO r FROM public.imagery_order_request(v_a, 'pro', 'umbra', 'spotlight', 1.0, 1, 26.5, 56.4);
  IF r.status <> 'refused' OR r.reason NOT LIKE 'tier pro cannot order looks%' THEN RAISE EXCEPTION 'FAIL 3a: Pro could order (%)', r.reason; END IF;
  UPDATE public.imagery_order_caps SET monthly_usd = 0, set_by = NULL, set_at = NULL;   -- the shipped state
  SELECT * INTO r FROM public.imagery_order_request(v_a, 'desk', 'umbra', 'spotlight', 1.0, 1, 26.5, 56.4);
  IF r.status <> 'refused' OR r.reason NOT LIKE '%monthly cap is not set (0)%' THEN RAISE EXCEPTION 'FAIL 3b: ordering open with caps at 0 (%)', r.reason; END IF;
  RAISE NOTICE 'PASS 3: Pro refused · caps at 0 = closed';

  PERFORM public.imagery_order_set_cap('desk', 2000, 'img11 guard');
  PERFORM public.imagery_order_set_cap('all_accounts', 2800, 'img11 guard');

  -- ── 4. A Desk order at the LIST price, with its EULA tier ──────────────
  SELECT * INTO r FROM public.imagery_order_request(v_a, 'desk', 'umbra', 'spotlight', 1.0, 1, 26.5, 56.4, 'Hormuz');
  IF r.status <> 'requested' OR r.price_usd <> 675 OR r.eula_tier <> 'cc_by_4.0' THEN
    RAISE EXCEPTION 'FAIL 4: desk order % at $% / % — want requested at $675, cc_by_4.0', r.status, r.price_usd, r.eula_tier;
  END IF;
  v_ord := r.order_id;
  RAISE NOTICE 'PASS 4: requested at the list price $675 · EULA cc_by_4.0 recorded';

  -- ── 5. The account cap bites at the order that would cross it ──────────
  SELECT * INTO r FROM public.imagery_order_request(v_a, 'desk', 'umbra', 'spotlight', 1.0, 2, 26.5, 56.4);   -- 675 + 850 = 1525
  IF r.status <> 'requested' THEN RAISE EXCEPTION 'FAIL 5a: an order under the cap was refused (%)', r.reason; END IF;
  SELECT * INTO r FROM public.imagery_order_request(v_a, 'desk', 'umbra', 'spotlight', 1.0, 1, 26.5, 56.4);   -- 1525 + 675 = 2200 > 2000
  IF r.status <> 'refused' OR r.reason NOT LIKE 'over the desk monthly cap%' THEN RAISE EXCEPTION 'FAIL 5b: the account cap did not bite (%)', r.reason; END IF;
  -- the global cap: another account, 1525 + 950 = 2475 ≤ 2800 fits; then 2475 + 675 > 2800 does not
  SELECT * INTO r FROM public.imagery_order_request(v_b, 'desk', 'umbra', 'spotlight', 0.5, 1, 1.25, 103.9);
  IF r.status <> 'requested' THEN RAISE EXCEPTION 'FAIL 5c: second account refused under both caps (%)', r.reason; END IF;
  SELECT * INTO r FROM public.imagery_order_request(v_b, 'desk', 'umbra', 'spotlight', 1.0, 1, 1.25, 103.9);
  IF r.status <> 'refused' OR r.reason NOT LIKE 'over the all-accounts monthly cap%' THEN RAISE EXCEPTION 'FAIL 5d: the global cap did not bite (%)', r.reason; END IF;
  RAISE NOTICE 'PASS 5: account cap and all-accounts cap bite at the crossing order';

  -- ── 6. Off the price list, or licence not ok → refused ─────────────────
  SELECT * INTO r FROM public.imagery_order_request(v_b, 'enterprise', 'umbra', 'spotlight', 0.25, 5, 1.25, 103.9);
  IF r.status <> 'refused' OR r.reason NOT LIKE 'not on the price list%' THEN RAISE EXCEPTION 'FAIL 6a: an unlisted product was accepted (%)', r.reason; END IF;
  UPDATE public.imagery_licences SET commercial_status = 'unclear' WHERE provider_id = 'umbra';
  SELECT * INTO r FROM public.imagery_order_request(v_b, 'desk', 'umbra', 'spotlight', 1.0, 1, 1.25, 103.9);
  IF r.status <> 'refused' OR r.reason NOT LIKE 'provider licence is unclear%' THEN RAISE EXCEPTION 'FAIL 6b: ordered under a non-ok licence (%)', r.reason; END IF;
  RAISE NOTICE 'PASS 6: unlisted product refused · non-ok licence refused';

  -- ── 7. Fulfilment moves only forward, and delivery needs the asset ─────
  BEGIN
    PERFORM public.imagery_order_set_status(v_ord, 'delivered', 'img11 guard');
    RAISE EXCEPTION 'FAIL 7a: requested → delivered skipped submission' USING ERRCODE = 'P0002';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  PERFORM public.imagery_order_set_status(v_ord, 'submitted', 'img11 guard', 'UMB-GUARD-2');
  BEGIN
    PERFORM public.imagery_order_set_status(v_ord, 'delivered', 'img11 guard');
    RAISE EXCEPTION 'FAIL 7b: delivered without an asset path' USING ERRCODE = 'P0002';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS 7: requested → submitted → delivered only, delivery needs the asset';
END
$$;

ROLLBACK;

SELECT 'IMG-11 guards: PASS 1-7 (request service_role only + founder functions not, closed until a founder look, Pro and 0-caps refused, list price + EULA recorded, account and global caps bite, unlisted/non-ok refused, forward-only fulfilment)' AS result,
       (SELECT string_agg(scope || '=' || monthly_usd, ', ' ORDER BY scope) FROM public.imagery_order_caps) AS caps_now,
       (SELECT count(*) FROM public.imagery_orders WHERE is_founder_test AND status = 'delivered') AS founder_looks;
