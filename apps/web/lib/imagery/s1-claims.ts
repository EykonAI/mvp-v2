import type { SupabaseClient } from '@supabase/supabase-js';
import { computePredictionHash } from '@/lib/predictions/hash';
import { recordIssuanceRun } from '@/lib/predictions/run-records';

/**
 * s1:anchorage_count — the Sentinel-1 anchorage claim issuer (Imagery IMG-10,
 * mig 193). Machine track, source 's1-anchorage', feature
 * 's1_anchorage_above_median'.
 *
 * WHAT IS CLAIMED. For each admitted anchorage: over the NEXT ISO week
 * (Monday–Sunday UTC — nothing of it is on disk at issue), the median
 * Sentinel-1 bright-return area is above the anchorage's own median of clear
 * looks in the 120 days before, frozen into the claim. p is the family's
 * shrunk judged rate (k + 10) / (n + 20) — 0.5 until something is judged.
 *
 * WHEN. Only when s1_anchorage_claim_plan() says so: the S1 method is
 * admitted (mig 189) AND a walk-forward backtest on the anchorages' own
 * history has >= 30 judged weeks (F-9). Until then every run records WHY it
 * issued nothing, with the backtest, in issuance_runs — silence is never
 * the record.
 *
 * VOID, never 0.5: a week with no clear pass, a revoked admission or a week
 * unobserved 45 days on (s1_anchorage_resolution).
 */

export const S1_CLAIM_SOURCE = 's1-anchorage';
export const S1_CLAIM_FEATURE = 's1_anchorage_above_median';
const CLAIM_HOURS = 7 * 24;

export interface PlanRow {
  issuing: boolean;
  reason: string;
  aoi_id: string | null;
  name: string | null;
  week_start: string | null;
  week_end: string | null;
  baseline_median: number | null;
  baseline_n: number | null;
  p: number | null;
  admission_id: number | null;
  backtest: Record<string, unknown> | null;
  family_status: string | null;
}

export function observableFor(aoiId: string, weekStart: string): string {
  return `s1:anchorage_count:${aoiId}:${weekStart}`;
}

export function statementFor(r: PlanRow): string {
  const where = r.name ? `${r.name} (${r.aoi_id})` : String(r.aoi_id);
  return (
    `At ${where}, the median Sentinel-1 bright radar-return area over ${r.week_start}–${r.week_end} (UTC, Monday–Sunday) ` +
    `is above the anchorage's own median of ${Math.round(Number(r.baseline_median))} m² over its ${r.baseline_n} clear looks ` +
    `in the previous 120 days. Bright-return area is an estimate of ships at anchor, not a count. ` +
    `VOID if no clear Sentinel-1 pass covers the anchorage that week, if the Sentinel-1 method is no longer admitted, ` +
    `or if no Sentinel-1 check covers the week within 45 days.`
  );
}

/** Pure: plan rows → predictions_register rows. Refuses anything not issuing or incomplete. */
export function buildS1ClaimRows(plan: PlanRow[], now: Date): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const r of plan) {
    if (!r.issuing || !r.aoi_id || !r.week_start || !r.week_end) continue;
    if (r.baseline_median === null || !(r.baseline_median > 0) || (r.baseline_n ?? 0) < 3) continue;
    if (r.p === null || !(r.p > 0 && r.p < 1)) continue;
    const statement = statementFor(r);
    const targetObservable = observableFor(r.aoi_id, r.week_start);
    // Judgeable the day after the week closes; the resolver DEFERS until the
    // S1 ingest has looked past the week.
    const nominal = new Date(`${r.week_end}T00:00:00.000Z`);
    nominal.setUTCDate(nominal.getUTCDate() + 1);
    const resolvesAt = nominal.getTime() > now.getTime() ? nominal : new Date(now.getTime() + 3_600_000);
    const hash = computePredictionHash({ statement, targetObservable, resolvesAt, issuedAt: now, predictedMean: r.p });
    out.push({
      feature: S1_CLAIM_FEATURE,
      context: {
        // Read by s1_anchorage_resolution (mig 193). Never parse the observable (#465).
        aoi_id: r.aoi_id,
        aoi_name: r.name,
        week_start: r.week_start,
        week_end: r.week_end,
        baseline_median: r.baseline_median,
        baseline_n: r.baseline_n,
        baseline_window: '120 days before the week, clear looks only',
        metric: 'bright_target_area_m2 (Sentinel-1 VV > 0.3, 20 m)',
        admission_id: r.admission_id,
        backtest_at_issue: r.backtest,
        family_status_at_issue: r.family_status,
        forecast_basis: r.p === 0.5 ? 'flat_prior_no_judged_claims_yet' : 'walk_forward_family_rate_shrunk_to_0.5',
        note: "Radar bright-return area includes anything bright in the polygon; a fixed clutter offset is absorbed by the anchorage's own median.",
      },
      predicted_distribution: { mean: r.p, type: 'point' },
      target_observable: targetObservable,
      target_window_hours: CLAIM_HOURS,
      issued_at: now.toISOString(),
      resolves_at: resolvesAt.toISOString(),
      persona: 'analyst',
      statement,
      source: S1_CLAIM_SOURCE,
      track: 'machine',
      hash,
    });
  }
  return out;
}

export interface S1IssueResult {
  issuing: boolean;
  reason: string;
  issued: number;
  planned: number;
  family_status: string | null;
  backtest: Record<string, unknown> | null;
  error: string | null;
}

export async function issueS1AnchorageClaims(db: SupabaseClient, now = new Date()): Promise<S1IssueResult> {
  const result: S1IssueResult = { issuing: false, reason: '', issued: 0, planned: 0, family_status: null, backtest: null, error: null };
  try {
    const { data, error } = await db.rpc('s1_anchorage_claim_plan', { p_min_backtest: 30 });
    if (error) throw new Error(`s1_anchorage_claim_plan: ${error.message}`);
    const plan = (data ?? []) as PlanRow[];
    const head = plan[0];
    result.issuing = !!head?.issuing;
    result.reason = head?.reason ?? 'issuing: nothing due (every admitted anchorage already claimed for next week, or none has a baseline)';
    result.family_status = head?.family_status ?? null;
    result.backtest = head?.backtest ?? null;
    const rows = buildS1ClaimRows(plan, now);
    result.planned = rows.length;
    if (rows.length > 0) {
      const { error: insErr } = await db.from('predictions_register').insert(rows);
      if (insErr) throw new Error(`predictions_register insert: ${insErr.message}`);
      result.issued = rows.length;
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  await recordIssuanceRun(db as unknown as Parameters<typeof recordIssuanceRun>[0], {
    source: S1_CLAIM_SOURCE,
    issued: result.issued,
    already_present: null,
    declined: result.issuing ? {} : { [result.reason || 'not issuing']: 1 },
    error: result.error,
  });
  return result;
}
