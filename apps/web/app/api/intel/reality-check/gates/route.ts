import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentTier } from '@/lib/subscription';
import { MODULE_TIER_REQUIREMENTS, tierMeetsRequirement } from '@/lib/intel/modules';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * The admission checklists for the two asset classes that have NOT cleared
 * admission: Power and Maritime / Port (build prompt §3.3, §4.1, §4.2).
 *
 * THE RULE THIS ROUTE EXISTS TO KEEP. Every row is either a LIVE query
 * against production or a dated statement carrying its own as-of. Nothing is
 * hard-coded, and nothing on a gated tab is data. The prototype shipped
 * "0 of 84 tiles" and "completeness 59.6x" as literals and both were stale
 * within a week (§3.6) — a checklist that cannot go stale is a checklist
 * that is not being measured.
 *
 * So each row carries `kind`:
 *   'live'   — the numbers in `detail` were read from production on this
 *              request, and `source` names the relation they came from.
 *   'dated'  — a judgement a query cannot make, with the date it was made
 *              and who made it. It ages visibly instead of silently.
 *
 * Neither tab may publish a verdict, a lead or a score. Power is refuted at
 * site level and redesigned at cluster level with two blockers open;
 * Maritime has one physical instrument and a dead derivation. Until those
 * clear, these tabs show the evidence for why there is nothing to show.
 */

export type GateStatus = 'ok' | 'warn' | 'fail' | 'pending';

interface GateRow {
  check: string;
  status: GateStatus;
  statusLabel: string;
  kind: 'live' | 'dated';
  detail: string;
  source: string;
}

function fail(what: string, e: unknown): GateRow {
  return {
    check: what,
    status: 'warn',
    statusLabel: 'Unreadable',
    kind: 'live',
    detail: `This row could not be read just now: ${e instanceof Error ? e.message : String(e)}. An unreadable check is not a passing check.`,
    source: 'live query failed',
  };
}

const ago = (iso: string | null | undefined): string => {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (!Number.isFinite(h)) return 'never';
  return h < 48 ? `${h.toFixed(1)} h ago` : `${Math.floor(h / 24)} days ago`;
};

