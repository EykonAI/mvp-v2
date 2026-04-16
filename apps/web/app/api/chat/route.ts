import { NextRequest, NextResponse } from 'next/server';
import { getAnthropic, CLAUDE_TOOLS, CONVERSATIONAL_SYSTEM_PROMPT } from '@/lib/anthropic';
import { executeToolCall } from '@/lib/tool-executor';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    const anthropic = getAnthropic();

    // Filter to valid roles
    const apiMessages = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content }));

    // Initial Claude call with tools
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: CONVERSATIONAL_SYSTEM_PROMPT,
      tools: CLAUDE_TOOLS,
      messages: apiMessages,
    });

    // Tool use loop — execute tools and feed results back
    const allMessages = [...apiMessages];
    let iterations = 0;
    const maxIterations = 5;

    while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
      iterations++;

      // Collect tool use blocks from response
      const toolUseBlocks = response.content.filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use');
      const textBlocks = response.content.filter((b: any) => b.type === 'text');

      // Add assistant response (with tool_use blocks) to conversation
      allMessages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and build tool_result messages
      const toolResults: any[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeToolCall(toolUse.name, toolUse.input as Record<string, any>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      allMessages.push({ role: 'user', content: toolResults });

      // Continue the conversation
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: CONVERSATIONAL_SYSTEM_PROMPT,
        tools: CLAUDE_TOOLS,
        messages: allMessages,
      });
    }

    // Extract final text response
    const textContent = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    return NextResponse.json({
      content: textContent,
      usage: response.usage,
      tool_calls: iterations,
      model: response.model,
    });
  } catch (err: any) {
    console.error('Chat API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
