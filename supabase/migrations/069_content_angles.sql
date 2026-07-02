-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 069 · Proactive Content Layer · angle library
--
-- The query library for the daily proactive content engine (the baseline
-- beneath the reactive newsjack spikes). Each row is an ANGLE: a specific,
-- CROSS-FEED analyst prompt written for a given post format. The engine picks
-- an eligible angle each run, hands the prompt to the AI Analyst (which grounds
-- it in live data via its tools), and drafts an X post. Angles are data, not
-- code, so they can be added/killed/edited without a deploy.
--
-- Reuses newsjack_events / newsjack_drafts (source='proactive') for the draft
-- queue + approve/publish, so both layers share /admin/newsjack.
--
-- Additive. RLS ON, NO permissive policy — service-role API only.
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS content_angles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  format         TEXT NOT NULL CHECK (format IN
                   ('analyst_query','data_snapshot','myth_check','base_rate','entity_deep_cut','calibration_retro')),
  title          TEXT NOT NULL,                    -- short label (rotation + admin)
  prompt         TEXT NOT NULL,                    -- the analyst instruction (the "question")
  required_feeds TEXT[] NOT NULL DEFAULT '{}',     -- >=2 feeds this angle spans (cross-domain)
  weight         INT NOT NULL DEFAULT 10,          -- rotation weight
  cooldown_days  INT NOT NULL DEFAULT 14,          -- min days between reuse
  last_used_at   TIMESTAMPTZ,
  score          NUMERIC NOT NULL DEFAULT 0,       -- performance (retention loop, v1.1)
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_angles_pick ON content_angles (enabled, last_used_at);

ALTER TABLE content_angles ENABLE ROW LEVEL SECURITY;
-- (no permissive policy — all access via the service-role API)

-- ── Seed library ────────────────────────────────────────────────
-- Every angle is specific and spans >=2 feeds. Live-AIS angles use covered
-- straits (Malacca / Suez / Bosphorus); uncovered regions are framed
-- analytically in the prompt itself.
INSERT INTO content_angles (format, title, prompt, required_feeds, weight, cooldown_days) VALUES
 ('analyst_query','Malacca tanker shift vs baseline',
  'How has crude-tanker traffic through the Strait of Malacca over the last 7 days compared with its trailing baseline, and what is the read-across for crude prices? Use live AIS vessel data and energy context.',
  ARRAY['AIS','energy'],12,14),
 ('data_snapshot','Bosphorus transit vs Black Sea conflict',
  'Right now, characterise vessel transit through the Bosphorus from live AIS and set it against conflict-event density in the Black Sea this week. What stands out?',
  ARRAY['AIS','conflict'],10,14),
 ('myth_check','Are Russian seaborne crude flows really down',
  'Test the common claim that sanctions have sharply cut Russian seaborne crude. What do current AIS vessel movements and energy-inventory data actually indicate this week? Be specific and name the feeds.',
  ARRAY['AIS','energy'],10,21),
 ('base_rate','Brent after a Gulf-of-Guinea conflict spike',
  'What is the historical base rate for a Brent move greater than 3 percent in the two weeks after a conflict-event spike in the Gulf of Guinea, and where do current conflict and energy signals put us now?',
  ARRAY['conflict','energy'],9,21),
 ('entity_deep_cut','Busiest covered LNG terminal this week',
  'For the busiest LNG export terminal in a region eYKON covers, characterise loadings and the vessel picture this week from live data, and note the implication for gas markets.',
  ARRAY['AIS','energy'],8,21),
 ('analyst_query','Military ADS-B delta by theatre',
  'Which active conflict theatre saw the largest change in military-aircraft ADS-B activity in the last 48 hours, and how does that line up with conflict-event data on the ground?',
  ARRAY['ADS-B','conflict'],10,14),
 ('data_snapshot','Power offline under storm warnings',
  'How many power plants are currently offline in regions under active storm or weather warnings, and what is the plausible demand impact? Use live infrastructure and weather data.',
  ARRAY['energy','weather'],8,14),
 ('base_rate','Sahel spike persistence and corroboration',
  'After a 2-sigma conflict-event spike in the Sahel, what is the base rate for activity persisting beyond 14 days, and do maritime or energy-infrastructure signals in the region corroborate escalation now?',
  ARRAY['conflict','energy'],8,21),
 ('entity_deep_cut','Dark-ship behaviour near Malacca',
  'What does the current AIS picture around the Strait of Malacca reveal about AIS-off (dark-ship) behaviour versus normal, and does any sanctions context line up?',
  ARRAY['AIS','OFAC'],9,21),
 ('analyst_query','Suez crude flow vs Brent',
  'How did crude-tanker flow through the Suez Canal move this week from live AIS, and how tightly did it track Brent?',
  ARRAY['AIS','energy'],10,14),
 ('myth_check','Is Red Sea shipping back to normal',
  'Test the claim that Red Sea shipping has normalised. Note: eYKON does not have live AIS coverage of Bab-el-Mandeb — answer analytically from reroute signals around the Cape and historical analogs, and say so plainly. Do not claim live Bab-el-Mandeb coverage.',
  ARRAY['AIS','conflict'],7,21),
 ('data_snapshot','Highest-signal convergence right now',
  'Where are conflict, maritime and energy anomalies converging most strongly right now across the covered regions, and why is that the highest-signal cluster this week?',
  ARRAY['conflict','AIS','energy'],9,10),
 ('analyst_query','Bosphorus queue and Black Sea flows',
  'Characterise the current vessel queue and transit tempo at the Bosphorus from live AIS, and connect it to any conflict or energy signals affecting Black Sea flows.',
  ARRAY['AIS','conflict'],9,14),
 ('base_rate','Refinery outage to crack spread',
  'What is the typical lag and magnitude from a refinery-outage signal to a crack-spread move per historical analogs, and do current energy-infrastructure and maritime signals point that way now?',
  ARRAY['energy','AIS'],8,21);
