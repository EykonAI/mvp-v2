import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { scoreVessel, computeRealFeatures } from '@/lib/intel/shadowFleet';
import { boxForPosition, boxState, BOX_DEAD_AFTER_H, type BoxLiveness } from '@/lib/intel/aisCoverage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Only the recently-active fleet is "trackable". vessel_positions accumulates
// latest-per-MMSI, so a wide window is dominated by vessels that long ago left
// our AIS coverage — not dark-fleet, just gone. Scoring the recent window keeps
// the leads list to vessels we are actually tracking.
//
// ACTIVE WINDOW IS MEASURED ON `updated_at` — see the timestamp note below.
// That is what bounds the maximum achievable gap to ACTIVE_WINDOW_H and what
// keeps vessels stranded in a dead coverage box out of the scored set: if a
// box has produced no fix for weeks, nothing from it is inside this window.
const ACTIVE_WINDOW_H = 72;
const UPSERT_BATCH = 1000;
const PAGE = 1000;
// A dark-contact EVENT opens when silence reaches this multiple of the
// vessel's own cadence (~12 h for an hourly reporter), and resolves at a 72 h
// re-observation deadline. See migration 112 for the full lifecycle contract.
const EVENT_OPEN_RATIO = 12;
const EVENT_DEADLINE_H = 72;
const MAX_SCAN = 60_000; // bounded, and reported — never silently truncated

