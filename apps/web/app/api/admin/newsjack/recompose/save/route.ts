import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { getDraft, insertRevisedDraft } from '@/lib/newsjack/store';
import { voiceLint, coverageLint, valueTest } from '@/lib/newsjack/lints';
import { craftLint } from '@/lib/copy/x-craft-lints';
import { threadToBody, type Evidence } from '@/lib/newsjack/template';
import { CODEX_VERSION } from '@/lib/copy/x-codex';

// POST /api/admin/newsjack/recompose/save — the ONE write path out of the
// dry-run surface. Founder-gated.
//
// Saves a recomposed thread into the review queue as a NEW revision beside
// the original. It does NOT publish, does NOT approve, and does NOT touch
// the row it was recomposed from. The saved row lands as status 'draft' and
// still needs the founder's tap on /admin/newsjack like everything else.
//
// WHY IT RE-RUNS EVERY GATE ON POSTS THE BROWSER SENT.
//
// The obvious shortcut is to trust the client: it already has the thread the
// dry run displayed, so just persist it. That would make this endpoint a way
// to put ARBITRARY text into the publish queue with composer='agent' stamped
// on it — bypassing the voice, coverage and value gates that are the entire
// reason the engine is trustworthy. A founder-only route is not an excuse:
// the gates exist to catch mistakes, not only malice, and "the founder typed
// it" is exactly the case where a coverage overclaim slips through.
//
// So every gate runs again here, server-side, on the exact bytes received.
// What you saw in the dry run is what gets saved, and only if it still
// passes. The evidence package is re-read from the stored event rather than
// accepted from the browser, so the coverage verdict cannot be spoofed.

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

interface Body {
  draftId?: string;
  posts?: unknown;
  composer?: unknown;
  model?: unknown;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const draftId = typeof body.draftId === 'string' ? body.draftId : null;
  const posts = Array.isArray(body.posts)
    ? body.posts.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean)
    : [];
  if (!draftId || posts.length === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const supabase = createServerSupabase();

  const original = await getDraft(supabase, draftId);
  if (!original) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (original.channel !== 'x') {
    return NextResponse.json({ error: 'only_x_channel' }, { status: 400 });
  }

  // Re-read the evidence from the event. Never from the request body — the
  // coverage verdict decides whether we may say "live", and a client that
  // could set it could launder an overclaim past coverageLint.
  const { data: evRow } = await supabase
    .from('newsjack_events')
    .select('id, domain, region, severity, status, evidence')
    .eq('id', original.event_id)
    .maybeSingle();
  if (!evRow) return NextResponse.json({ error: 'event_not_found' }, { status: 404 });

  const row = evRow as {
    id: string; domain: string | null; region: string | null;
    severity: string | null; status: string; evidence: Record<string, unknown> | null;
  };

  // Blocked events stay blocked. 96 of 109 were blocked for having no sourced
  // insight — an evidence gap no rewrite closes. Saving a revision against one
  // would be the laundering the dry-run surface was built to avoid.
  if (row.status !== 'drafted') {
    return NextResponse.json(
      { error: 'event_not_drafted', detail: `event status is '${row.status}' — only drafted events accept revisions` },
      { status: 409 },
    );
  }

  const e = (row.evidence ?? {}) as Record<string, unknown>;
  const evidence: Evidence = {
    domain: row.domain,
    region: row.region,
    severity: row.severity,
    headline: typeof e.headline === 'string' ? e.headline : '',
    analystLine: typeof e.analystLine === 'string' ? e.analystLine : '',
    sources: Array.isArray(e.sources) ? (e.sources as string[]) : [],
    replayUrl: typeof e.replayUrl === 'string' ? e.replayUrl : '',
    framing: e.framing === 'analytical' ? 'analytical' : 'live',
    seatsRemaining: null,
  };

  const refUrl = original.posts.length
    ? extractUrl(original.posts[original.posts.length - 1])
    : null;
  if (!refUrl) {
    return NextResponse.json({ error: 'no_ref_url_on_original' }, { status: 409 });
  }

  // Every gate, on the exact bytes received.
  const threadBody = threadToBody(posts);
  const voice = voiceLint(threadBody);
  const coverage = coverageLint(threadBody);
  // hasSources is what the ANALYST returned at detection time, not something
  // a rewrite can create. The engine stored it on the evidence blob; read it
  // from there. (An earlier draft of this line read `... || true`, which is
  // always true and silently disabled the check.)
  const hasSources = e.hasSources === true || evidence.sources.length > 0;
  const value = valueTest({ hasSources, replayUrl: refUrl, body: threadBody });
  const craft = craftLint(posts, evidence, refUrl, []);

  const violations = [...voice.violations, ...coverage.violations, ...craft.violations];
  if (!value.pass) violations.push(...value.reasons);
  if (violations.length) {
    return NextResponse.json(
      { error: 'gates_failed', violations },
      { status: 422 },
    );
  }

  const composer = body.composer === 'agent' ? 'agent' : 'template';
  const model = typeof body.model === 'string' ? body.model : null;

  const revision = await insertRevisedDraft(supabase, {
    supersedes_draft_id: draftId,
    event_id: original.event_id,
    channel: 'x',
    body: threadBody,
    posts,
    ref_url: refUrl,
    lints: { voice, coverage, value, craft },
    composer,
    composer_model: model,
    codex_version: CODEX_VERSION,
    craft_warnings: craft.warnings,
  });

  if (revision == null) {
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    revision,
    supersedes: draftId,
    status: 'draft',
    detail: `saved as revision ${revision} — review and publish it on /admin/newsjack`,
    craftWarnings: craft.warnings,
  });
}

function extractUrl(s: string): string | null {
  const m = s.match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[.,;]$/, '') : null;
}