export async function GET() {
  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, MODULE_TIER_REQUIREMENTS['reality-check'])) {
    return NextResponse.json({ error: 'forbidden', tier }, { status: 403 });
  }

  // A checklist that 500s tells the reader nothing. If the client itself
  // cannot be built, say so in the payload and let every row read
  // "Unreadable" — an unreadable check is not a passing check.
  let supabase: ReturnType<typeof createServerSupabase>;
  try {
    supabase = createServerSupabase();
  } catch (e) {
    return NextResponse.json({
      as_of: new Date().toISOString(),
      note: 'The admission checklists could not be read.',
      error: e instanceof Error ? e.message : String(e),
      power: [],
      maritime: [],
    });
  }

  const power: GateRow[] = [];
  const maritime: GateRow[] = [];

  // ── POWER ────────────────────────────────────────────────────────────
  try {
    const [combustion, nuclear] = await Promise.all([
      supabase.from('power_plants').select('id', { count: 'exact', head: true })
        .eq('status', 'operating').in('fuel_type', ['coal', 'oil/gas', 'bioenergy']),
      supabase.from('power_plants').select('id', { count: 'exact', head: true })
        .eq('status', 'operating').eq('fuel_type', 'nuclear'),
    ]);
    if (combustion.error) throw new Error(combustion.error.message);
    power.push({
      check: 'Eligibility',
      status: 'ok',
      statusLabel: 'Defined',
      kind: 'live',
      detail: `${(combustion.count ?? 0).toLocaleString()} operating combustion unit rows in the registry (coal, oil/gas, bioenergy). ${(nuclear.count ?? 0).toLocaleString()} operating nuclear rows are excluded: a nuclear site keeps constant yard lighting through refuelling, so it can neither pass nor fail this observable. Hydro, solar and wind have no combustion and are excluded for the same reason. The registry stores one row per generating unit, so unit rows over-state sites.`,
      source: 'power_plants (status, fuel_type), counted on this request',
    });
  } catch (e) { power.push(fail('Eligibility', e)); }

  power.push({
    check: 'Watched universe',
    status: 'warn',
    statusLabel: 'Measured once',
    kind: 'dated',
    detail: '1,319 eligible sites were inside the ingest boxes when the redesign was scoped, of which 580–1,042 are usable in a given window depending on clear nights. The honest yield is one to two shortlist leads per multi-week window, worldwide. 403 of the 1,319 are in the United States, where EPA CEMS and EIA-930 publish hourly generation free — a satellite inference there is strictly worse than a public feed.',
    source: 'read-only audit, as of 2026-09-18',
  });

  try {
    const { data, error } = await supabase
      .from('power_plants').select('ingested_at')
      .order('ingested_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    const at = (data as { ingested_at?: string } | null)?.ingested_at ?? null;
    const days = at ? Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000) : null;
    power.push({
      check: 'Reference snapshot',
      status: days !== null && days > 60 ? 'fail' : 'ok',
      statusLabel: days !== null && days > 60 ? 'Stale' : 'Fresh',
      kind: 'live',
      detail: at
        ? `The power registry was loaded once, ${at.slice(0, 10)} (${days} days ago), and nothing has refreshed it since. A snapshot that old looks healthy from the inside — every row is present and every query returns — which is exactly why the age is stated here rather than inferred.`
        : 'No ingest timestamp on any row: the snapshot cannot date itself.',
      source: 'power_plants.ingested_at, newest row',
    });
  } catch (e) { power.push(fail('Reference snapshot', e)); }

  power.push({
    check: 'Unit of claim',
    status: 'ok',
    statusLabel: 'Designed',
    kind: 'dated',
    detail: 'Single-linkage clusters of operating combustion sites at 50 km. At 25 km the Kuwait cluster is only Az Zour North and South, 1.35 km apart and sharing pixels in the VNP46A2 3x3 box — their "corroboration" is one reading counted twice. 50 km reaches Shuaiba North at about 42 km, a genuinely independent pixel. Site-level power is refuted and closed: 1,001 sites returned zero dual-confirmed candidates, while solar and wind farms tripped the light-down rule at 13.66% against 1.10% for combustion.',
    source: 'redesign, as of 2026-09-18',
  });

  power.push({
    check: 'Controls',
    status: 'fail',
    statusLabel: 'Disputed',
    kind: 'dated',
    detail: 'Solar/wind clusters and never-built clusters must not trip the rule at or above the rate of real combustion clusters, and placebo windows must not trip more than the live window. One analysis pass found the cluster rule quiet on a control window; a second found it firing on San Francisco Bay and Karachi most weeks. The two have not been reconciled. If the controls fail, Power does not ship — not gated, not labelled beta, not with caveats.',
    source: 'two analysis passes, as of 2026-09-18',
  });

  power.push({
    check: 'Onset observed',
    status: 'fail',
    statusLabel: 'Fails — Kuwait',
    kind: 'dated',
    detail: 'The case that prompted the redesign is weaker than the story told about it. Az Zour South and North fell about 95% (from 67–190 to 5–9) and stayed down from 07-17 to 07-25 — but the fall happened inside the 07-10 to 07-16 ingest hole, so the onset was never observed. Mina Al Ahmadi, 46 km away, read 112.1 on 07-18 and 119.9 by 07-24: it does not corroborate.',
    source: 'production read, as of 2026-09-10',
  });

  try {
    const { data, error } = await supabase
      .from('blackmarble_ingest_runs')
      .select('night, tiles_expected, tiles_processed, tiles_missing, ok, ran_at')
      .order('night', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    const r = data as {
      night?: string; tiles_expected?: number; tiles_processed?: number;
      tiles_missing?: number; ok?: boolean; ran_at?: string;
    } | null;
    const missing = r?.tiles_missing ?? null;
    power.push({
      check: 'Data clock',
      status: missing && missing > 0 ? 'warn' : 'ok',
      statusLabel: missing && missing > 0 ? 'Partial' : 'Complete',
      kind: 'live',
      detail: r
        ? `Newest Black Marble night ${String(r.night).slice(0, 10)}: ${r.tiles_processed ?? 0} of ${r.tiles_expected ?? 0} tiles, ${missing ?? 0} missing, last run ${ago(r.ran_at)}. The run flag reads ok = ${String(r.ok)} — and ok means "no errors", never "complete". Incomplete nights are re-fetched daily until about night+15, then freeze, so tiles_missing is the column to read.`
        : 'No Black Marble ingest run has ever been recorded.',
      source: 'blackmarble_ingest_runs, newest night',
    });
  } catch (e) { power.push(fail('Data clock', e)); }

  power.push({
    check: 'Method recall',
    status: 'pending',
    statusLabel: 'Not measured',
    kind: 'dated',
    detail: 'The CEMS validation harness (tracks V-0 to V-5) would measure what fraction of genuine shutdowns the shared method catches, against EPA CEMS unit-hour ground truth on the watched US combustion cohort. None of it is built. Until it is, every figure in this programme is a false-positive rate and nothing here states recall. The measurement, when it exists, will be a POWER measurement: no refinery claim may cite it.',
    source: 'programme scope, as of 2026-09-18',
  });

  // ── MARITIME / PORT ──────────────────────────────────────────────────
  try {
    const [runs, newest] = await Promise.all([
      supabase.from('port_call_derivation_runs').select('day', { count: 'exact', head: true }),
      supabase.from('port_call_derivation_runs').select('day, status, ran_at, error')
        .order('ran_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (runs.error) throw new Error(runs.error.message);
    const r = newest.data as { day?: string; status?: string; ran_at?: string; error?: string | null } | null;
    maritime.push({
      check: 'Run record',
      status: (runs.count ?? 0) > 0 ? 'ok' : 'fail',
      statusLabel: (runs.count ?? 0) > 0 ? 'Present' : 'Missing',
      kind: 'live',
      detail: r
        ? `${(runs.count ?? 0).toLocaleString()} derivation run row(s); the newest covers ${String(r.day).slice(0, 10)} with status ${r.status}, ${ago(r.ran_at)}${r.error ? ` — error: ${r.error}` : ''}. A run record is what makes "ran and found nothing" distinguishable from "did not run".`
        : 'No derivation run has ever been recorded: "ran and found nothing" is indistinguishable from "did not run".',
      source: 'port_call_derivation_runs',
    });
  } catch (e) { maritime.push(fail('Run record', e)); }

  try {
    const { data, error } = await supabase
      .from('port_call_coverage').select('day, status, atoms')
      .order('day', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ day: string; status: string; atoms: number | null }>;
    const byStatus: Record<string, number> = {};
    for (const x of rows) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    const allowed = new Set(['derived', 'samples_absent', 'pending']);
    const stray = Object.keys(byStatus).filter((s) => !allowed.has(s));
    maritime.push({
      check: 'Coverage vocabulary',
      status: stray.length === 0 ? 'ok' : 'fail',
      statusLabel: stray.length === 0 ? 'Clean' : 'Not clean',
      kind: 'live',
      detail: `${rows.length} day(s) of coverage: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}. Admission needs only derived, samples_absent and pending${stray.length ? `; ${stray.join(', ')} must clear first` : ''}. A missing day is a day the derivation did not run, not a quiet day at sea.`,
      source: 'port_call_coverage, newest 200 days',
    });

    const derived = rows.filter((x) => x.status === 'derived' && x.atoms !== null).slice(0, 14);
    const vals = derived.map((x) => Number(x.atoms));
    const lo = vals.length ? Math.min(...vals) : null;
    const hi = vals.length ? Math.max(...vals) : null;
    const ratio = lo && hi && lo > 0 ? hi / lo : null;
    const zeroDay = vals.some((v) => v === 0);
    maritime.push({
      check: 'Completeness',
      status: vals.length >= 14 && ratio !== null && ratio < 3 && !zeroDay ? 'ok' : 'fail',
      statusLabel: vals.length >= 14 && ratio !== null && ratio < 3 && !zeroDay ? 'Passes' : 'Needs 14 days, max/min < 3.0',
      kind: 'live',
      detail: vals.length
        ? `${vals.length} derived day(s) available${vals.length < 14 ? ' — the gate needs 14 consecutive' : ''}; atoms run ${lo?.toLocaleString()} to ${hi?.toLocaleString()}${ratio ? `, a max/min of ${ratio.toFixed(1)}x` : ''}${zeroDay ? '; a zero day counts as a failure' : ''}. Before the derivation stopped, the series measured its own cron — days alternating between a few hundred and many thousands of calls — not port traffic.`
        : 'No derived day carries an atom count: there is nothing to measure completeness on.',
      source: 'port_call_coverage.atoms, newest derived days',
    });
  } catch (e) { maritime.push(fail('Coverage', e)); }

  maritime.push({
    check: 'Statistic',
    status: 'ok',
    statusLabel: 'Designed',
    kind: 'dated',
    detail: 'The per-port arrival rate as a leave-one-out share of global watched arrivals, median over derivation days, against the port’s own baseline — the direct analogue of the refinery statistic, and the only candidate whose numerator and denominator come from the same rows. A signal defined as a share cannot be manufactured by ingest growth. Leave-one-out matters: Amsterdam alone is 4,324 of 88,598 rows. Medians are mandatory, because arrivals bunch on tides, convoys and pilot windows.',
    source: 'design, as of 2026-09-18',
  });

  maritime.push({
    check: 'Second instrument',
    status: 'fail',
    statusLabel: 'None',
    kind: 'dated',
    detail: 'AIS is the only physical instrument here. A second observable derived from the same AIS feed is not independent corroboration. Until a genuinely different measurement exists, Maritime may publish refutations and coverage statements — "a disruption was reported at port X and traffic is unchanged" — and may not publish dual-confirmed leads in the refinery sense. A port call is a 3 km, under-half-a-knot dwell inference, not a berth record.',
    source: 'standing limit, as of 2026-09-18',
  });

  try {
    const { data, error } = await supabase
      .from('ais_box_liveness').select('slug, label, kind, newest_fix, fixes_last_hour')
      .order('slug', { ascending: true });
    if (error) throw new Error(error.message);
    const boxes = (data ?? []) as Array<{ slug: string; label: string; kind: string; newest_fix: string | null; fixes_last_hour: number | null }>;
    const dead = boxes.filter((b) => !b.newest_fix || (Date.now() - new Date(b.newest_fix).getTime()) > 24 * 3_600_000);
    maritime.push({
      check: 'Anchors',
      status: dead.length === 0 ? 'ok' : 'warn',
      statusLabel: dead.length === 0 ? 'All live' : `${dead.length} silent`,
      kind: 'live',
      detail: boxes.length
        ? `${boxes.length} coverage box(es); ${dead.length} with no fix in 24 h${dead.length ? ` (${dead.map((b) => `${b.label} — ${ago(b.newest_fix)}`).join('; ')})` : ''}. A box with no fixes is a box we are not listening to, and no claim may be anchored on one.`
        : 'No AIS coverage box is recorded at all.',
      source: 'ais_box_liveness, every box',
    });
  } catch (e) { maritime.push(fail('Anchors', e)); }

  return NextResponse.json({
    as_of: new Date().toISOString(),
    note: 'Every row above is either read from production on this request (live) or a judgement with the date it was made (dated). Nothing on these two tabs is a claim, a verdict or a score — neither asset class has cleared admission.',
    power,
    maritime,
  });
}
