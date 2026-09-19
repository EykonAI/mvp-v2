#!/usr/bin/env node
// ─── REALITY CHECK PR-5: the TypeScript half, tested ─────────────────────
//
// The database half (migs 169 + 170) is proven by supabase/tests/pr5_guards.sql
// in the SQL Editor. This proves what SQL cannot run:
//   · the classifier ladder (lib/reality-check/classify.ts) on real and
//     synthetic series — including the Maysan first-tick fixture read from
//     production (primary LEAD 0.558, 3x3 REFUTED 0.80, KS on the baseline's
//     halves D 0.25 / p 0.786 — the values the SQL reproduction printed);
//   · the rolling rule (lib/reality-check/tick.ts planTick);
//   · the claim rules (lib/reality-check/claims.ts): p = (k + 10)/(n + 20),
//     alternate ticks, which families a verdict calls for, no banned phrase,
//     and decision C (founder, 2026-09-19): no claim window starts on a night
//     already on disk at issue — driven through the real issuer on an
//     in-memory register (a partly ingested night, a shrinking frontier lead,
//     a row that appears inside the window);
//   · the scorer default (lib/predictions/resolvers/index.ts): a source with
//     no resolver resolves VOID, never 0.5; the refinery-rc wrapper maps the
//     SQL rule's ready / defer / void faithfully.
//
// Needs apps/web/node_modules (typescript), so CI runs it after `npm ci`
// (.github/workflows/reality-check.yml, job "unit"). Run locally:
//   node apps/web/scripts/reality-check/test-refinery-rc.mjs

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../..');
const require = createRequire(join(WEB, 'package.json'));
const ts = require('typescript');

// ── a minimal TS loader: transpile on require, resolve '@/…' and './…' ──
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

const C = load(join(WEB, 'lib/reality-check/classify.ts'));
const K = load(join(WEB, 'lib/reality-check/claims.ts'));
const T = load(join(WEB, 'lib/reality-check/tick.ts'));
const R = load(join(WEB, 'lib/predictions/resolvers/index.ts'));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ── fixtures ────────────────────────────────────────────────────────────
function nights(from, n) { return Array.from({ length: n }, (_, i) => C.addDays(from, i)); }
/** A complex whose baseline/window values and FIRMS days are given in date order. */
function complex({ key = 'RFC-N00-E000-1', w, base, win, base3 = base, win3 = win, bf = 31, bh = 10, wf = 15, wh = 0 }) {
  const bn = nights(w.baseline_start, base.length);
  const wn = nights(w.window_start, win.length);
  const heatDays = [...nights(w.baseline_start, bf), ...nights(w.window_start, wf)];
  const heat = [...heatDays.slice(0, bf).map((_, i) => i < bh), ...heatDays.slice(bf).map((_, i) => i < wh)];
  return {
    cluster_key: key, members: ['way:1'], member_names: ['Test'],
    light_nights: [...bn, ...wn],
    radiance_median: [...base, ...win],
    radiance_3x3_median: [...base3, ...win3],
    heat_days: heatDays, heat_day: heat, non_refinery_members: 0,
  };
}

// ── 1 · window arithmetic (D-6) ─────────────────────────────────────────
{
  const a = C.windowsFor('2026-09-01');
  check('first tick windows: baseline 07-18..08-17, window 08-18..09-01',
    a.baseline_start === '2026-07-18' && a.baseline_end === '2026-08-17' && a.window_start === '2026-08-18' && a.window_end === '2026-09-01', a);
  const b = C.windowsFor('2026-09-08');
  check('first real tick windows: baseline 07-25..08-24, window 08-25..09-08',
    b.baseline_start === '2026-07-25' && b.baseline_end === '2026-08-24' && b.window_start === '2026-08-25' && b.window_end === '2026-09-08', b);
}

// ── 2 · the statistic ───────────────────────────────────────────────────
check('median odd', C.median([3, 1, 2]) === 2);
check('median even = midpoint (percentile_cont)', C.median([4, 1, 3, 2]) === 2.5);
check('median empty = null', C.median([]) === null);
check('light down is strict: exactly 0.60 × baseline is not down', C.lightDown(C.micro(60), C.micro(100)) === false && C.lightDown(C.micro(59.999999), C.micro(100)) === true);

