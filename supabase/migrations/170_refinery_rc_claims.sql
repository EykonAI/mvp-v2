-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 170 · refinery-rc: the resolver, then the source; refinery
--             sites leave the night-lights families; the decision on record
--             (Reality Check programme, PR-5, file 2 of 2; D-7, §3.5)
--
-- RESOLVER FIRST, SOURCE SECOND (§3.5). This file creates the resolution
-- rule (refinery_rc_resolution) and only then admits 'refinery-rc' through
-- predictions_register_source_check; the TypeScript resolver that calls it
-- (lib/predictions/resolvers/refinery-rc.ts) and its case in
-- resolvers/index.ts ship in the same PR. The same PR changes the scorer's
-- default: a source with no resolver case now resolves VOID ("no resolver"),
-- never resolveManual's flat 0.5. Read 2026-09-19: no stored claim relies on
-- the default — the register holds ais 41 · ais-darkgap 76,939 · blackmarble
-- 352 · eia 18 · firms-recovery 171 · polymarket 2, and every one of those
-- sources has a case. 'kalshi' and 'ai' are admitted by the CHECK with no
-- resolver and no rows; the default would have scored them 0.5.
--
-- THE FOUR FAMILIES (§3.5; founder 2026-09-18/19: every claim type issues
-- from launch, near-certain included, all in the machine-track headline).
-- A claim is issued by the TypeScript tick (lib/reality-check/claims.ts) on
-- an issuing tick for every complex that qualifies — no selection — with
-- p = (k + 20 x 0.5) / (n + 20) from its family's judged record
-- (refinery_rc_walkforward, mig 169), k and n frozen into context.
--   rc_heat_dark_persists  every thermally dark complex (REFUTED or LEAD):
--       over the 14 FIRMS days after the FIRMS clock at issue, the heat rate
--       stays below 0.60 x the tick's baseline heat rate.
--       VOID when fewer than 12 of the 14 days carry a usable row.
--   rc_site_stays_lit      every REFUTED complex: over the 14 Black Marble
--       nights after the tick's data clock, the median usable clear-night
--       radiance stays at or above 0.60 x the tick's baseline median.
--   rc_lead_light_persists every LEAD complex: the same median stays below
--       0.60 x the baseline median.
--       Both light families: VOID with fewer than 3 usable clear nights that
--       carry a retrieval (radiance NOT NULL — zero is a value, D-4).
--   rc_refutation_holds    every REFUTED complex (near-certain): the complex
--       is not a LEAD in either of the next two published ticks.
--       VOID when it is VOID (or absent) in both.
-- Every family: VOID when the complex key has been retired (merged or
-- dissolved) — §3.2, "void every open claim on the retired key" — and VOID
-- with the instrument named when the window is still unpublished 45 days
-- after it ends (the data-clock rule of #482). Before that: DEFER (the
-- scorer retries), never a verdict on a window the instrument has not
-- finished. A claim resolves over the MEMBERS FROZEN ON IT at issue, not
-- the complex's later membership.
--
-- REFINERY SITES LEAVE THE NIGHT-LIGHTS FAMILIES (§3.5 "one observable, one
-- claim"). The night-lights claims are issued by
-- app/api/cron/detect-nightlights-significance from nightlights_significant_sites.
-- That view gains has_refinery (appended; nothing else changes) and the
-- route declines those candidates with a stated reason; a BEFORE INSERT
-- trigger refuses any new source='blackmarble' claim whose site_key is a
-- refinery's coordinates (facility_type 'refinery', any site_type). Read
-- 2026-09-19: 21 of the 352 night-lights claims were at refinery sites
-- (first_light 4, recovery 17); the 5 still open are left to resolve.
--
-- due_unscored_predictions: 'refinery-rc' joins the data-clock sources the
-- scorer works last (mig 155 pattern) — its claims defer for days.
--
-- Idempotent. No temp tables, no session state. Apply MANUALLY in the
-- Supabase SQL Editor, the whole file, AFTER 169, BEFORE merge — and merge
-- the same day, before 10:20 UTC: from the moment this file is applied, the
-- deployed night-lights route (which does not yet skip refinery sites) would
-- have its daily batch refused by the trigger if a refinery site is among its
-- candidates. Paste back the VERIFY rows (one SELECT, last).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ─── 1 · The resolution rule (read-only; the TypeScript resolver calls it) ─
CREATE OR REPLACE FUNCTION public.refinery_rc_resolution(
  p_feature text,
  p_context jsonb,
  p_now     timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  c_stale_days CONSTANT integer := 45;   -- = INSTRUMENT_STALE_DAYS, lib/predictions/resolvers/data-clock.ts
  c_days       CONSTANT integer := 14;
  v_key        text := p_context->>'cluster_key';
  v_members    text[];
  v_ws         date;
  v_we         date;
  v_clock      date;
  v_stale      boolean;
  v_rc         record;
  v_final      integer;
  v_cov        integer;
  v_heat       integer;
  v_bf         integer;
  v_bh         integer;
  v_bmed       numeric;
  v_wmed       numeric;
  v_runs       bigint[];
  v_clocks     date[];
  v_verdicts   text[];
BEGIN
  IF p_feature IS NULL OR p_feature NOT IN ('rc_heat_dark_persists', 'rc_site_stays_lit',
                                            'rc_lead_light_persists', 'rc_refutation_holds') THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             'unknown refinery-rc family ' || coalesce(p_feature, 'null') || ' — no resolution rule');
  END IF;

  BEGIN
    v_ws    := (p_context->>'window_start')::date;
    v_we    := (p_context->>'window_end')::date;
    v_bf    := (p_context->>'baseline_firms_days')::int;
    v_bh    := (p_context->>'baseline_heat_days')::int;
    v_bmed  := (p_context->>'baseline_median')::numeric;
    v_clock := (p_context->>'tick_data_clock')::date;
    SELECT array_agg(x ORDER BY x) INTO v_members
      FROM jsonb_array_elements_text(p_context->'members') AS x;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             'refinery-rc claim context is malformed (' || SQLERRM || ') — not evidence about the site');
  END;
  IF v_key IS NULL OR v_ws IS NULL OR v_we IS NULL OR v_we - v_ws + 1 <> c_days
     OR coalesce(cardinality(v_members), 0) = 0 THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             'refinery-rc claim missing cluster_key / members / a 14-day window_start..window_end — not evidence about the site');
  END IF;

  -- a retired key's open claims are VOID (§3.2): a merge or a dissolution
  -- changes the observable, and the claim's population no longer exists
  SELECT c.cluster_key, c.retired_at, c.retired_reason, c.merged_into INTO v_rc
    FROM refinery_complexes c WHERE c.cluster_key = v_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason', 'no refinery complex ' || v_key);
  END IF;
  IF v_rc.retired_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             format('complex %s was retired (%s%s) on %s — its population no longer exists; open claims on a retired key are VOID',
                    v_key, v_rc.retired_reason,
                    CASE WHEN v_rc.merged_into IS NOT NULL THEN ' into ' || v_rc.merged_into ELSE '' END,
                    to_char(v_rc.retired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')));
  END IF;

  v_stale := p_now > ((v_we + c_stale_days)::timestamp AT TIME ZONE 'UTC');

  -- ── heat: the next 14 FIRMS days ───────────────────────────────────────
  IF p_feature = 'rc_heat_dark_persists' THEN
    IF v_bf IS NULL OR v_bh IS NULL OR v_bf <= 0 OR v_bh <= 0 THEN
      RETURN jsonb_build_object('state', 'void', 'void_reason',
               'rc_heat_dark_persists claim missing its frozen baseline heat days — not evidence about the site');
    END IF;
    SELECT count(*) FILTER (WHERE s.is_final) INTO v_final
      FROM sensor_night_census s
     WHERE s.sensor = 'firms' AND s.facility_type = 'refinery' AND s.night BETWEEN v_ws AND v_we;
    IF v_final < c_days THEN
      IF v_stale THEN
        RETURN jsonb_build_object('state', 'void', 'void_reason',
                 format('FIRMS finalised only %s of the 14 days %s..%s, %s days after the window — instrument did not publish the window, not looked',
                        v_final, v_ws, v_we, (p_now::date - v_we)));
      END IF;
      RETURN jsonb_build_object('state', 'defer', 'reason', format('FIRMS days final: %s of 14', v_final));
    END IF;
    SELECT count(*), count(*) FILTER (WHERE d.heat) INTO v_cov, v_heat
      FROM (SELECT f.period, bool_or(f.detection_count > 0) AS heat
              FROM firms_facility_observations f
              JOIN sensor_usable_nights u
                ON u.sensor = 'firms' AND u.facility_type = 'refinery' AND u.night = f.period
             WHERE f.facility_type = 'refinery'
               AND f.facility_id = ANY (v_members)
               AND f.period BETWEEN v_ws AND v_we
             GROUP BY f.period) d;
    IF v_cov < 12 THEN
      RETURN jsonb_build_object('state', 'void', 'void_reason',
               format('%s of the 14 FIRMS days %s..%s carry a usable row for %s (needs 12) — not looked, not dark',
                      v_cov, v_ws, v_we, v_key));
    END IF;
    RETURN jsonb_build_object('state', 'ready',
             'observed', CASE WHEN 5 * v_heat * v_bf < 3 * v_bh * v_cov THEN 1 ELSE 0 END,
             'evidence', jsonb_build_object('firms_days', v_cov, 'heat_days', v_heat,
                                            'baseline_heat_days', v_bh, 'baseline_firms_days', v_bf,
                                            'rule', 'heat rate < 0.60 x baseline heat rate (5*wh*bf < 3*bh*wf)'));
  END IF;

  -- ── light: the next 14 Black Marble nights ─────────────────────────────
  IF p_feature IN ('rc_site_stays_lit', 'rc_lead_light_persists') THEN
    IF v_bmed IS NULL OR v_bmed < 0 THEN
      RETURN jsonb_build_object('state', 'void', 'void_reason',
               p_feature || ' claim missing its frozen baseline median — not evidence about the site');
    END IF;
    SELECT count(*) FILTER (WHERE s.is_final) INTO v_final
      FROM sensor_night_census s
     WHERE s.sensor = 'blackmarble' AND s.facility_type = 'refinery' AND s.night BETWEEN v_ws AND v_we;
    IF v_final < c_days THEN
      IF v_stale THEN
        RETURN jsonb_build_object('state', 'void', 'void_reason',
                 format('Black Marble finalised only %s of the 14 nights %s..%s, %s days after the window — instrument did not publish the window, not looked',
                        v_final, v_ws, v_we, (p_now::date - v_we)));
      END IF;
      RETURN jsonb_build_object('state', 'defer', 'reason', format('Black Marble nights final: %s of 14', v_final));
    END IF;
    -- per usable night: the MEDIAN over the frozen members' clear retrievals;
    -- then the median over those nights. No average anywhere.
    SELECT count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY n.m)::numeric
      INTO v_cov, v_wmed
      FROM (SELECT b.period, percentile_cont(0.5) WITHIN GROUP (ORDER BY b.radiance) AS m
              FROM blackmarble_facility_radiance b
              JOIN sensor_usable_nights u
                ON u.sensor = 'blackmarble' AND u.facility_type = 'refinery' AND u.night = b.period
             WHERE b.facility_type = 'refinery'
               AND b.facility_id = ANY (v_members)
               AND b.period BETWEEN v_ws AND v_we
               AND b.cloud_confidence = 'confident_clear'
               AND b.radiance IS NOT NULL
             GROUP BY b.period) n;
    IF v_cov < 3 THEN
      RETURN jsonb_build_object('state', 'void', 'void_reason',
               format('%s usable clear night(s) carrying a retrieval for %s in %s..%s (needs 3) — cloud or no retrieval, not darkness',
                      v_cov, v_key, v_ws, v_we));
    END IF;
    RETURN jsonb_build_object('state', 'ready',
             'observed', CASE WHEN p_feature = 'rc_site_stays_lit'
                              THEN CASE WHEN 5 * v_wmed >= 3 * v_bmed THEN 1 ELSE 0 END
                              ELSE CASE WHEN 5 * v_wmed <  3 * v_bmed THEN 1 ELSE 0 END END,
             'evidence', jsonb_build_object('usable_clear_nights', v_cov, 'window_median', round(v_wmed, 4),
                                            'baseline_median', v_bmed,
                                            'rule', CASE WHEN p_feature = 'rc_site_stays_lit'
                                                         THEN 'window median >= 0.60 x baseline median'
                                                         ELSE 'window median < 0.60 x baseline median' END));
  END IF;

  -- ── refutation holds: the next two published ticks ─────────────────────
  IF v_clock IS NULL THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             'rc_refutation_holds claim missing tick_data_clock — not evidence about the site');
  END IF;
  -- the first two data clocks after the claim's tick; at each, the latest
  -- complete run (a superseding tick replaces the one it supersedes)
  SELECT array_agg(x.id ORDER BY x.data_clock_night), array_agg(x.data_clock_night ORDER BY x.data_clock_night)
    INTO v_runs, v_clocks
    FROM (SELECT DISTINCT ON (r.data_clock_night) r.id, r.data_clock_night
            FROM reality_check_runs r
           WHERE r.asset_class = 'refinery' AND r.status = 'complete' AND r.data_clock_night > v_clock
           ORDER BY r.data_clock_night, r.id DESC
           LIMIT 2) x;
  IF coalesce(cardinality(v_runs), 0) < 2 THEN
    IF v_stale THEN
      RETURN jsonb_build_object('state', 'void', 'void_reason',
               format('%s tick(s) published after the data clock %s by %s — the next two ticks never came, not looked',
                      coalesce(cardinality(v_runs), 0), v_clock, p_now::date));
    END IF;
    RETURN jsonb_build_object('state', 'defer', 'reason',
             format('ticks published after %s: %s of 2', v_clock, coalesce(cardinality(v_runs), 0)));
  END IF;
  SELECT array_agg(coalesce(v.verdict, 'ABSENT') ORDER BY u.o) INTO v_verdicts
    FROM unnest(v_runs) WITH ORDINALITY AS u(id, o)
    LEFT JOIN reality_check_site_verdicts v ON v.run_id = u.id AND v.cluster_key = v_key;
  IF 'LEAD' = ANY (v_verdicts) THEN
    RETURN jsonb_build_object('state', 'ready', 'observed', 0,
             'evidence', jsonb_build_object('runs', to_jsonb(v_runs), 'data_clocks', to_jsonb(v_clocks),
                                            'verdicts', to_jsonb(v_verdicts)));
  END IF;
  IF (v_verdicts[1] LIKE 'VOID_%' OR v_verdicts[1] = 'ABSENT')
     AND (v_verdicts[2] LIKE 'VOID_%' OR v_verdicts[2] = 'ABSENT') THEN
    RETURN jsonb_build_object('state', 'void', 'void_reason',
             format('%s was %s and %s in the next two ticks (runs %s, %s) — not observed, not held',
                    v_key, v_verdicts[1], v_verdicts[2], v_runs[1], v_runs[2]));
  END IF;
  RETURN jsonb_build_object('state', 'ready', 'observed', 1,
           'evidence', jsonb_build_object('runs', to_jsonb(v_runs), 'data_clocks', to_jsonb(v_clocks),
                                          'verdicts', to_jsonb(v_verdicts)));
