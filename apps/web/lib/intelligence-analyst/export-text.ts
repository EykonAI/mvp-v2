// ─── Markdown + JSON exporters ──────────────────────────────────
// Companion to export-pdf.ts; produces analyst-ingestible plain
// formats. Brand tokens (§4.8) are referenced in the metadata
// so downstream tooling can identify the source.

import { BRAND_TOKENS } from '@/lib/brand/tokens';
import type { ToolCallSummary } from './relevance';

export interface ExportInput {
  id: string;
  queryText: string;
  responseText: string;
  toolCalls: ToolCallSummary[];
  fetchedAtIso: string;
  generatedAtIso: string;
}

export function renderQueryMarkdown(input: ExportInput): string {
  const tools = input.toolCalls
    .map(tc => {
      const rows = tc.row_count == null ? 'rows: —' : `rows: ${tc.row_count}`;
      return `  - **${tc.name}** (${rows})\n    \`\`\`json\n    ${JSON.stringify(tc.input)}\n    \`\`\``;
    })
    .join('\n');
  const provenance = input.toolCalls.length > 0
    ? `## Provenance\n\n${tools}\n\nData fetched at: \`${input.fetchedAtIso}\` (UTC)`
    : `## Provenance\n\nNo tool calls — response synthesised from the model only.`;

  return [
    '---',
    `id: ${input.id}`,
    `wordmark: ${BRAND_TOKENS.product.wordmark}`,
    `product: ${BRAND_TOKENS.product.name}`,
    `generated_at: ${input.generatedAtIso}`,
    `data_fetched_at: ${input.fetchedAtIso}`,
    '---',
    '',
    `# Query\n\n${input.queryText}`,
    '',
    `## Response\n\n${input.responseText}`,
    '',
    provenance,
    '',
    `_${BRAND_TOKENS.product.confidential} · ${input.generatedAtIso} UTC_`,
    '',
  ].join('\n');
}

export function renderQueryJson(input: ExportInput): string {
  const payload = {
    schema: 'eykon-intelligence-export-v1',
    wordmark: BRAND_TOKENS.product.wordmark,
    product: BRAND_TOKENS.product.name,
    id: input.id,
    query: input.queryText,
    response: input.responseText,
    tool_calls: input.toolCalls,
    data_fetched_at: input.fetchedAtIso,
    generated_at: input.generatedAtIso,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportFilenameForFormat(
  queryText: string,
  dateIso: string,
  format: 'md' | 'json',
): string {
  const yyyymmdd = dateIso.slice(0, 10).replace(/-/g, '');
  const slug =
    queryText
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 6)
      .join(' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'query';
  return `eykon-intelligence-${slug}-${yyyymmdd}.${format}`;
}
