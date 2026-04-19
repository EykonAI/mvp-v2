# Changelog

## 2026-04-19 — Intelligence Center overhaul

- Replaced the v1 Personalised Intelligence Dashboard with the new **Intelligence Center**
  (Intelligence Dashboard + nine domain workspaces: Chokepoint Simulator, Sanctions
  Wargame, Cascade Map, Commodities, Shadow Fleet Profiler, Critical Minerals Cascade,
  Regime Change Detector, Precursor Pattern Library, Calibration Ledger).
- Implemented Features 1–25 per the April 2026 Feature Ideation Output v2.
- Ported the Unified Wireframe design-token layer (Jura + IBM Plex Sans + IBM Plex Mono;
  bg-void / navy / panel / raised; teal / amber / red / green / violet / coral / wheat).
- New Supabase migrations 002–006 (posture_scores, convergence_events, entities,
  scenario_runs, user_events, user_interest_vectors, predictions_register,
  prediction_outcomes, calibration_summary, vessel_profiles, fleet_kinship_edges,
  baseline_distributions, regime_shifts, precursor_library).
- New cron routes (`/api/cron/*`) for posture / baseline / shadow-fleet / convergence /
  regime-shift / prediction scoring — all CRON_SECRET-guarded.
- Extended Conversational Claude tools — ten new Intelligence-Center tools
  (posture scores, convergences, shadow-fleet leads, calibration, precursor matches,
  chokepoint + sanctions scenarios, regime shifts, entities search, N-hop actor expander).
- Retired `components/Dashboard.tsx`, `components/dashboard/*`,
  `app/api/dashboard/*` (briefing reborn as `/api/intel/briefing` with a persona-aware
  prompt that powers the Citizen Brief hero card).
- Added the behavioural sub-agent at `services/agents/behavioural/` (nightly user-
  interest vectors + blind-spot candidates) and extended the Supervisor with
  Opus-4-7 convergence synthesis and precursor-match alerting.
- Updated canonical model IDs to `claude-sonnet-4-6` (conversational + sub-agents)
  and `claude-opus-4-7` (Supervisor synthesis).