END;
$function$;

COMMENT ON FUNCTION public.refinery_rc_resolution(text, jsonb, timestamptz) IS
  'Reality Check PR-5 (mig 170): the resolution rule for the four refinery-rc families, read-only. Returns {state: ready|defer|void, observed, void_reason, evidence}. Resolves over the members frozen on the claim; VOID on a retired key, on thin coverage (< 12 of 14 FIRMS days; < 3 usable clear nights with a retrieval; VOID in both next ticks) and on a window still unpublished 45 days after it ends; DEFER before that. Called by lib/predictions/resolvers/refinery-rc.ts. Service role only.';

REVOKE EXECUTE ON FUNCTION public.refinery_rc_resolution(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refinery_rc_resolution(text, jsonb, timestamptz) TO service_role;

-- ─── 2 · … and only now the source (every existing value kept) ─────────
ALTER TABLE public.predictions_register DROP CONSTRAINT IF EXISTS predictions_register_source_check;
ALTER TABLE public.predictions_register
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
    'blackmarble'::text,      -- mig 128 families, #473
    'refinery-rc'::text       -- mig 170: Reality Check families (resolver above)
  ])) NOT VALID;
ALTER TABLE public.predictions_register VALIDATE CONSTRAINT predictions_register_source_check;

-- ─── 3 · The scorer works data-clock sources last (mig 155 body + one source)
CREATE OR REPLACE FUNCTION public.due_unscored_predictions(p_limit integer DEFAULT 500)
RETURNS TABLE (
  id                     uuid,
  feature                text,
  source                 text,
  predicted_distribution jsonb,
  target_observable      text,
  resolves_at            timestamptz,
  issued_at              timestamptz,
  context                jsonb,
  persona                text
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.id, r.feature, r.source, r.predicted_distribution, r.target_observable,
         r.resolves_at, r.issued_at, r.context, r.persona
  FROM predictions_register r
  WHERE r.resolves_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM prediction_outcomes o WHERE o.prediction_id = r.id
    )
  -- Sources whose resolver waits on an instrument's data clock (#482) go last:
  -- they defer for days and would otherwise hold slots on every tick (mig 155;
  -- 'refinery-rc' added by mig 170).
  ORDER BY CASE WHEN r.source IN ('blackmarble', 'firms-recovery', 'refinery-rc') THEN 1 ELSE 0 END,
           r.resolves_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
