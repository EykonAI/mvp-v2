-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 194 · On-demand VHR "look" as a capped pass-through (Imagery
--             Layer build prompt rev A, IMG-11, founder decision F-6).
--             Requires 183.
--
-- A customer on Desk or Enterprise can REQUEST a very-high-resolution look
-- over a point; eYKON passes it through to the provider and every purchase
-- is a row in imagery_orders with the EULA tier recorded. FAIL-CLOSED at
-- every gate — imagery_order_request() records a refused row, with the
-- reason, instead of an order, when:
--
--   1 · THE REAL-MONEY TEST HAS NOT HAPPENED. No customer order until the
--       founder has bought one look from that provider end to end and
--       recorded it delivered (imagery_order_record_founder_look).
--   2 · the tier is not desk / enterprise;
--   3 · the provider's licence row is not 'ok' (today only Umbra is);
--   4 · the product is not on the price list — the price is the LIST price
--       read from imagery_price_list, never a number the client sends;
--   5 · the account's month-to-date orders plus this one exceed its tier's
--       monthly cap, or all accounts together exceed the global cap. Caps
--       default to 0 — nothing can be ordered until the founder sets them
--       (founder decision F-10). Requests are serialised with an advisory
--       lock so two requests cannot both fit under one cap.
--
-- UMBRA, read live 2026-09-27 (https://umbra.space/pricing): Spotlight
-- 5×5 km, 1.0 m 1-look $675 … 0.25 m 3-look $4,900; "We sell our data under
-- a CC by 4.0 License" — eYKON may show and redistribute a bought look with
-- the credit. EULA tier 'cc_by_4.0'.
--
-- Fulfilment is by hand for now (no Umbra Canopy credentials in eYKON):
-- the founder places the order with Umbra and moves the row through
-- imagery_order_set_status (submitted → delivered with the asset path).
--
-- ACCESS: RLS on, service_role only. APPLY: after 183, manually, whole
-- file, BEFORE merge. Then supabase/tests/img11_guards.sql — ONE row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.imagery_licences') IS NULL THEN
    RAISE EXCEPTION '194 requires 183 (imagery schema) — apply 183 first';
  END IF;
END $$;

-- ─── 1 · Price list (list prices, read from the provider) ──────────────
CREATE TABLE IF NOT EXISTS public.imagery_price_list (
  provider_id    text        NOT NULL REFERENCES public.imagery_licences (provider_id),
  product        text        NOT NULL,
  resolution_m   numeric     NOT NULL,
  looks          integer     NOT NULL,
  footprint      text        NOT NULL,
  price_usd      numeric     NOT NULL,
  eula_tier      text        NOT NULL,
  source_url     text        NOT NULL,
  read_on        date        NOT NULL,
  PRIMARY KEY (provider_id, product, resolution_m, looks),
  CONSTRAINT ipl_price CHECK (price_usd > 0),
  CONSTRAINT ipl_looks CHECK (looks >= 1),
  CONSTRAINT ipl_eula CHECK (eula_tier IN ('cc_by_4.0', 'internal_only', 'display_licensed', 'public_release'))
);

INSERT INTO public.imagery_price_list (provider_id, product, resolution_m, looks, footprint, price_usd, eula_tier, source_url, read_on)
SELECT 'umbra', 'spotlight', r, l, '5x5 km', p, 'cc_by_4.0', 'https://umbra.space/pricing', DATE '2026-09-27'
  FROM (VALUES
    (1.0, 1, 675), (1.0, 2, 850), (1.0, 3, 1000), (1.0, 4, 1200), (1.0, 5, 1350), (1.0, 8, 1850), (1.0, 10, 2200),
    (0.5, 1, 950), (0.5, 2, 1200), (0.5, 3, 1400), (0.5, 4, 1650), (0.5, 5, 1900), (0.5, 8, 2600),
    (0.35, 1, 1750), (0.35, 2, 2200), (0.35, 3, 2650), (0.35, 4, 3050), (0.35, 5, 3500),
    (0.25, 1, 3250), (0.25, 2, 4050), (0.25, 3, 4900)
  ) AS v(r, l, p)
ON CONFLICT DO NOTHING;

-- ─── 2 · Caps (0 = closed until the founder sets them, F-10) ───────────
CREATE TABLE IF NOT EXISTS public.imagery_order_caps (
  scope        text        PRIMARY KEY,
  monthly_usd  numeric     NOT NULL DEFAULT 0,
  set_by       text,
  set_at       timestamptz,
  CONSTRAINT ioc_scope CHECK (scope IN ('desk', 'enterprise', 'all_accounts')),
  CONSTRAINT ioc_cap CHECK (monthly_usd >= 0),
  CONSTRAINT ioc_set_pair CHECK ((set_by IS NULL) = (set_at IS NULL))
);
INSERT INTO public.imagery_order_caps (scope) VALUES ('desk'), ('enterprise'), ('all_accounts') ON CONFLICT DO NOTHING;

-- ─── 3 · Orders ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imagery_orders (
  id                 bigserial   PRIMARY KEY,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  user_id            uuid,
  tier               text,
  is_founder_test    boolean     NOT NULL DEFAULT false,
  provider_id        text        REFERENCES public.imagery_licences (provider_id),
  product            text        NOT NULL,
  resolution_m       numeric,
  looks              integer,
  latitude           double precision,
  longitude          double precision,
  price_usd          numeric,
  eula_tier          text,
  status             text        NOT NULL,
  refusal_reason     text,
  provider_order_id  text,
  asset_path         text,
  price_paid_usd     numeric,
  note               text,
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT io_status CHECK (status IN ('refused', 'requested', 'submitted', 'delivered', 'failed', 'cancelled')),
  CONSTRAINT io_refused_has_reason CHECK ((status = 'refused') = (refusal_reason IS NOT NULL)),
  -- every order that is not a refusal carries its list price and EULA tier
  CONSTRAINT io_priced CHECK (status = 'refused' OR (provider_id IS NOT NULL AND price_usd > 0 AND eula_tier IS NOT NULL)),
  CONSTRAINT io_eula CHECK (eula_tier IS NULL OR eula_tier IN ('cc_by_4.0', 'internal_only', 'display_licensed', 'public_release')),
  CONSTRAINT io_delivered_has_asset CHECK (status <> 'delivered' OR (asset_path IS NOT NULL AND provider_order_id IS NOT NULL)),
  CONSTRAINT io_customer_has_account CHECK (is_founder_test OR user_id IS NOT NULL),
  CONSTRAINT io_latlon CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);
CREATE INDEX IF NOT EXISTS imagery_orders_user_month_idx ON public.imagery_orders (user_id, requested_at);

COMMENT ON TABLE public.imagery_orders IS
  'IMG-11 (mig 194). Every VHR look requested, refused or bought — one row, with its list price and EULA tier. Refusals are rows too (the reason is the record). is_founder_test marks the founder''s real-money test purchase, which must be delivered before any customer order is accepted.';

-- ─── 4 · Request (the only way a customer order is created) ────────────
CREATE OR REPLACE FUNCTION public.imagery_order_request(
  p_user uuid, p_tier text, p_provider text, p_product text, p_resolution_m numeric, p_looks integer,
  p_lat double precision, p_lon double precision, p_note text DEFAULT NULL)
RETURNS TABLE (order_id bigint, status text, price_usd numeric, eula_tier text, reason text)
LANGUAGE plpgsql
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  v_reason   text;
  v_price    record;
  v_licence  text;
  v_cap_acct numeric;
  v_cap_all  numeric;
  v_mtd_acct numeric;
  v_mtd_all  numeric;
  v_month    timestamptz := date_trunc('month', now());
  v_id       bigint;
BEGIN
  -- serialise every request, so two cannot both fit under one cap
  PERFORM pg_advisory_xact_lock(hashtext('imagery_order_request'));

  SELECT l.commercial_status INTO v_licence FROM public.imagery_licences l WHERE l.provider_id = p_provider;
  SELECT * INTO v_price FROM public.imagery_price_list pl
   WHERE pl.provider_id = p_provider AND pl.product = p_product AND pl.resolution_m = p_resolution_m AND pl.looks = p_looks;
  SELECT c.monthly_usd INTO v_cap_acct FROM public.imagery_order_caps c WHERE c.scope = p_tier;
  SELECT c.monthly_usd INTO v_cap_all  FROM public.imagery_order_caps c WHERE c.scope = 'all_accounts';
  SELECT coalesce(sum(o.price_usd), 0) INTO v_mtd_acct FROM public.imagery_orders o
   WHERE o.user_id = p_user AND o.requested_at >= v_month AND o.status IN ('requested', 'submitted', 'delivered');
  SELECT coalesce(sum(o.price_usd), 0) INTO v_mtd_all FROM public.imagery_orders o
   WHERE NOT o.is_founder_test AND o.requested_at >= v_month AND o.status IN ('requested', 'submitted', 'delivered');

  v_reason := CASE
    WHEN p_user IS NULL THEN 'no account'
    WHEN NOT EXISTS (SELECT 1 FROM public.imagery_orders f
                      WHERE f.provider_id = p_provider AND f.is_founder_test AND f.status = 'delivered')
      THEN 'not open yet: no founder-bought ' || coalesce(p_provider, '?') || ' look has been delivered end to end'
    WHEN p_tier IS NULL OR p_tier NOT IN ('desk', 'enterprise') THEN 'tier ' || coalesce(p_tier, 'unknown') || ' cannot order looks (Desk and Enterprise only)'
    WHEN v_licence IS DISTINCT FROM 'ok' THEN 'provider licence is ' || coalesce(v_licence, 'missing') || ', not ok'
    WHEN v_price.provider_id IS NULL THEN 'not on the price list: ' || coalesce(p_product, '?') || ' ' || coalesce(p_resolution_m::text, '?') || ' m ' || coalesce(p_looks::text, '?') || '-look'
    WHEN p_lat IS NULL OR p_lon IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lon NOT BETWEEN -180 AND 180 THEN 'no valid point to image'
    WHEN v_cap_acct IS NULL OR v_cap_acct <= 0 THEN 'the ' || p_tier || ' monthly cap is not set (0) — ordering is closed'
    WHEN v_mtd_acct + v_price.price_usd > v_cap_acct
      THEN format('over the %s monthly cap: $%s this month + $%s > $%s', p_tier, v_mtd_acct, v_price.price_usd, v_cap_acct)
    WHEN v_cap_all IS NULL OR v_cap_all <= 0 THEN 'the all-accounts monthly cap is not set (0) — ordering is closed'
    WHEN v_mtd_all + v_price.price_usd > v_cap_all
      THEN format('over the all-accounts monthly cap: $%s this month + $%s > $%s', v_mtd_all, v_price.price_usd, v_cap_all)
  END;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.imagery_orders (user_id, tier, provider_id, product, resolution_m, looks, latitude, longitude, status, refusal_reason, note)
    VALUES (p_user, p_tier,
            CASE WHEN EXISTS (SELECT 1 FROM public.imagery_licences l2 WHERE l2.provider_id = p_provider) THEN p_provider END,
            coalesce(p_product, '?'), p_resolution_m, p_looks,
            CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lon BETWEEN -180 AND 180 THEN p_lat END,
            CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lon BETWEEN -180 AND 180 THEN p_lon END,
            'refused', v_reason, left(p_note, 500))
    RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, 'refused'::text, NULL::numeric, NULL::text, v_reason;
    RETURN;
  END IF;

  INSERT INTO public.imagery_orders (user_id, tier, provider_id, product, resolution_m, looks, latitude, longitude,
                                     price_usd, eula_tier, status, note)
  VALUES (p_user, p_tier, p_provider, p_product, p_resolution_m, p_looks, p_lat, p_lon,
          v_price.price_usd, v_price.eula_tier, 'requested', left(p_note, 500))
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, 'requested'::text, v_price.price_usd, v_price.eula_tier,
                      'requested at the list price; eYKON places it with the provider by hand'::text;
END
$function$;

-- ─── 5 · The founder's real-money look, and fulfilment ─────────────────
CREATE OR REPLACE FUNCTION public.imagery_order_record_founder_look(
  p_provider text, p_product text, p_resolution_m numeric, p_looks integer, p_lat double precision, p_lon double precision,
  p_price_paid_usd numeric, p_provider_order_id text, p_asset_path text, p_by text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_price record;
  v_id    bigint;
BEGIN
  IF p_by IS NULL OR length(btrim(p_by)) = 0 THEN RAISE EXCEPTION 'record_founder_look: say who bought it (p_by)'; END IF;
  IF p_price_paid_usd IS NULL OR p_price_paid_usd <= 0 THEN RAISE EXCEPTION 'record_founder_look: a real-money test needs the price actually paid'; END IF;
  IF p_provider_order_id IS NULL OR p_asset_path IS NULL THEN
    RAISE EXCEPTION 'record_founder_look: a look is delivered only with the provider order id and the asset path';
  END IF;
  SELECT * INTO v_price FROM public.imagery_price_list pl
   WHERE pl.provider_id = p_provider AND pl.product = p_product AND pl.resolution_m = p_resolution_m AND pl.looks = p_looks;
  IF v_price.provider_id IS NULL THEN RAISE EXCEPTION 'record_founder_look: % % % m %-look is not on the price list', p_provider, p_product, p_resolution_m, p_looks; END IF;
  INSERT INTO public.imagery_orders (is_founder_test, provider_id, product, resolution_m, looks, latitude, longitude,
                                     price_usd, eula_tier, status, provider_order_id, asset_path, price_paid_usd, updated_by, note)
  VALUES (true, p_provider, p_product, p_resolution_m, p_looks, p_lat, p_lon, v_price.price_usd, v_price.eula_tier,
          'delivered', p_provider_order_id, p_asset_path, p_price_paid_usd, btrim(p_by), 'founder real-money test (F-6)')
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.imagery_order_set_status(
  p_order_id bigint, p_status text, p_by text, p_provider_order_id text DEFAULT NULL, p_asset_path text DEFAULT NULL,
  p_price_paid_usd numeric DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_old text;
BEGIN
  IF p_by IS NULL OR length(btrim(p_by)) = 0 THEN RAISE EXCEPTION 'imagery_order_set_status: say who (p_by)'; END IF;
  SELECT o.status INTO v_old FROM public.imagery_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'imagery_order_set_status: no order %', p_order_id; END IF;
  IF NOT ((v_old = 'requested' AND p_status IN ('submitted', 'cancelled'))
       OR (v_old = 'submitted' AND p_status IN ('delivered', 'failed'))) THEN
    RAISE EXCEPTION 'imagery_order_set_status: % → % is not allowed', v_old, p_status;
  END IF;
  UPDATE public.imagery_orders o
     SET status = p_status,
         provider_order_id = coalesce(p_provider_order_id, o.provider_order_id),
         asset_path = coalesce(p_asset_path, o.asset_path),
         price_paid_usd = coalesce(p_price_paid_usd, o.price_paid_usd),
         updated_by = btrim(p_by), updated_at = now()
   WHERE o.id = p_order_id;
  RETURN v_old || ' → ' || p_status;
END
$function$;

CREATE OR REPLACE FUNCTION public.imagery_order_set_cap(p_scope text, p_monthly_usd numeric, p_by text)
RETURNS TABLE (scope text, monthly_usd numeric, set_by text, set_at timestamptz)
LANGUAGE sql
SET search_path = public
AS $function$
  UPDATE public.imagery_order_caps c
     SET monthly_usd = p_monthly_usd, set_by = nullif(btrim(p_by), ''), set_at = CASE WHEN nullif(btrim(p_by), '') IS NULL THEN NULL ELSE now() END
   WHERE c.scope = p_scope
  RETURNING c.scope, c.monthly_usd, c.set_by, c.set_at
$function$;

-- ─── 6 · Access ────────────────────────────────────────────────────────
ALTER TABLE public.imagery_price_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imagery_order_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imagery_orders     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imagery_price_list, public.imagery_order_caps, public.imagery_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.imagery_price_list, public.imagery_order_caps, public.imagery_orders TO service_role;

REVOKE EXECUTE ON FUNCTION public.imagery_order_request(uuid, text, text, text, numeric, integer, double precision, double precision, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_order_record_founder_look(text, text, numeric, integer, double precision, double precision, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_order_set_status(bigint, text, text, text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_order_set_cap(text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_order_request(uuid, text, text, text, numeric, integer, double precision, double precision, text) TO service_role;
-- The founder-only functions are revoked from service_role EXPLICITLY —
-- Supabase's default privileges grant it EXECUTE on every new function — so
-- the web app cannot record a founder look, move an order or change a cap.
-- They run as postgres, in the SQL Editor, by the founder.
REVOKE EXECUTE ON FUNCTION public.imagery_order_record_founder_look(text, text, numeric, integer, double precision, double precision, numeric, text, text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.imagery_order_set_status(bigint, text, text, text, text, numeric) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.imagery_order_set_cap(text, numeric, text) FROM service_role;

COMMIT;

-- VERIFY (read only)
SELECT (SELECT count(*) FROM public.imagery_price_list WHERE provider_id = 'umbra')                AS umbra_prices,
       (SELECT min(price_usd) || '–' || max(price_usd) FROM public.imagery_price_list)            AS price_range_usd,
       (SELECT string_agg(scope || '=' || monthly_usd, ', ' ORDER BY scope) FROM public.imagery_order_caps) AS caps,
       (SELECT count(*) FROM public.imagery_orders WHERE is_founder_test AND status = 'delivered') AS founder_looks_delivered;
