import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { runAnalyst } from '@/lib/intelligence-analyst/run';

// process-anomaly-flags · hourly cron (P2a, supersedes services/supervisor).
//
// The standalone supervisor worker (Layer 1b, 5-min heartbeat) was written to
// turn unprocessed anomaly_flags into agent_reports, but it NEVER completed a
// run in production: agent_reports has zero rows ever and anomaly_flags.processed
// was never set true — which in turn starved every consumer of agent_reports
// (the analyst's query_agent_reports tool, the citizen briefing). This cron
// replaces it inside the web app where the analyst tool loop already lives:
//
//   1. LOW-severity flags are bulk-marked processed with no LLM call — they do
//      not merit a standalone report (same threshold the supervisor used).
//   2. Up to MAX_REPORTS_PER_TICK medium/high/critical flags are grounded into
//      short intelligence reports via runAnalyst (live-tool loop, tier 'pro')
//      and written to agent_reports as global reports (user_id NULL).
//   3. Flags are marked processed even when the LLM call fails, so one bad
//      flag can never poison-pill the queue.
//
// Auth: Bearer <CRON_SECRET>. Cost is capped by design at 8 analyst calls/hour.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_REPORTS_PER_TICK = 8;
const SCAN_LIMIT = 100;
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2 };

interface AnomalyFlag {
  id: string;
  source: string;
  domain: string;
  flag_type: string;
  severity: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

function buildPrompt(flag: AnomalyFlag): string {
  return [
    'You are grounding an automated anomaly flag into a short intelligence report.',
    'Use your live-data tools to verify and contextualise it, then respond in EXACTLY this format:',
    '',
    'TITLE: <one line, max 90 characters, no markdown>',
    'SUMMARY: <2-3 sentences>',
    'NARRATIVE: <1-2 short paragraphs; cite which live signals (provider + reading) ground the assessment>',
    '',
    'If your tools return insufficient data to corroborate the flag, say so honestly in the',
    'summary and narrative — do not invent corroboration.',
    '',
    'Anomaly flag JSON:',
    JSON.stringify(
      {
        source: flag.source,
        domain: flag.domain,
        flag_type: flag.flag_type,
        severity: flag.severity,
        created_at: flag.created_at,
        payload: flag.payload ?? {},
      },
      null,
      2,
    ),
  ].join('\n');
}

/** Parse the TITLE/SUMMARY/NARRATIVE format, falling back gracefully on free text. */
function parseReport(text: string, flag: AnomalyFlag): { title: string; summary: string; narrative: string } {
  const title = /TITLE:\s*(.+)/i.exec(text)?.[1]?.trim();
  const summary = /SUMMARY:\s*([\s\S]*?)(?=\nNARRATIVE:|$)/i.exec(text)?.[1]?.trim();
  const narrative = /NARRATIVE:\s*([\s\S]*)/i.exec(text)?.[1]?.trim();
  return {
    title: (title || `${flag.domain} anomaly: ${flag.flag_type}`).slice(0, 90),
    summary: summary || text.slice(0, 300),
    narrative: narrative || text,
  };
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();

  // 1. Low-severity flags: mark processed in bulk, no report.
  const { data: lowRows, error: lowErr } = await supabase
    .from('anomaly_flags')
    .update({ processed: true })
    .eq('processed', false)
    .eq('severity', 'low')
    .select('id');
  if (lowErr) {
    return NextResponse.json({ ok: false, error: lowErr.message }, { status: 500 });
  }
  const lowSkipped = lowRows?.length ?? 0;

  // 2. Candidates: unprocessed medium/high/critical, severity-major then oldest-first.
  //    (Severity order is enforced in JS — text-column ordering would be alphabetical.)
  const { data: rows, error: candErr } = await supabase
    .from('anomaly_flags')
    .select('id, source, domain, flag_type, severity, payload, created_at')
    .eq('processed', false)
    .in('severity', ['medium', 'high', 'critical'])
    .order('created_at', { ascending: true })
    .limit(SCAN_LIMIT);
  if (candErr) {
    return NextResponse.json({ ok: false, error: candErr.message, low_skipped: lowSkipped }, { status: 500 });
  }

  const candidates = ((rows ?? []) as AnomalyFlag[])
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        a.created_at.localeCompare(b.created_at),
    )
    .slice(0, MAX_REPORTS_PER_TICK);

  // 3. Ground each candidate into an agent_report.
  let reportsWritten = 0;
  let llmFailures = 0;

  for (const flag of candidates) {
    try {
      const out = await runAnalyst({ prompt: buildPrompt(flag), tier: 'pro' });
      const { title, summary, narrative } = parseReport(out.text, flag);

      const payload = flag.payload ?? {};
      const { error: insErr } = await supabase.from('agent_reports').insert({
        domain: flag.domain,
        severity: flag.severity,
        title,
        summary,
        narrative,
        entities: [],
        sources: [flag.source],
        bounding_box: (payload as { bounding_box?: unknown }).bounding_box ?? null,
        user_id: null, // global report — visible to all users per RLS
      });
      if (insErr) throw new Error(`agent_reports insert failed: ${insErr.message}`);
      reportsWritten++;
    } catch (err) {
      // Mark processed anyway (below) so a failing flag cannot poison-pill the queue.
      llmFailures++;
      console.error(
        `[process-anomaly-flags] flag ${flag.id} (${flag.domain}/${flag.flag_type}) failed:`,
        err instanceof Error ? err.message : err,
      );
    }

    const { error: markErr } = await supabase
      .from('anomaly_flags')
      .update({ processed: true })
      .eq('id', flag.id);
    if (markErr) {
      console.error(`[process-anomaly-flags] failed to mark flag ${flag.id} processed:`, markErr.message);
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    low_skipped: lowSkipped,
    candidates: candidates.length,
    reports_written: reportsWritten,
    llm_failures: llmFailures,
  });
}
