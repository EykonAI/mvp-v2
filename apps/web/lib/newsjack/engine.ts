import { createServerSupabase } from '@/lib/supabase-server';
import { runAnalyst } from '@/lib/intelligence-analyst/run';
import { isCoveredRegion, framingFor } from '@/lib/newsjack/coverage';
import { voiceLint, coverageLint, valueTest } from '@/lib/newsjack/lints';
import { renderXThread, renderLinkedIn, renderSubstack, threadToBody, type Evidence } from '@/lib/newsjack/template';
import { eventExistsForSource, insertEvent, insertDraft } from '@/lib/newsjack/store';
import { notifyFounder } from '@/lib/newsjack/notify';

// The detect → package → draft → store loop (Newsjacking SOP §5). Runs from the
// newsjack-detect cron; it NEVER publishes (approval happens in /admin/newsjack).
// v1: two sources (anomaly_flags + convergence_events) unified into a Candidate,
// and three channel drafts per event (X thread + LinkedIn + Substack). Every
// guardrail in §4/§8 is enforced: freshness, severity, dedupe, coverage honesty,
// voice, the value test.

type SB = ReturnType<typeof createServerSupabase>;

const ANOMALY_FRESH_HOURS = 6; // anomalies are hourly — newsjacking is about NOW
const CONVERGENCE_FRESH_HOURS = 48; // convergences are computed nightly
const CONVERGENCE_MAX_P = 0.05; // only statistically strong convergences
const MAX_PER_TICK = 3; // analyst calls are costly; cap events per run
const SCAN_LIMIT = 25;
const SEVERITY_OK = new Set(['medium', 'high']);
const PUBLIC_BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://eykon.ai').replace(/\/+$/, '');

interface Candidate {
  source: 'anomaly_flag' | 'convergence_event';
  sourceRef: string;
  createdAt: string;
  domain: string | null;
  region: string | null;
  severity: string | null;
  lat: number | null;
  lon: number | null;
  context: string; // grounding for the analyst (a convergence synthesis, or an anomaly summary)
}

export interface TickResult {
  scanned: number;
  drafted: number;
  blocked: number;
  skipped: number;
  details: Array<{ ref: string; source: string; outcome: string; note?: string }>;
}

