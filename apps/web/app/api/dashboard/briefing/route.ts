import { NextRequest, NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/anthropic';
import { createServerSupabase } from '@/lib/supabase-server';

// Generate a personalised daily briefing for a user
export async function POST(req: NextRequest) {
  try {
    const { user_id } = await req.json();
    if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

    const supabase = createServerSupabase();

    // Fetch user's watchlists
    const { data: watchlists } = await supabase
      .from('watchlists')
      .select('*')
      .eq('user_id', user_id);

    // Fetch recent agent reports (last 24h)
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: reports } = await supabase
      .from('agent_reports')
      .select('*')
      .gte('created_at', since)
      .order('severity', { ascending: false })
      .limit(10);

    // Fetch recent anomaly flags
    const { data: flags } = await supabase
      .from('anomaly_flags')
      .select('*')
      .gte('created_at', since)
      .eq('processed', true)
      .limit(20);

    // Generate briefing with Claude
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: `You are the eYKON.ai daily briefing generator. Create a concise, structured intelligence briefing based on the user's watchlist and recent events. Format with clear sections, bullet points, and severity indicators. Be factual, cite sources, and highlight actionable intelligence.`,
      messages: [{
        role: 'user',
        content: `Generate a daily intelligence briefing for this user.

User watchlists: ${JSON.stringify(watchlists || [], null, 2)}

Recent intelligence reports (last 24h): ${JSON.stringify(reports || [], null, 2)}

Recent anomaly flags (last 24h): ${JSON.stringify(flags || [], null, 2)}

Structure the briefing as:
1. Executive Summary (2-3 sentences)
2. Critical Alerts (if any high/critical severity events)
3. Watchlist Updates (per region/entity being monitored)
4. Notable Developments (other significant events)
5. Recommended Queries (3 suggested follow-up questions)`,
      }],
    });

    const briefingText = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    // Store as agent report
    const { data: savedReport } = await supabase
      .from('agent_reports')
      .insert({
        domain: 'briefing',
        severity: 'low',
        title: `Daily Briefing — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        summary: briefingText.substring(0, 200),
        narrative: briefingText,
        entities: [],
        sources: ['ACLED', 'AIS', 'ADS-B', 'ENTSO-E'],
        user_id,
      })
      .select()
      .single();

    return NextResponse.json({
      briefing: briefingText,
      report_id: savedReport?.id,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
