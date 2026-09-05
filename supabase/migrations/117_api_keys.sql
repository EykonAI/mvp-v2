-- 117_api_keys.sql
--
-- API keys for programmatic access — the auth substrate for the MCP
-- server (PR-2) and any later REST surface. One row per issued key.
--
-- WHY A FAST HASH, NOT bcrypt/argon2:
--   These keys are 256 bits of CSPRNG output, not user-chosen
--   passwords. There is no dictionary to attack and no rainbow table
--   worth building, so the slow-KDF tradeoff buys nothing and would
--   add latency to EVERY authenticated call. SHA-256 is the correct
--   choice for high-entropy secrets. (This reasoning is the whole
--   justification — if key generation ever stops being CSPRNG-random,
--   this decision has to be revisited.)
--
-- WHAT IS STORED:
--   key_hash   — sha256(full key), hex. The plaintext key is shown to
--                the user ONCE at creation and never persisted.
--   key_prefix — the first 12 chars ('eyk_' + 8), enough to identify a
--                key in a list, far too little to authenticate with.
--
-- REVOCATION IS A TIMESTAMP, NOT A DELETE. A deleted row loses the
-- audit trail of a key that may have leaked; revoked_at keeps it and
-- the resolver refuses it. Same reasoning as unsubscribed_at on
-- closing_leads (mig 106) and the FP lifecycle states.
--
-- RLS enabled with NO permissive policy: reachable only through the
-- service-role client (createServerSupabase), per §3.3 of the
-- Consolidated Brief. Same posture as the COMM, monetisation, newsjack
-- and closing_leads tables. The /settings/api management UI (PR-4)
-- therefore goes through a service-role route, never PostgREST direct.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merging — Railway
-- auto-deploys main on merge and the resolver 500s without the table.
--
-- STEP 1: apply this migration.
-- STEP 2: merge the PR.

create table public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- sha256 hex of the full plaintext key. UNIQUE so a hash collision
  -- or a double-insert surfaces as an error rather than two live keys.
  key_hash    text not null,

  -- Display-only identifier: 'eyk_' + the first 8 chars of the secret.
  key_prefix  text not null,

  -- User-supplied name, so a person can tell which integration to
  -- revoke without guessing from a prefix.
  label       text not null,

  -- Throttled write (the resolver only refreshes this when it is more
  -- than 5 minutes stale) so an authenticated read is not also a write
  -- on every single call.
  last_used_at timestamptz,

  -- Revocation and optional expiry. Both are checked by the resolver;
  -- a null expires_at means the key does not expire on its own.
  revoked_at  timestamptz,
  expires_at  timestamptz,

  created_at  timestamptz not null default now(),

  constraint api_keys_key_hash_key unique (key_hash),
  constraint api_keys_key_prefix_len check (char_length(key_prefix) between 8 and 24),
  constraint api_keys_label_len      check (char_length(label) between 1 and 80)
);

-- THE hot path: every authenticated MCP call resolves a key by hash.
-- Partial index — a revoked key never needs to be found quickly, and
-- excluding them keeps the index small as keys are rotated.
create index api_keys_active_hash_idx
  on public.api_keys (key_hash)
  where revoked_at is null;

-- The management UI lists a user's keys newest-first.
create index api_keys_user_idx
  on public.api_keys (user_id, created_at desc);

alter table public.api_keys enable row level security;

comment on table public.api_keys is
  'Programmatic-access keys (MCP server, future REST API). Service-role only: RLS on, no permissive policy. Plaintext keys are never stored — key_hash is sha256 of the key, shown to the user once at creation.';
