-- 109_purchase_attribution.sql
--
-- Campaign, partner and country attribution stamped onto the purchase row
-- at checkout (Closing LP Build Brief v1.5 §22.4 / §22.7, decisions D-2 and
-- D-3). Prerequisite for the admin › Growth & Revenue › Subscribers view.
--
-- WHY ON purchases AND NOT DERIVED LATER
--   The tempting shortcut is to match closing_leads.email against
--   user_profiles.email after the fact. That breaks whenever someone fills
--   the lead form with one address and signs up with another — common, and
--   it fails silently in the direction that flatters us: an unmatched sale
--   reads as organic rather than attributed. Capturing at checkout is the
--   difference between attribution that is reliable and attribution that is
--   approximately right.
--
-- WHY purchases AND NOT subscriptions
--   A $9 Week Pass grants a tier_override and a Query Pack grants a
--   usage_bonus; neither writes a subscriptions row. purchases is the only
--   table that sees all three payment shapes (§22.2).
--
-- THREE ORTHOGONAL SIGNALS — none subsumes another (§22.4):
--   landing_path  → which PAGE converted them  (/start vs /pricing vs /c)
--   referral_code → which PARTNER sent them    (who earns the bounty)
--   utm_*         → which CHANNEL sent them    (reddit, discord, x)
--
-- NO BACKFILL. Existing rows stay NULL and render "—" in the admin view. A
-- fabricated attribution is worse than an honest blank, and the completed
-- purchases now in the table predate the closing funnel entirely.
--
-- Verified before writing (per §3.2): purchases had NO utm_*, landing_path,
-- referrer, country or referral_code column. The checkout route referenced a
-- Rewardful referral only inside the NOWPayments invoice DESCRIPTION string
-- ("rw:<code>") — a human-readable label on a third-party invoice, never
-- queryable from our side. This migration is what makes it queryable.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merging the PR — Railway
-- auto-deploys main on merge and the checkout INSERT 500s without these
-- columns, which would take the paid funnel down.

alter table public.purchases
  add column if not exists utm_source    text,
  add column if not exists utm_medium    text,
  add column if not exists utm_campaign  text,
  add column if not exists utm_content   text,
  add column if not exists landing_path  text,
  add column if not exists referrer      text,
  add column if not exists country       text,
  add column if not exists referral_code text;

-- Channel rollups: "which campaign produced revenue this month".
create index if not exists purchases_attribution_idx
  on public.purchases (utm_source, created_at desc);

-- "Came via /start" filter — partial, because the overwhelming majority of
-- rows will carry no landing_path until the funnel has run for a while.
create index if not exists purchases_landing_idx
  on public.purchases (landing_path)
  where landing_path is not null;

-- Partner attribution / bounty reconciliation.
create index if not exists purchases_referral_idx
  on public.purchases (referral_code)
  where referral_code is not null;

comment on column public.purchases.landing_path is
  'Page the buyer FIRST landed on in this campaign session (first-touch, '
  'carried from the browser). Not the page checkout was launched from — '
  'that is always /pricing and would make this column useless.';
comment on column public.purchases.referral_code is
  'Partner/advocate code in effect at the moment of payment: the live '
  'Rewardful click-through if present, else the code the buyer signed up '
  'with, else the referring advocate''s own code. Denormalised on purpose — '
  'user_profiles.referred_by can change after the sale.';
comment on column public.purchases.country is
  'Edge geo header at checkout (lib/geo/request-country.ts), same source as '
  'the fiat waitlist. NULL when no edge header is present — never guessed.';

-- Verification (run after applying):
--   select count(*) from public.purchases where utm_source is not null;  -- 0
--   \d public.purchases   -- 8 new columns, all nullable, no default
--   select indexname from pg_indexes
--     where tablename = 'purchases' and indexname like 'purchases_%_idx';
