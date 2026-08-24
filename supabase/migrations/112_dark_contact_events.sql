-- 112 · Dark-contact events — the resolvable observable
--
-- The workspace so far ranks a live LIST: rows churn hourly and nothing has a
-- beginning, an end, or an outcome. This table makes the dark gap an EVENT
-- with a lifecycle, which is what an alert, a track record and (later, PR H)
-- a Calibration Ledger machine-track claim all require.
--
-- THE OBSERVABLE, WORDED HONESTLY. An event asks: "will this vessel be
-- RE-OBSERVED by eYKON's AIS coverage within 72 h of the event opening?"
--   reappeared  — a newer fix arrived, from ANY box. A positive observation;
--                 detection is feed-wide because vessels move.
--   still_dark  — the deadline passed with no new fix. This is a statement
--                 about OUR instrument ("not re-observed by our coverage"),
--                 never "the transponder was off" — a vessel that sailed into
--                 water we do not cover is indistinguishable from a dark one,
--                 and the wording must not pretend otherwise.
--   void        — the box the vessel was last seen in went dead while the
--                 event was open (void_reason 'coverage_lost:<slug>').
--                 Continued silence became unmeasurable: never a win, never
--                 a loss. Absence of an observation is not a result.
--
-- LIFECYCLE RULES, enforced by the hourly compute-shadow-fleet-scores cron:
--   open    silence >= 12x the vessel's OWN cadence (mig 111 baseline
--           required; mig 110 live-box gate inherited from the scorer).
--   dedup   UNIQUE (mmsi, gap_started_at): gap_started_at is the last-fix
--           timestamp, so the same ongoing gap can never spawn a second
--           event — including after a still_dark resolution. A NEW event for
--           the same vessel requires a NEW fix first (which changes
--           gap_started_at), i.e. the previous gap actually ended.
--   close-before-open ordering in the cron: a vessel that reappeared minutes
--           ago closes its old event and does not immediately reopen (its
--           ratio is ~0 against the new fix).
--
-- Instrument-protective by construction: gaps are measured against the BOX's
-- own data clock (mig 110), so a stalled feed FREEZES ratios rather than
-- inflating them — a feed hiccup cannot mass-open events.
--
-- Events outlive vessel_profiles on purpose: profiles are pruned at the 72 h
-- active window, and a genuinely dark vessel leaves that window while its
-- event is still the most interesting row in the system.
--
-- Rehearsed read-only on production 2026-08-24: 153 events would open on the
-- first tick (of 526 scoreable vessels; 67 vanished under way, 33 FOC).

create table if not exists dark_contact_events (
  id                     uuid primary key default gen_random_uuid(),
  mmsi                   text not null,
  -- identity denormalised at open: the record must say who the vessel WAS
  -- when the event opened, even if the AIS snapshot row later changes.
  name                   text,
  flag                   text,
  box_slug               text,
  last_fix_lat           double precision,
  last_fix_lon           double precision,
  last_speed_kn          double precision,
  cadence_hours          double precision not null,
  silence_ratio_at_open  double precision not null,
  confidence_at_open     double precision not null,
  indicators             jsonb,
  gap_started_at         timestamptz not null,
  opened_at              timestamptz not null default now(),
  deadline_at            timestamptz not null,
  status                 text not null default 'open'
                           check (status in ('open', 'resolved', 'void')),
  resolution             text
                           check (resolution in ('reappeared', 'still_dark')),
  void_reason            text,
  closed_at              timestamptz,
  final_gap_hours        double precision,
  created_at             timestamptz not null default now(),
  -- a resolved row carries a resolution, a void row a reason, an open row neither
  constraint dark_contact_events_terminal_shape check (
    (status = 'open'     and resolution is null and void_reason is null and closed_at is null) or
    (status = 'resolved' and resolution is not null and void_reason is null and closed_at is not null) or
    (status = 'void'     and resolution is null and void_reason is not null and closed_at is not null)
  ),
  constraint dark_contact_events_gap_dedup unique (mmsi, gap_started_at)
);

create index if not exists idx_dark_contact_events_status_opened
  on dark_contact_events (status, opened_at desc);
create index if not exists idx_dark_contact_events_mmsi
  on dark_contact_events (mmsi);

alter table dark_contact_events enable row level security;
-- No policy on purpose: service-role only, like migrations 110/111.