// ── 3 · Maysan, first-tick windows, values read from production ─────────
{
  const w = C.windowsFor('2026-09-01');
  const base = [12.5, 107.53, 38.32, 21.18, 30.73, 12.15, 322.91, 814.84, 35.5, 146.37, 33.24, 31.29, 40.09, 28.57, 694.06, 418.13, 81.08, 45, 14.42, 45.47, 20.54, 14.13, 25.57, 25.94];
  const win = [11.8, 25.26, 31.22, 14.97, 15.58, 17.89, 40.11, 11.71, 19.19, 40.83, 26.73];
  const base3 = [232.94, 54.9, 81.49, 244.35, 135.02, 153.65, 149.25, 282.83, 98.99, 69.56, 24.68, 18.32, 68.42, 116.41, 241.07, 191.64, 43.78, 90.39, 107.84, 63.84, 220.6, 68.98, 188.26, 98.02];
  const win3 = [191.03, 70.66, 82.48, 106.15, 73.57, 104.34, 96.88, 10.37, 117.99, 23.12, 68.46];
  const v = C.classifyComplex(complex({ key: 'RFC-N31-E047-1', w, base, win, base3, win3, bf: 31, bh: 10, wf: 15, wh: 0 }), w);
  check('Maysan: primary LEAD', v.verdict === 'LEAD', v);
  check('Maysan: medians 34.37 → 19.19 (ratio 0.558)', v.baseline_median === 34.37 && v.window_median === 19.19
    && Math.abs(v.window_median / v.baseline_median - 0.558) < 0.001, [v.baseline_median, v.window_median]);
  check('Maysan: not robust — REFUTED on radiance_3x3 (ratio ~0.80)', v.robustness_verdict === 'REFUTED'
    && Math.abs(v.r3_window_median / v.r3_baseline_median - 0.798) < 0.002, [v.robustness_verdict, v.r3_baseline_median, v.r3_window_median]);
  check('Maysan: KS on the baseline halves D 0.25, p 0.786 (the SQL reproduction), tested at 24 nights',
    v.ks_tested === true && v.ks_d === 0.25 && Math.abs(v.ks_p - 0.7864) < 0.0005, [v.ks_d, v.ks_p]);
  check('Maysan: distributions overlap (window max 40.83 >= baseline min 12.15)', v.window_max >= v.baseline_min && v.baseline_max >= v.window_min);
}

