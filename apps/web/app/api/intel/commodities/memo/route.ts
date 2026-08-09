import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess, enforceAiQueryLimit, enforceCreditBalance } from '@/lib/analyst/access';
import { DEFAULT_ANALYST_MODEL } from '@/lib/analyst/model';
import { runAnalyst } from '@/lib/intelligence-analyst/run';
import { buildMarketsPayload } from '@/lib/intel/commodities/markets';
import { buildLivePayload } from '@/lib/intel/commodities/live';
import { buildShipmentsPayload } from '@/lib/intel/commodities/shipments';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 120;

/**
 * Draft trade memo (footer action, PR 2 D5).
 *
 * The ONE labeled-LLM feature in this workspace. Runs the single
 * analyst engine server-side (the newsjack pattern), grounded on the
 * exact panel payloads — the model is told what the instruments can
 * and cannot say, and the output is returned labeled with model +
 * timestamp, never presented as panel data.
 *
 * Gates, in order (mirrors the analyst session routes exactly):
 *   1. Pro+ effective tier (requireSessionAccess)
 *   2. Monthly AI-query cap — atomic RPC, 429 with upgrade/pass offers
 *   3. Credit wallet pre-flight (migrations 100–102) — 402 when a
 *      metered wallet cannot cover the turn
 * The runAnalyst meter context then records + debits the actual spend.
 * A memo that bypassed the wallet would be a regression against #354.
 */
export async function POST(req: NextRequest) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;

  const limited = await enforceAiQueryLimit(caller.userId, caller.tier);
  if (limited) return limited;

  const denied = await enforceCreditBalance(caller.userId, DEFAULT_ANALYST_MODEL);
  if (denied) return denied;

  let commodity = '';
  try {
    const body = await req.json();
    commodity = String(body?.commodity ?? '');
  } catch {
    return NextResponse.json({ error: 'JSON body { commodity } required' }, { status: 400 });
  }

  const markets = await buildMarketsPayload(commodity);
  if (!markets) {
    return NextResponse.json({ error: `unknown commodity '${commodity}'` }, { status: 400 });
  }
  const [live, shipments] = await Promise.all([
    buildLivePayload(),
    buildShipmentsPayload(commodity),
  ]);

  const prompt = [
    `Draft a concise trade memo (300–450 words) for the commodity "${commodity}" grounded STRICTLY on the JSON snapshot below — the live payloads of the eYKON Commodities workspace.`,
    '',
    'Hard rules:',
    '- Use ONLY numbers present in the snapshot; cite each with its source and window as given (e.g. "EIA daily spot, 2026-08-08").',
    '- A corridor with no_data is NOT observed — say "no coverage for N days, last observed X", never treat it as zero or as a decline.',
    '- AIS-derived rows are inference (the snapshot says so); write "AIS-inferred", never assert cargo.',
    '- Sanction designation deltas are measured history, not predictions. Do not extrapolate any trend.',
    '- If the snapshot lacks the data for a claim, write "insufficient live data" for that point instead of filling the gap.',
    '- Structure: Situation · Physical flows · Risk factors · What to watch (each watch item tied to a feed that actually updates).',
    '',
    'SNAPSHOT:',
    JSON.stringify({ markets, live, shipments }, null, 1),
  ].join('\n');

  const out = await runAnalyst({
    prompt,
    tier: caller.tier,
    meter: { userId: caller.userId, feature: 'analyst_turn', ref: `trade_memo:${commodity}` },
  });

  return NextResponse.json({
    memo: out.text,
    // Label, not fine print: the UI shows this line with the memo.
    label: `Analyst-generated draft · model ${out.model} · ${new Date().toISOString()} · grounded on the workspace snapshot — verify figures against the panels before external use`,
    model: out.model,
    tool_calls: out.toolCalls,
    generated_at: new Date().toISOString(),
  });
}
