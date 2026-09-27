#!/usr/bin/env node
// ─── IMAGERY IMG-8: alerts, the weekly brief item and posture, tested ────
//
// The database half (migration 191) is proven by supabase/tests/img8_guards.sql:
// a cloudy week fires nothing and logs VOID, every look is judged once, the
// weekly movements omit VOID looks, the theatre term is NULL until admitted.
// This file proves the TypeScript half:
//
//   1. imagery_change config bounds (10-500 %, a site or a kind);
//   2. a pass of only VOID looks produces NO alert; a fired alert names a
//      spectral change against the site's own median — never a stockpile,
//      a tonnage or "activity" — and counts VOID looks as VOID, not zero;
//   3. the weekly item keeps only clear, baselined looks and appears only
//      on the weekly cadence;
//   4. posture: the five-domain formula uses the original weights, a row
//      that names its formula is read as written, the legacy fixture rows
//      still reconstruct, the precursor series stays four-domain, and the
//      digest never reports a formula change as a posture mover.
//
// Every assertion fails if its rule is removed. Needs apps/web/node_modules
// (typescript). node apps/web/scripts/intel/test-imagery-notif.mjs

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

const I = load(join(WEB, 'lib/notifications/imagery-change.ts'));
const D = load(join(WEB, 'lib/notifications/digest.ts'));
const P = load(join(WEB, 'lib/intel/postureComposite.ts'));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ── 1 · config ───────────────────────────────────────────────────────────
const ok = I.normaliseImageryChangeConfig({ sensor: 's2_l2a', kind: 'mine', direction: 'either', min_change_pct: 20 });
check('C1 a mine-kind rule normalises', ok.config && ok.config.kind === 'mine' && ok.config.aoi_id === null, ok);
check('C2 < 10 % refused', I.normaliseImageryChangeConfig({ kind: 'mine', min_change_pct: 5 }).error === 'invalid_min_change_pct');
check('C3 > 500 % refused', I.normaliseImageryChangeConfig({ kind: 'mine', min_change_pct: 900 }).error === 'invalid_min_change_pct');
check('C4 a site or a kind is required', I.normaliseImageryChangeConfig({ min_change_pct: 20 }).error === 'site_or_kind_required');
check('C5 unknown sensor refused', I.normaliseImageryChangeConfig({ sensor: 'landsat', kind: 'mine' }).error === 'invalid_sensor');
const site = I.normaliseImageryChangeConfig({ aoi_id: 'mine:abc', kind: 'port' });
check('C6 a named site wins over a kind', site.config && site.config.aoi_id === 'mine:abc' && site.config.kind === null, site);
check('C7 malformed site id refused', I.normaliseImageryChangeConfig({ aoi_id: 'drop table' }).error === 'invalid_aoi_id');

// ── 2 · alerts ───────────────────────────────────────────────────────────
const cfg = ok.config;
const look = (d, outcome, over = {}) => ({
  aoi_id: 'mine:m1', name: 'Test pit', kind: 'mine', sensor: 's2_l2a', acquired_at: `2026-09-${d}T10:30:00Z`,
  coverage_state: outcome === 'void' ? 'cloudy' : 'clear', outcome,
  value: outcome === 'void' ? null : 0.13, baseline_median: 0.1, baseline_n: 4,
  change_pct: outcome === 'fired' ? 30 : outcome === 'below_threshold' ? 5 : null, chip_path: null, ...over,
});
check('A1 a cloudy week (only VOID looks) fires nothing', I.summariseJudged([look('21', 'void'), look('23', 'void'), look('25', 'void')], cfg) === null);
check('A2 below-threshold and no-baseline looks fire nothing',
  I.summariseJudged([look('21', 'below_threshold'), look('22', 'no_baseline', { change_pct: null })], cfg) === null);
check('A3 a "fired" row with no value is not an alert', I.summariseJudged([look('21', 'fired', { value: null })], cfg) === null);
const res = I.summariseJudged([look('20', 'void'), look('24', 'fired'), look('25', 'void')], cfg);
check('A4 one fired look → alert', res && res.fired.length === 1 && res.voidLooks === 2, res);
const text = res ? [res.summary, ...res.detailLines].join(' \n ') : '';
check('A5 the summary states a change vs the site\'s own median', /moved \+30 % from its own median on 2026-09-24/.test(text), res && res.summary);
check('A6 VOID looks are called VOID, not zero', /logged as VOID — not zero/.test(text));
check('A7 no stockpile / tonnage / activity claim', !/stockpile (grew|rose|fell)|tonnes|activity (rose|increased|fell)|expanded/i.test(text.replace(/not a tonnage, a volume or an activity level/, '')), text);
check('A8 credit present', /Contains modified Copernicus Sentinel data \d{4}/.test(text));
const payload = I.buildImageryChangeFirePayload({ name: 'r' }, res, '2026-09-27T00:00:00Z');
check('A9 payload type', payload.ruleType === 'imagery_change');

