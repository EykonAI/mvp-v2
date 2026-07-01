import { createServerSupabase } from '@/lib/supabase-server';

// DB layer for the Newsjacking Engine. All access is via the service-role
// client (the newsjack_* tables are RLS-on with no permissive policy).

type SB = ReturnType<typeof createServerSupabase>;

export interface NewsjackEventInput {
  source: string;
  source_ref: string;
  event_key: string;
  domain: string | null;
  region: string | null;
  severity: string | null;
  covered: boolean;
  status: 'detected' | 'drafted' | 'blocked' | 'approved' | 'published' | 'rejected' | 'expired';
  blocked_reason: string | null;
  evidence: Record<string, unknown>;
}

export interface NewsjackDraftInput {
  event_id: string;
  channel: 'x' | 'linkedin' | 'substack';
  body: string;
  posts: string[];
  ref_url: string | null;
  lints: Record<string, unknown>;
  value_pass: boolean;
  status: 'draft' | 'approved' | 'rejected' | 'published';
}

export async function eventExistsForSource(supabase: SB, source: string, sourceRef: string): Promise<boolean> {
  const { data } = await supabase
    .from('newsjack_events')
    .select('id')
    .eq('source', source)
    .eq('source_ref', sourceRef)
    .maybeSingle();
  return !!data;
}

export async function insertEvent(supabase: SB, e: NewsjackEventInput): Promise<string | null> {
  const { data, error } = await supabase
    .from('newsjack_events')
    .insert({
      source: e.source,
      source_ref: e.source_ref,
      event_key: e.event_key,
      domain: e.domain,
      region: e.region,
      severity: e.severity,
      covered: e.covered,
      status: e.status,
      blocked_reason: e.blocked_reason,
      evidence: e.evidence,
    })
    .select('id')
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function insertDraft(supabase: SB, d: NewsjackDraftInput): Promise<boolean> {
  const { error } = await supabase.from('newsjack_drafts').insert({
    event_id: d.event_id,
    channel: d.channel,
    body: d.body,
    posts: d.posts,
    ref_url: d.ref_url,
    lints: d.lints,
    value_pass: d.value_pass,
    status: d.status,
  });
  return !error;
}

// ── Admin review ────────────────────────────────────────────────

export interface ReviewDraft {
  draft_id: string;
  event_id: string;
  channel: string;
  posts: string[];
  ref_url: string | null;
  value_pass: boolean;
  status: string;
  created_at: string;
  domain: string | null;
  region: string | null;
  severity: string | null;
  covered: boolean;
  event_status: string;
  blocked_reason: string | null;
}

interface DraftJoinRow {
  id: string;
  event_id: string;
  channel: string;
  posts: unknown;
  ref_url: string | null;
  value_pass: boolean;
  status: string;
  created_at: string;
  newsjack_events:
    | { domain: string | null; region: string | null; severity: string | null; covered: boolean; status: string; blocked_reason: string | null }
    | { domain: string | null; region: string | null; severity: string | null; covered: boolean; status: string; blocked_reason: string | null }[]
    | null;
}

export async function listDrafts(supabase: SB, limit = 50): Promise<ReviewDraft[]> {
  const { data } = await supabase
    .from('newsjack_drafts')
    .select(
      'id, event_id, channel, posts, ref_url, value_pass, status, created_at, newsjack_events!inner(domain, region, severity, covered, status, blocked_reason)',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data as DraftJoinRow[] | null) ?? [];
  return rows.map((r) => {
    const ev = Array.isArray(r.newsjack_events) ? r.newsjack_events[0] : r.newsjack_events;
    return {
      draft_id: r.id,
      event_id: r.event_id,
      channel: r.channel,
      posts: Array.isArray(r.posts) ? (r.posts as string[]) : [],
      ref_url: r.ref_url,
      value_pass: r.value_pass,
      status: r.status,
      created_at: r.created_at,
      domain: ev?.domain ?? null,
      region: ev?.region ?? null,
      severity: ev?.severity ?? null,
      covered: ev?.covered ?? true,
      event_status: ev?.status ?? 'unknown',
      blocked_reason: ev?.blocked_reason ?? null,
    };
  });
}

export interface DraftRow {
  id: string;
  event_id: string;
  channel: string;
  posts: string[];
  status: string;
}

export async function getDraft(supabase: SB, draftId: string): Promise<DraftRow | null> {
  const { data } = await supabase
    .from('newsjack_drafts')
    .select('id, event_id, channel, posts, status')
    .eq('id', draftId)
    .maybeSingle();
  if (!data) return null;
  const d = data as { id: string; event_id: string; channel: string; posts: unknown; status: string };
  return { id: d.id, event_id: d.event_id, channel: d.channel, posts: Array.isArray(d.posts) ? (d.posts as string[]) : [], status: d.status };
}

async function setEventStatus(supabase: SB, eventId: string, status: string): Promise<void> {
  await supabase.from('newsjack_events').update({ status, updated_at: new Date().toISOString() }).eq('id', eventId);
}

export async function approveDraft(supabase: SB, draftId: string): Promise<boolean> {
  const draft = await getDraft(supabase, draftId);
  if (!draft) return false;
  const { error } = await supabase
    .from('newsjack_drafts')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', draftId);
  if (error) return false;
  await setEventStatus(supabase, draft.event_id, 'approved');
  return true;
}

export async function rejectDraft(supabase: SB, draftId: string): Promise<boolean> {
  const draft = await getDraft(supabase, draftId);
  if (!draft) return false;
  const { error } = await supabase
    .from('newsjack_drafts')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', draftId);
  if (error) return false;
  await setEventStatus(supabase, draft.event_id, 'rejected');
  return true;
}

export async function editDraft(supabase: SB, draftId: string, editedBody: string): Promise<boolean> {
  const { error } = await supabase
    .from('newsjack_drafts')
    .update({ edited_body: editedBody.slice(0, 8000), updated_at: new Date().toISOString() })
    .eq('id', draftId);
  return !error;
}

export async function markPublished(supabase: SB, draftId: string, url: string | null): Promise<boolean> {
  const draft = await getDraft(supabase, draftId);
  if (!draft) return false;
  const { error } = await supabase
    .from('newsjack_drafts')
    .update({ status: 'published', published_url: url, published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', draftId);
  if (error) return false;
  await setEventStatus(supabase, draft.event_id, 'published');
  return true;
}
