-- 118_mcp_call_log.sql
--
-- Per-call log for the MCP server, and the substrate for the daily
-- quota. One row per tools/call.
--
-- WHY A LOG AND NOT A COUNTER COLUMN:
--   usage_counters is keyed on (user_id, period_start) where
--   period_start is date_trunc('month') — it is a MONTHLY instrument.
--   The founder decision is 50 calls per DAY, and a monthly cap of
--   ~1500 is a materially different product: it permits burning the
--   whole month in an afternoon. Rather than widen the shared
--   increment_usage_counter() (CREATE OR REPLACE with a changed
--   signature leaves the old function live and callable — §16.5), MCP
--   gets its own daily instrument.
--
--   The log form is chosen over a second counter table because an API
--   product needs to answer "what did this key actually call?" — for
--   support, for abuse investigation, and for pricing the tier
--   honestly once there is real traffic. A bare counter answers none
--   of those.
--
-- WHAT IS NOT STORED:
--   No tool ARGUMENTS. They can carry a customer's area of interest,
--   which is exactly the sensitivity that keeps session replay off the
--   product surfaces (rev. §13.8.3 — "a recording of /intel is a
--   recording of what someone is investigating"). The tool NAME is
--   enough for quota, support and abuse work.
--
-- THE WINDOW IS A UTC CALENDAR DAY, not a trailing 24 hours. A buyer
-- reads "50 per day" as a daily allowance that resets, and the 429 can
-- then state exactly when it resets. A rolling window cannot give that
-- answer without a per-row lookup.
--
-- RLS enabled with NO permissive policy — service-role only, matching
-- api_keys (117) and the COMM / monetisation / closing_leads tables.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merging. The MCP
-- route counts against this table on every call and 500s without it.
--
-- STEP 1: apply migration 117 (api_keys) if it is not already applied.
-- STEP 2: apply this migration.
-- STEP 3: merge the PR.

create table public.mcp_call_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- Kept for support and abuse work: which key made the call. Nulled
  -- rather than cascaded on key deletion is not needed — keys are
  -- revoked, never deleted (117) — but the FK stays ON DELETE CASCADE
  -- to match the user cascade above.
  api_key_id uuid references public.api_keys(id) on delete cascade,

  tool_name  text not null,

  -- Whether the call returned isError. Lets the digest separate "used
  -- 50 times" from "failed 50 times", which are very different
  -- support conversations.
  ok         boolean not null default true,

  duration_ms integer,
  called_at  timestamptz not null default now(),

  constraint mcp_call_log_tool_len check (char_length(tool_name) between 1 and 64)
);

-- THE quota query: count a user's calls since the start of the UTC day.
-- user_id leads because the count is always per-user.
create index mcp_call_log_user_day_idx
  on public.mcp_call_log (user_id, called_at desc);

-- Support / abuse: what did this key do.
create index mcp_call_log_key_idx
  on public.mcp_call_log (api_key_id, called_at desc);

alter table public.mcp_call_log enable row level security;

comment on table public.mcp_call_log is
  'One row per MCP tools/call. Backs the daily quota (UTC calendar day) and per-key usage inspection. Tool arguments are deliberately NOT stored — they reveal what a customer is investigating. Service-role only: RLS on, no permissive policy.';
