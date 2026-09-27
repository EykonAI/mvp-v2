import type { SupabaseClient } from '@supabase/supabase-js';
import type { FirePayload } from './dispatch';

// Imagery change rules — "tell me when a watched site's satellite reading
// moves ≥ X % from its OWN median" (rule_type='imagery_change', mig 191,
// Imagery Layer IMG-8).
//
// Evaluated by the cheap cron alongside firms_proximity. The judging is in
// SQL (imagery_rule_evaluate): every NEW look is written to
// imagery_rule_evaluations exactly once per rule with an outcome — fired,
// below_threshold, no_baseline or void — so the ledger is also the dedupe.
//
// ─── HONESTY INVARIANT (do not soften this copy) ─────────────────
// • A look that is not clear (cloudy, partly cloudy, partial swath, no
//   acquisition, processing error) is VOID: it is logged, it never fires,
//   and it is never described as zero or as "no change".
// • Sentinel-2 median NDVI is a spectral reading of surface cover. The
//   alert says "median NDVI moved +30 % from this site's own median" —
//   never "stockpile grew", "mine expanded" or "activity rose".
// • Sentinel-1 rules see nothing until the S1 measurement study is
//   admitted (imagery_s1_readings, mig 189); the reading is a radar
//   bright-return area, an estimate, never a vessel count.

export type ImagerySensor = 's2_l2a' | 's1_grd';
export type ImageryDirection = 'up' | 'down' | 'either';
export const IMAGERY_SITE_KINDS = ['mine', 'port', 'refinery_complex', 'lng_terminal', 'anchorage', 'chokepoint'] as const;
export type ImagerySiteKind = (typeof IMAGERY_SITE_KINDS)[number];

export const IMAGERY_MIN_CHANGE_PCT = 10;
export const IMAGERY_MAX_CHANGE_PCT = 500;
export const IMAGERY_DEFAULT_CHANGE_PCT = 20;
/** A new rule also judges the looks of the week before it was created. */
export const IMAGERY_FIRST_LOOKBACK_DAYS = 7;
export const IMAGERY_MAX_DETAIL_LOOKS = 8;

export interface ImageryChangeConfig {
  sensor: ImagerySensor;
  /** One site (e.g. "mine:…"), or null to watch every site of `kind`. */
  aoi_id: string | null;
  kind: ImagerySiteKind | null;
  direction: ImageryDirection;
  min_change_pct: number;
}

export type ImageryConfigError =
  | 'invalid_sensor'
  | 'invalid_direction'
  | 'invalid_min_change_pct'
  | 'invalid_kind'
  | 'invalid_aoi_id'
  | 'site_or_kind_required';

export function normaliseImageryChangeConfig(
  raw: Record<string, unknown> | undefined,
): { config: ImageryChangeConfig } | { error: ImageryConfigError } {
  const c = raw ?? {};
  const sensor = String(c.sensor ?? 's2_l2a');
  if (sensor !== 's2_l2a' && sensor !== 's1_grd') return { error: 'invalid_sensor' };
  const direction = String(c.direction ?? 'either');
  if (direction !== 'up' && direction !== 'down' && direction !== 'either') return { error: 'invalid_direction' };
  const pct = Number(c.min_change_pct ?? IMAGERY_DEFAULT_CHANGE_PCT);
  if (!Number.isFinite(pct) || pct < IMAGERY_MIN_CHANGE_PCT || pct > IMAGERY_MAX_CHANGE_PCT) {
    return { error: 'invalid_min_change_pct' };
  }
  const aoiRaw = typeof c.aoi_id === 'string' ? c.aoi_id.trim() : '';
  const aoi_id = aoiRaw.length > 0 ? aoiRaw : null;
  if (aoi_id && !/^[a-z_]+:[A-Za-z0-9_.:-]{1,120}$/.test(aoi_id)) return { error: 'invalid_aoi_id' };
  const kindRaw = typeof c.kind === 'string' && c.kind.length > 0 ? c.kind : null;
  if (kindRaw && !(IMAGERY_SITE_KINDS as readonly string[]).includes(kindRaw)) return { error: 'invalid_kind' };
  if (!aoi_id && !kindRaw) return { error: 'site_or_kind_required' };
  return {
    config: {
      sensor,
      aoi_id,
      kind: aoi_id ? null : (kindRaw as ImagerySiteKind),
      direction,
      min_change_pct: Math.round(pct * 10) / 10,
    },
  };
}

const SENSOR_LABEL: Record<ImagerySensor, string> = {
  s2_l2a: 'Sentinel-2 median NDVI',
  s1_grd: 'Sentinel-1 radar bright-return area',
};

const DIRECTION_LABEL: Record<ImageryDirection, string> = {
  up: 'rises',
  down: 'falls',
  either: 'moves',
};

