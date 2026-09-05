// /llms.txt — the agent-readable index (llmstxt.org convention).
//
// A route rather than a static public/ file so every URL is built from
// APP_URL, which is the same source robots.ts and sitemap.ts use. A
// hardcoded domain here would be one more place to forget when the
// canonical host changes.
//
// WHAT BELONGS HERE, AND WHAT MUST NOT
//
// This file is read by agents deciding whether eYKON can answer a
// question. It is a marketing surface in the sense that it persuades,
// so it inherits the homepage truth-pass rule (§13.1): every number is
// derived or omitted, and no model is named because the runtime model
// is one env var.
//
// The coverage limits are stated here ON PURPOSE. An agent that learns
// from this file that AIS is chokepoint-only and that night-lights lag
// ~9 days will ask better questions and misreport less — and the
// alternative is a demo it can falsify in a single call, which §13.9.8
// records as the thing that loses a specialist's trust.

import { NextResponse } from 'next/server';
import { APP_URL } from '@/lib/url';
import { CLAUDE_TOOLS, CITIZEN_AI_TOOLS } from '@/lib/anthropic';
import { MCP_DAILY_LIMITS } from '@/lib/mcp/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Derived, never hand-counted. §16.4: a label duplicated from the
  // thing it describes is a label that will outlive it — the landing
  // page has already drifted on this exact number twice.
  const toolCount = CLAUDE_TOOLS.length;
  const citizenToolCount = CLAUDE_TOOLS.filter((t) => CITIZEN_AI_TOOLS.has(t.name)).length;
  const toolNames = CLAUDE_TOOLS.map((t) => `- \`${t.name}\` — ${t.description ?? ''}`).join('\n');

  const body = `# eYKON.ai

> A geopolitical-intelligence platform with a live interactive map of physical-sensor and event feeds, an AI analyst workspace, and a published forecast record. eYKON scores its own predictions and publishes the result — the calibration ledger is queryable as a tool, so an agent can check eYKON's measured skill before trusting an answer.

eYKON exposes ${toolCount} live-data tools over the Model Context Protocol at \`${APP_URL}/api/mcp\` (Streamable HTTP). An API key is required; keys are created at ${APP_URL}/settings and MCP access is included on paid plans.

## Connecting

\`\`\`
claude mcp add --transport http eykon ${APP_URL}/api/mcp --header "Authorization: Bearer eyk_YOUR_KEY"
\`\`\`

Any MCP client works — the endpoint is stateless Streamable HTTP and returns JSON.

## Daily call limits

${(['member', 'pro', 'desk', 'enterprise'] as const)
  .map((t) => `- ${t}: ${MCP_DAILY_LIMITS[t]} tool calls per day (resets 00:00 UTC)`)
  .join('\n')}

The free tier does not include MCP. A key on the free tier is refused on every call.

## What the tools return

Every successful result carries a provenance envelope stating the instrument, its grounding, and its known limits. Read it — several feeds are deliberately partial and saying so is the product.

${toolNames}

Citizen-subset keys reach ${citizenToolCount} of these; paid keys reach all ${toolCount}.

## Limits you should know before quoting eYKON

- **Thermal (NASA FIRMS)**: a detection is a hot pixel, not a confirmed fire and never a strike. Coverage is 10,556 of 13,262 watched facilities — South America, Africa and Oceania are outside the ingest boxes and return NO DATA, not zero.
- **Night-lights (NASA Black Marble)**: radiance is not power state, and NASA publication lags roughly 9 days. Any answer describes last week, not last night.
- **Vessels (AIS)**: chokepoint-only on the current tier. Not global vessel coverage.
- **Conflict (GDELT)**: media-derived. It measures reporting, not ground truth.
- **Critical minerals**: fixture-backed. Excluded from demos and not a measurement.
- **Simulators** (\`run_chokepoint_scenario\`, \`run_sanctions_wargame\`): models over stored inputs. Never quote a modelled second-order effect as data.

## Pages

- [Home](${APP_URL}/): the platform, its six pillars, and the live figures
- [Connect an agent](${APP_URL}/mcp): MCP setup, authentication and limits
- [Pricing](${APP_URL}/pricing): plans and what each includes
- [Start here](${APP_URL}/start): a guided walkthrough with a live feed-status board

## Contact

hello@eykon.ai
`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
