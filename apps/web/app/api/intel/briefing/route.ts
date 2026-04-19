import { NextRequest, NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/anthropic';
import { createServerSupabase } from '@/lib/supabase-server';

const PERSONA_FRAMES: Record<string, string> = {
  analyst:
    'Structured intelligence report. Executive summary, critical alerts, watchlist updates, notable developments, recommended follow-up queries.',
  journalist:
    'Lead-first story brief. Lede, 3–4 short paragraphs with quotable facts, one candidate headline, and a note on what is still unverified.',
  'day-trader':
    'Market-oriented brief. 3 named instruments with direction + magnitude + time horizon, and the specific data point each call rests on.',
  commodities:
    'Commodities desk brief. Focus on supply-demand balance, chokepoint exposure, and near-term disruption risk. 5 short bullet points.',
  ngo:
    'Humanitarian-access brief. Displacement, border crossings, and infrastructure status. Avoid armed-actor speculation.',
  citizen:
    'Plain-language brief. 300 words. What is happening, why it matters, what is still unclear. No acronyms. No jargon. Mandatory "what I am unsure about" paragraph at the end.',
  corporate:
    'Corporate-risk brief. Asset exposure, supply-chain impact, workforce safety. Per asset class: Low / Elevated / Critical.',
};

/**
 * Persona-aware daily briefing. Replaces the legacy
 * /api/dashboard/briefing route. When persona=citizen the shell
 * replaces the Posture Viewport with this briefing card (Feature 14).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const personaKey = (body?.persona ?? url.searchParams.get('persona') ?? 'analyst') as string;
    const frame = PERSONA_FRAMES[personaKey] ?? PERSONA_FRAMES.analyst;
    const userId = body?.user_id ?? null;

    const supabase = createServerSupabase();

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [{ data: reports }, { data: flags }, { data: watchlists }] = await Promise.all([
      supabase
        .from('agent_reports')
        .select('*')
        .gte('created_at', since)
        .order('severity', { ascending: false })
        .limit(10),
      supabase
        .from('anomaly_flags')
        .select('*')
        .gte('created_at', since)
        .eq('processed', true)
        .limit(20),
      userId
        ? supabase.from('watchlists').select('*').eq('user_id', userId)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      system: `You are the eYKON.ai briefing generator. Produce a briefing tailored to the requested persona. Cite sources (provider + timestamp) in every factual claim.\n\nPersona frame: ${frame}`,
      messages: [
        {
          role: 'user',
          content: `Generate today's briefing.\n\nPersona: ${personaKey}\n\nWatchlists: ${JSON.stringify(watchlists ?? [], null, 2)}\n\nRecent reports (last 24h): ${JSON.stringify(reports ?? [], null, 2)}\n\nRecent anomaly flags (last 24h): ${JSON.stringify(flags ?? [], null, 2)}`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return NextResponse.json({
      persona: personaKey,
      briefing: text,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = POST;
