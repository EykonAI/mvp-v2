-- 106_closing_leads.sql
--
-- Lead capture for the /start closing landing page (closing-LP brief v1.3
-- §6, PR C). One row per prospect email; the qualification form on Screen 5
-- writes here via POST /api/closing/lead (service-role only).
--
-- Design notes:
--   • email is normalised to lowercase by the route before write, so the
--     plain UNIQUE constraint enforces the brief's unique-on-lower(email)
--     intent (PostgREST upsert cannot target an expression index).
--   • utm_* columns record FIRST touch only — the route never overwrites
--     them on a duplicate submission, matching the $set_once person-property
--     semantics on the PostHog side (PR B).
--   • RLS enabled with NO permissive policy: reachable only through the
--     service-role client (createServerSupabase), per §3.3 of the
--     Consolidated Brief. Same posture as the COMM/monetisation tables.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merging PR C — Railway
-- auto-deploys main on merge, and the route 500s without the table.

create table public.closing_leads (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  name_or_handle    text not null,
  persona           text not null,
  theatres          text[] not null default '{}',
  current_tools     text,
  wants_daily_brief boolean not null default false,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  referrer          text,
  landing_path      text,
  ip_hash           text,
  user_agent        text,
  converted_user_id uuid references auth.users(id),
  converted_at      timestamptz,
  notified_at       timestamptz,
  unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint closing_leads_email_key unique (email),
  constraint closing_leads_persona_check check (persona in (
    'day-trader', 'osint-analyst', 'commodities-desk', 'journalist',
    'corporate-risk', 'researcher-ngo', 'other'
  ))
);

create index closing_leads_created_idx
  on public.closing_leads (created_at desc);
create index closing_leads_campaign_idx
  on public.closing_leads (utm_campaign, created_at desc);
-- Rate-limit lookup: recent submissions per hashed IP.
create index closing_leads_ip_hash_idx
  on public.closing_leads (ip_hash, created_at desc);

alter table public.closing_leads enable row level security;
-- No permissive policy on purpose: service-role reads/writes only.

comment on table public.closing_leads is
  'Qualified leads from the /start closing page (Screen 5 form). '
  'Written only by POST /api/closing/lead via service role. '
  'utm_* columns are first-touch and never overwritten.';

-- Verification (run after applying):
--   select count(*) from public.closing_leads;                -- 0
--   select relrowsecurity from pg_class
--     where relname = 'closing_leads';                        -- t
--   insert as anon should fail (RLS, no policy).
