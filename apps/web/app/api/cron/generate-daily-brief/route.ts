import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { getAnthropic } from '@/lib/anthropic';
import { fetchDigestSources, composeDigest, type DigestData } from '@/lib/notifications/digest';

// generate-daily-brief · daily cron (Railway: 0 6 * * * — 06:00 UTC,
// an hour before send-digests so the day's brief exists before email).
//
// Writes ONE persisted plain-language brief per UTC day into
// daily_briefs (migration 071). The BRIEFS "Today" page reads the
// stored row instead of regenerating an LLM brief per page view.
// Grounding reuses the digest source layer (fetchDigestSources +
// composeDigest — the same five live tables that feed the email
// digest), NOT the legacy /api/intel/briefing inputs: agent_reports
// has no writer running in production and anomaly_flags.processed is
// never promoted, so that route composed from empty evidence and the
// brief never changed day to day.
//
// Unlike the email digest (skipped on empty windows so users don't get
// "nothing happened" mail), the Today page must always have a brief —
// an empty window stores deterministic quiet-period copy without
// spending an LLM call.
//
// Idempotency: one row per brief_date; a re-run within the same UTC
// day no-ops unless ?force=1 (which regenerates in place).
// Auth: Bearer <CRON_SECRET>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = 'claude-sonnet-4-5';

const QUIET_COPY =
  'A quiet period. Over the last 24 hours the monitored feeds produced no anomaly ' +
  'flags, convergences, infrastructure incidents, or notable conflict events above ' +
  'reporting thresholds. Theatre posture scores continued to update on schedule ' +
  'without significant movement.\n\n' +
  'What I am unsure about: a quiet window in the data is not proof of a quiet world — ' +
  'it can also mean the underlying providers reported late or thinly. Check the live ' +
  'globe for current positions.';

function briefPrompt(digest: DigestData): string {
  return [
    "Write today's eYKON daily brief from the evidence below.",
    '',
    'Rules:',
    '- Plain language, roughly 300 words. No acronyms, no jargon.',
    '- What is happening, why it matters, what is still unclear.',
    '- Use ONLY the evidence provided. Never invent events, numbers, or places.',
    '- Attribute claims to their stream (e.g. "anomaly detection flagged…", "conflict reporting recorded…", "posture scoring moved…").',
    '- End with a mandatory paragraph starting exactly with "What I am unsure about:".',
    '- Output the brief text only — no title, no preamble, no markdown headings.',
    '',
    `Evidence (last ${digest.windowHours}h, composed ${new Date().toISOString()}):`,
    JSON.stringify(
      {
        convergences: digest.convergences,
        anomalies: digest.anomalies,
        infrastructure_incidents: digest.infraIncidents,
        top_conflict_events: digest.conflictTop,
        posture_movers: digest.postureMovers,
        totals: digest.totals,
      },
      null,
      2,
    ),
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const force = new URL(req.url).searchParams.get('force') === '1';
  const supabase = createServerSupabase();
  const briefDate = new Date().toISOString().slice(0, 10); // UTC day

  if (!force) {
    const { data: existing } = await supabase
      .from('daily_briefs')
      .select('id, generated_at')
      .eq('brief_date', briefDate)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ skipped: 'already generated', brief_date: briefDate, generated_at: existing.generated_at });
    }
  }

  const sources = await fetchDigestSources(supabase, 24);
  const digest = composeDigest(sources, 'citizen', 'daily');

  let content: string;
  let model: string | null = null;

  if (digest.isEmpty) {
    content = QUIET_COPY;
  } else {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        'You are the eYKON.ai daily briefing writer. You turn structured intelligence ' +
        'evidence into a calm, sourced, plain-language brief for a general reader.',
      messages: [{ role: 'user', content: briefPrompt(digest) }],
    });
    content = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    if (!content) {
      return NextResponse.json({ ok: false, error: 'model returned empty brief' }, { status: 500 });
    }
    model = MODEL;
  }

  const row = {
    brief_date: briefDate,
    content,
    is_quiet: digest.isEmpty,
    sources: {
      totals: digest.totals,
      convergences: digest.convergences.length,
      posture_movers: digest.postureMovers.length,
      source_errors: sources.errors,
      digest,
    },
    model,
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('daily_briefs')
    .upsert(row, { onConflict: 'brief_date' });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    brief_date: briefDate,
    quiet: digest.isEmpty,
    model,
    forced: force,
    chars: content.length,
    source_errors: sources.errors,
  });
}
