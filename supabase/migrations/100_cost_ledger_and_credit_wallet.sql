-- ═══════════════════════════════════════════════════════════════
-- Migration 100 — Per-user cost ledger + credit wallet
--
-- Two questions this schema keeps separate, deliberately:
--   1. "What did this user cost us?"   → cost_events, ALL rows
--   2. "What may be debited from their balance?" → cost_events
--      WHERE billable, against user_credit_accounts
--
-- Conflating them is why a single total_cost_usd column on
-- user_profiles is the wrong shape: it answers (1) badly and cannot
-- answer (2) at all. See the FP Test Plan build brief §5.1.
--
-- Additive. All new tables RLS-enabled with NO permissive policy —
-- reachable only via the service role (createServerSupabase).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · cost_events — the append-only ledger ──────────────────
-- One row per billable event, for EVERY user, forever. Never UPDATE
-- a row to correct it; insert a compensating row instead.
CREATE TABLE IF NOT EXISTS cost_events (
  id                 BIGSERIAL PRIMARY KEY,
  -- SET NULL, not CASCADE: cost history outlives the user row so
  -- historical P&L does not silently shrink when an account is deleted.
  user_id            UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  category           TEXT NOT NULL CHECK (category IN
                       ('llm','messaging','onchain','payment_fee','infra','other')),
  -- analyst_turn | deep_analysis | auto_title | rule_eval_ai |
  -- editorial | newsjack | sms | whatsapp | email | lock_deploy | ...
  feature            TEXT NOT NULL,

  -- FALSE = tracked for profitability, NEVER debited from a balance.
  -- Email digests are billable=false by founder decision.
  billable           BOOLEAN NOT NULL DEFAULT TRUE,

  usd_cost           NUMERIC(12,6) NOT NULL CHECK (usd_cost >= 0),
  -- Stamps the rate card used, so a price change never retroactively
  -- rewrites history. Sonnet 5 intro pricing ends 2026-08-31.
  price_version      TEXT NOT NULL,

  -- LLM detail (NULL for non-LLM rows). All four token classes are
  -- stored because prompt caching is ON: cache reads bill ~0.1x and
  -- cache writes ~1.25x, so input+output alone misprices every
  -- multi-turn session.
  model              TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_write_tokens INTEGER,
  cache_read_tokens  INTEGER,
  -- Tool-loop legs summed into this row. This is the receipt for the
  -- multi-leg accumulation fix: legs=1 on a turn that visibly called
  -- several tools means the engine fix has regressed.
  legs               INTEGER,

  session_id         UUID,
  ref                TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_events_user_time
  ON cost_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_events_billable
  ON cost_events (user_id, billable, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_events_feature
  ON cost_events (feature, occurred_at DESC);

ALTER TABLE cost_events ENABLE ROW LEVEL SECURITY;

-- ─── 2 · user_credit_accounts — the wallet ─────────────────────
-- NO ROW = UNMETERED. A user without a row here is governed by their
-- tier's ordinary query limits, exactly as today. The wallet is an
-- overlay for test plans, not a replacement for the tier ladder.
CREATE TABLE IF NOT EXISTS user_credit_accounts (
  user_id           UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  label             TEXT,
  -- Per-plan, set at grant time from an editable admin field
  -- (default $10.00). NOT a constant.
  budget_usd        NUMERIC(10,4) NOT NULL CHECK (budget_usd >= 0),
  spent_usd         NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  -- Deep Analysis sub-cap as a fraction of budget (founder decision:
  -- 20%). Binds independently of the main budget.
  deep_cap_pct      NUMERIC(5,4)  NOT NULL DEFAULT 0.20
                      CHECK (deep_cap_pct >= 0 AND deep_cap_pct <= 1),
  deep_spent_usd    NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (deep_spent_usd >= 0),
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','exhausted','suspended')),
  exhausted_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_credit_accounts ENABLE ROW LEVEL SECURITY;

-- ─── 3 · credit_grants — the audit trail ───────────────────────
-- budget_usd is the running total of grants, maintained by the admin
-- grant path in the same transaction. This table is the auditable
-- history; the account row is the fast read.
CREATE TABLE IF NOT EXISTS credit_grants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  amount_usd   NUMERIC(10,4) NOT NULL CHECK (amount_usd > 0),
  -- 'purchase' is RESERVED so the later self-serve wallet can reuse
  -- the webhook's grant-first idempotency pattern with no schema change.
  source       TEXT NOT NULL DEFAULT 'founder'
                 CHECK (source IN ('founder','purchase')),
  reason       TEXT,
  granted_by   TEXT NOT NULL,
  purchase_id  UUID REFERENCES purchases(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_grants_user
  ON credit_grants (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_grants_purchase
  ON credit_grants (purchase_id) WHERE purchase_id IS NOT NULL;

ALTER TABLE credit_grants ENABLE ROW LEVEL SECURITY;

-- ─── 4 · user_cost_summary — the one-number read ───────────────
-- A VIEW, deliberately not a column on user_profiles: a column
-- answers one question, cannot be broken down by feature/model/month,
-- cannot be audited or corrected without destroying history, and puts
-- a hot write on a row read by every request. If this is ever measured
-- too slow, the answer is a nightly rollup TABLE, not a live column.
CREATE OR REPLACE VIEW user_cost_summary AS
SELECT
  user_id,
  SUM(usd_cost)                                             AS cost_all_usd,
  SUM(usd_cost) FILTER (WHERE billable)                     AS cost_billable_usd,
  SUM(usd_cost) FILTER (WHERE feature = 'deep_analysis')    AS cost_deep_usd,
  SUM(usd_cost) FILTER (WHERE category = 'llm')             AS cost_llm_usd,
  COUNT(*)                                                  AS event_count,
  MIN(occurred_at)                                          AS first_event_at,
  MAX(occurred_at)                                          AS last_event_at
FROM cost_events
WHERE user_id IS NOT NULL
GROUP BY user_id;

-- ─── 5 · tier_overrides: widen the source CHECK ────────────────
-- Easy to miss and it fails at RUNTIME, not at build. The FP test
-- plan grants Pro from a new source, so the constraint must widen.
-- Verify the live constraint name first:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'tier_overrides'::regclass AND contype = 'c';
ALTER TABLE tier_overrides DROP CONSTRAINT IF EXISTS tier_overrides_source_check;
ALTER TABLE tier_overrides ADD  CONSTRAINT tier_overrides_source_check
  CHECK (source IN ('week_pass','fp_test'));
-- tier stays CHECK (tier IN ('pro')) — the test plan grants Pro, nothing higher.

-- ═══════════════════════════════════════════════════════════════
-- Verification (run as SELECTs before merging):
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'tier_overrides'::regclass AND contype = 'c';
--   -- expect: source IN ('week_pass','fp_test')
--
--   SELECT count(*) FROM cost_events;            -- expect 0
--   SELECT count(*) FROM user_credit_accounts;   -- expect 0
--   SELECT * FROM user_cost_summary LIMIT 1;     -- expect 0 rows, no error
-- ═══════════════════════════════════════════════════════════════
