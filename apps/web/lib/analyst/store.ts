// ─── AI ANALYST v2 — session/message store ───────────────────────
//
// Service-role Supabase access with EXPLICIT ownership checks on
// every read/write (project convention: API routes use the admin
// client; RLS is the backstop, not the gate). All shapes match
// migration 090_analyst_workspace.sql — columns verified against it.

import { createServerSupabase } from '@/lib/supabase-server';

export interface AnalystSessionRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  persona: string | null;
  model: string | null;
  origin: 'workspace' | 'inline' | 'comm';
  viewport: unknown | null;
  pinned: boolean;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface AnalystMessageRow {
  id: string;
  session_id: string;
  user_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: unknown | null;
  provenance: unknown | null;
  token_usage: unknown | null;
  created_at: string;
}

const SESSION_COLS =
  'id, user_id, project_id, title, persona, model, origin, viewport, pinned, message_count, last_message_at, created_at, archived_at';

const MESSAGE_COLS =
  'id, session_id, user_id, seq, role, content, tool_calls, provenance, token_usage, created_at';

export async function listSessions(userId: string): Promise<AnalystSessionRow[]> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_sessions')
    .select(SESSION_COLS)
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('pinned', { ascending: false })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw new Error(`listSessions: ${error.message}`);
  return (data ?? []) as AnalystSessionRow[];
}

export async function createSession(opts: {
  userId: string;
  persona?: string | null;
  model?: string | null;
  origin?: 'workspace' | 'inline' | 'comm';
  viewport?: unknown;
}): Promise<AnalystSessionRow> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_sessions')
    .insert({
      user_id: opts.userId,
      persona: opts.persona ?? null,
      model: opts.model ?? null,
      origin: opts.origin ?? 'workspace',
      viewport: opts.viewport ?? null,
    })
    .select(SESSION_COLS)
    .single();
  if (error) throw new Error(`createSession: ${error.message}`);
  return data as AnalystSessionRow;
}

// Returns the session only when it belongs to userId — the ownership
// gate every [id] route goes through.
export async function getSessionOwned(
  sessionId: string,
  userId: string,
): Promise<AnalystSessionRow | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_sessions')
    .select(SESSION_COLS)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`getSessionOwned: ${error.message}`);
  return (data as AnalystSessionRow) ?? null;
}

export async function getMessages(sessionId: string): Promise<AnalystMessageRow[]> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_messages')
    .select(MESSAGE_COLS)
    .eq('session_id', sessionId)
    .order('seq', { ascending: true });
  if (error) throw new Error(`getMessages: ${error.message}`);
  return (data ?? []) as AnalystMessageRow[];
}

export async function insertMessage(opts: {
  sessionId: string;
  userId: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: unknown;
  provenance?: unknown;
  tokenUsage?: unknown;
}): Promise<AnalystMessageRow> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_messages')
    .insert({
      session_id: opts.sessionId,
      user_id: opts.userId,
      seq: opts.seq,
      role: opts.role,
      content: opts.content,
      tool_calls: opts.toolCalls ?? null,
      provenance: opts.provenance ?? null,
      token_usage: opts.tokenUsage ?? null,
    })
    .select(MESSAGE_COLS)
    .single();
  if (error) throw new Error(`insertMessage: ${error.message}`);
  return data as AnalystMessageRow;
}

export async function touchSession(opts: {
  sessionId: string;
  messageCount: number;
}): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin
    .from('analyst_sessions')
    .update({
      message_count: opts.messageCount,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', opts.sessionId);
  if (error) throw new Error(`touchSession: ${error.message}`);
}

const MUTABLE_SESSION_FIELDS = new Set(['title', 'pinned', 'persona']);

export async function patchSession(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (MUTABLE_SESSION_FIELDS.has(k)) safe[k] = v;
  }
  if (Object.keys(safe).length === 0) return;
  const admin = createServerSupabase();
  const { error } = await admin.from('analyst_sessions').update(safe).eq('id', sessionId);
  if (error) throw new Error(`patchSession: ${error.message}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin.from('analyst_sessions').delete().eq('id', sessionId);
  if (error) throw new Error(`deleteSession: ${error.message}`);
}

export async function setSessionTitle(sessionId: string, title: string): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin
    .from('analyst_sessions')
    .update({ title })
    .eq('id', sessionId);
  if (error) throw new Error(`setSessionTitle: ${error.message}`);
}