/**
 * Compute-shadow-fleet-scores · hourly.
 *
 * THE TIMESTAMP THAT MATTERS
 * vessel_positions carries two timestamps that look interchangeable and are not:
 *   ingested_at — column DEFAULT now(), written once on INSERT. It is the age of
 *                 the ROW: the first time this vessel was ever seen. Never updated.
 *   updated_at  — maintained by trigger trg_vessel_touch on every upsert. It is
 *                 the last time the VESSEL transmitted.
 * This job scored the dark-gap from `ingested_at` until 2026-08-24, so the
 * composite measured how long a database row had existed rather than how long a
 * ship had been silent. Vessels under way at 12+ knots ranked top of the leads
 * list with a fabricated 52-hour gap. Everything here reads `updated_at`.
 *
 * v2 scores ONLY from signals the live AIS feed provides — the dark-gap and
 * flag-of-convenience. The v1 cargo / port-call / beneficial-owner / flag-history
 * / vessel-age features were loop-index placeholders with no data source; they
 * saturated the composite near 1.0 (~95% of vessels flagged) and were removed.
 * Restore them (here, in computeRealFeatures, and the weights fixture) once the
 * enrichment pipeline lands.
 *
 * COVERAGE GATE (migration 110). Before scoring, this job refreshes
 * ais_box_liveness and looks up the box each vessel was last seen in. A vessel
 * whose box has been silent for more than BOX_DEAD_AFTER_H is NOT scored — its
 * profile is deleted and it is counted in `voided_dead_box` — because a silence
 * observed by a dead instrument is a fact about the instrument. The gate is a
 * gate, not a term: a contact in a dead box is not scored low, it is not scored.
 * Gaps for live-box vessels are measured against the BOX's own newest fix, so a
 * regionally stale feed cannot inflate its vessels' gaps either.
 *
 * Profiles for vessels that have left the active window are pruned, so
 * vessel_profiles reflects the current tracked fleet with real scores only.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVE_WINDOW_H * 3600_000).toISOString();

  // Refresh the per-box liveness snapshot first, so the gate below reads the
  // state of the feed as of this run. Failure is loud: without liveness the
  // gate cannot be applied, and scoring without it is exactly the bug this
  // migration exists to prevent.
  const refresh = await supabase.rpc('refresh_ais_box_liveness');
  if (refresh.error) {
    return NextResponse.json(
      { ok: false, error: `refresh_ais_box_liveness: ${refresh.error.message}` },
      { status: 500 },
    );
  }

  // Refresh per-vessel cadence baselines (mig 111) — the denominator of the
  // v3 silence feature. Loud failure for the same reason as liveness: scoring
  // absolute silence against no baseline is the v2 bug this replaces.
  const cadRefresh = await supabase.rpc('refresh_vessel_cadence');
  if (cadRefresh.error) {
    return NextResponse.json(
      { ok: false, error: `refresh_vessel_cadence: ${cadRefresh.error.message}` },
      { status: 500 },
    );
  }
  const cadence = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('vessel_cadence')
      .select('mmsi, median_interval_h')
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ ok: false, error: `vessel_cadence: ${error.message}` }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const r of data as any[]) cadence.set(r.mmsi, r.median_interval_h);
    if (data.length < PAGE) break;
  }
  const livenessRes = await supabase.from('ais_box_liveness').select('*');
  if (livenessRes.error || !livenessRes.data?.length) {
    return NextResponse.json(
      { ok: false, error: `ais_box_liveness unreadable: ${livenessRes.error?.message ?? 'no rows'}` },
      { status: 500 },
    );
  }
  const liveness = new Map<string, BoxLiveness>(
    (livenessRes.data as BoxLiveness[]).map(r => [r.slug, r]),
  );

  // Data clock = the fleet-wide freshest observation, so a stalled feed doesn't
  // mark every vessel dark. Read explicitly rather than taken from the batch:
  // the batch is ordered oldest-first so that the silent vessels — the ones this
  // job exists to find — survive the scan cap.
  const clock = await supabase
    .from('vessel_positions')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const dataClockMs = clock.data?.updated_at
    ? new Date(clock.data.updated_at).getTime()
    : now.getTime();

  // Page through the active window, oldest fix first.
  const rows: Array<{ mmsi: string; name: string | null; flag: string | null; latitude: number | null; longitude: number | null; speed: number | null; updated_at: string }> = [];
  let truncated = false;
  for (let from = 0; from < MAX_SCAN; from += PAGE) {
    const { data, error } = await supabase
      .from('vessel_positions')
      .select('mmsi, name, flag, latitude, longitude, speed, updated_at')
      .gte('updated_at', since)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...(data as any));
    if (data.length < PAGE) break;
    if (rows.length >= MAX_SCAN) { truncated = true; break; }
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scored: 0, note: 'no positions in active window' });
  }

  const latestByMmsi = new Map<string, any>();
  for (const p of rows) latestByMmsi.set(p.mmsi, p);

  // THE GATE. Assign each vessel to the box it was last seen in; vessels in a
  // dead box are voided, not scored. Gaps for the rest are measured against the
  // box's own newest fix (its local data clock), falling back to the fleet
  // clock only for open-ocean positions outside every subscription box.
  const voidedByBox = new Map<string, number>();
  const upserts: any[] = [];
  const voidedMmsis: string[] = [];
  let unscoredNoBaseline = 0;
  const eventCandidates: any[] = [];
  for (const p of latestByMmsi.values()) {
    const box = boxForPosition(p.latitude, p.longitude);
    const row = box ? liveness.get(box.slug) : undefined;
    if (box && boxState(row, now.getTime()) === 'dead') {
      voidedByBox.set(box.slug, (voidedByBox.get(box.slug) ?? 0) + 1);
      voidedMmsis.push(p.mmsi);
      continue;
    }
    const clockMs = row?.newest_fix ? new Date(row.newest_fix).getTime() : dataClockMs;
    const gapHours = Math.max(0, (clockMs - new Date(p.updated_at).getTime()) / 3600_000);

    // No cadence baseline yet: the profile row is KEPT with composite NULL —
    // "observed, not yet scorable" — never scored with a default. Keeping the
    // row matters structurally: sample-ais-history samples vessel_profiles,
    // so deleting these would stop the very sampling that builds their
    // baseline, and the pipeline would strangle itself.
    const cadenceH = cadence.get(p.mmsi);
    if (cadenceH === undefined) {
      unscoredNoBaseline++;
      upserts.push({
        mmsi: p.mmsi,
        name: p.name,
        flag: p.flag,
        composite_score: null,
        indicators: { unscored: 'no_cadence_baseline', silence_hours: round1(gapHours) },
        last_ais_at: p.updated_at,
        last_dark_at: null,
        computed_at: now.toISOString(),
      });
      continue;
    }

    const features = computeRealFeatures({
      flag: p.flag,
      gapHours,
      cadenceHours: cadenceH,
      lastSpeedKn: p.speed ?? null,
    });
    const composite = scoreVessel(features).composite;
    const silenceRatio = gapHours / Math.max(0.5, cadenceH);
    if (silenceRatio >= EVENT_OPEN_RATIO) {
      // Dedup is structural: UNIQUE (mmsi, gap_started_at) makes the same
      // ongoing gap un-reopenable, including after a still_dark resolution.
      eventCandidates.push({
        mmsi: p.mmsi,
        name: p.name,
        flag: p.flag,
        box_slug: box?.slug ?? null,
        last_fix_lat: p.latitude,
        last_fix_lon: p.longitude,
        last_speed_kn: p.speed ?? null,
        cadence_hours: cadenceH,
        silence_ratio_at_open: round1(silenceRatio),
        confidence_at_open: composite,
        indicators: { ...features, silence_hours: round1(gapHours), cadence_hours: round1(cadenceH) },
        gap_started_at: p.updated_at,
        opened_at: now.toISOString(),
        deadline_at: new Date(now.getTime() + EVENT_DEADLINE_H * 3600_000).toISOString(),
      });
    }
    upserts.push({
      mmsi: p.mmsi,
      name: p.name,
      flag: p.flag,
      composite_score: composite,
      // Context keys ride along with the scored features so the UI can print
      // "silence X h = R× own cadence" without a second query.
      indicators: {
        ...features,
        silence_hours: round1(gapHours),
        cadence_hours: round1(cadenceH),
      },
      last_ais_at: p.updated_at,
      last_dark_at: gapHours > 6 ? p.updated_at : null,
      computed_at: now.toISOString(),
    });
  }

  // A row exists iff we looked: profiles for voided vessels are removed so a
  // previously-scored vessel whose box has since died cannot linger on the
  // leads list with a frozen score.
  for (let i = 0; i < voidedMmsis.length; i += UPSERT_BATCH) {
    await supabase
      .from('vessel_profiles')
      .delete()
      .in('mmsi', voidedMmsis.slice(i, i + UPSERT_BATCH));
  }

  for (let i = 0; i < upserts.length; i += UPSERT_BATCH) {
    const { error: upErr } = await supabase
      .from('vessel_profiles')
      .upsert(upserts.slice(i, i + UPSERT_BATCH), { onConflict: 'mmsi' });
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message, scored: i }, { status: 500 });
  }

  // Prune profiles for vessels that have left the active window so the table
  // reflects the current tracked fleet. last_ais_at now holds a true last-contact
  // time, so this prunes on the same clock the scores were computed against.
  const { error: delErr } = await supabase
    .from('vessel_profiles')
    .delete()
    .lt('last_ais_at', since);

  // ── Dark-contact event lifecycle (mig 112) ─────────────────────────────
  // Close before open: a vessel that reappeared minutes ago closes its event
  // here and cannot re-open below (its ratio is ~0 against the new fix).
  let evReappeared = 0;
  let evStillDark = 0;
  let evVoided = 0;
  let evOpened = 0;

  const openEvents: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('dark_contact_events')
      .select('id, mmsi, gap_started_at, deadline_at, box_slug')
      .eq('status', 'open')
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ ok: false, error: `dark_contact_events: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    openEvents.push(...data);
    if (data.length < PAGE) break;
  }

  if (openEvents.length > 0) {
    // Reappearance is detected FEED-WIDE (vessels move between boxes), so we
    // read fresh positions for the event vessels rather than the window batch —
    // a vessel silent beyond the 72 h active window is exactly the one whose
    // event is still open.
    const posByMmsi = new Map<string, string>();
    const evMmsis = openEvents.map(e => e.mmsi);
    for (let i = 0; i < evMmsis.length; i += 400) {
      const { data } = await supabase
        .from('vessel_positions')
        .select('mmsi, updated_at')
        .in('mmsi', evMmsis.slice(i, i + 400));
      for (const r of (data ?? []) as any[]) posByMmsi.set(r.mmsi, r.updated_at);
    }

    for (const ev of openEvents) {
      const lastFix = posByMmsi.get(ev.mmsi);
      const gapStartMs = new Date(ev.gap_started_at).getTime();
      if (lastFix && new Date(lastFix).getTime() > gapStartMs) {
        // A newer fix exists: the vessel was re-observed. Positive observation.
        const gapH = (new Date(lastFix).getTime() - gapStartMs) / 3600_000;
        await supabase.from('dark_contact_events').update({
          status: 'resolved',
          resolution: 'reappeared',
          closed_at: lastFix,
          final_gap_hours: round1(gapH),
        }).eq('id', ev.id);
        evReappeared++;
      } else if (ev.box_slug && boxState(liveness.get(ev.box_slug), now.getTime()) === 'dead') {
        // The box that measured this silence went dead: continued silence is
        // unmeasurable. Never a win, never a loss.
        await supabase.from('dark_contact_events').update({
          status: 'void',
          void_reason: `coverage_lost:${ev.box_slug}`,
          closed_at: now.toISOString(),
        }).eq('id', ev.id);
        evVoided++;
      } else if (now.getTime() > new Date(ev.deadline_at).getTime()) {
        // Not re-observed by our coverage within the deadline. A statement
        // about the instrument's view, and worded that way everywhere.
        await supabase.from('dark_contact_events').update({
          status: 'resolved',
          resolution: 'still_dark',
          closed_at: now.toISOString(),
          final_gap_hours: round1((now.getTime() - gapStartMs) / 3600_000),
        }).eq('id', ev.id);
        evStillDark++;
      }
    }
  }

  if (eventCandidates.length > 0) {
    for (let i = 0; i < eventCandidates.length; i += UPSERT_BATCH) {
      const { data, error } = await supabase
        .from('dark_contact_events')
        .upsert(eventCandidates.slice(i, i + UPSERT_BATCH), {
          onConflict: 'mmsi,gap_started_at',
          ignoreDuplicates: true,
        })
        .select('id');
      if (error) {
        return NextResponse.json({ ok: false, error: `open events: ${error.message}` }, { status: 500 });
      }
      evOpened += (data ?? []).length;
    }
  }

  // Echo the inputs so a stale build is detectable from outside: `gap_source`
  // does not exist in any bundle before this change.
  return NextResponse.json({
    ok: true,
    gap_source: 'updated_at',
    gap_clock: 'per-box newest fix',
    active_window_h: ACTIVE_WINDOW_H,
    box_dead_after_h: BOX_DEAD_AFTER_H,
    data_clock: new Date(dataClockMs).toISOString(),
    scanned: rows.length,
    truncated,
    scored: upserts.length - unscoredNoBaseline,
    unscored_no_baseline: unscoredNoBaseline,
    cadence_baselines: cadence.size,
    voided_dead_box: voidedMmsis.length,
    events_opened: evOpened,
    events_reappeared: evReappeared,
    events_still_dark: evStillDark,
    events_voided: evVoided,
    events_open_total: openEvents.length - evReappeared - evStillDark - evVoided + evOpened,
    voided_by_box: Object.fromEntries(voidedByBox),
    pruned: delErr ? `error: ${delErr.message}` : 'ok',
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
