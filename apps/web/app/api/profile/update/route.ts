import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';

// Updates the caller's public COMM profile fields on user_profiles
// (migration 055). Auth via getCurrentUser(); the write is scoped to
// user.id (same pattern as /api/profile/persona). Handle uniqueness is
// enforced by uq_user_profiles_handle → a 23505 maps to 409 handle_taken.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HANDLE_RE = /^[A-Za-z0-9_]{3,32}$/;
const VISIBILITY = new Set(['public', 'members', 'private']);
const MAX_BIO = 280;
const MAX_NAME = 60;
const MAX_LINKS = 5;
const MAX_URL = 300;
const MAX_LABEL = 40;

function okUrl(u: unknown): u is string {
  return typeof u === 'string' && u.length <= MAX_URL && /^https?:\/\//i.test(u);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ('handle' in body) {
    const h = body.handle;
    if (h === null || h === '') update.handle = null;
    else if (typeof h === 'string' && HANDLE_RE.test(h)) update.handle = h;
    else return NextResponse.json({ error: 'invalid_handle' }, { status: 400 });
  }
  if ('display_name' in body) {
    const v = body.display_name;
    if (v === null) update.display_name = null;
    else if (typeof v === 'string' && v.length <= MAX_NAME) update.display_name = v;
    else return NextResponse.json({ error: 'invalid_display_name' }, { status: 400 });
  }
  if ('bio' in body) {
    const v = body.bio;
    if (v === null) update.bio = null;
    else if (typeof v === 'string' && v.length <= MAX_BIO) update.bio = v;
    else return NextResponse.json({ error: 'invalid_bio' }, { status: 400 });
  }
  for (const k of ['avatar_url', 'cover_url'] as const) {
    if (k in body) {
      const v = body[k];
      if (v === null || v === '') update[k] = null;
      else if (okUrl(v)) update[k] = v;
      else return NextResponse.json({ error: `invalid_${k}` }, { status: 400 });
    }
  }
  if ('profile_visibility' in body) {
    const v = body.profile_visibility;
    if (typeof v === 'string' && VISIBILITY.has(v)) update.profile_visibility = v;
    else return NextResponse.json({ error: 'invalid_visibility' }, { status: 400 });
  }
  if ('reputation_opt_in' in body) {
    update.reputation_opt_in = Boolean(body.reputation_opt_in);
  }
  if ('links' in body) {
    const raw = body.links;
    if (!Array.isArray(raw) || raw.length > MAX_LINKS) {
      return NextResponse.json({ error: 'invalid_links' }, { status: 400 });
    }
    const links: { label: string; url: string }[] = [];
    for (const item of raw) {
      const url = (item as { url?: unknown })?.url;
      const label = (item as { label?: unknown })?.label;
      if (!okUrl(url)) return NextResponse.json({ error: 'invalid_links' }, { status: 400 });
      links.push({
        url,
        label: typeof label === 'string' && label.length > 0 && label.length <= MAX_LABEL ? label : url,
      });
    }
    update.links = links;
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, noop: true });

  const supabase = createServerSupabase();
  const { error } = await supabase.from('user_profiles').update(update).eq('id', user.id);
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'handle_taken' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
