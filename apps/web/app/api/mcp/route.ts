// ─── MCP endpoint — https://eykon.ai/api/mcp ─────────────────────
//
// Streamable HTTP, stateless. Exposes the analyst tools to any MCP
// client (Claude Code, Claude Desktop, Cursor, an agent of your own)
// under an eYKON API key.
//
// STATELESS BY CONSTRUCTION: no sessionIdGenerator, so every request
// builds its own Server + transport pair and nothing is held between
// calls. That is what lets this run behind a load balancer with no
// sticky sessions, and it is why there is no DELETE handler — there is
// no session to tear down.
//
// The transport is WebStandardStreamableHTTPServerTransport, whose
// handleRequest(Request) => Promise<Response> is exactly the App
// Router contract. No Node IncomingMessage/ServerResponse shim.
//
// NOTE ON /api AND MIDDLEWARE: middleware.ts deliberately excludes
// /api/*, so this route gets NO auth wall and NO rate limiting from
// the framework. It owns both. Do not assume anything upstream is
// protecting it.

import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { resolveApiKey, type ApiCaller } from '@/lib/mcp/auth';
import { buildMcpServer } from '@/lib/mcp/server';
import { safeError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Next 14 caches supabase GETs even under force-dynamic (§16.6). Every
// tool call reads live state, so the Data Cache must be off here.
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/** 401 with WWW-Authenticate, so a client knows HOW to authenticate. */
function unauthorized(message: string, reason: string) {
  return NextResponse.json(
    { error: message, reason },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Bearer realm="eykon", charset="UTF-8"',
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * Methods a caller may use WITHOUT a key.
 *
 * Listing is public so a registry, a crawler or a person deciding
 * whether to subscribe can see what eYKON offers. Until now tools/list
 * returned 401, which meant the MCP catalogue entry advertised a server
 * nobody could inspect — the listing asserted capabilities instead of
 * demonstrating them.
 *
 * initialize and ping are here because a client cannot reach tools/list
 * without completing the handshake first.
 *
 * Everything NOT on this list needs a key. That direction matters: a
 * method added to the protocol later is private by default rather than
 * silently public.
 */
const PUBLIC_METHODS = new Set(['initialize', 'ping', 'tools/list']);

/** JSON-RPC notifications carry no id and expect no response. */
function isNotification(m: unknown): boolean {
  return typeof m === 'string' && m.startsWith('notifications/');
}

/**
 * Does this body contain anything that needs a key?
 *
 * Batches are the trap: JSON-RPC permits an array, so a single request
 * can mix tools/list with tools/call. If ANY member needs auth, the
 * whole request does — otherwise a batch would be a way to smuggle a
 * free tool call alongside a public one.
 *
 * Unparseable or unexpected shapes require auth. Failing closed here
 * costs an anonymous caller a 401 on a malformed request; failing open
 * would hand out tool calls.
 */
function requiresAuth(rawBody: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return true;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) return true;
  return entries.some((e) => {
    const m = (e as { method?: unknown } | null)?.method;
    if (isNotification(m)) return false;
    return typeof m !== 'string' || !PUBLIC_METHODS.has(m);
  });
}

async function handle(req: NextRequest): Promise<Response> {
  // The body can only be read once, and the transport needs it too, so
  // read it here and hand the transport a fresh Request carrying the
  // same bytes. GET has no body and is always treated as public — the
  // transport answers it correctly on its own in stateless mode.
  const rawBody = req.method === 'POST' ? await req.text() : '';

  // Authenticate when the method REQUIRES it, and also whenever a key
  // is offered at all.
  //
  // The second condition is not redundant. tools/list is public, so
  // without it a caller who supplies a perfectly good key would skip
  // authentication and receive the anonymous CATALOGUE — 24 tools —
  // instead of the tier-filtered surface their key actually grants,
  // which for a Citizen is 13. They would then call a tool the listing
  // promised and be refused. Offering a key must never give you a worse
  // answer than offering none.
  //
  // It also means a BAD key is rejected on a public method rather than
  // silently ignored, so a typo surfaces immediately instead of
  // presenting as "the catalogue looks wrong".
  const offersKey = Boolean(req.headers.get('authorization'));

  let caller: ApiCaller | null = null;
  if (req.method !== 'POST' || offersKey || requiresAuth(rawBody)) {
    const auth = await resolveApiKey(req.headers.get('authorization'));
    if (!auth.ok) {
      // Distinguishable refusals — §13.2.3, a gate must say what it
      // caught. A revoked key and a mistyped key need different actions.
      return unauthorized(auth.message, auth.reason);
    }
    caller = auth.caller;
  }

  const server = buildMcpServer(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  const forwarded =
    req.method === 'POST'
      ? new Request(req.url, { method: 'POST', headers: req.headers, body: rawBody })
      : (req as unknown as Request);

  return transport.handleRequest(forwarded);
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (err) {
    // Fail loud. A quota read that failed, a missing table, a dead
    // Supabase — none of these may present as a successful empty
    // answer, and none may present as unlimited access.
    safeError('[api/mcp] request failed', err);
    return NextResponse.json(
      {
        error: 'MCP request failed.',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

// GET is part of the Streamable HTTP spec (clients may open a stream).
// In stateless JSON mode the transport answers it correctly on its own
// — including refusing it where a session would be required — so it is
// routed to the same handler rather than special-cased here.
export async function GET(req: NextRequest) {
  try {
    return await handle(req);
  } catch (err) {
    safeError('[api/mcp] request failed', err);
    return NextResponse.json(
      { error: 'MCP request failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
