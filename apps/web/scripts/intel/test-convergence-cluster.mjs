#!/usr/bin/env node
// ─── IMAGERY IMG-6: the convergence rules with a radar class, tested ─────
//
// The database half (migration 189) is proven by supabase/tests/img6_guards.sql:
// nothing is a candidate until the S1 method is admitted, and a VOID pass
// never is. This file proves the TypeScript half, end to end with fixture
// clusters:
//
//   1. 'SAR' maps to its own class, 'sensor-s1-sar', and counts as a sensor;
//   2. a VOID pass (no acquisition, partial swath, processing error, no
//      value, no baseline) produces NO flag — so a media flag next to a VOID
//      pass is still alone in its cell and NO convergence is written;
//   3. a clear, raised, baselined pass next to a media flag makes a
//      two-class, sensor-confirmed cluster; the same site is flagged once;
//   4. the pre-IMG-6 behaviour is unchanged (media-only cells stay
//      multi-source/single-source, occupied cells are skipped).
//
// Every assertion fails if its rule is removed. Needs apps/web/node_modules
// (typescript). node apps/web/scripts/intel/test-convergence-cluster.mjs

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../..');
const require = createRequire(join(WEB, 'package.json'));
const ts = require('typescript');

const cache = new Map();
function resolveTs(base) {
  for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(base + ext)) return base + ext;
  return null;
}
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const m = { exports: {} };
  cache.set(file, m);
  const req = (id) => {
    if (id.startsWith('@/')) { const f = resolveTs(join(WEB, id.slice(2))); if (f) return load(f); }
    if (id.startsWith('.')) { const f = resolveTs(resolve(dirname(file), id)); if (f) return load(f); }
    return require(id);
  };
  new Function('module', 'exports', 'require', out)(m, m.exports, req);
  return m.exports;
}

const C = load(join(WEB, 'lib/intel/convergenceCluster.ts'));
const F = load(join(WEB, 'lib/imagery/s1-flags.ts'));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// Bab-el-Mandeb window centroid and a media flag in the same 10° cell
const BAB = { lat: 12.575, lon: 43.375 };
const media = { id: 'm1', domain: 'Conflict', flag_type: 'acled_spike', payload: { latitude: 13.1, longitude: 44.2 } };
const cand = (over) => ({
  site_key: 'chokepoint:bab-el-mandeb@2026-10-01T03:12:00Z', aoi_id: 'chokepoint:bab-el-mandeb', kind: 'chokepoint',
  name: 'Bab-el-Mandeb strait (S1 window)', latitude: BAB.lat, longitude: BAB.lon, acquired_at: '2026-10-01T03:12:00Z',
  coverage_state: 'clear', bright_area_m2: 60000, vessel_equivalents: 60, baseline_median: 20000, baseline_n: 3,
  ratio_to_baseline: 3, admission_id: 1, ...over,
});

// ── 1 · the class ─────────────────────────────────────────────────────────
check('C1 SAR is its own class', C.sourceClass('SAR') === 'sensor-s1-sar', C.sourceClass('SAR'));
check('C2 the flag domain is SAR', F.S1_FLAG_DOMAIN === 'SAR', F.S1_FLAG_DOMAIN);
check('C3 existing classes unchanged',
  C.sourceClass('Conflict') === 'media' && C.sourceClass('Energy') === 'media' && C.sourceClass('Maritime') === 'sensor-ais'
  && C.sourceClass('Thermal') === 'sensor-firms' && C.sourceClass('Nightlights') === 'sensor-viirs-dnb' && C.sourceClass('X') === 'other:X');

// ── 2 · a VOID pass contributes nothing ──────────────────────────────────
const voids = [
  cand({ site_key: 'v1', coverage_state: 'no_acquisition', bright_area_m2: null, vessel_equivalents: null, ratio_to_baseline: null }),
  cand({ site_key: 'v2', coverage_state: 'partial_swath', bright_area_m2: null, vessel_equivalents: null, ratio_to_baseline: null }),
  cand({ site_key: 'v3', coverage_state: 'processing_error', bright_area_m2: null, vessel_equivalents: null, ratio_to_baseline: null }),
  cand({ site_key: 'v4', bright_area_m2: null }),
  cand({ site_key: 'v5', baseline_n: 2 }),
  cand({ site_key: 'v6', baseline_n: null, baseline_median: null, ratio_to_baseline: null }),
  cand({ site_key: 'v7', ratio_to_baseline: 1.49 }),
];
const voidFlags = F.s1FlagsFromCandidates(voids, new Set());
check('V1 no VOID / unbaselined / ordinary pass becomes a flag', voidFlags.length === 0, voidFlags.map(f => f.payload.site_key));
const voidCells = C.clusterFlags([media, ...voidFlags], new Set(), 10);
check('V2 a media flag beside VOID passes is no convergence', voidCells.length === 0, voidCells);

// ── 3 · an admitted, raised pass corroborates nothing but co-occurs ──────
const seen = new Set();
const good = F.s1FlagsFromCandidates([cand({}), cand({})], seen);
check('G1 one raised pass → one flag (same site once)', good.length === 1, good.length);
check('G2 flag shape', good[0] && good[0].domain === 'SAR' && good[0].source === 'imagery-s1'
  && good[0].payload.latitude === BAB.lat && good[0].payload.site_key.startsWith('chokepoint:bab-el-mandeb@'), good[0]);
check('G3 3× median is high severity', good[0] && good[0].severity === 'high', good[0] && good[0].severity);
check('G4 a flag already written is not written again', F.s1FlagsFromCandidates([cand({})], seen).length === 0);
const cells = C.clusterFlags([media, ...good], new Set(), 10);
check('G5 media + SAR → one cluster', cells.length === 1, cells.length);
const c0 = cells[0] ?? {};
check('G6 classes are media + sensor-s1-sar', JSON.stringify(c0.classes) === JSON.stringify(['media', 'sensor-s1-sar']), c0.classes);
check('G7 two classes → 0.15', c0.joint_p_value === 0.15, c0.joint_p_value);
check('G8 a sensor class present → sensor-confirmed level', c0.corroboration_level === 'sensor-confirmed', c0.corroboration_level);
check('G9 the instrument caveat travels in the payload', /not a vessel count/.test(String(good[0]?.payload.instrument)));

// ── 4 · unchanged behaviour ──────────────────────────────────────────────
const energy = { id: 'e1', domain: 'Energy', payload: { latitude: 12.2, longitude: 43.9 } };
const mOnly = C.clusterFlags([media, energy], new Set(), 10);
check('U1 media + media → single-source, K = 1', mOnly.length === 1 && mOnly[0].K === 1 && mOnly[0].corroboration_level === 'single-source', mOnly);
const occ = new Set(['10:40']);
check('U2 an occupied cell is skipped', C.clusterFlags([media, ...good], occ, 10).length === 0);
check('U3 a flag without coordinates is ignored', C.clusterFlags([media, { domain: 'SAR', payload: {} }], new Set(), 10).length === 0);

if (fails.length) {
  console.error(`test-convergence-cluster: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`test-convergence-cluster: OK — ${pass} checks (SAR class, VOID contributes nothing, raised pass co-occurs, unchanged rules).`);