export function suggestImageryRuleName(c: ImageryChangeConfig): string {
  const target = c.aoi_id ?? `any ${c.kind?.replace(/_/g, ' ')}`;
  return `${SENSOR_LABEL[c.sensor]} ${DIRECTION_LABEL[c.direction]} ≥ ${c.min_change_pct} % · ${target}`;
}

export interface JudgedLook {
  aoi_id: string;
  name: string | null;
  kind: string | null;
  sensor: ImagerySensor;
  acquired_at: string;
  coverage_state: string;
  outcome: 'fired' | 'below_threshold' | 'no_baseline' | 'void';
  value: number | null;
  baseline_median: number | null;
  baseline_n: number | null;
  change_pct: number | null;
  chip_path: string | null;
}

export interface ImageryChangeResult {
  fired: JudgedLook[];
  /** Newly judged looks that did not see the site — logged, never fired. */
  voidLooks: number;
  summary: string;
  detailLines: string[];
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function signed(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct} %`;
}

function siteLabel(l: JudgedLook): string {
  return l.name ? `${l.name} (${l.aoi_id})` : l.aoi_id;
}

/** Pure: summary + detail lines from newly judged looks, or null when nothing fired. */
export function summariseJudged(looks: JudgedLook[], config: ImageryChangeConfig): ImageryChangeResult | null {
  const fired = looks.filter(l => l.outcome === 'fired' && l.change_pct !== null && l.value !== null);
  const voidLooks = looks.filter(l => l.outcome === 'void').length;
  if (fired.length === 0) return null;
  const label = SENSOR_LABEL[config.sensor];
  const summary =
    fired.length === 1
      ? `${label} at ${siteLabel(fired[0])} moved ${signed(fired[0].change_pct!)} from its own median on ${day(fired[0].acquired_at)}.`
      : `${label} moved ≥ ${config.min_change_pct} % from its own median at ${new Set(fired.map(f => f.aoi_id)).size} watched site(s) (${fired.length} looks).`;
  const lines: string[] = [];
  for (const f of fired.slice(0, IMAGERY_MAX_DETAIL_LOOKS)) {
    lines.push(
      `${day(f.acquired_at)} — ${siteLabel(f)}: ${signed(f.change_pct!)} vs its median of ${f.baseline_n} earlier clear looks (a clear, cloud-free look).`,
    );
  }
  if (fired.length > IMAGERY_MAX_DETAIL_LOOKS) lines.push(`… and ${fired.length - IMAGERY_MAX_DETAIL_LOOKS} more looks.`);
  if (voidLooks > 0) {
    lines.push(`${voidLooks} other look(s) in this pass did not see the site (cloud, swath, no acquisition): logged as VOID — not zero, not "no change".`);
  }
  lines.push(
    config.sensor === 's2_l2a'
      ? 'Median NDVI is a spectral reading of surface cover inside the site polygon. It is not a tonnage, a volume or an activity level.'
      : 'Radar bright-return area is an estimate that includes anything bright (ships, platforms, coast); it is not a vessel count.',
  );
  lines.push(`Contains modified Copernicus Sentinel data ${new Date().getUTCFullYear()}.`);
  return { fired, voidLooks, summary, detailLines: lines };
}

export async function evaluateImageryChangeRule(
  supabase: SupabaseClient,
  rule: { id: string; config: unknown; created_at?: string | null },
): Promise<{ result: ImageryChangeResult | null; judged: number; voidLooks: number }> {
  const parsed = normaliseImageryChangeConfig(rule.config as Record<string, unknown>);
  if ('error' in parsed) throw new Error(`imagery_change config: ${parsed.error}`);
  const c = parsed.config;
  const created = rule.created_at ? Date.parse(rule.created_at) : Date.now();
  const since = new Date((Number.isFinite(created) ? created : Date.now()) - IMAGERY_FIRST_LOOKBACK_DAYS * 86400_000).toISOString();
  const { data, error } = await supabase.rpc('imagery_rule_evaluate', {
    p_rule_id: rule.id,
    p_sensor: c.sensor,
    p_aoi_id: c.aoi_id,
    p_kind: c.kind,
    p_direction: c.direction,
    p_min_change_pct: c.min_change_pct,
    p_since: since,
  });
  if (error) throw new Error(`imagery_rule_evaluate: ${error.message}`);
  const looks = (data ?? []) as JudgedLook[];
  const voidLooks = looks.filter(l => l.outcome === 'void').length;
  return { result: summariseJudged(looks, c), judged: looks.length, voidLooks };
}

export function buildImageryChangeFirePayload(
  rule: { name: string },
  result: ImageryChangeResult,
  firedAtIso: string,
): FirePayload {
  return {
    ruleName: rule.name,
    ruleType: 'imagery_change',
    summary: result.summary,
    detailLines: result.detailLines,
    rationale: null,
    firedAtIso,
  };
}