// ── 4 · the ladder ──────────────────────────────────────────────────────
{
  const w = C.windowsFor('2026-09-08');
  const flat = (n, x) => Array.from({ length: n }, (_, i) => x + (i % 5));
  const cases = [
    ['REFUTED: heat down, light held', { base: flat(20, 100), win: flat(8, 110) }, 'REFUTED', 'REFUTED'],
    ['LEAD: heat down, light down, tested', { base: flat(20, 100), win: flat(8, 40) }, 'LEAD', 'LEAD'],
    ['dual-down at 8 baseline nights → VOID_INSUFFICIENT_NIGHTS, never LEAD', { base: flat(8, 100), win: flat(5, 40) }, 'VOID_INSUFFICIENT_NIGHTS', null],
    ['refuted at 8 baseline nights stays REFUTED (untested)', { base: flat(8, 100), win: flat(5, 110) }, 'REFUTED', 'REFUTED'],
    ['STEADY', { base: flat(20, 100), win: flat(8, 100), wh: 7 }, 'STEADY', 'STEADY'],
    ['LIGHT_DOWN_ONLY', { base: flat(20, 100), win: flat(8, 40), wh: 7 }, 'LIGHT_DOWN_ONLY', 'LIGHT_DOWN_ONLY'],
    ['heat not observable (baseline 6/31 = 0.19)', { base: flat(20, 100), win: flat(8, 100), bh: 6 }, 'VOID_HEAT_NOT_OBSERVABLE', null],
    ['a step in the baseline fails KS → VOID_BASELINE_UNSTABLE', { base: [...flat(10, 20), ...flat(10, 200)], win: flat(8, 150) }, 'VOID_BASELINE_UNSTABLE', null],
    ['below the floors → VOID_INSUFFICIENT_NIGHTS', { base: flat(4, 100), win: flat(8, 100) }, 'VOID_INSUFFICIENT_NIGHTS', null],
    ['no window night → VOID_NOT_OBSERVED', { base: flat(20, 100), win: [] }, 'VOID_NOT_OBSERVED', null],
    ['LEAD, not robust: 3x3 holds the light', { base: flat(20, 100), win: flat(8, 40), base3: flat(20, 100), win3: flat(8, 90) }, 'LEAD', 'REFUTED'],
    ['null nights are no retrieval, not darkness', { base: [...flat(20, 100), null, null], win: [null, null, 110, 110, 110] }, 'REFUTED', 'REFUTED'],
  ];
  for (const [name, args, want, wantR] of cases) {
    const v = C.classifyComplex(complex({ w, ...args }), w);
    check(`ladder: ${name}`, v.verdict === want && v.robustness_verdict === wantR, { verdict: v.verdict, robustness: v.robustness_verdict });
  }
  // CHECK-shape invariants the database will re-derive
  const v = C.classifyComplex(complex({ w, base: flat(4, 100), win: flat(8, 100) }), w);
  check('BELOW_FLOOR rows carry no KS (a failed test could not be VOID_INSUFFICIENT_NIGHTS)', v.coverage_state === 'BELOW_FLOOR' && v.ks_tested === null && v.ks_p === null);
  const z = C.classifyComplex(complex({ w, base: [0, 0, 0, 0, 0, 0], win: [0, 0, 0] }), w);
  check('zero radiance is a value: all-zero baseline and window read STEADY-side (ratio undefined, not down)', z.verdict === 'REFUTED' && z.baseline_median === 0);
}

// ── 5 · the rolling rule ────────────────────────────────────────────────
{
  const last = { id: 7, data_clock_night: '2026-09-08', baseline_start: '2026-07-25', window_end: '2026-09-08', bm_nights_used: ['2026-07-25', '2026-07-26'], firms_days_used: ['2026-07-25'] };
  const same = { bmNow: ['2026-07-25', '2026-07-26'], firmsNow: ['2026-07-25'] };
  check('plan: no clock → skip', T.planTick({ clock: null, last: null, bmNow: null, firmsNow: null }).kind === 'skip');
  check('plan: first tick → new', T.planTick({ clock: '2026-09-08', last: null, bmNow: null, firmsNow: null }).kind === 'new');
  check('plan: +6 nights, nothing late → skip', T.planTick({ clock: '2026-09-14', last, ...same }).kind === 'skip');
  check('plan: +7 nights → new', T.planTick({ clock: '2026-09-15', last, ...same }).kind === 'new');
  const late = T.planTick({ clock: '2026-09-10', last, bmNow: ['2026-07-25', '2026-07-26', '2026-07-27'], firmsNow: ['2026-07-25'] });
  check('plan: a late night inside the range → superseding tick at the SAME clock', late.kind === 'supersede' && late.clock === '2026-09-08' && late.supersedes === 7, late);
  check('plan: the clock went backwards → skip', T.planTick({ clock: '2026-09-01', last, ...same }).kind === 'skip');
}

