-- 108_persona_model.sql
--
-- Adopt the ZL persona model on closing_leads (closing-LP brief v1.4
-- §4.0 / PR G). The /start page becomes a three-step persona funnel;
-- these are the five personas its Step 1 offers, and they key the
-- per-persona pitch, the routing destination, and the lead score.
--
-- Why replace rather than widen the CHECK: closing_leads held 0 rows
-- when this was written (verified via supabase-ro immediately before,
-- per the brief's own instruction). With no rows there is nothing to
-- migrate and no reason to carry two vocabularies. VERIFY 0 ROWS AGAIN
-- before running — if any lead has landed since, widen instead of
-- replacing and map the old slugs.
--
--   select count(*) from public.closing_leads;   -- must be 0
--
-- The old seven slugs (day-trader, osint-analyst, commodities-desk,
-- journalist, corporate-risk, researcher-ngo, other) were this brief's
-- v1.2 guess at segmentation. ZL's five are better for selling: each
-- has a distinct pitch, a distinct destination, and 'citizen' absorbs
-- the long tail that 'other' used to.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merging PR G —
-- Railway auto-deploys main on merge and the route 400s every valid
-- submission until the constraint matches the code.

alter table public.closing_leads
  drop constraint if exists closing_leads_persona_check;

alter table public.closing_leads
  add constraint closing_leads_persona_check check (persona in (
    'trader',      -- macro, commodities, crypto
    'analyst',     -- OSINT investigation & research
    'journalist',  -- newsroom or independent
    'risk',        -- corporate risk / commodities desk
    'citizen'      -- the curious long tail
  ));

-- Step-3 qualification fields. `pay` is the commercially decisive one:
-- it disqualifies fiat-only prospects before they waste a month, which
-- is the whole reason the question is asked out loud on the page.
alter table public.closing_leads
  add column if not exists markets   text[] not null default '{}',
  add column if not exists need      text,
  add column if not exists pay       text,
  add column if not exists publishes text;

-- Routing/segmentation reads: "which personas actually pay", "which
-- theatres do payers watch". Partial index — pay is null until Step 3.
create index if not exists closing_leads_persona_pay_idx
  on public.closing_leads (persona, pay)
  where pay is not null;

comment on column public.closing_leads.markets is
  'Up to 3. What the lead trades or covers (Step 3).';
comment on column public.closing_leads.need is
  'Single. What would make eYKON useful in week 1 (Step 3).';
comment on column public.closing_leads.pay is
  'Single. crypto_today | fiat_waiting | unsure. The qualifying field: '
  'we only take crypto today, and saying so costs a few sales and saves '
  'the prospect a wasted month.';
comment on column public.closing_leads.publishes is
  'Single. no | under_10k | over_10k. over_10k routes to the Founding '
  'Partner lane rather than self-serve checkout.';

-- Verification (run after applying):
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname='closing_leads_persona_check';        -- the five slugs
--   select count(*) from information_schema.columns
--     where table_name='closing_leads';                   -- 26
