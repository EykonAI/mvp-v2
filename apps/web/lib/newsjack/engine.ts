import { createServerSupabase } from '@/lib/supabase-server';
import { runAnalyst } from '@/lib/intelligence-analyst/run';
import { isCoveredRegion, framingFor } from '@/lib/newsjack/coverage';
import { voiceLint, coverageLint, valueTest } from '@/lib/newsjack/lints';
import { renderXThread, threadToBody, type Evidence } from '@/lib/newsjack/template';
import { eventExistsForSource, insertEvent, insertDraft } from '@/lib/newsjack/store';
import { notifyFounder } from '@/lib/newsjack/notify';

// The detect → package → draft → store loop (Newsjacking SOP §5). Runs from
// the newsjack-detect cron. It NEVER publishes — approval happens in
// /admin/newsjack. Every guardrail in §4/§8 is enforced here: freshness,
// severity, dedupe, coverage honesty, voice, the value test.

type SB = ReturnType<typeof createServerSupabase>;

const FRESH_HOURS = 6; // newsjacking is about NOW — only flags this recent
const MAX_PER_TICK = 3; // analyst calls are costly; cap drafts per run
const SCAN_LIMIT = 25; // candidate flags to inspect per run
const SEVERITY_OK = new Set(['medium', 'high']);
const PUBLIC_BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://eykon.ai').replace(/\/+$/, '');