// ── 5b · a run record on every call (R-4: "a row iff the tick ran") ────────
{
  const rows = [];
  const db = { from: (table) => ({ insert: async (r) => { rows.push({ table, ...r }); return { error: null }; } }) };
  const base = { run_id: null, supersedes_run_id: null, data_clock_night: null, windows: null, funnel: null, claims: null, duration_ms: 0, error: null };
  await T.recordTickRun(db, { ...base, action: 'skipped', reason: 'data clock 2026-09-10 is 2 night(s) past the last tick' });
  await T.recordTickRun(db, { ...base, action: 'refused', reason: '3 complex(es) still hold a site that is not site_type refinery' });
  await T.recordTickRun(db, { ...base, action: 'failed', reason: 'first tick', error: 'tick inputs: canceling statement due to statement timeout' });
  await T.recordTickRun(db, { ...base, action: 'published', reason: 'first tick', claims: { issuing: true, reason: '', issued: 27, by_family: {}, declined: {}, error: null } });
  const [skip, refused, failed] = rows;
  check('run record: one issuance_runs row per call that does not reach the issuer (the issuer records its own)',
    rows.length === 3 && rows.every((r) => r.table === 'issuance_runs' && r.source === 'refinery-rc' && r.issued === 0), rows);
  check('run record: a skipped tick is recorded without an error, with its reason',
    skip.error === null && Object.keys(skip.declined)[0].startsWith('no issuing tick — tick skipped: data clock'), skip);
  check('run record: refused and failed ticks carry their error (the admin issuance-error alert reads it)',
    /tick refused: 3 complex/.test(refused.error ?? '') && /tick failed: tick inputs: canceling statement/.test(failed.error ?? ''), [refused, failed]);

  // …and the tick itself writes it on the paths that return early from inside
  // its try block (skip, refuse) — a record placed after the try/finally would
  // never run there. A chainable stand-in for the Supabase client:
  const stubDb = (answers, written) => {
    const chain = (result) => {
      const b = { then: (res, rej) => Promise.resolve(result).then(res, rej) };
      for (const m of ['select', 'update', 'eq', 'lt', 'lte', 'gte', 'order', 'limit', 'not', 'in', 'range', 'single', 'maybeSingle']) b[m] = () => b;
      return b;
    };
    return {
      from: (table) => {
        const b = chain({ data: answers[table] ?? [], error: null });
        b.insert = (r) => { written.push({ table, ...r }); return chain({ data: null, error: null }); };
        return b;
      },
      rpc: (name) => chain({ data: answers[`rpc:${name}`] ?? [], error: null }),
    };
  };
  const w1 = [];
  const skipped = await T.runRefineryRealityCheck(stubDb({}, w1), new Date('2026-09-20T10:22:00Z'));
  check('tick: no data clock → skipped, and the skip leaves an issuance_runs row (source refinery-rc, no error)',
    skipped.action === 'skipped' && w1.length === 1 && w1[0].table === 'issuance_runs' && w1[0].source === 'refinery-rc'
    && w1[0].error === null && /tick skipped: no usable Black Marble/.test(Object.keys(w1[0].declined)[0]), { skipped, w1 });
  const w2 = [];
  const refusedTick = await T.runRefineryRealityCheck(stubDb({
    sensor_usable_nights: [{ night: '2026-09-08' }],
    'rpc:reality_check_tick_inputs': [{ cluster_key: 'RFC-N00-E000-1', members: ['a'], member_names: ['A'], light_nights: [], radiance_median: [], radiance_3x3_median: [], heat_days: [], heat_day: [], non_refinery_members: 1 }],
  }, w2), new Date('2026-09-20T10:22:00Z'));
  check('tick: a stale registry → refused, and the refusal is recorded WITH its error',
    refusedTick.action === 'refused' && w2.length === 1 && w2[0].table === 'issuance_runs' && /tick refused/.test(w2[0].error ?? ''), { refusedTick, w2 });
}