export async function runDetectTick(supabase: SB): Promise<TickResult> {
  const res: TickResult = { scanned: 0, drafted: 0, blocked: 0, skipped: 0, details: [] };

  // Convergences first (richer, multi-domain), then single-domain anomalies.
  const candidates = [
    ...(await collectConvergences(supabase)),
    ...(await collectAnomalies(supabase)),
  ];

  for (const cand of candidates) {
    if (res.drafted + res.blocked >= MAX_PER_TICK) break;
    res.scanned++;

    if (await eventExistsForSource(supabase, cand.source, cand.sourceRef)) {
      res.skipped++;
      res.details.push({ ref: cand.sourceRef, source: cand.source, outcome: 'skip_seen' });
      continue;
    }

    const covered = isCoveredRegion(cand.region);
    const framing = framingFor(cand.region);

    // ── Package: one dense, sourced analyst line ──
    let analystText = '';
    let toolCalls = 0;
    try {
      const out = await runAnalyst({ prompt: buildAnalystPrompt(cand, framing), tier: 'pro' });
      analystText = out.text.trim();
      toolCalls = out.toolCalls;
    } catch (err) {
      res.skipped++;
      res.details.push({ ref: cand.sourceRef, source: cand.source, outcome: 'analyst_error', note: err instanceof Error ? err.message : 'unknown' });
      continue;
    }

    const noData = /insufficient (live )?data/i.test(analystText) || analystText.length === 0;
    const hasSources = toolCalls > 0 && !noData;

    const evidence: Evidence = {
      domain: cand.domain,
      region: cand.region,
      severity: cand.severity,
      headline: buildHeadline(cand),
      analystLine: firstLine(analystText) || 'insufficient live data',
      sources: extractSources(analystText),
      replayUrl: buildReplayUrl(cand),
      framing,
      seatsRemaining: null,
    };

    const x = renderXThread(evidence);
    const body = threadToBody(x.posts);
    const voice = voiceLint(body);
    const coverage = coverageLint(body);
    const value = valueTest({ hasSources, replayUrl: x.refUrl, body });
    const blocked = !voice.ok || !coverage.ok || !value.pass;

    const eventKey = `${cand.source}:${cand.domain ?? 'x'}:${cand.region ?? 'x'}:${cand.createdAt.slice(0, 13)}`;
    const eventId = await insertEvent(supabase, {
      source: cand.source,
      source_ref: cand.sourceRef,
      event_key: eventKey,
      domain: cand.domain,
      region: cand.region,
      severity: cand.severity,
      covered,
      status: blocked ? 'blocked' : 'drafted',
      blocked_reason: blocked ? [...voice.violations, ...coverage.violations, ...value.reasons].join('; ') : null,
      evidence: { ...evidence, analystText, toolCalls, hasSources, sourceKind: cand.source },
    });
    if (!eventId) {
      res.skipped++;
      res.details.push({ ref: cand.sourceRef, source: cand.source, outcome: 'insert_failed_or_duplicate' });
      continue;
    }

    // X draft (always). LinkedIn + Substack variants only when the event passed
    // the gates — no point drafting variants of a blocked event.
    await insertDraft(supabase, {
      event_id: eventId,
      channel: 'x',
      body,
      posts: x.posts,
      ref_url: x.refUrl,
      lints: { voice, coverage, value },
      value_pass: value.pass,
      status: 'draft',
    });

    if (!blocked) {
      const li = renderLinkedIn(evidence);
      await insertDraft(supabase, {
        event_id: eventId,
        channel: 'linkedin',
        body: li.body,
        posts: [li.body],
        ref_url: li.refUrl,
        lints: { voice: voiceLint(li.body), coverage: coverageLint(li.body) },
        value_pass: voiceLint(li.body).ok && coverageLint(li.body).ok,
        status: 'draft',
      });
      const sub = renderSubstack(evidence);
      await insertDraft(supabase, {
        event_id: eventId,
        channel: 'substack',
        body: sub.body,
        posts: [sub.body],
        ref_url: sub.refUrl,
        lints: { voice: voiceLint(sub.body), coverage: coverageLint(sub.body) },
        value_pass: voiceLint(sub.body).ok && coverageLint(sub.body).ok,
        status: 'draft',
      });
    }

    if (blocked) {
      res.blocked++;
      res.details.push({ ref: cand.sourceRef, source: cand.source, outcome: 'blocked', note: [...voice.violations, ...coverage.violations, ...value.reasons].join('; ') });
    } else {
      res.drafted++;
      res.details.push({ ref: cand.sourceRef, source: cand.source, outcome: 'drafted' });
      await notifyFounder({
        domain: cand.domain,
        region: cand.region,
        severity: cand.severity,
        lead: x.posts[0] ?? '',
        adminUrl: `${PUBLIC_BASE}/admin/newsjack`,
      });
    }
  }

  return res;
}

// ── sources → candidates ────────────────────────────────────────