$$;

COMMENT ON FUNCTION public.due_unscored_predictions(integer) IS
  'Due, unscored claims for the scorer (mig 120); mig 155 orders data-clock-deferred sources (blackmarble, firms-recovery) after everything else so a deferring claim never starves one that can resolve; mig 170 adds refinery-rc to them.';

REVOKE EXECUTE ON FUNCTION public.due_unscored_predictions(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.due_unscored_predictions(integer) TO service_role;

-- ─── 4 · Refinery sites leave the night-lights families ────────────────
-- (a) the candidate view says which sites are refineries (column appended;
--     mig 094 body otherwise verbatim)
CREATE OR REPLACE VIEW public.nightlights_significant_sites AS
  SELECT site_key,
         period,
         event_type,
         (array_agg(facility_name ORDER BY length(facility_name), facility_name))[1] AS site_name,
         (array_agg(country ORDER BY (country IS NULL), country))[1]                  AS country,
         count(*)                        AS unit_rows,
         max(latitude)                   AS latitude,
         max(longitude)                  AS longitude,
         max(observed_radiance)          AS observed_radiance,
         max(baseline_mean)              AS baseline_mean,
         max(baseline_nights)            AS baseline_nights,
         max(deviation_sigma)            AS deviation_sigma,
         max(dark_nights)                AS dark_nights,
         min(created_at)                 AS first_seen_at,
         -- mig 170: a refinery site's light is scored by refinery-rc, not here
         bool_or(facility_type = 'refinery') AS has_refinery
    FROM nightlights_significant_events_sited
   WHERE site_key IS NOT NULL
   GROUP BY site_key, period, event_type;

COMMENT ON VIEW public.nightlights_significant_sites IS
  'One row per PHYSICAL SITE per night per event type — the honest unit for any count. unit_rows records how many registry rows collapsed into it. Reading nightlights_significant_events directly over-counts ~4x. See migration 094. has_refinery (mig 170): a refinery row sits at the site — such sites no longer receive night-lights claims (refinery-rc scores them).';

-- (b) the fence: a new night-lights claim at a refinery's coordinates is refused
CREATE OR REPLACE FUNCTION public.refuse_nightlights_claim_at_refinery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.source = 'blackmarble' AND EXISTS (
       SELECT 1 FROM refineries r
        WHERE (round(r.latitude::numeric, 4) || ':' || round(r.longitude::numeric, 4)) = NEW.context->>'site_key') THEN
    RAISE EXCEPTION 'night-lights claim refused: % is a refinery site — refinery sites left the night-lights families when refinery-rc began issuing (mig 170); one observable, one claim',
      NEW.context->>'site_key'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.refuse_nightlights_claim_at_refinery() IS
  'BEFORE INSERT guard (mig 170): a new source=''blackmarble'' claim whose context.site_key is a refinery''s coordinates (round(lat,4):round(lon,4), the mig-094 site key) is refused. The night-lights route declines those candidates first; this is the backstop.';

REVOKE EXECUTE ON FUNCTION public.refuse_nightlights_claim_at_refinery() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_predictions_nightlights_no_refinery ON public.predictions_register;
CREATE TRIGGER trg_predictions_nightlights_no_refinery
  BEFORE INSERT ON public.predictions_register
  FOR EACH ROW
  WHEN (NEW.source = 'blackmarble')
  EXECUTE FUNCTION public.refuse_nightlights_claim_at_refinery();

-- ─── 5 · The decision, on the record ───────────────────────────────────
INSERT INTO public.ledger_change_log (at, pr, note)
SELECT now(), '#540 · mig 170',
       'refinery-rc (mig 170): four scored machine-track families issue from the first Reality Check tick — rc_heat_dark_persists, rc_site_stays_lit, rc_lead_light_persists and the near-certain rc_refutation_holds — by founder decision (2026-09-18/19) to issue before a measured record; every family counts in the machine-track headline. p = (k + 10) / (n + 20) from each family''s judged record, Calibrating until 90 judged. Not yet measurable: refinery recall (no ground truth — recall not measured), each family''s skill (n = 0) and its split-half stability. Refinery sites leave the night-lights families; a source with no resolver now resolves VOID, never 0.5.'
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_change_log WHERE note LIKE 'refinery-rc (mig 170)%');

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — ONE SELECT (the SQL Editor shows only the last statement's rows).
-- Every row must read ok = true. Expectations measured read-only 2026-09-19.
-- ═══════════════════════════════════════════════════════════════════════
WITH checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'resolver function present (then the source)', 'true',
         (to_regprocedure('public.refinery_rc_resolution(text,jsonb,timestamp with time zone)') IS NOT NULL)::text
  UNION ALL
  SELECT 2, 'source CHECK admits refinery-rc and keeps the 11 earlier values', '12 · true',
         (SELECT (length(d) - length(replace(d, '::text', ''))) / length('::text') || ' · ' || (d LIKE '%''refinery-rc''%')::text
            FROM (SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
                   WHERE conrelid = 'public.predictions_register'::regclass
                     AND conname = 'predictions_register_source_check') x)
  UNION ALL
  SELECT 3, 'source CHECK validated', 'true',
         (SELECT convalidated::text FROM pg_constraint
           WHERE conrelid = 'public.predictions_register'::regclass AND conname = 'predictions_register_source_check')
  UNION ALL
  SELECT 4, 'due_unscored_predictions orders refinery-rc with the data-clock sources', 'true',
         (pg_get_functiondef('public.due_unscored_predictions(integer)'::regprocedure)
            LIKE '%(''blackmarble'', ''firms-recovery'', ''refinery-rc'')%')::text
  UNION ALL
  SELECT 5, 'nightlights_significant_sites.has_refinery present', 'true',
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'nightlights_significant_sites'
                    AND column_name = 'has_refinery')::text
  UNION ALL
  SELECT 6, 'night-lights refinery trigger present', 'true',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_predictions_nightlights_no_refinery'
                    AND tgrelid = 'public.predictions_register'::regclass AND NOT tgisinternal)::text
  UNION ALL
  SELECT 7, 'night-lights claims at refinery sites so far — history kept, open ones resolve (21 on 2026-09-19; more if the route issued before this file)', '>= 21',
         (SELECT count(*)::text
            FROM public.predictions_register p
           WHERE p.source = 'blackmarble'
             AND EXISTS (SELECT 1 FROM public.refineries r
                          WHERE (round(r.latitude::numeric, 4) || ':' || round(r.longitude::numeric, 4)) = p.context->>'site_key'))
  UNION ALL
  SELECT 8, 'resolution rule answers: unknown family → void', 'void',
         (public.refinery_rc_resolution('rc_nope', '{}'::jsonb)->>'state')
  UNION ALL
  SELECT 9, 'resolution rule answers: malformed claim → void', 'void',
         (public.refinery_rc_resolution('rc_site_stays_lit', '{"cluster_key":"RFC-N00-E000-1"}'::jsonb)->>'state')
  UNION ALL
  SELECT 10, 'refinery-rc claims in the register (none until the first tick)', '0',
         (SELECT count(*)::text FROM public.predictions_register WHERE source = 'refinery-rc')
  UNION ALL
  SELECT 11, 'change-log row', '1',
         (SELECT count(*)::text FROM public.ledger_change_log WHERE note LIKE 'refinery-rc (mig 170)%')
  UNION ALL
  SELECT 12, 'anon/authenticated cannot execute the resolution rule or the scorer queue', 'false',
         (has_function_privilege('anon', 'public.refinery_rc_resolution(text,jsonb,timestamp with time zone)', 'EXECUTE')
          OR has_function_privilege('authenticated', 'public.refinery_rc_resolution(text,jsonb,timestamp with time zone)', 'EXECUTE')
          OR has_function_privilege('anon', 'public.due_unscored_predictions(integer)', 'EXECUTE'))::text
)
SELECT ord, check_name, expected, actual,
       CASE WHEN ord = 7 THEN actual::int >= 21 ELSE actual = expected END AS ok
  FROM checks
 ORDER BY ord;
