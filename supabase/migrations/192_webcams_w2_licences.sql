-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 192 · Webcams wave 2: licence rows and a recorded clearance
--             (Imagery Layer build prompt rev A, IMG-9). Requires 187.
--
-- THE LICENCE ROW COMES BEFORE THE CAMERA. Wave 2 adds two operators, each
-- as its OWN licence row, and neither is cleared by this migration:
--
--   ny_511     511NY (NYSDOT). The Developer's Access Agreement (read
--              2026-09-27, https://511ny.org/developers/daa) lets a company
--              "redistribute, enhance, repackage, or otherwise add value to
--              the provided data", integrity preserved, with a registered
--              developer key; it restricts use of the 511NY name and logo.
--              Status 'unclear' until the founder reads it and clears it.
--   ohio_ohgo  OHGO public API (ODOT). Terms of Use (read 2026-09-27): a free
--              service, API key required, rate-limited, revocable; silent on
--              commercial use. Status 'unclear'.
--
-- The existing us_511_platform row keeps the remaining 511 states (Georgia,
-- Louisiana, Ontario), still 'unclear'.
--
-- imagery_licence_set_status(provider, status, by, note) is the ONE way to
-- change a status: it records who and when (cleared_by / cleared_at) and
-- appends the note. An 'excluded' provider can never be re-opened. The
-- existing triggers do the rest: a camera is live only under an 'ok' row,
-- the registry cron fetches only 'ok' providers (IMG-9 code), liveness only
-- checks 'ok' providers, and a downgrade takes every camera down at once.
--
-- ACCESS: service_role only. APPLY: after 187, manually, whole file,
-- BEFORE merge. Then supabase/tests/img9_guards.sql — ONE result row.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.webcams_upsert(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '192 requires 187 (webcams wave 1) — apply 187 first';
  END IF;
END $$;

INSERT INTO public.imagery_licences
  (provider_id, provider_name, feed_kind, commercial_status, attribution_text, terms_url, notes)
VALUES
  ('ny_511', '511NY traffic cameras (New York State DOT)', 'webcam', 'unclear',
   'Traffic cameras: 511NY / New York State Department of Transportation',
   'https://511ny.org/developers/daa',
   'IMG-9 (mig 192). DAA read 2026-09-27: a company may redistribute, enhance, repackage or add value, source integrity preserved; registered developer key required (NY511_API_KEY); no use of the 511NY name/logo in our branding. Disabled cameras serve a shared placeholder PNG — excluded by the fetcher.'),
  ('ohio_ohgo', 'OHGO traffic cameras (Ohio DOT)', 'webcam', 'unclear',
   'Traffic cameras: OHGO / Ohio Department of Transportation',
   'https://publicapi.ohgo.com/docs/terms-of-use',
   'IMG-9 (mig 192). Terms of Use read 2026-09-27: free service, API key required (OHGO_API_KEY), rate-limited, access revocable; silent on commercial use.')
ON CONFLICT (provider_id) DO NOTHING;

UPDATE public.imagery_licences
   SET provider_name = '511 platform — other states (Georgia, Louisiana, Ontario)',
       notes = coalesce(notes, '') || ' · 192: 511NY and OHGO split into their own rows (ny_511, ohio_ohgo).',
       updated_at = now()
 WHERE provider_id = 'us_511_platform' AND provider_name NOT LIKE '511 platform — other states%';

CREATE OR REPLACE FUNCTION public.imagery_licence_set_status(p_provider text, p_status text, p_by text, p_note text)
RETURNS TABLE (provider_id text, commercial_status text, cleared_by text, cleared_at timestamptz, cameras_live integer)
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  v_old text;
BEGIN
  IF p_by IS NULL OR length(btrim(p_by)) = 0 THEN
    RAISE EXCEPTION 'imagery_licence_set_status: say who decides (p_by)';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN
    RAISE EXCEPTION 'imagery_licence_set_status: record why (p_note, at least a sentence)';
  END IF;
  SELECT l.commercial_status INTO v_old FROM public.imagery_licences l WHERE l.provider_id = p_provider FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'imagery_licence_set_status: unknown provider %', p_provider; END IF;
  IF v_old = 'excluded' AND p_status <> 'excluded' THEN
    RAISE EXCEPTION 'imagery_licence_set_status: % is excluded and can never be re-opened', p_provider;
  END IF;

  UPDATE public.imagery_licences l
     SET commercial_status = p_status,
         cleared_by = btrim(p_by),
         cleared_at = now(),
         notes = coalesce(l.notes || ' · ', '') || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || ' '
                 || v_old || ' → ' || p_status || ' by ' || btrim(p_by) || ': ' || btrim(p_note),
         updated_at = now()
   WHERE l.provider_id = p_provider;

  RETURN QUERY
  SELECT l.provider_id, l.commercial_status, l.cleared_by, l.cleared_at,
         (SELECT count(*)::integer FROM public.webcams w WHERE w.provider_id = l.provider_id AND w.is_live)
    FROM public.imagery_licences l WHERE l.provider_id = p_provider;
END
$function$;

COMMENT ON FUNCTION public.imagery_licence_set_status(text, text, text, text) IS
  'IMG-9 (mig 192). The one way to change a provider''s commercial status: records who and when, appends the reason. excluded is final. Cameras go live only under ok (trigger, mig 183); a downgrade takes them down.';

REVOKE EXECUTE ON FUNCTION public.imagery_licence_set_status(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_licence_set_status(text, text, text, text) TO service_role;

COMMIT;

-- VERIFY (read only)
SELECT provider_id, commercial_status, cleared_by, attribution_text IS NOT NULL AS has_credit
  FROM public.imagery_licences
 WHERE provider_id IN ('ny_511', 'ohio_ohgo', 'us_511_platform', 'taiwan_tdx', 'dgt_spain', 'windy_webcams')
 ORDER BY provider_id;
