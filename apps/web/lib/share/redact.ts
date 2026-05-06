/**
 * Redaction layer for public artifact views. Strips PII and
 * user-state-leaking columns from the raw DB row before the public
 * page server-renders it. The owner's user_id, persona, channel
 * configuration, etc. never reach the unauthenticated viewer.
 */

export type PublicAnalystView = {
  share_token: string;
  shared_at: string;
  query_text: string;
  response_text: string;
  // Tool-call summaries the model fired during the conversation.
  // We expose name + row_count only — the raw `input` payload can
  // contain user-supplied filters that read as "this user is
  // monitoring X" and would be a soft information-leak.
  tool_calls: Array<{ name: string; row_count: number | null }>;
  domain_tags: string[];
  // Coarse timestamp — the day the conversation last ran. We
  // deliberately do not expose minute-level created_at because
  // patterns over time can hint at the owner's working hours.
  last_run_day: string;
};

type RawAnalystRow = {
  share_token: string | null;
  shared_at: string | null;
  query_text: string | null;
  response_text: string | null;
  tool_calls: unknown;
  domain_tags: string[] | null;
  last_run_at: string | null;
};

export function redactAnalystRow(row: RawAnalystRow): PublicAnalystView | null {
  if (!row.share_token || !row.shared_at) return null;
  if (!row.query_text || !row.response_text) return null;

  const tool_calls = Array.isArray(row.tool_calls)
    ? (row.tool_calls as Array<Record<string, unknown>>)
        .map((c) => ({
          name: typeof c.name === 'string' ? c.name : 'unknown',
          row_count: typeof c.row_count === 'number' ? c.row_count : null,
        }))
        .slice(0, 20)
    : [];

  return {
    share_token: row.share_token,
    shared_at: row.shared_at,
    query_text: row.query_text,
    response_text: row.response_text,
    tool_calls,
    domain_tags: (row.domain_tags ?? []).slice(0, 10),
    last_run_day: row.last_run_at ? row.last_run_at.slice(0, 10) : '',
  };
}

// ─── Notification fire ─────────────────────────────────────────

export type PublicNotificationView = {
  share_token: string;
  shared_at: string;
  fired_day: string;
  rule_name: string;
  rule_type: 'single_event' | 'multi_event' | 'outcome_ai' | 'cross_data_ai' | null;
  summary: string;
  rationale: string | null;
  detail_lines: string[];
};

type RawNotificationRow = {
  share_token: string | null;
  shared_at: string | null;
  fired_at: string | null;
  payload: unknown;
};

const RULE_TYPES = ['single_event', 'multi_event', 'outcome_ai', 'cross_data_ai'] as const;
type RuleType = (typeof RULE_TYPES)[number];

function isRuleType(value: unknown): value is RuleType {
  return typeof value === 'string' && (RULE_TYPES as readonly string[]).includes(value);
}

export function redactNotificationFire(row: RawNotificationRow): PublicNotificationView | null {
  if (!row.share_token || !row.shared_at) return null;
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  const rule_name = typeof payload.ruleName === 'string' ? payload.ruleName : '(unnamed rule)';
  const summary = typeof payload.summary === 'string' ? payload.summary : '';
  const rationale = typeof payload.rationale === 'string' ? payload.rationale : null;
  const rule_type = isRuleType(payload.ruleType) ? payload.ruleType : null;

  const detail_lines = Array.isArray(payload.detailLines)
    ? (payload.detailLines as unknown[])
        .filter((line): line is string => typeof line === 'string')
        .slice(0, 8)
    : [];

  return {
    share_token: row.share_token,
    shared_at: row.shared_at,
    fired_day: row.fired_at ? row.fired_at.slice(0, 10) : '',
    rule_name,
    rule_type,
    summary,
    rationale,
    detail_lines,
  };
}
