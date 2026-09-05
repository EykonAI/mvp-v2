// ─── The MCP server over the analyst tools ───────────────────────
//
// Wraps the EXISTING tool surface — CLAUDE_TOOLS / toolsForTier and
// executeToolCall — with no second definition of either. There is one
// tool catalogue and one executor; MCP is a transport over them, the
// same way lib/analyst/engine.ts is.
//
// Deliberately transport-agnostic below the route: this module builds
// a Server, and app/api/mcp/route.ts owns the HTTP.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolsForTier } from '@/lib/anthropic';
import { executeToolCall } from '@/lib/tool-executor';
import { checkDailyQuota, recordCall, MCP_DAILY_LIMITS } from '@/lib/mcp/limits';
import { envelopeFor } from '@/lib/mcp/provenance';
import type { ApiCaller } from '@/lib/mcp/auth';

export const MCP_SERVER_NAME = 'eykon';
export const MCP_SERVER_VERSION = '1.0.0';

/** Shape returned for any refusal, so an agent gets a reason it can act on. */
function refusal(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

export function buildMcpServer(caller: ApiCaller): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // The existing definitions are ALREADY JSON Schema. The only
    // transformation is the field name — input_schema -> inputSchema.
    // No Zod rewrite, and no second copy of 24 schemas to drift.
    tools: toolsForTier(caller.tier).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.input_schema as Record<string, unknown>,
      annotations: {
        // Every tool on this surface reads. run_* are simulations over
        // stored inputs and persist a scenario row, but mutate no
        // source data and destroy nothing.
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const started = Date.now();
    const { name, arguments: args } = req.params;

    // ── Gate 1: tier ──────────────────────────────────────────────
    // Re-checked HERE and not only in tools/list, because a client can
    // call a tool it was never shown. A filter on the catalogue is a
    // convenience; this is the control.
    const allowed = new Set(toolsForTier(caller.tier).map((t) => t.name));
    if (!allowed.has(name)) {
      const known = new Set(toolsForTier('enterprise').map((t) => t.name));
      return refusal(
        known.has(name)
          ? {
              // Only the citizen tier is tool-filtered (toolsForTier);
              // member and above receive the full set. So the tier a
              // refused tool actually unlocks at is MEMBER, not pro.
              // Naming the wrong tier here would send a citizen to buy
              // the wrong thing.
              error: `The tool "${name}" is not available on the ${caller.tier} tier.`,
              your_tier: caller.tier,
              required_tier: 'member',
              upgrade_url: 'https://eykon.ai/pricing?from=mcp',
            }
          : {
              error: `Unknown tool "${name}".`,
              hint: 'Call tools/list to see the tools available to this key.',
            },
      );
    }

    // ── Gate 2: daily quota ───────────────────────────────────────
    // checkDailyQuota throws on a read failure (fail closed). That
    // propagates to the route, which turns it into a 5xx naming the
    // cause — never a silent free call.
    const quota = await checkDailyQuota(caller.userId, caller.tier);
    if (!quota.allowed) {
      return refusal(
        quota.limit <= 0
          ? {
              // Every tier now carries a non-zero default allowance, so
              // this branch is only reached when an operator has set
              // MCP_DAILY_LIMIT_<TIER>=0 — a deliberate per-tier kill
              // switch. It therefore must NOT name a tier to upgrade
              // to: the cap is a runtime setting, not a plan boundary,
              // and pointing at /pricing would send someone to buy
              // something that would not fix it.
              error: `MCP access is currently disabled for the ${caller.tier} tier.`,
              your_tier: caller.tier,
              contact: 'hello@eykon.ai',
            }
          : {
              error: `Daily MCP limit reached (${quota.limit} calls).`,
              used: quota.used,
              limit: quota.limit,
              resets_at: quota.resetsAt,
              your_tier: caller.tier,
              upgrade_url:
                caller.tier === 'pro'
                  ? 'https://eykon.ai/pricing?plan=desk_founding_annual'
                  : 'https://eykon.ai/pricing?from=mcp',
            },
      );
    }

    // ── Execute ───────────────────────────────────────────────────
    const raw = await executeToolCall(name, (args ?? {}) as Record<string, any>);

    let parsed: unknown;
    let parseFailed = false;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parseFailed = true;
    }

    // executeToolCall catches its own failures and returns
    // JSON.stringify({error}) — a SUCCESSFUL return carrying a
    // failure. Left unmapped an agent reads that as data and reasons
    // over it as a finding. Map it to isError so the failure is loud
    // at the protocol level, per §0.2.
    const failed =
      parseFailed ||
      (typeof parsed === 'object' && parsed !== null && 'error' in (parsed as object));

    const durationMs = Date.now() - started;

    // Fire-and-forget: a logging failure must not fail a call that
    // already ran, but it is logged loudly because silent logging
    // failure would quietly stop the quota counting.
    void recordCall({
      userId: caller.userId,
      apiKeyId: caller.keyId,
      toolName: name,
      ok: !failed,
      durationMs,
    });

    if (failed) {
      return {
        content: [{ type: 'text' as const, text: raw }],
        isError: true,
      };
    }

    // The provenance envelope rides WITH the data, because an MCP
    // result travels into another agent's context with no eYKON page
    // around it to caveat it (§13.4.2, generalised).
    const body = {
      data: parsed,
      provenance: envelopeFor(name),
      usage: {
        used: quota.used + 1,
        limit: quota.limit,
        resets_at: quota.resetsAt,
      },
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
      structuredContent: body,
      isError: false,
    };
  });

  return server;
}

export { MCP_DAILY_LIMITS };