// ── 3 · weekly brief item ────────────────────────────────────────────────
const rows = [
  { aoi_id: 'mine:a', name: 'A', kind: 'mine', sensor: 's2_l2a', acquired_at: '2026-09-24T10:00:00Z', metric_name: 'ndvi_median', value: 0.14, baseline_n: 4, change_pct: 40, chip_url: 'https://x/c.png' },
  { aoi_id: 'mine:b', name: 'B', kind: 'mine', sensor: 's2_l2a', acquired_at: '2026-09-25T10:00:00Z', metric_name: null, value: null, baseline_n: 4, change_pct: null, chip_url: null },
  { aoi_id: 'mine:c', name: 'C', kind: 'mine', sensor: 's2_l2a', acquired_at: '2026-09-25T10:00:00Z', metric_name: 'ndvi_median', value: 0.2, baseline_n: 2, change_pct: 30, chip_url: null },
];
const mv = D.composeImageryMovements(rows);
check('B1 only the clear, baselined look is kept', mv.length === 1 && mv[0].aoiId === 'mine:a', mv);
check('B2 item carries date, change and credit', mv[0] && mv[0].date === '2026-09-24' && mv[0].changePct === 40 && /Copernicus Sentinel data 2026/.test(mv[0].credit), mv[0]);
const baseSources = {
  windowHours: 168, sinceIso: '2026-09-20T00:00:00Z', anomalies: [], convergences: [], infraEvents: [], conflictEvents: [],
  postureRows: [], imageryMovements: rows, errors: [],
};
const weekly = D.composeDigest(baseSources, 'generalist', 'weekly');
const daily = D.composeDigest({ ...baseSources, windowHours: 24 }, 'generalist', 'daily');
check('B3 weekly digest carries the item', weekly.imageryMovements.length === 1, weekly.imageryMovements);
check('B4 daily digest never does', daily.imageryMovements.length === 0);
check('B5 an imagery movement makes a weekly digest non-empty', weekly.isEmpty === false);

// ── 4 · posture ──────────────────────────────────────────────────────────
check('P1 five-domain uses the original weights', P.compositeWithImagery(1, 1, 1, 1, 1) === 1 && P.compositeWithImagery(0, 0, 0, 0, 1) === 0.1);
check('P2 a row naming its formula is read as written', P.storedComposite(0.5, 0.4, 'five-domain-v3') === 0.5 && P.storedComposite(0.5, null, 'four-domain-v2') === 0.5);
check('P3 legacy fixture rows still reconstruct', P.storedComposite(0.5, 0.3) === Math.round(((0.5 - 0.03) / 0.9) * 1000) / 1000);
check('P4 precursor series stays four-domain for a v3 row',
  P.fourDomainComposite({ composite: 0.9, imagery: 1, composite_formula: 'five-domain-v3', air: 0.5, sea: 0.5, conflict: 0.5, grid: 0.5 }) === 0.5);
check('P5 a v3 row missing a domain gives null, not 0',
  P.fourDomainComposite({ composite: 0.9, imagery: 1, composite_formula: 'five-domain-v3', air: 0.5, sea: null, conflict: 0.5, grid: 0.5 }) === null);
const moved = D.composeDigest({
  ...baseSources, imageryMovements: [],
  postureRows: [
    { theatre_slug: 'hormuz', composite: 0.62, formula: 'five-domain-v3', computed_at: '2026-09-26T12:00:00Z' },
    { theatre_slug: 'hormuz', composite: 0.60, formula: 'five-domain-v3', computed_at: '2026-09-26T06:00:00Z' },
    { theatre_slug: 'hormuz', composite: 0.30, formula: 'four-domain-v2', computed_at: '2026-09-25T00:00:00Z' },
  ],
}, 'generalist', 'weekly');
const hz = moved.postureMovers.find(m => m.theatre === 'hormuz');
check('P6 a formula change is not a posture mover', hz && hz.from === 0.6 && hz.to === 0.62, moved.postureMovers);

if (fails.length) {
  console.error(`test-imagery-notif: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`test-imagery-notif: OK — ${pass} checks (config bounds, VOID never alerts, spectral wording, weekly-only clear items, posture formulas).`);