// ── 6 · claims ──────────────────────────────────────────────────────────
{
  check('p = (k + 10)/(n + 20): n 0 → 0.5', K.shrunkRate(0, 0) === 0.5);
  check('p: k 9, n 10 → 0.6333', K.shrunkRate(9, 10) === 0.6333);
  check('p: k 100, n 100 → 0.9167', K.shrunkRate(100, 100) === 0.9167);
  check('alternate ticks: none yet → issue', K.isIssuingTick('2026-09-08', null) === true);
  check('alternate ticks: +7 → no', K.isIssuingTick('2026-09-15', '2026-09-08') === false);
  check('alternate ticks: +14 → issue', K.isIssuingTick('2026-09-22', '2026-09-08') === true);

  const w = C.windowsFor('2026-09-08');
  const mk = (key, verdict) => ({ cluster_key: key, verdict, members: ['a'], member_count: 1, baseline_median: 100, window_median: 110, baseline_heat_days: 10, baseline_firms_days: 31, robustness_verdict: verdict });
  // production on 2026-09-19: BM data clock 09-08, newest night with any BM row 09-09 (405/449), FIRMS clock 09-19
  const clocks = { firms: '2026-09-19', bmNewestOnDisk: '2026-09-09', lastLightWindowEnd: null };
  const cands = K.candidatesFor([mk('K1', 'REFUTED'), mk('K2', 'LEAD'), mk('K3', 'STEADY'), mk('K4', 'VOID_INSUFFICIENT_NIGHTS')], w, clocks);
  const fams = cands.map((c) => `${c.family}:${c.row.cluster_key}`).sort();
  check('claims: REFUTED → heat + stays lit + refutation holds; LEAD → heat + lead persists; others nothing',
    JSON.stringify(fams) === JSON.stringify(['rc_heat_dark_persists:K1', 'rc_heat_dark_persists:K2', 'rc_lead_light_persists:K2', 'rc_refutation_holds:K1', 'rc_site_stays_lit:K1']), fams);
  const heat = cands.find((c) => c.family === 'rc_heat_dark_persists');
  const lit = cands.find((c) => c.family === 'rc_site_stays_lit');
  const lead = cands.find((c) => c.family === 'rc_lead_light_persists');
  const holds = cands.find((c) => c.family === 'rc_refutation_holds');
  check('decision C: light window = the 14 nights after the newest BM night on disk (09-09 partly ingested → 09-10..09-23), both light families',
    lit.window_start === '2026-09-10' && lit.window_end === '2026-09-23' && lead.window_start === '2026-09-10' && lead.window_end === '2026-09-23', [lit.window_start, lit.window_end]);
  check('heat window = the 14 FIRMS days after the FIRMS clock (09-20..10-03); refutation holds = the 14 nights after the data clock (09-09..09-22)',
    heat.window_start === '2026-09-20' && heat.window_end === '2026-10-03' && holds.window_start === '2026-09-09' && holds.window_end === '2026-09-22');
  check('decision C: light start = the frontier + 1 when the frontier is the clock', K.lightWindowStart('2026-09-08', '2026-09-08', null) === '2026-09-09');
  check('decision C: light start = the frontier + 1 when a later night is partly on disk', K.lightWindowStart('2026-09-08', '2026-09-12', null) === '2026-09-13');
  check('decision C: a shrinking frontier lead cannot overlap the last light window (09-10..09-23 claimed; clock = frontier = 09-22 → 09-24)',
    K.lightWindowStart('2026-09-22', '2026-09-22', '2026-09-23') === '2026-09-24');
  check('decision C: the last light window is only a floor (frontier 10-01 → 10-02)', K.lightWindowStart('2026-09-22', '2026-10-01', '2026-09-23') === '2026-10-02');
  let threw = null;
  try { K.assertNothingOnDisk('FIRMS', '2026-09-20', '2026-10-03', new Map([['K1', 0], ['K2', 2]])); } catch (e) { threw = e.message; }
  check('decision C: a window night already on disk refuses the issuance (names the complex and the count)', /FIRMS window 2026-09-20\.\.2026-10-03 already holds rows at issue for K2 \(2 night/.test(threw ?? ''), threw);
  let clear = true;
  try { K.assertNothingOnDisk('Black Marble', '2026-09-10', '2026-09-23', new Map([['K1', 0]])); } catch { clear = false; }
  check('decision C: all zero → issues', clear);
  const row = K.buildClaimRow({ c: lit, label: 'Test', memberNames: ['Test'], w, runId: 1, fam: { judged: 0, k: 0, status: 'calibrating' }, firmsClock: '2026-09-19', bmNewestOnDisk: '2026-09-09', nightsOnDisk: 0, now: new Date('2026-09-20T10:22:00Z') });
  check('claim row: machine track, source refinery-rc, hash, p 0.5, observable with the dates, nothing on disk, the frontier recorded',
    row.track === 'machine' && row.source === 'refinery-rc' && /^[0-9a-f]{64}$/.test(row.hash)
    && row.predicted_distribution.mean === 0.5 && row.target_observable === 'refinery-rc:rc_site_stays_lit:K1:2026-09-10..2026-09-23'
    && row.context.window_start === '2026-09-10' && row.context.window_end === '2026-09-23' && row.resolves_at === '2026-09-24T00:00:00.000Z'
    && row.context.forecast_k === 0 && row.context.forecast_n === 0 && row.context.window_nights_on_disk_at_issue === 0
    && row.context.bm_newest_night_on_disk_at_issue === '2026-09-09' && /2026-09-10–2026-09-23/.test(row.statement), row);
  const banned = /barrels offline|bpd offline|capacity offline|outage confirmed|confirmed outage|shutdown confirmed|% of capacity/i;
  const texts = cands.map((c) => K.statementFor(c, 'Test', w));
  check('claims: no statement carries a §6 banned phrase', texts.every((t) => !banned.test(t)), texts.find((t) => banned.test(t)));
}

// ── 6b · decision C through the real issuer, on an in-memory register ──
{
  // A PostgREST-shaped stand-in: eq / in / gte / lte / not-null / order / limit / range / insert.
  // `frontier` forces the one unfiltered BM read (the frontier) to a stale answer — a row landing mid-issue.
  const memDb = (tables, rpcs, { frontier } = {}) => {
    let nextId = 1;
    const from = (table) => {
      const st = { filters: [], orders: [], lim: null, off: 0, ins: null };
      const exec = () => {
        if (st.ins) {
          const rows = st.ins.map((r) => { const id = nextId++; return { id, public_id: `p_${id}`, ...r }; });
          (tables[table] ??= []).push(...rows);
          return { data: rows, error: null };
        }
        if (table === 'blackmarble_facility_radiance' && frontier && st.filters.length === 0) return { data: [{ period: frontier }], error: null };
        let rows = (tables[table] ?? []).filter((r) => st.filters.every((f) => f(r)));
        for (const [c, asc] of [...st.orders].reverse()) rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        return { data: rows.slice(st.off, st.lim === null ? undefined : st.off + st.lim), error: null };
      };
      const b = {
        select: () => b,
        eq: (c, v) => { st.filters.push((r) => r[c] === v); return b; },
        in: (c, vs) => { st.filters.push((r) => vs.includes(r[c])); return b; },
        gte: (c, v) => { st.filters.push((r) => r[c] >= v); return b; },
        lte: (c, v) => { st.filters.push((r) => r[c] <= v); return b; },
        not: (c) => { st.filters.push((r) => r[c] !== null && r[c] !== undefined); return b; },
        order: (c, o = {}) => { st.orders.push([c, o.ascending !== false]); return b; },
        limit: (n) => { st.lim = n; return b; },
        range: (a, z) => { st.off = a; st.lim = z - a + 1; return b; },
        insert: (rows) => { st.ins = Array.isArray(rows) ? rows : [rows]; return b; },
        then: (res, rej) => Promise.resolve(exec()).then(res, rej),
      };
      return b;
    };
    return { from, rpc: (name) => ({ then: (res, rej) => Promise.resolve({ data: rpcs[name] ?? null, error: null }).then(res, rej) }) };
  };
  const days = (from, to) => { const out = []; for (let d = from; d <= to; d = C.addDays(d, 1)) out.push(d); return out; };
  const bm = (type, id, from, to) => days(from, to).map((period) => ({ facility_type: type, facility_id: id, period }));
  const fams = Object.fromEntries(K.FAMILIES.map((f) => [f, { judged: 0, k: 0, status: 'calibrating' }]));
  const rpcs = { refinery_rc_walkforward: { families: fams } };
  const v = { cluster_key: 'K1', verdict: 'REFUTED', members: ['a'], member_count: 1, baseline_median: 100, window_median: 110, baseline_heat_days: 10, baseline_firms_days: 31, robustness_verdict: 'REFUTED' };
  const names = new Map([['K1', ['Alpha']]]);
  const byFam = (t, clock) => Object.fromEntries((t.predictions_register ?? []).filter((r) => r.context.tick_data_clock === clock).map((r) => [r.feature, r]));

  // first issuing tick: data clock 09-08; night 09-09 partly on disk (another facility type); FIRMS clock 09-19
  const t = {
    blackmarble_facility_radiance: [...bm('refinery', 'a', '2026-08-01', '2026-09-08'), ...bm('power_plant', 'pp', '2026-08-01', '2026-09-09')],
    firms_facility_observations: bm('refinery', 'a', '2026-08-01', '2026-09-19'),
    reality_check_runs: [], predictions_register: [], issuance_runs: [],
  };
  const r1 = await K.issueRefineryClaims(memDb(t, rpcs), { runId: 1, windows: C.windowsFor('2026-09-08'), verdicts: [v], names }, new Date('2026-09-20T10:22:00Z'));
  const c1 = byFam(t, '2026-09-08');
  check('issuer, first tick: 3 claims, nothing declined, no error', r1.issued === 3 && r1.error === null && Object.keys(r1.declined).length === 0, r1);
  check('issuer, first tick: the light window starts after the newest night with ANY BM row (09-09, not a refinery row) → 09-10..09-23',
    c1.rc_site_stays_lit?.context.window_start === '2026-09-10' && c1.rc_site_stays_lit?.context.window_end === '2026-09-23'
    && c1.rc_site_stays_lit?.target_observable === 'refinery-rc:rc_site_stays_lit:K1:2026-09-10..2026-09-23', c1.rc_site_stays_lit?.context);
  check('issuer, first tick: window_nights_on_disk_at_issue = 0 for light and heat, null for refutation holds; the frontier is on the claim',
    c1.rc_site_stays_lit?.context.window_nights_on_disk_at_issue === 0 && c1.rc_heat_dark_persists?.context.window_nights_on_disk_at_issue === 0
    && c1.rc_refutation_holds?.context.window_nights_on_disk_at_issue === null && c1.rc_site_stays_lit?.context.bm_newest_night_on_disk_at_issue === '2026-09-09');
  check('issuer, first tick: heat 09-20..10-03 (after the FIRMS clock), refutation holds 09-09..09-22 (after the data clock)',
    c1.rc_heat_dark_persists?.context.window_start === '2026-09-20' && c1.rc_heat_dark_persists?.context.window_end === '2026-10-03'
    && c1.rc_refutation_holds?.context.window_start === '2026-09-09' && c1.rc_refutation_holds?.context.window_end === '2026-09-22');

  // +7: not an issuing tick
  t.reality_check_runs.push({ asset_class: 'refinery', status: 'complete', data_clock_night: '2026-09-08', claims_issued: 3 });
  const r7 = await K.issueRefineryClaims(memDb(t, rpcs), { runId: 2, windows: C.windowsFor('2026-09-15'), verdicts: [v], names }, new Date('2026-09-27T10:22:00Z'));
  check('issuer, +7: not an issuing tick, nothing written', r7.issuing === false && r7.issued === 0 && t.predictions_register.length === 3, r7);

  // +14: the backlog lands in full — data clock = frontier = 09-22, so the frontier's lead shrank from 1 to 0
  t.blackmarble_facility_radiance.push(...bm('refinery', 'a', '2026-09-09', '2026-09-22'));
  t.firms_facility_observations.push(...bm('refinery', 'a', '2026-09-20', '2026-10-03'));
  const r14 = await K.issueRefineryClaims(memDb(t, rpcs), { runId: 3, windows: C.windowsFor('2026-09-22'), verdicts: [v], names }, new Date('2026-10-04T10:22:00Z'));
  const c14 = byFam(t, '2026-09-22');
  check('issuer, +14 with a shrunken frontier lead: 3 claims, none declined for overlap', r14.issued === 3 && r14.error === null && Object.keys(r14.declined).length === 0, r14);
  check('issuer, +14: the light window starts after the last light window (09-23), not on it → 09-24..10-07; nothing on disk',
    c14.rc_site_stays_lit?.context.window_start === '2026-09-24' && c14.rc_site_stays_lit?.context.window_end === '2026-10-07'
    && c14.rc_site_stays_lit?.context.window_nights_on_disk_at_issue === 0, c14.rc_site_stays_lit?.context);
  check('issuer, +14: heat 10-04..10-17 and refutation holds 09-23..10-06 follow their own clocks, no overlap',
    c14.rc_heat_dark_persists?.context.window_start === '2026-10-04' && c14.rc_refutation_holds?.context.window_start === '2026-09-23'
    && c14.rc_refutation_holds?.context.window_end === '2026-10-06');

  // a row lands inside the window between the frontier read and the count → nothing issues, the error is recorded
  const t2 = {
    blackmarble_facility_radiance: [...bm('refinery', 'a', '2026-08-01', '2026-09-08'), { facility_type: 'refinery', facility_id: 'a', period: '2026-09-12' }],
    firms_facility_observations: bm('refinery', 'a', '2026-08-01', '2026-09-19'),
    reality_check_runs: [], predictions_register: [], issuance_runs: [],
  };
  const rr = await K.issueRefineryClaims(memDb(t2, rpcs, { frontier: '2026-09-09' }), { runId: 1, windows: C.windowsFor('2026-09-08'), verdicts: [v], names }, new Date('2026-09-20T10:22:00Z'));
  check('issuer: a window night on disk at issue → no claim at all, the error names it and lands in issuance_runs',
    rr.issued === 0 && t2.predictions_register.length === 0 && /Black Marble window 2026-09-10\.\.2026-09-23 already holds rows at issue for K1 \(1 night/.test(rr.error ?? '')
    && t2.issuance_runs.length === 1 && t2.issuance_runs[0].error === rr.error, { rr, runs: t2.issuance_runs });
}

// ── 7 · the scorer: no resolver, no score ───────────────────────────────
{
  const stub = (rpcAnswer, track = 'house') => ({
    rpc: async () => rpcAnswer,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { track }, error: null }) }) }) }),
  });
  const row = (source, extra = {}) => ({ id: 'x', feature: 'f', source, target_observable: 'o', resolves_at: '', issued_at: '', context: {}, predicted_distribution: {}, ...extra });
  const unknown = await R.resolveBySource(row('kalshi'), stub(null));
  check('default: a source with no resolver case → VOID "no resolver", never 0.5', unknown && unknown.void_reason && /no resolver/.test(unknown.void_reason) && unknown.observed === 0, unknown);
  const madeUp = await R.resolveBySource(row('never-heard-of-it', { track: 'machine' }), stub(null));
  check('default: an unknown machine source → VOID', madeUp && /no resolver/.test(madeUp.void_reason ?? ''), madeUp);
  const manualMachine = await R.resolveBySource(row('manual'), stub(null, 'machine'));
  check("'manual' on the machine track → VOID", manualMachine && /no resolver/.test(manualMachine.void_reason ?? ''), manualMachine);
  const manualHouse = await R.resolveBySource(row('manual'), stub(null, 'house'));
  check("'manual' on the house track keeps its operator placeholder", manualHouse && manualHouse.observed === 0.5 && !manualHouse.void_reason, manualHouse);

  const rc = (answer) => R.resolveBySource(row('refinery-rc'), stub(answer));
  const ready1 = await rc({ data: { state: 'ready', observed: 1 }, error: null });
  const ready0 = await rc({ data: { state: 'ready', observed: 0 }, error: null });
  const defer = await rc({ data: { state: 'defer' }, error: null });
  const vd = await rc({ data: { state: 'void', void_reason: 'retired' }, error: null });
  const err = await rc({ data: null, error: { message: 'boom' } });
  check('refinery-rc: ready 1 / ready 0 scored as observed', ready1?.observed === 1 && !ready1.void_reason && ready0?.observed === 0 && !ready0.void_reason);
  check('refinery-rc: defer → null (retry next tick)', defer === null);
  check('refinery-rc: void carries the rule\'s reason', vd?.void_reason === 'retired');
  check('refinery-rc: an RPC error → null, never a guess', err === null);
}

if (fails.length) {
  console.error(`test-refinery-rc: ${fails.length} failed, ${pass} passed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`test-refinery-rc: OK — ${pass} checks passed`);
