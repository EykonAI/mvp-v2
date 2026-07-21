-- 089 · Live-feed freshness alert state (AIS / GDELT / ADS-B)
--
-- Dedupe state for the live-feed liveness check (lib/monitoring/feed-health.ts).
-- The exact sibling of firms_liveness_alerts (087): one row per feed, and ONLY
-- while that feed is unhealthy — deleted on recovery, so "no row" means "fresh".
--
-- ─── Why this closes a real, currently-open gap ────────────────────
-- /admin/ingest-health already SHOWS AIS/GDELT/ADS-B freshness (the probe in
-- feed-health.ts), but page-only: nothing pushed. On 2026-07-21 the AIS worker
-- sat CRITICAL at 41.6h and no one was paged — the page was telling the truth
-- to an empty room. This table is what lets the same probe ALERT to Discord,
-- so a dead feed finds a human instead of waiting for one to open the page.
--
-- Same three behaviours as 087, for the same reason (an hourly re-post trains
-- the reader to mute the channel, and a muted alert reads as coverage while
-- providing none):
--
--   1. First detection alerts immediately.
--   2. An ESCALATION (warn -> critical) alerts immediately, bypassing the
--      re-alert timer. For AIS, critical (>=12h stale) means the vessel layer
--      has been dark long enough that convergence/analyst answers are already
--      degraded — that must not wait on a timer.
--   3. Otherwise re-alert at most once per FEED_REALERT_HOURS (default 6).
--
-- Deleting on recovery re-arms (1): a feed that breaks, is fixed, then breaks
-- again alerts immediately the second time.
--
-- Keyed on the feed KEY (FEEDS[].key: 'adsb' | 'ais' | 'gdelt'), the single
-- source of truth in feed-health.ts — not a foreign key, matching 087. A key
-- retired from FEEDS simply stops being probed and its stale row is swept in
-- feed-health.ts. Service-role only, like the rest of the operational surface.

create table if not exists live_feed_alerts (
  -- FEEDS[].key from lib/monitoring/feed-health.ts.
  feed text primary key,

  -- 'warn' | 'critical'. Stored so an escalation can be detected without
  -- re-deriving the previous state.
  severity text not null check (severity in ('warn', 'critical')),

  -- Hours since the feed's most recent row (max(ingested_at)) at alert time.
  -- Recorded for the message body and post-hoc "how stale before anyone
  -- noticed" questions. Nullable: a feed we cannot read at all has no value.
  hours_stale numeric,

  first_detected_at timestamptz not null default now(),
  last_alerted_at timestamptz not null default now()
);

comment on table live_feed_alerts is
  'Dedupe state for live-feed (AIS/GDELT/ADS-B) freshness alerts. A row exists only while a feed is unhealthy; deleted on recovery. Sibling of firms_liveness_alerts. See lib/monitoring/feed-health.ts.';

alter table live_feed_alerts enable row level security;
-- No policy, deliberately: service-role access only, matching
-- firms_liveness_alerts and the rest of the operational surface.
