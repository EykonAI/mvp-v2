#!/usr/bin/env node
// ─── IMAGERY IMG-7: what query_imagery / query_webcams tell an agent ─────
//
// The acceptance line for IMG-7: the tool returns coverage_state for every
// row, and a VOID row is never summed. This proves it on the pure half
// (lib/imagery/analyst-tools.ts) with a fixture site whose VOID looks carry
// 0, 0.9 and NULL — none may reach the agent as a number. Plus: baselines
// are the site's own median with n >= 3, and webcams leave only as eYKON
// proxy links with the operator's credit.
//
// Every assertion fails if its rule is removed. Needs apps/web/node_modules
// (typescript). node apps/web/scripts/intel/test-imagery-tools.mjs

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

const T = load(join(WEB, 'lib/imagery/analyst-tools.ts'));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// A mine with six Sentinel-2 looks: three clear, three VOID of different kinds.
// The VOID rows carry NaN / 0 / a stray number on purpose: none may leak.
const row = (d, state, v, extra = {}) => ({
  aoi_id: 'mine:m1', kind: 'mine', name: 'Test pit', lat: -23.5, lon: -68.2, sensor: 's2_l2a',
  acquired_at: `2026-09-${String(d).padStart(2, '0')}T10:30:00Z`, coverage_state: state,
  metric_name: state === 'clear' ? 'ndvi_median' : null, metric_value: v, baseline_median: 0.2, baseline_n: 4, ...extra,
});
const rows = [
  row(2, 'clear', 0.2), row(7, 'cloudy', null), row(12, 'clear', 0.25),
  row(17, 'partly_cloudy', 0.9), row(22, 'no_acquisition', 0), row(26, 'clear', 0.1),
  { ...row(24, 'clear', 0.3), aoi_id: 'port:p1', kind: 'port', name: 'Test port', baseline_n: 2 },
];
const out = T.imageryPayload('s2_l2a', 30, rows);
const flat = out.sites.flatMap(s => s.looks_detail);

// ── 1 · every row carries coverage_state; totals count, never sum ────────
check('I1 every returned look has a coverage_state', flat.length > 0 && flat.every(l => typeof l.coverage_state === 'string' && l.coverage_state.length > 0));
check('I2 all 7 looks are counted, VOID included', out.looks === 7 && out.looks_by_state.cloudy === 1 && out.looks_by_state.no_acquisition === 1, out.looks_by_state);
const m1 = out.sites.find(s => s.aoi_id === 'mine:m1');
check('I3 per-site counts', m1 && m1.looks === 6 && m1.clear_looks === 3 && m1.looks_by_state.partly_cloudy === 1, m1);
check('I4 no field in the payload is a sum or mean of values',
  !JSON.stringify(out).match(/"(sum|total_value|mean|avg|average)[a-z_]*"/i));

// ── 2 · a VOID row is never a number ─────────────────────────────────────
const voidLooks = flat.filter(l => l.coverage_state !== 'clear');
check('V1 three VOID looks listed', voidLooks.length === 3, voidLooks.length);
check('V2 a VOID look has value NULL — even when the row carried 0 or 0.9', voidLooks.every(l => l.value === null && l.ratio_to_baseline === null), voidLooks);
check('V3 latest look is the VOID one when it is newest', m1 && m1.latest_look.coverage_state === 'clear' && m1.latest_look.acquired_at.startsWith('2026-09-26'));
const m1v = T.summariseObservations([row(2, 'clear', 0.2), row(9, 'cloudy', null)])[0];
check('V4 a newer cloudy look is the latest look, the older clear one stays the latest CLEAR',
  m1v.latest_look.coverage_state === 'cloudy' && m1v.latest_clear.acquired_at.startsWith('2026-09-02') && m1v.latest_clear.value === 0.2, m1v);

// ── 3 · baselines: own median, only with n >= 3 ──────────────────────────
check('B1 clear value vs own median', m1 && m1.latest_clear.value === 0.1 && m1.latest_clear.ratio_to_baseline === 0.5, m1 && m1.latest_clear);
const p1 = out.sites.find(s => s.aoi_id === 'port:p1');
check('B2 no ratio when baseline_n < 3', p1 && p1.latest_clear.ratio_to_baseline === null, p1);

// ── 4 · sensor copy and credit ───────────────────────────────────────────
check('S1 the void rule travels with the payload', /NOT zero/.test(out.void_rule) && /Never add, average/.test(out.void_rule));
check('S2 credit', /^Contains modified Copernicus Sentinel data \d{4}$/.test(out.credit), out.credit);
check('S3 S1 note says estimate, not count', /not a count/.test(T.SENSOR_NOTES.s1_grd) && /ONLY for sites the Sentinel-1 measurement study admitted/.test(T.SENSOR_NOTES.s1_grd));
const s1 = T.summariseObservations([{ ...row(3, 'no_acquisition', null), sensor: 's1_grd', vessel_equivalents: 12 }])[0];
check('S4 an S1 VOID pass carries no vessel-equivalents', s1.looks_detail[0].vessel_equivalents === null, s1.looks_detail[0]);

// ── 5 · webcams: proxy URL + credit, never upstream ──────────────────────
const cams = [
  { webcam_id: 'wc_0123456789abcdef', provider_id: 'tfl_jamcams', name: 'A40 Westway', latitude: 51.52, longitude: -0.2,
    heading_deg: 90, category: 'traffic', attribution_text: 'Powered by TfL Open Data', last_ok_at: '2026-09-27T10:00:00Z',
    nearest_aoi_id: null, nearest_aoi_name: null, upstream_url: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/x.jpg' },
  { webcam_id: 'wc_fedcba9876543210', provider_id: 'hk_td', name: 'Kwai Chung', latitude: 22.35, longitude: 114.12,
    heading_deg: null, category: 'traffic', attribution_text: 'Transport Department, HKSAR', last_ok_at: null,
    nearest_aoi_id: 'port:hk', nearest_aoi_name: 'Hong Kong' },
];
const w = T.webcamPayload('https://eykon.ai/', cams, 1);
check('W1 limit applies to the list, not the count', w.returned === 1 && w.live_cameras_in_area === 2, w);
check('W2 image URL is the eYKON proxy', w.cameras[0].image_url === 'https://eykon.ai/api/webcams/wc_0123456789abcdef/image', w.cameras[0].image_url);
check('W3 no upstream URL anywhere in the payload', !JSON.stringify(T.webcamPayload('https://eykon.ai', cams, 10)).includes('amazonaws'));
check('W4 every camera carries its attribution', T.webcamPayload('https://eykon.ai', cams, 10).cameras.every(c => c.attribution.length > 0));
check('W5 the frame rule travels', /not "now"/.test(w.rule) && /no\s+recognition/i.test(w.rule));

if (fails.length) {
  console.error(`test-imagery-tools: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`test-imagery-tools: OK — ${pass} checks (coverage_state on every look, VOID never a number or a sum, own-median baselines, proxy-only webcams).`);
