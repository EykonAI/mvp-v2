-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — Seed · entities registry (curated shortlist for Sanctions Wargame
--                                       and Shadow-Fleet autocomplete)
-- Idempotent: uses ON CONFLICT DO NOTHING via unique canonical_name + type.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO entities (entity_type, canonical_name, aliases, metadata, provenance)
VALUES
  ('operator', 'Sovcomflot',          ARRAY['SCF Group']::TEXT[],        '{"country":"RU"}'::jsonb, '["OFAC-SDN"]'::jsonb),
  ('operator', 'NITC',                ARRAY['National Iranian Tanker Company']::TEXT[], '{"country":"IR"}'::jsonb, '["OFAC-SDN"]'::jsonb),
  ('flag',     'Gabon',               ARRAY['GAB']::TEXT[],                '{"code":"GAB"}'::jsonb, '["IMO Flag State"]'::jsonb),
  ('flag',     'Cook Islands',        ARRAY['COK']::TEXT[],                '{"code":"COK"}'::jsonb, '["IMO Flag State"]'::jsonb),
  ('flag',     'Panama',              ARRAY['PAN']::TEXT[],                '{"code":"PAN"}'::jsonb, '["IMO Flag State"]'::jsonb),
  ('flag',     'Liberia',             ARRAY['LBR']::TEXT[],                '{"code":"LBR"}'::jsonb, '["IMO Flag State"]'::jsonb),
  ('port',     'Kozmino',             ARRAY['Kozmino Terminal']::TEXT[],   '{"country":"RU"}'::jsonb, '["GEM"]'::jsonb),
  ('port',     'Primorsk',            ARRAY['Primorsk Terminal']::TEXT[],  '{"country":"RU"}'::jsonb, '["GEM"]'::jsonb),
  ('port',     'Rotterdam',           ARRAY['Port of Rotterdam']::TEXT[],  '{"country":"NL"}'::jsonb, '["GEM"]'::jsonb),
  ('port',     'Kharg Island',        ARRAY['Kharg']::TEXT[],              '{"country":"IR"}'::jsonb, '["GEM"]'::jsonb),
  ('refinery', 'Jamnagar',            ARRAY['Reliance Jamnagar']::TEXT[],  '{"country":"IN"}'::jsonb, '["GEM"]'::jsonb),
  ('refinery', 'Ulsan',               ARRAY['SK Ulsan']::TEXT[],           '{"country":"KR"}'::jsonb, '["GEM"]'::jsonb),
  ('refinery', 'Paraguana',           ARRAY['Paraguaná Refining Center']::TEXT[], '{"country":"VE"}'::jsonb, '["GEM"]'::jsonb),
  ('refinery', 'Port Arthur',         ARRAY['Motiva Port Arthur']::TEXT[], '{"country":"US"}'::jsonb, '["GEM"]'::jsonb),
  ('mine',     'Tenke Fungurume',     ARRAY['TFM']::TEXT[],                '{"country":"CD","mineral":"cobalt"}'::jsonb, '["CMOC"]'::jsonb),
  ('mine',     'Bayan Obo',           ARRAY['Baiyun Ebo']::TEXT[],         '{"country":"CN","mineral":"neodymium"}'::jsonb, '["Baogang"]'::jsonb)
ON CONFLICT DO NOTHING;
