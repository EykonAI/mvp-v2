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

// model + project_id are deliberately NOT in MUTABLE_SESSION_FIELDS:
// they carry entitlement (Deep Analysis = Pro+, projects = Pro+), so
// the route validates before calling these dedicated setters — the
// generic PATCH can never flip them.
export async function setSessionModel(sessionId: string, model: string | null): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin.from('analyst_sessions').update({ model }).eq('id', sessionId);
  if (error) throw new Error(`setSessionModel: ${error.message}`);
}

export async function setSessionProject(
  sessionId: string,
  projectId: string | null,
): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin
    .from('analyst_sessions')
    .update({ project_id: projectId })
    .eq('id', sessionId);
  if (error) throw new Error(`setSessionProject: ${error.message}`);
}

// ─── Projects (brief §9.2 — Pro+ leverage) ─────────────────────

export interface AnalystProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  color: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

const PROJECT_COLS =
  'id, user_id, name, description, instructions, color, pinned, created_at, updated_at, archived_at';

export async function listProjects(userId: string): Promise<AnalystProjectRow[]> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_projects')
    .select(PROJECT_COLS)
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`listProjects: ${error.message}`);
  return (data ?? []) as AnalystProjectRow[];
}

export async function createProject(opts: {
  userId: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  color?: string | null;
}): Promise<AnalystProjectRow> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_projects')
    .insert({
      user_id: opts.userId,
      name: opts.name,
      description: opts.description ?? null,
      instructions: opts.instructions ?? null,
      color: opts.color ?? null,
    })
    .select(PROJECT_COLS)
    .single();
  if (error) throw new Error(`createProject: ${error.message}`);
  return data as AnalystProjectRow;
}

export async function getProjectOwned(
  projectId: string,
  userId: string,
): Promise<AnalystProjectRow | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_projects')
    .select(PROJECT_COLS)
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`getProjectOwned: ${error.message}`);
  return (data as AnalystProjectRow) ?? null;
}

const MUTABLE_PROJECT_FIELDS = new Set(['name', 'description', 'instructions', 'color', 'pinned']);

export async function patchProject(
  projectId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (MUTABLE_PROJECT_FIELDS.has(k)) safe[k] = v;
  }
  const admin = createServerSupabase();
  const { error } = await admin.from('analyst_projects').update(safe).eq('id', projectId);
  if (error) throw new Error(`patchProject: ${error.message}`);
}

// Archive (soft-delete) so sessions filed under it keep their history;
// analyst_sessions.project_id is ON DELETE SET NULL, but archiving is
// the reversible, non-destructive default for a beat the user built up.
export async function archiveProject(projectId: string): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin
    .from('analyst_projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', projectId);
  if (error) throw new Error(`archiveProject: ${error.message}`);
}

// ─── Insights (brief §9.5 — Pro+, attach to a project) ─────────

export interface AnalystInsightRow {
  id: string;
  user_id: string;
  project_id: string | null;
  session_id: string | null;
  message_id: string | null;
  title: string;
  body: string;
  provenance: unknown | null;
  created_at: string;
}

const INSIGHT_COLS =
  'id, user_id, project_id, session_id, message_id, title, body, provenance, created_at';

export async function createInsight(opts: {
  userId: string;
  projectId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  title: string;
  body: string;
  provenance?: unknown;
}): Promise<AnalystInsightRow> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_insights')
    .insert({
      user_id: opts.userId,
      project_id: opts.projectId ?? null,
      session_id: opts.sessionId ?? null,
      message_id: opts.messageId ?? null,
      title: opts.title,
      body: opts.body,
      provenance: opts.provenance ?? null,
    })
    .select(INSIGHT_COLS)
    .single();
  if (error) throw new Error(`createInsight: ${error.message}`);
  return data as AnalystInsightRow;
}

export async function listInsights(
  userId: string,
  projectId?: string | null,
): Promise<AnalystInsightRow[]> {
  const admin = createServerSupabase();
  let q = admin
    .from('analyst_insights')
    .select(INSIGHT_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw new Error(`listInsights: ${error.message}`);
  return (data ?? []) as AnalystInsightRow[];
}

export async function getInsightOwned(
  insightId: string,
  userId: string,
): Promise<AnalystInsightRow | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_insights')
    .select(INSIGHT_COLS)
    .eq('id', insightId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`getInsightOwned: ${error.message}`);
  return (data as AnalystInsightRow) ?? null;
}

export async function deleteInsight(insightId: string): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin.from('analyst_insights').delete().eq('id', insightId);
  if (error) throw new Error(`deleteInsight: ${error.message}`);
}

// Sessions filed under a project, newest activity first — the dossier
// compiles these in order.
export async function listSessionsByProject(
  userId: string,
  projectId: string,
): Promise<AnalystSessionRow[]> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('analyst_sessions')
    .select(SESSION_COLS)
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .is('archived_at', null)
    .order('last_message_at', { ascending: true, nullsFirst: true })
    .limit(100);
  if (error) throw new Error(`listSessionsByProject: ${error.message}`);
  return (data ?? []) as AnalystSessionRow[];
}
