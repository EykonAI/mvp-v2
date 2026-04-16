import { NextRequest, NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/anthropic';

// Generate contextual query suggestions based on user context
export async function POST(req: NextRequest) {
  try {
    const { watchlist_names, viewport, recent_queries } = await req.json();

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 300,
      system: `You generate 3 short, specific geopolitical query suggestions for eYKON.ai users. Each suggestion should be a natural-language question that the Claude analyst can answer using live data tools (vessel queries, aircraft queries, conflict queries, infrastructure queries). Return ONLY a JSON array of 3 strings. No other text.`,
      messages: [{
        role: 'user',
        content: `User context:
- Watchlist regions: ${JSON.stringify(watchlist_names || ['Red Sea', 'Black Sea'])}
- Map viewport center: ${viewport ? `${viewport.latitude.toFixed(1)}, ${viewport.longitude.toFixed(1)}` : 'global'}
- Recent queries: ${JSON.stringify(recent_queries || [])}

Generate 3 relevant, specific query suggestions.`,
      }],
    });

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    // Parse JSON array from response
    let suggestions: string[];
    try {
      suggestions = JSON.parse(text);
    } catch {
      // Fallback suggestions
      suggestions = [
        'What vessel activity is happening near the Strait of Hormuz right now?',
        'Are there any active conflicts near major shipping lanes?',
        'Show me military aircraft activity in the Black Sea region',
      ];
    }

    return NextResponse.json({ suggestions });
  } catch (err: any) {
    // Return fallback suggestions on error
    return NextResponse.json({
      suggestions: [
        'What happened in the Red Sea in the last 48 hours?',
        'Are there any AIS dark-ship events near the Strait of Hormuz?',
        'Show me current conflict activity in the Middle East',
      ],
    });
  }
}
