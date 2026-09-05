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
import { resolveApiKey } from '@/lib/mcp/auth';
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

async function handle(req: NextRequest): Promise<Response> {
  const auth = await resolveApiKey(req.headers.get('authorization'));

  if (!auth.ok) {
    // Distinguishable refusals — §13.2.3, a gate must say what it
    // caught. A revoked key and a mistyped key need different actions
    // from the person holding them.
    return unauthorized(auth.message, auth.reason);
  }

  const server = buildMcpServer(auth.caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(req as unknown as Request);
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
