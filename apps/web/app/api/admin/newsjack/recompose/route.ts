import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { composeXThread } from '@/lib/copy/x-composer';
import { CODEX_VERSION } from '@/lib/copy/x-codex';
import type { Evidence } from '@/lib/newsjack/template';
import type { Register } from '@/lib/copy/x-voice';

// POST /api/admin/newsjack/recompose — DRY RUN ONLY.
//
// Re-writes existing X drafts through the copywriting agent and returns a
// before/after report.
//
// IT NEVER WRITES A NEWSJACK ROW. No commit mode, no query flag that enables
// one, no insert/update/upsert/delete anywhere in this file. The queue stays
// exactly as the founder left it while the output is being judged.
//
// PRECISELY ONE THING IS WRITTEN, and it is not a draft: composeXThread calls
// recordLlmTurn, which inserts a row into cost_events per composition. That is
// deliberate and must not be suppressed — the spend is real, and a ledger that
// undercounts against the Anthropic invoice reads as efficiency rather than as
// a missing entry. "Dry run" here means "changes nothing you are reviewing",
// not "touches no table". Say it that way.
//
// WHY THIS EXISTS. The composer has never written anything. Cadence is 4–8
// events per 90 days, so waiting for a live event to find out whether the
// register is right could take weeks. This runs it against real evidence
// packages that already exist and shows the two versions side by side.
//
// WHAT THE OUTPUT IS AND IS NOT. It is a TEST CORPUS and a register decision
// aid. It is NOT a publication queue. Newsjacking windows are 15–60 minutes
// and the evidence in these rows was computed when the event fired, so a
// recomposed 3-week-old draft is well-written copy about a dead event.
// Rewriting the words does not refresh the facts. The response says so on
// every row, via `stale`.
//
// BLOCKED EVENTS ARE EXCLUDED BY CONSTRUCTION. 96 of the 109 blocked rows
// were blocked for "no sourced insight" — an evidence failure the writer
// cannot fix. Recomposing them would turn a justified block into something
// that merely LOOKS publishable, which is the exact failure the gates exist
// to prevent. `status = 'drafted'` below is load-bearing, not a convenience.

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_DAYS = 7;
const MAX_DRAFTS = 30;   // ~30 Sonnet calls; the route budget, not a sample
const STALE_AFTER_HOURS = 48;

interface EventRow {
  id: string;
  created_at: string;
  domain: string | null;
  region: string | null;
  severity: string | null;
  covered: boolean;
  status: string;
  evidence: Record<string, unknown> | null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const days = clampInt(url.searchParams.get('days'), DEFAULT_DAYS, 1, 30);
  const limit = clampInt(url.searchParams.get('limit'), MAX_DRAFTS, 1, MAX_DRAFTS);
  const rawReg = (url.searchParams.get('register') ?? '').toLowerCase();
  const register: Register | undefined =
    rawReg === 'flat' || rawReg === 'dry' || rawReg === 'open' ? rawReg : undefined;

  // Echo the inputs back. A ?days=14 request that reports 7 is a stale build,
  // and that is only visible from outside if the response says what it did.
  const echo = {
    days,
    limit,
    register: register ?? 'deployed default',
    codexVersion: CODEX_VERSION,
    dryRun: true as const,
  };

  const supabase = createServerSupabase();
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  const { data, error } = await supabase
    .from('newsjack_drafts')
    .select(
      'id, posts, ref_url, created_at, newsjack_events!inner(id, created_at, domain, region, severity, covered, status, evidence)',
    )
    .eq('channel', 'x')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit * 3); // over-fetch: the status filter below is applied in JS
  if (error) {
    return NextResponse.json({ ...echo, error: error.message }, { status: 500 });
  }

  type Row = { id: string; posts: unknown; ref_url: string | null; created_at: string; newsjack_events: EventRow | EventRow[] | null };
  const rows = ((data as Row[] | null) ?? [])
    .map((r) => ({ ...r, ev: Array.isArray(r.newsjack_events) ? r.newsjack_events[0] : r.newsjack_events }))
    .filter((r) => r.ev && r.ev.status === 'drafted')
    .slice(0, limit);

  const results = [];
  let composedByAgent = 0;
  let fellBack = 0;

  for (const r of rows) {
    const ev = r.ev as EventRow;
    const e = (ev.evidence ?? {}) as Record<string, unknown>;

    // Rebuild the evidence package the engine passed the first time. If the
    // row cannot produce one, skip it loudly rather than composing from a
    // half-empty package and reporting the result as comparable.
    const evidence: Evidence = {
      domain: ev.domain,
      region: ev.region,
      severity: ev.severity,
      headline: str(e.headline) ?? '',
      analystLine: str(e.analystLine) ?? '',
      sources: Array.isArray(e.sources) ? (e.sources as string[]) : [],
      replayUrl: str(e.replayUrl) ?? '',
      framing: e.framing === 'analytical' ? 'analytical' : 'live',
      seatsRemaining: null,
    };
    if (!evidence.analystLine || !evidence.replayUrl) {
      results.push({
        draftId: r.id,
        skipped: 'evidence package incomplete on the stored row',
        region: ev.region,
      });
      continue;
    }

    const before = Array.isArray(r.posts) ? (r.posts as string[]) : [];
    // force: true — the deployed kill switch is almost certainly still off,
    // and a dry run that silently returned template output would be useless
    // at exactly the moment it is needed. This is the ONLY caller that forces.
    const after = await composeXThread(evidence, [], { force: true, register });
    if (after.meta.composer === 'agent') composedByAgent++;
    else fellBack++;

    const ageHours = Math.round((Date.now() - new Date(ev.created_at).getTime()) / 3_600_000);

    results.push({
      draftId: r.id,
      eventId: ev.id,
      region: ev.region,
      domain: ev.domain,
      severity: ev.severity,
      framing: evidence.framing,
      ageHours,
      // The honest label on every row. A recomposed old draft is a writing
      // sample, never a post.
      stale: ageHours > STALE_AFTER_HOURS,
      publishable: ageHours <= STALE_AFTER_HOURS ? 'maybe — check the facts still hold' : 'no — the newsjack window closed',
      before,
      after: after.posts,
      composer: after.meta.composer,
      model: after.meta.model,
      register: after.meta.register,
      attempts: after.meta.attempts,
      fallbackReason: after.meta.fallbackReason,
      craftWarnings: after.meta.craftWarnings,
    });
  }

  return NextResponse.json({
    ...echo,
    note:
      'DRY RUN. No draft was created or changed; the only rows written are cost_events, one per composition, because the spend is real. This is a writing sample and a register decision aid, not a publication queue — recomposing copy does not refresh the underlying evidence.',
    scanned: rows.length,
    composedByAgent,
    fellBack,
    results,
  });
}

function clampInt(raw: string | null, dflt: number, min: number, max: number): number {
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