interface AnomalyRow {
  id: string;
  domain: string | null;
  severity: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

async function collectAnomalies(supabase: SB): Promise<Candidate[]> {
  const sinceIso = new Date(Date.now() - ANOMALY_FRESH_HOURS * 3600_000).toISOString();
  const { data } = await supabase
    .from('anomaly_flags')
    .select('id, domain, severity, payload, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(SCAN_LIMIT);
  const rows = (data as AnomalyRow[] | null) ?? [];
  const out: Candidate[] = [];
  for (const r of rows) {
    if (!SEVERITY_OK.has((r.severity ?? '').toLowerCase())) continue;
    const p = r.payload ?? {};
    const region = str(p.theatre_label) ?? str(p.theatre) ?? str(p.region);
    out.push({
      source: 'anomaly_flag',
      sourceRef: r.id,
      createdAt: r.created_at,
      domain: r.domain,
      region,
      severity: r.severity,
      lat: numOrNull(p.latitude),
      lon: numOrNull(p.longitude),
      context: `${r.severity ?? ''} ${r.domain ?? ''} anomaly near ${region ?? 'a monitored theatre'}.`.replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

interface ConvergenceRow {
  id: string;
  location: string | null;
  bounding_box: Record<string, unknown> | null;
  joint_p_value: number | null;
  synthesis: string | null;
  created_at: string;
}

async function collectConvergences(supabase: SB): Promise<Candidate[]> {
  const sinceIso = new Date(Date.now() - CONVERGENCE_FRESH_HOURS * 3600_000).toISOString();
  const { data } = await supabase
    .from('convergence_events')
    .select('id, location, bounding_box, joint_p_value, synthesis, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(SCAN_LIMIT);
  const rows = (data as ConvergenceRow[] | null) ?? [];
  const out: Candidate[] = [];
  for (const r of rows) {
    const p = typeof r.joint_p_value === 'number' ? r.joint_p_value : 1;
    if (p > CONVERGENCE_MAX_P) continue;
    const c = bboxCentroid(r.bounding_box);
    out.push({
      source: 'convergence_event',
      sourceRef: r.id,
      createdAt: r.created_at,
      domain: 'Convergence',
      region: r.location,
      severity: p < 0.01 ? 'high' : 'medium',
      lat: c.lat,
      lon: c.lon,
      context: str(r.synthesis) ?? `Multi-domain convergence at ${r.location ?? 'a monitored area'} (joint p=${p}).`,
    });
  }
  return out;
}

// ── helpers ─────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bboxCentroid(b: Record<string, unknown> | null): { lat: number | null; lon: number | null } {
  if (!b) return { lat: null, lon: null };
  const latMin = numOrNull(b.lat_min ?? b.min_lat ?? b.minLat);
  const latMax = numOrNull(b.lat_max ?? b.max_lat ?? b.maxLat);
  const lonMin = numOrNull(b.lon_min ?? b.min_lon ?? b.minLon);
  const lonMax = numOrNull(b.lon_max ?? b.max_lon ?? b.maxLon);
  if (latMin != null && latMax != null && lonMin != null && lonMax != null) {
    return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
  }
  return { lat: null, lon: null };
}

function buildAnalystPrompt(cand: Candidate, framing: 'live' | 'analytical'): string {
  const coverageNote =
    framing === 'analytical'
      ? ' Note: live AIS for this region is not on the current tier — frame analytically, do not claim live vessel coverage.'
      : '';
  return (
    `Context: ${cand.context}\n\n` +
    `Using your live-data tools, write ONE dense sentence (<=230 characters) that an analyst or macro trader would value: ` +
    `what is happening and the historical base rate or market read. Name the feed(s) you used (e.g. GDELT, AIS, ADS-B, EIA, ACLED). ` +
    `No emojis. No exclamation marks. No marketing language. ` +
    `If you do not have the live data to support a claim, reply exactly "insufficient live data" and nothing else.${coverageNote}`
  );
}

function buildHeadline(cand: Candidate): string {
  const where = cand.region ?? 'a monitored theatre';
  if (cand.source === 'convergence_event') {
    return `A multi-domain convergence is developing at ${where}.`;
  }
  const dom = (cand.domain ?? 'activity').toLowerCase();
  return `A ${cand.severity ?? ''} ${dom} anomaly is unfolding near ${where}.`.replace(/\s+/g, ' ').trim();
}

// Live-view URL: the globe focused on the incident point. Honest — the live
// operational surface, not an invented /replay route.
function buildReplayUrl(cand: Candidate): string {
  if (cand.lat != null && cand.lon != null) {
    return `${PUBLIC_BASE}/app?lat=${cand.lat.toFixed(3)}&lon=${cand.lon.toFixed(3)}`;
  }
  return `${PUBLIC_BASE}/app`;
}

function firstLine(text: string): string {
  const line = text.split(/\n/).map((s) => s.trim()).find(Boolean) ?? '';
  return line.replace(/^["“]|["”]$/g, '').trim();
}

function extractSources(text: string): string[] {
  const feeds = ['GDELT', 'AIS', 'ADS-B', 'ADSB', 'EIA', 'ACLED', 'OFAC', 'ENTSO-E', 'GEM', 'Polymarket'];
  const found = new Set<string>();
  for (const f of feeds) {
    if (new RegExp(`\\b${f.replace(/[-]/g, '\\-')}\\b`, 'i').test(text)) found.add(f === 'ADSB' ? 'ADS-B' : f);
  }
  const urls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  for (const u of urls.slice(0, 2)) found.add(u);
  return Array.from(found);
}