interface AnomalyRow {
  id: string;
  source: string;
  domain: string | null;
  severity: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface TickResult {
  scanned: number;
  drafted: number;
  blocked: number;
  skipped: number;
  details: Array<{ flag: string; outcome: string; note?: string }>;
}

export async function runDetectTick(supabase: SB): Promise<TickResult> {
  const res: TickResult = { scanned: 0, drafted: 0, blocked: 0, skipped: 0, details: [] };
  const sinceIso = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();

  const { data, error } = await supabase
    .from('anomaly_flags')
    .select('id, source, domain, severity, payload, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(SCAN_LIMIT);
  if (error) {
    res.details.push({ flag: '-', outcome: 'query_error', note: error.message });
    return res;
  }

  const rows = (data as AnomalyRow[] | null) ?? [];
  for (const flag of rows) {
    if (res.drafted + res.blocked >= MAX_PER_TICK) break;
    res.scanned++;

    // Guardrails: severity floor + not already seen.
    if (!SEVERITY_OK.has((flag.severity ?? '').toLowerCase())) {
      res.skipped++;
      res.details.push({ flag: flag.id, outcome: 'skip_low_severity' });
      continue;
    }
    if (await eventExistsForSource(supabase, 'anomaly_flag', flag.id)) {
      res.skipped++;
      res.details.push({ flag: flag.id, outcome: 'skip_seen' });
      continue;
    }

    const p = flag.payload ?? {};
    const region = str(p.theatre_label) ?? str(p.theatre) ?? str(p.region);
    const covered = isCoveredRegion(region);
    const framing = framingFor(region);
    const eventKey = `anomaly:${flag.domain ?? 'x'}:${region ?? 'x'}:${flag.created_at.slice(0, 13)}`;

    // ── Package: ask the analyst for ONE dense, sourced line ──
    let analystText = '';
    let toolCalls = 0;
    try {
      const out = await runAnalyst({ prompt: buildAnalystPrompt(flag, region, framing), tier: 'pro' });
      analystText = out.text.trim();
      toolCalls = out.toolCalls;
    } catch (err) {
      res.skipped++;
      res.details.push({ flag: flag.id, outcome: 'analyst_error', note: err instanceof Error ? err.message : 'unknown' });
      continue;
    }

    const noData = /insufficient (live )?data/i.test(analystText) || analystText.length === 0;
    const hasSources = toolCalls > 0 && !noData;
    const replayUrl = buildReplayUrl(p);

    const evidence: Evidence = {
      domain: flag.domain,
      region,
      severity: flag.severity,
      headline: buildHeadline(flag, region),
      analystLine: firstLine(analystText) || 'insufficient live data',
      sources: extractSources(analystText),
      replayUrl,
      framing,
      seatsRemaining: null,
    };

    const { posts, refUrl } = renderXThread(evidence);
    const body = threadToBody(posts);
    const voice = voiceLint(body);
    const coverage = coverageLint(body);
    const value = valueTest({ hasSources, replayUrl: refUrl, body });

    const blocked = !voice.ok || !coverage.ok || !value.pass;
    const eventId = await insertEvent(supabase, {
      source: 'anomaly_flag',
      source_ref: flag.id,
      event_key: eventKey,
      domain: flag.domain,
      region,
      severity: flag.severity,
      covered,
      status: blocked ? 'blocked' : 'drafted',
      blocked_reason: blocked ? [...voice.violations, ...coverage.violations, ...value.reasons].join('; ') : null,
      evidence: { ...evidence, analystText, toolCalls, hasSources },
    });
    if (!eventId) {
      res.skipped++;
      res.details.push({ flag: flag.id, outcome: 'insert_failed_or_duplicate' });
      continue;
    }

    await insertDraft(supabase, {
      event_id: eventId,
      channel: 'x',
      body,
      posts,
      ref_url: refUrl,
      lints: { voice, coverage, value },
      value_pass: value.pass,
      status: 'draft',
    });

    if (blocked) {
      res.blocked++;
      res.details.push({ flag: flag.id, outcome: 'blocked', note: [...voice.violations, ...coverage.violations, ...value.reasons].join('; ') });
    } else {
      res.drafted++;
      res.details.push({ flag: flag.id, outcome: 'drafted' });
      await notifyFounder({
        domain: flag.domain,
        region,
        severity: flag.severity,
        lead: posts[0] ?? '',
        adminUrl: `${PUBLIC_BASE}/admin/newsjack`,
      });
    }
  }

  return res;
}

// ── helpers ─────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function buildAnalystPrompt(flag: AnomalyRow, region: string | null, framing: 'live' | 'analytical'): string {
  const where = region ? ` near ${region}` : '';
  const coverageNote =
    framing === 'analytical'
      ? ' Note: live AIS for this region is not on the current tier — frame analytically, do not claim live vessel coverage.'
      : '';
  return (
    `A ${flag.severity ?? 'notable'} ${flag.domain ?? 'geopolitical'} anomaly just fired${where}. ` +
    `Using your live-data tools, write ONE dense sentence (<=230 characters) that an analyst or macro trader would value: ` +
    `what is happening and the historical base rate or market read. Name the feed(s) you used (e.g. GDELT, AIS, ADS-B, EIA, ACLED). ` +
    `No emojis. No exclamation marks. No marketing language. ` +
    `If you do not have the live data to support a claim, reply exactly "insufficient live data" and nothing else.${coverageNote}`
  );
}

function buildHeadline(flag: AnomalyRow, region: string | null): string {
  const where = region ?? 'a monitored theatre';
  const dom = (flag.domain ?? 'activity').toLowerCase();
  return `A ${flag.severity ?? ''} ${dom} anomaly is unfolding near ${where}.`.replace(/\s+/g, ' ').trim();
}

// Replay/live-view URL: the globe focused on the incident point. Honest — it is
// the live operational surface, not an invented /replay route.
function buildReplayUrl(payload: Record<string, unknown>): string {
  const lat = Number(payload.latitude);
  const lon = Number(payload.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `${PUBLIC_BASE}/app?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
  }
  return `${PUBLIC_BASE}/app`;
}

function firstLine(text: string): string {
  const line = text.split(/\n/).map((s) => s.trim()).find(Boolean) ?? '';
  return line.replace(/^["“]|["”]$/g, '').trim();
}

// Pull citation labels (known feed names + any URLs) out of the analyst reply.
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
