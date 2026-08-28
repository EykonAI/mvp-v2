import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { getDraft, approveDraft, rejectDraft, editDraft, markPublished } from '@/lib/newsjack/store';
import { publishThread } from '@/lib/newsjack/publish';
import { publishDiscord, discordConfigured } from '@/lib/newsjack/discord-publish';

// POST /api/admin/newsjack/[id] — founder-only review actions on a draft
// (Newsjacking SOP layer 4/5). Approve → publish via the configured webhook,
// or fall back to manual mode. Nothing here is reachable without isFounder.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = { action?: string; edited_body?: string; published_url?: string };

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  const supabase = createServerSupabase();
  const draft = await getDraft(supabase, params.id);
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  switch (body.action) {
    case 'approve': {
      const ok = await approveDraft(supabase, params.id);
      if (!ok) return NextResponse.json({ error: 'update_failed' }, { status: 500 });
      // X auto-publishes via the native API; Discord auto-publishes to the
      // OWNED server's webhook when configured (PR-4). Everything else is
      // copy-to-post: LinkedIn/Substack by workflow, Reddit and TikTok by
      // decision (§13.4.1 — licensing, shadowban risk, the posting audit).
      if (draft.channel === 'x') {
        const pub = await publishThread(draft.posts);
        if (pub.ok) await markPublished(supabase, params.id, pub.url ?? null);
        return NextResponse.json({ ok: true, channel: draft.channel, published: pub.ok, mode: pub.mode, url: pub.url, detail: pub.detail, posts: draft.posts });
      }
      if (draft.channel === 'discord' && discordConfigured()) {
        const pub = await publishDiscord(draft.posts);
        if (pub.ok) await markPublished(supabase, params.id, null);
        // A failed webhook leaves the draft approved-but-unpublished and
        // says why — never a silent success, never a silent drop.
        return NextResponse.json({ ok: true, channel: draft.channel, published: pub.ok, mode: 'discord_webhook', detail: pub.detail, posts: draft.posts });
      }
      return NextResponse.json({ ok: true, channel: draft.channel, published: false, mode: 'manual', detail: 'approved — copy and post on this channel', posts: draft.posts });
    }
    case 'reject': {
      const ok = await rejectDraft(supabase, params.id);
      return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
    }
    case 'edit': {
      if (typeof body.edited_body !== 'string') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
      const ok = await editDraft(supabase, params.id, body.edited_body);
      return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
    }
    case 'mark_published': {
      const ok = await markPublished(supabase, params.id, body.published_url ?? null);
      return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
    }
    default:
      return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  }
}
