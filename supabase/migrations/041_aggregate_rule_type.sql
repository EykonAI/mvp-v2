-- ─── 041: aggregate rule type ──────────────────────────────────
-- Extends user_notification_rules.rule_type CHECK constraint to
-- include 'aggregate' so the cheap cron can evaluate count-over-
-- window rules (PR 5 of the Notification Center evaluator deep-fix
-- sequence). Rule config shape is enforced in app code
-- (apps/web/lib/notifications/tools.ts) — same convention as the
-- other four rule types.
--
-- AggregateConfig in app code (subset implemented in PR 5):
--   bucket          : 'Conflict' | 'Air' | 'Maritime' | 'EnergyPower' |
--                     'EnergyPipelines' | 'EnergyRefineries' | 'Mining' |
--                     'AviationInfra' | 'MaritimeInfra' | 'AnomalyFlags' |
--                     'ConvergenceEvents'  (Weather excluded — no table)
--   filter          : { country?: string }  (other keys accepted for
--                     forward compatibility but ignored in PR 5)
--   metric          : 'count_total' | 'count_distinct'
--                     ('sum' / 'avg' rejected as not_yet_supported)
--   distinct_on     : column name, required when metric='count_distinct'
--   window_hours    : 1 ≤ N ≤ 720
--   threshold_kind  : 'absolute_above' | 'absolute_below' |
--                     'pct_change_vs_prev_window'
--                     ('sigma_above_baseline' rejected; needs the
--                     user_rule_baselines cache table — deferred)
--   threshold_value : number > 0
--
-- DEFERRED (per engineering brief §6.1): the user_rule_baselines
-- cache table. Only needed if threshold_kind='sigma_above_baseline'
-- becomes a hot path. A future PR can layer it on top of this
-- migration's CHECK extension without further schema churn.

-- The CHECK constraint cannot be altered in place; drop + recreate.
ALTER TABLE user_notification_rules
  DROP CONSTRAINT IF EXISTS user_notification_rules_rule_type_check;
ALTER TABLE user_notification_rules
  ADD CONSTRAINT user_notification_rules_rule_type_check
  CHECK (rule_type IN (
    'single_event', 'multi_event', 'outcome_ai', 'cross_data_ai', 'aggregate'
  ));

-- Widen the cheap-cron partial index to include aggregate rules.
-- Partial-index predicates cannot be altered; drop + recreate.
DROP INDEX IF EXISTS idx_user_notification_rules_cheap_active;
CREATE INDEX idx_user_notification_rules_cheap_active
  ON user_notification_rules (rule_type, last_fired_at)
  WHERE active = true AND rule_type IN (
    'single_event', 'multi_event', 'aggregate'
  );
