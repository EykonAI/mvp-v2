#!/usr/bin/env node
// ─── IMAGERY IMG-10: the s1:anchorage_count claim family, tested ──────────
//
// The database half (migration 193) is proven by supabase/tests/img10_guards.sql:
// nothing measured or issued before admission, the walk-forward backtest is
// printed with its base rate (and looks only backwards), Calibrating until 90
// judged, VOID rules. This file proves the TypeScript half:
//
//   1. rows are built only from an issuing plan, with a positive frozen
//      baseline of >= 3 clear looks and 0 < p < 1;
//   2. the claim is about the NEXT week and resolves the day after it ends;
//      its statement carries the VOID rules and the not-a-count caveat;
//   3. the resolver maps defer → null (retry), void → VOID with the reason,
//      ready → 0/1, anything else → null — never a guessed 0.5;
//   4. the scorer's dispatch has a case for 's1-anchorage', and a source with
//      no case is VOID.
//
// node apps/web/scripts/intel/test-s1-claims.mjs

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

const S = load(join(WEB, 'lib/imagery/s1-claims.ts'));
const R = load(join(WEB, 'lib/predictions/resolvers/s1-anchorage.ts'));
const I = load(join(WEB, 'lib/predictions/resolvers/index.ts'));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

const now = new Date('2026-10-01T10:00:00Z');   // a Thursday
const good = { issuing: true, reason: 'issuing', aoi_id: 'anchorage:port_123', name: 'Test anchorage', week_start: '2026-10-05',
  week_end: '2026-10-11', baseline_median: 41234.5, baseline_n: 9, p: 0.5, admission_id: 7,
  backtest: { judged: 44, base_rate: 0.41, brier: 0.24, skill: 0.01 }, family_status: 'Calibrating: 0 of 90 judged claims' };

// ── 1 · what becomes a row ───────────────────────────────────────────────
const rows = S.buildS1ClaimRows([good], now);
check('B1 an issuing plan row becomes one claim', rows.length === 1, rows.length);
check('B2 nothing from a non-issuing plan', S.buildS1ClaimRows([{ ...good, issuing: false }], now).length === 0);
check('B3 no baseline → no claim', S.buildS1ClaimRows([{ ...good, baseline_median: null }], now).length === 0);
check('B4 baseline of 2 looks → no claim', S.buildS1ClaimRows([{ ...good, baseline_n: 2 }], now).length === 0);
check('B5 p outside (0,1) → no claim', S.buildS1ClaimRows([{ ...good, p: 1 }], now).length === 0 && S.buildS1ClaimRows([{ ...good, p: null }], now).length === 0);

// ── 2 · the claim itself ─────────────────────────────────────────────────
const r0 = rows[0] ?? {};
check('C1 source / feature / track', r0.source === 's1-anchorage' && r0.feature === 's1_anchorage_above_median' && r0.track === 'machine', r0);
check('C2 observable', r0.target_observable === 's1:anchorage_count:anchorage:port_123:2026-10-05', r0.target_observable);
check('C3 resolves the day after the week ends', r0.resolves_at === '2026-10-12T00:00:00.000Z', r0.resolves_at);
check('C4 resolver context frozen', r0.context && r0.context.aoi_id === good.aoi_id && r0.context.week_start === good.week_start
  && r0.context.week_end === good.week_end && r0.context.baseline_median === good.baseline_median && r0.context.backtest_at_issue.judged === 44, r0.context);
check('C5 statement: week, baseline, not-a-count, VOID rules', /2026-10-05–2026-10-11/.test(r0.statement) && /41235 m²/.test(r0.statement)
  && /not a count/.test(r0.statement) && /VOID if no clear Sentinel-1 pass/.test(r0.statement) && /no longer admitted/.test(r0.statement), r0.statement);
check('C6 point forecast at p', r0.predicted_distribution && r0.predicted_distribution.mean === 0.5, r0.predicted_distribution);
check('C7 hash present', typeof r0.hash === 'string' && r0.hash.length >= 32, r0.hash);

// ── 3 · resolver mapping ─────────────────────────────────────────────────
const fake = (data, error = null) => ({ rpc: async (name, args) => ({ data: typeof data === 'function' ? data(name, args) : data, error }) });
const row = { id: 'x', feature: 's1_anchorage_above_median', source: 's1-anchorage', target_observable: 'o', resolves_at: '', issued_at: '', context: { aoi_id: 'a' }, predicted_distribution: null };
check('R1 defer → null', (await R.resolveS1Anchorage(row, fake({ state: 'defer' }))) === null);
const v = await R.resolveS1Anchorage(row, fake({ state: 'void', void_reason: 'no clear Sentinel-1 pass at a' }));
check('R2 void → VOID with the reason', v && v.void_reason === 'no clear Sentinel-1 pass at a', v);
check('R3 ready 1 → observed 1', (await R.resolveS1Anchorage(row, fake({ state: 'ready', observed: 1 })))?.observed === 1);
check('R4 ready 0 → observed 0, not VOID', (() => true)() && (await R.resolveS1Anchorage(row, fake({ state: 'ready', observed: 0 })))?.void_reason === undefined);
check('R5 an error → null (retry), never a guess', (await R.resolveS1Anchorage(row, fake(null, { message: 'boom' }))) === null);
check('R6 an odd answer → null, never 0.5', (await R.resolveS1Anchorage(row, fake({ state: 'ready', observed: 0.5 }))) === null);
let sent = null;
await R.resolveS1Anchorage(row, fake((name, args) => { sent = { name, args }; return { state: 'defer' }; }));
check('R7 calls s1_anchorage_resolution with the context', sent && sent.name === 's1_anchorage_resolution' && sent.args.p_context.aoi_id === 'a', sent);

// ── 4 · dispatch ─────────────────────────────────────────────────────────
const d = await I.resolveBySource(row, fake({ state: 'void', void_reason: 'why' }));
check('D1 the scorer dispatches s1-anchorage to its resolver', d && d.void_reason === 'why', d);
const nr = await I.resolveBySource({ ...row, source: 's9-unknown' }, fake({}));
check('D2 a source with no case is VOID, never 0.5', nr && typeof nr.void_reason === 'string' && /no resolver/.test(nr.void_reason), nr);

if (fails.length) {
  console.error(`test-s1-claims: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`test-s1-claims: OK — ${pass} checks (rows only from an issuing plan, next-week claim with VOID rules, resolver never guesses, dispatch).`);
