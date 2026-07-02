-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 070 · Proactive Content Layer · angle library RE-SEED
--
-- The initial 069 angles asked the AI Analyst for computed metrics its tools do
-- NOT expose — type-filtered crude-tanker counts, historical baselines,
-- week-over-week deltas — so the analyst honestly replied "insufficient live
-- data" and the engine never drafted (verified live: the Malacca angle returned
-- 10 vessels with type=0, no baseline, so "shift vs baseline" is unanswerable).
--
-- This replaces them with angles calibrated to what the tools ACTUALLY return:
-- current SNAPSHOTS (vessel/aircraft counts, conflict events, infrastructure,
-- shadow-fleet leads, convergences, posture/regime signals, precursor analogs,
-- the chokepoint simulator) + CROSS-FEED correlation. No baselines, no deltas,
-- no type filters. Balanced across the TRADER and OSINT-ANALYST communities.
-- Coverage-honest: live-AIS angles use covered straits (Malacca/Suez/Bosphorus);
-- uncovered regions are framed analytically in the prompt.
--
-- Additive migration; does a clean replace of the seed set (angles are early —
-- no founder edits yet). Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

DELETE FROM content_angles;  -- clean replace of the 069 seed

INSERT INTO content_angles (format, title, prompt, required_feeds, weight, cooldown_days) VALUES
 -- ── Trader-leaning (energy, chokepoints, infrastructure) ──
 ('data_snapshot','Malacca vs Bosphorus congestion now',
  'How many vessels are transiting the Strait of Malacca right now versus the Bosphorus, from live AIS, and is there any conflict or infrastructure signal near either chokepoint that could affect flows? Give the two counts and a one-line read for a trader.',
  ARRAY['AIS','conflict'],11,10),
 ('entity_deep_cut','Busiest covered port right now',
  'Identify a major port that eYKON covers showing notably high live vessel density right now, describe what surrounds it (nearby refineries, pipelines, or conflict events), and note the trading implication. Use live AIS and infrastructure data.',
  ARRAY['AIS','infrastructure'],9,14),
 ('data_snapshot','Power plants under weather stress',
  'How many power plants sit in regions under active weather warnings right now, name the largest by capacity, and give the plausible supply or demand implication. Use live infrastructure and weather data.',
  ARRAY['infrastructure','weather'],9,12),
 ('analyst_query','Refinery closest to conflict',
  'Which refinery or major energy facility currently sits closest to active conflict events, roughly how close, and what would a disruption there mean for regional supply? Use live conflict and infrastructure data.',
  ARRAY['conflict','infrastructure'],10,12),
 ('analyst_query','Chokepoint closure scenario',
  'Choose the covered chokepoint with the most notable current vessel activity and run a closure scenario: which flows are exposed and what is the reroute cost? Use the chokepoint simulator and live AIS.',
  ARRAY['AIS','energy'],8,14),
 ('analyst_query','Bosphorus queue and Black Sea',
  'Characterise the current vessel queue and transit tempo at the Bosphorus from live AIS, and connect it to any live conflict or energy signal affecting Black Sea flows.',
  ARRAY['AIS','conflict'],9,12),
 -- ── OSINT-leaning (conflict, aircraft, shadow fleet, sanctions) ──
 ('data_snapshot','Military aircraft hotspot now',
  'Which theatre shows the most military-aircraft activity on the globe right now from live ADS-B, and does live conflict-event data corroborate escalation there? Give the count and the corroboration.',
  ARRAY['ADS-B','conflict'],11,10),
 ('entity_deep_cut','Shadow-fleet lead of the day',
  'Take the strongest current shadow-fleet lead, describe the vessel and its behaviour, and connect it to any sanctioned actor or route through the entity network. Use shadow-fleet leads and entity data.',
  ARRAY['AIS','sanctions'],10,14),
 ('analyst_query','Conflict zone with infrastructure at risk',
  'Where is conflict-event activity most concentrated right now, what critical infrastructure (power, pipelines, ports) sits inside that zone, and what is most exposed? Use live conflict and infrastructure data.',
  ARRAY['conflict','infrastructure'],10,12),
 ('myth_check','Is this region really quiet',
  'Pick a region widely assumed to be quiet right now and test it against live conflict, maritime and aircraft signals. Is the calm real, or is something building? State plainly what the data shows.',
  ARRAY['conflict','AIS'],8,14),
 ('entity_deep_cut','Sanctioned actor network snapshot',
  'Take a currently notable sanctioned actor or entity, map its live connections through the actor network, and note any vessel or infrastructure activity linked to it. Use entity and shadow-fleet data.',
  ARRAY['sanctions','AIS'],8,18),
 ('data_snapshot','Regime-shift signal now',
  'Which region shows the largest current regime-shift or posture signal, and does a second live feed (conflict, maritime or aircraft) corroborate the change? Use posture or regime signals plus a live feed.',
  ARRAY['regime','ADS-B'],8,12),
 -- ── Cross-cutting (both communities) ──
 ('data_snapshot','Highest-signal convergence now',
  'Across the covered regions, where are multiple domains converging most strongly right now per the convergence feed, what is driving it, and why is it the highest-signal cluster? Use convergences and the underlying feeds.',
  ARRAY['convergence','conflict'],9,8),
 ('base_rate','Precursor-analog read',
  'Take the strongest current precursor-analog match, describe the present pattern, and note what comparable past episodes tended to precede, framed as an analog and not a forecast. Use precursor matches and a corroborating live feed.',
  ARRAY['precursor','conflict'],7,18),
 ('myth_check','Red Sea rerouting claim',
  'Test the claim that shipping has returned to the Red Sea. Note plainly that eYKON does not have live AIS coverage of Bab-el-Mandeb; answer from what live AIS does show around the Cape and Suez and from conflict signals, and say what is knowable versus not.',
  ARRAY['AIS','conflict'],6,18),
 ('calibration_retro','Resolved call retrospective',
  'If the calibration ledger has a recently resolved prediction, state the original call, its date, and how it resolved against outcomes. If none has resolved yet, reply exactly insufficient live data.',
  ARRAY['calibration','conflict'],4,21);
