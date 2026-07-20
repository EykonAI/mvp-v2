-- 087 · FIRMS shard-liveness alert state
--
-- Dedupe state for the ingest-shard liveness check (lib/firms/liveness.ts).
-- One row per region, and ONLY while that region is unhealthy: the row is
-- deleted on recovery, so "no row" means "this shard is fine".
--
-- Why a table at all, rather than a stateless check that alerts every tick:
-- the liveness probe runs hourly. A stateless version would post the same
-- Discord message every hour for as long as a shard stayed broken, which
-- trains the reader to mute the channel — and a muted alert is worse than
-- no alert, because it reads as coverage while providing none. This table
-- buys three behaviours that make the alert survivable:
--
--   1. First detection alerts immediately.
--   2. An ESCALATION (warn -> critical) alerts immediately, even if the
--      re-alert interval has not elapsed. Crossing into critical means the
--      FIRMS NRT recovery window is closing and the founder has hours, not
--      days — that must never wait for a timer.
--   3. Otherwise it re-alerts at most once per FIRMS_LIVENESS_REALERT_HOURS
--      (default 6), so a shard broken over a weekend produces ~4 messages
--      a day rather than 24.
--
-- Deleting on recovery is what re-arms (1): a shard that breaks, is fixed,
-- and breaks again next week alerts immediately the second time.
--
-- Service-role only, like every other operational table here: there is no
-- user-facing read path and no reason to expose ingest health to clients.

create table if not exists firms_liveness_alerts (
  -- FIRMS_REGIONS[].slug. Not a foreign key — the region list lives in
  -- lib/firms/client.ts, which is deliberately the single source of truth
  -- (see migration 085). A slug retired from that list simply stops being
  -- probed, and its stale row is cleaned up by the sweep in liveness.ts.
  region text primary key,

  -- 'warn' | 'critical'. Stored so an escalation can be detected without
  -- re-deriving the previous state from ingest history.
  severity text not null check (severity in ('warn', 'critical')),

  -- Whole days between the newest OK-covered day for this region and today
  -- (UTC). Recorded for the message body and for post-hoc questions like
  -- "how far behind had it fallen before anyone noticed".
  stale_days integer not null,

  -- Hours since this region's most recent ingest run of any kind. The
  -- earlier of the two signals: an hourly shard that has not run in >3h is
  -- already broken, well before day coverage starts slipping.
  hours_since_run numeric,

  first_detected_at timestamptz not null default now(),
  last_alerted_at timestamptz not null default now()
);

comment on table firms_liveness_alerts is
  'Dedupe state for FIRMS ingest-shard liveness alerts. A row exists only while a region is unhealthy; deleted on recovery. See lib/firms/liveness.ts.';

alter table firms_liveness_alerts enable row level security;
-- No policy, deliberately: service-role access only, matching
-- firms_ingest_runs and the rest of the operational surface.
