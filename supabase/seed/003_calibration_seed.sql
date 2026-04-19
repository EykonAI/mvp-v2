-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — Seed · calibration_summary
-- Flat-line degraded-state — replaced by the nightly scoring cron
-- once the Prediction Register has ≥ 30 days of resolved predictions.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO calibration_summary (id, metrics, generated_at, degraded) VALUES (
  1,
  '[
     {"key":"brier",    "label":"Aggregate Brier",      "value":"—","trend":"flat","spark":[0.18,0.19,0.18,0.17,0.18,0.18]},
     {"key":"posture",  "label":"Posture-Shift Monitor","value":"—","trend":"flat","spark":[0.22,0.21,0.22,0.23,0.22,0.22]},
     {"key":"conflict", "label":"Conflict Escalation",  "value":"—","trend":"flat","spark":[0.20,0.20,0.20,0.20,0.20,0.20]},
     {"key":"trade",    "label":"Trade-Flow Horizon",   "value":"—","trend":"flat","spark":[0.17,0.17,0.17,0.17,0.17,0.17]},
     {"key":"precision","label":"Alerts Precision@10", "value":"—","trend":"flat","spark":[0.60,0.60,0.60,0.60,0.60,0.60]}
   ]'::jsonb,
  NOW(),
  TRUE
)
ON CONFLICT (id) DO UPDATE
  SET metrics = EXCLUDED.metrics, generated_at = EXCLUDED.generated_at, degraded = EXCLUDED.degraded;
