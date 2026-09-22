#!/usr/bin/env node
// ─── REALITY CHECK PR-6: the board's rules, tested ───────────────────────
//
// The database half (migration 171) is proven by supabase/tests/pr6_guards.sql
// in the Supabase SQL Editor: the frozen tick, the superseding tick, the
// content hash, the grants and the field mask. This file proves what SQL
// cannot run — the presentation rules in lib/reality-check/board.ts, which
// are where the prototype's three honesty defects lived (§3.6):
//
//   1. every row state has a treatment, STEADY, LIGHT_DOWN_ONLY and all four
//      VOID states included, with a distinct rank and a non-empty gloss;
//   2. the refutation cell is the hero and the lead is never the headline —
//      REFUTED sorts before LEAD, and LEAD is amber rather than red;
//   3. a night that was not looked at is a GAP, never a zero — and a measured
//      radiance of exactly 0 is a value, not a sentinel;
//
// plus the §3.4 standing disclosure character-for-character, the §6 banned
// strings over every string this module can put on a screen, and the funnel
// and claims-line arithmetic the board renders.
//
// Every assertion below fails if its rule is removed. Needs apps/web/
// node_modules (typescript), so CI runs it in the job that has installed.
//   node apps/web/scripts/reality-check/test-rc-board.mjs

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

const B = load(join(WEB, 'lib/reality-check/board.ts'));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

const ALL_VERDICTS = [
  'STEADY', 'LIGHT_DOWN_ONLY', 'REFUTED', 'LEAD',
  'VOID_NOT_OBSERVED', 'VOID_INSUFFICIENT_NIGHTS',
  'VOID_BASELINE_UNSTABLE', 'VOID_HEAT_NOT_OBSERVABLE',
];

// ── 1 · every row state has a treatment ─────────────────────────────────
check('V1 the D-2 vocabulary is complete', Object.keys(B.VERDICTS).length === 8, Object.keys(B.VERDICTS));
for (const v of ALL_VERDICTS) {
  const p = B.VERDICTS[v];
  check(`V2 ${v} has a presentation`, !!p, v);
  if (!p) continue;
  check(`V3 ${v} has a pill label`, typeof p.label === 'string' && p.label.length > 0 && p.label.length <= 22, p.label);
  check(`V4 ${v} has a banner`, typeof p.banner === 'string' && p.banner.length > 10, p.banner);
  check(`V5 ${v} has a gloss a reader can act on`, typeof p.gloss === 'string' && p.gloss.length > 40, p.gloss);
  check(`V6 ${v} has a tone`, ['refuted', 'lead', 'watch', 'steady', 'void'].includes(p.tone), p.tone);
  check(`V7 ${v} marks whether it withholds`, p.withheld === v.startsWith('VOID_'), { v, withheld: p.withheld });
}
check('V8 STEADY and LIGHT_DOWN_ONLY are not void-toned (the prototype had neither)',
  B.VERDICTS.STEADY.tone === 'steady' && B.VERDICTS.LIGHT_DOWN_ONLY.tone === 'watch');
check('V9 every rank is distinct', new Set(ALL_VERDICTS.map((v) => B.VERDICTS[v].rank)).size === 8);
check('V10 the four VOID states have four distinct glosses',
  new Set(ALL_VERDICTS.filter((v) => v.startsWith('VOID_')).map((v) => B.VERDICTS[v].gloss)).size === 4);

// ── 2 · the refutation is the hero, the lead never the headline ─────────
check('H1 REFUTED outranks LEAD', B.VERDICTS.REFUTED.rank < B.VERDICTS.LEAD.rank);
check('H2 REFUTED outranks every other state',
  ALL_VERDICTS.every((v) => v === 'REFUTED' || B.VERDICTS.REFUTED.rank < B.VERDICTS[v].rank));
check('H3 LEAD is its own tone, not the refuted one', B.VERDICTS.LEAD.tone === 'lead');
const mixed = [
  { cluster_key: 'RFC-c', verdict: 'VOID_NOT_OBSERVED' },
  { cluster_key: 'RFC-b', verdict: 'LEAD' },
  { cluster_key: 'RFC-a', verdict: 'STEADY' },
  { cluster_key: 'RFC-d', verdict: 'REFUTED' },
  { cluster_key: 'RFC-e', verdict: 'REFUTED' },
];
const sorted = B.sortRows(mixed).map((r) => r.cluster_key);
check('H4 sortRows puts the refutations first, then the lead, silence last',
  JSON.stringify(sorted) === JSON.stringify(['RFC-d', 'RFC-e', 'RFC-b', 'RFC-a', 'RFC-c']), sorted);
check('H5 sortRows does not mutate its input', mixed[0].cluster_key === 'RFC-c');

// ── 3 · zero is a value; a night not looked at is a gap ─────────────────
check('Z1 num1(0) renders the measured zero', B.num1(0) === '0.0', B.num1(0));
check('Z2 num1(null) is an em dash, never 0', B.num1(null) === '—', B.num1(null));
check('Z3 num1(undefined) is an em dash', B.num1(undefined) === '—');
check('Z4 pct(0) is 0%', B.pct(0) === '0%');
check('Z5 pct(null) is an em dash', B.pct(null) === '—');
check('Z6 num2 keeps two decimals', B.num2(0.558) === '0.56', B.num2(0.558));

const nights = [
  { night: '2026-07-18', phase: 'baseline', light_state: 'OBSERVED', radiance_median: 0, heat_state: 'DETECTION', detecting_members: 2 },
  { night: '2026-07-19', phase: 'baseline', light_state: 'NOT_CLEAR', radiance_median: null, heat_state: 'NO_DETECTION', detecting_members: 0 },
  { night: '2026-07-20', phase: 'baseline', light_state: 'CLEAR_NO_RETRIEVAL', radiance_median: null, heat_state: 'DAY_NOT_USABLE', detecting_members: null },
  { night: '2026-07-21', phase: 'baseline', light_state: 'NIGHT_NOT_USABLE', radiance_median: null, heat_state: 'NOT_INGESTED', detecting_members: null },
  { night: '2026-08-18', phase: 'window', light_state: 'OBSERVED', radiance_median: 34.4, heat_state: 'NO_DETECTION', detecting_members: 0 },
];
const ls = B.lightStrip(nights);
check('G1 an observed zero is a measured value, not a gap', ls[0].value === 0 && ls[0].gap === false);
check('G2 a cloudy night is a gap with no value', ls[1].value === null && ls[1].gap === true);
check('G3 clear-but-no-retrieval is a gap, not an observation', ls[2].value === null && ls[2].gap === true);
check('G4 a night outside the census is a gap', ls[3].value === null && ls[3].gap === true);
check('G5 the window night keeps its phase', ls[4].phase === 'window' && ls[4].value === 34.4);
check('G6 lightStrip never emits 0 for a gap', ls.every((b) => !(b.gap && b.value === 0)));

const hs = B.heatStrip(nights);
check('G7 a detection day carries its member count', hs[0].value === 2 && hs[0].gap === false);
check('G8 a usable day with no detection is a measured 0, not a gap', hs[1].value === 0 && hs[1].gap === false);
check('G9 a day outside the census is a gap', hs[2].value === null && hs[2].gap === true);
check('G10 a day never written is a gap', hs[3].value === null && hs[3].gap === true);
check('G11 stripMax ignores gaps', B.stripMax(ls) === 34.4, B.stripMax(ls));
check('G12 stripMax of an all-gap strip is null', B.stripMax(ls.filter((b) => b.gap)) === null);
check('G13 gapCount counts the nights not looked at', B.gapCount(ls) === 3 && B.gapCount(hs) === 2);

// ── 4 · §3.4, verbatim ──────────────────────────────────────────────────
const STANDING =
  'These instruments observe heat and light, not intent. A refinery in a scheduled turnaround and one in an unplanned outage look identical from orbit. eYKON does not hold a turnaround calendar, so every row above may be either — and a dual-confirmed lead is a reason to make a phone call, not a conclusion.';
check('S1 the standing maintenance disclosure is verbatim (build prompt §3.4)',
  B.MAINTENANCE_DISCLOSURE === STANDING, B.MAINTENANCE_DISCLOSURE);

// ── 5 · §6, the prohibition, over every string this module can render ───
const BANNED = [
  'barrels offline', 'bpd offline', 'capacity offline',
  'outage confirmed', 'confirmed outage', 'shutdown confirmed',
];
const strings = [
  ...Object.values(B.VERDICTS).flatMap((p) => [p.label, p.banner, p.gloss]),
  ...Object.values(B.HEAT_STATES),
  ...B.KNOWN_LIMITS,
  B.MAINTENANCE_DISCLOSURE,
  ...Object.values(B.ASSET_LABELS),
];
for (const b of BANNED) {
  const hit = strings.filter((s) => String(s).toLowerCase().includes(b));
  check(`P1 no board string says "${b}"`, hit.length === 0, hit);
}
check('P2 no board string states a barrel volume',
  !strings.some((s) => /\b\d[\d,.]*\s*(b\/d|bpd|barrels)\b/i.test(String(s))));
check('P3 the limits name the capacity state rather than a figure',
  B.KNOWN_LIMITS.some((l) => /capacity is not established/i.test(l)));
check('P4 the limits say recall is not measured (D-10)',
  B.KNOWN_LIMITS.some((l) => /recall is not measured/i.test(l)));
check('P5 the limits say the two sensors are the same VIIRS family',
  B.KNOWN_LIMITS.some((l) => /VIIRS-family/i.test(l)));

// ── 6 · the funnel the board renders ────────────────────────────────────
const tick = {
  parameters: {
    min_baseline_nights: 5, min_window_nights: 3,
    heat_observable_floor: 0.2, heat_down_ratio: 0.6, light_down_ratio: 0.6,
  },
  funnel: {
    counted_by: 'complex',
    watched: { complexes: 295, rows: 353 },
    observed: { complexes: 230, rows: 280 },
    heat_observable: { complexes: 87, rows: 110 },
    thermally_dark: { complexes: 10, rows: 12 },
    refuted: { complexes: 9, rows: 11 },
    lead: { complexes: 0, rows: 0 },
    withheld: { complexes: 1, rows: 1 },
  },
  robustness: { column: 'radiance_3x3', min_px_hq: 5, not_robust: [] },
};
const steps = B.funnelSteps(tick);
check('F1 five funnel terms, in order',
  steps.length === 5 && JSON.stringify(steps.map((s) => s.key)) ===
    JSON.stringify(['watched', 'observed', 'heat_observable', 'thermally_dark', 'refuted']));
check('F2 every term publishes its denominator in facility rows',
  steps.every((s) => Number.isInteger(s.rows)));
check('F3 the refuted term is the hero and nothing else is',
  steps.filter((s) => s.hero).length === 1 && steps[4].hero === true);
check('F4 the notes quote the tick’s own parameters, not constants',
  steps[1].note.includes('5+') && steps[2].note.includes('0.2') && steps[3].note.includes('0.6'));
const split = B.outcomeSplit(tick);
check('F5 the outcome splits into refuted, lead and withheld',
  JSON.stringify(split.map((o) => o.key)) === JSON.stringify(['refuted', 'lead', 'withheld']));
check('F6 the outcome terms sum to the thermally dark term',
  split.reduce((s, o) => s + o.complexes, 0) === tick.funnel.thermally_dark.complexes);
check('F7 withheld is never dropped from the outcome',
  split.find((o) => o.key === 'withheld').complexes === 1);
check('F8 elimination share is refuted over thermally dark',
  Math.abs(B.eliminationShare(tick) - 0.9) < 1e-9, B.eliminationShare(tick));
check('F9 elimination share is null when nothing was dark, never 0%',
  B.eliminationShare({ ...tick, funnel: { ...tick.funnel, thermally_dark: { complexes: 0, rows: 0 } } }) === null);

// ── 7 · D-13, the robustness note ───────────────────────────────────────
check('R1 with nothing flipping, the note says every verdict survives',
  /survives the stricter radiance_3x3/.test(B.robustnessNote(tick)));
const flipped = {
  ...tick,
  robustness: {
    ...tick.robustness,
    not_robust: [{ cluster_key: 'RFC-31-47-1', verdict: 'LEAD', robustness_verdict: 'REFUTED' }],
  },
};
const rn = B.robustnessNote(flipped);
check('R2 a flipping verdict is named on the board', rn.includes('RFC-31-47-1') && rn.includes('Lead') && rn.includes('Refuted'), rn);
check('R3 the note states the consequence, not just the fact', /lead, not a conclusion/.test(rn), rn);

// ── 8 · the claims line (D-7) ───────────────────────────────────────────
const fam = (o) => ({ issued: 0, judged: 0, k: 0, void: 0, open: 0, skill: null, status: 'calibrating', ...o });
check('C1 no block yields no line', B.claimsLine(null) === null && B.claimsLine(undefined) === null);
check('C2 an errored monitor yields no line', B.claimsLine({ error: 'boom' }) === null);
check('C3 no families yields no line', B.claimsLine({ families: {} }) === null);
const calib = B.claimsLine({
  families: {
    a: fam({ issued: 27, judged: 0, status: 'calibrating' }),
    b: fam({ issued: 9, judged: 0, status: 'calibrating' }),
  },
});
check('C4 issued and judged are summed over the families', calib.issued === 36 && calib.judged === 0, calib);
check('C5 a calibrating family makes the line Calibrating', calib.label === 'Calibrating', calib);
const oneOpen = B.claimsLine({
  families: {
    a: fam({ issued: 100, judged: 95, skill: 0.2, status: 'scored' }),
    b: fam({ issued: 100, judged: 40, status: 'calibrating' }),
  },
});
check('C6 one calibrating family still makes the whole line Calibrating', oneOpen.label === 'Calibrating', oneOpen);
const scored = B.claimsLine({
  families: {
    a: fam({ issued: 100, judged: 95, skill: 0.2, status: 'scored' }),
    b: fam({ issued: 100, judged: 95, skill: 0.1, status: 'scored' }),
  },
});
check('C7 skill is shown only when every family has one, and named as the mean it is',
  scored.label === 'mean skill +0.150', scored);
const undef = B.claimsLine({
  families: {
    a: fam({ issued: 100, judged: 95, skill: null, status: 'scored' }),
  },
});
check('C8 an undefined skill is never rendered as a number', undef.label === 'Calibrating', undef);
const susp = B.claimsLine({ families: { a: fam({ issued: 5, judged: 5, status: 'suspended' }) } });
check('C9 a suspended family is surfaced in the status', susp.status === 'suspended', susp);

// ── 9 · the asset switcher ──────────────────────────────────────────────
check('A1 three asset classes', B.ASSETS.length === 3 && B.ASSETS[0] === 'refineries');
check('A2 an unknown asset falls back to the one with a detector',
  B.parseAsset('terminals') === 'refineries' && B.parseAsset(null) === 'refineries' && B.parseAsset('') === 'refineries');
check('A3 the switcher is case-insensitive', B.parseAsset('POWER') === 'power');
check('A4 every asset carries its admission state',
  B.ASSETS.every((a) => typeof B.ASSET_STATES[a].state === 'string' && B.ASSET_STATES[a].state.length > 0));
check('A5 only refineries is live', B.ASSET_STATES.refineries.tone === 'live'
  && B.ASSET_STATES.power.tone === 'gated' && B.ASSET_STATES.maritime.tone === 'blocked');

// ── 10 · windows are explicit dates, never "30-day" ─────────────────────
check('W1 windowLabel renders both endpoints', B.windowLabel('2026-07-18', '2026-08-17') === '07-18 → 08-17');
check('W2 no board string says "30-day" or "14-night"',
  !strings.some((s) => /\b(30-day|14-night)\b/i.test(String(s))));

// ── 11 · the lead mask below Pro (migration 182, §5, D-12) ─────────────
const masked = {
  ...tick,
  robustness: {
    ...tick.robustness,
    not_robust: [
      { cluster_key: null, verdict: 'LEAD', robustness_verdict: 'REFUTED', name_masked: true },
      { cluster_key: 'RFC-N26-E053-1', verdict: 'LIGHT_DOWN_ONLY', robustness_verdict: 'STEADY', name_masked: false },
    ],
  },
};
const mn = B.robustnessNote(masked);
check('M1 a masked lead flip is counted and described, never identified',
  mn.startsWith('2 verdicts change') && mn.includes('a lead, identity withheld below Pro') && !mn.includes('null'), mn);
check('M2 a non-lead flip is still named', mn.includes('RFC-N26-E053-1'), mn);
const rowsMasked = [
  { row_key: 'withheld-lead-2', cluster_key: null, verdict: 'LEAD' },
  { row_key: 'RFC-b', cluster_key: 'RFC-b', verdict: 'REFUTED' },
  { row_key: 'withheld-lead-1', cluster_key: null, verdict: 'LEAD' },
];
const sm = B.sortRows(rowsMasked).map((r) => B.rowKey(r));
check('M3 rows sort and key on row_key, so a masked lead never collides with another',
  JSON.stringify(sm) === JSON.stringify(['RFC-b', 'withheld-lead-1', 'withheld-lead-2']), sm);
check('M4 rowKey falls back to the cluster key on a payload from before migration 182',
  B.rowKey({ cluster_key: 'RFC-x' }) === 'RFC-x');

// ── 12 · the Location cell prints no US state, for any row ──────────────
check('K1 placeLabel is city, country — no US state even when the payload carries one',
  B.placeLabel({ city: 'Baytown', us_state: 'TX', country: 'United States', iso_country: 'US' }) === 'Baytown, United States',
  B.placeLabel({ city: 'Baytown', us_state: 'TX', country: 'United States', iso_country: 'US' }));
check('K2 placeLabel falls back to the ISO code and is null with nothing to print',
  B.placeLabel({ city: null, country: null, iso_country: 'NL' }) === 'NL' && B.placeLabel(null) === null
  && B.placeLabel({ city: null, country: null, iso_country: null }) === null);

// ── 13 · copy rendered from the tick, never typed (tick 2026-W37) ───────
const w37 = {
  tick: '2026-W37',
  parameters: { heat_observable_floor: 0.20, heat_down_ratio: 0.60, min_baseline_nights: 5, min_window_nights: 3 },
  funnel: {
    counted_by: 'complex',
    watched: { complexes: 295, rows: 353 }, observed: { complexes: 228, rows: 277 },
    heat_observable: { complexes: 87, rows: 122 }, thermally_dark: { complexes: 19, rows: 24 },
    refuted: { complexes: 17, rows: 22 }, lead: { complexes: 2, rows: 2 }, withheld: { complexes: 0, rows: 0 },
  },
  heat_not_observable: { complexes: 141, rows: 155, with_baseline_detection: 63, without_baseline_detection: 78, floor: 0.20, rule: '' },
  claims: { issued_on_this_tick: 55, at_publication: null, live: null,
    on_register: { claims: 55, complexes: 19, verdicts_without_claims: 276, rule: '' } },
  robustness: { column: 'radiance_3x3', min_px_hq: 5, not_robust: [] },
};
const hno = B.heatNotObservableText(w37);
check('T1 heat-not-observable is a RATE at or below the floor, with the split from the tick',
  hno.startsWith('141 observed complexes have a baseline heat-detection rate of 0.20 or less')
  && hno.includes('63 of them had detection days in the baseline and 78 had none')
  && hno.includes('never as heat steady'), hno);
check('T2 the heat line follows the tick, not a constant',
  B.heatNotObservableText({ ...w37, heat_not_observable: { ...w37.heat_not_observable, complexes: 7, with_baseline_detection: 2, without_baseline_detection: 5 } })
    .startsWith('7 observed complexes'));
check('T3 with nothing heat-not-observable there is no line',
  B.heatNotObservableText({ ...w37, heat_not_observable: { ...w37.heat_not_observable, complexes: 0, with_baseline_detection: 0, without_baseline_detection: 0 } }) === null);
check('T4 a payload from before migration 182 still gets a true line (no split, no "no baseline")',
  /^141 observed complexes have a baseline heat-detection rate of 0\.20 or less — too little heat/.test(
    B.heatNotObservableText({ ...w37, heat_not_observable: undefined, funnel: { ...w37.funnel } }) ?? ''),
  B.heatNotObservableText({ ...w37, heat_not_observable: undefined }));
const cc = B.claimsCoverageText(w37);
check('T5 the claims line says who carries a claim, with every count from the tick and the register',
  cc === 'Claims are issued only on the thermally dark complexes. Tick 2026-W37 issued 55 claims on 19 complexes; the other 276 of its 295 verdicts carry none.', cc);
check('T6 a tick that issued no claims says so, and why',
  /^Tick 2026-W38 issued no claims: claims issue on alternate ticks only/.test(
    B.claimsCoverageText({ ...w37, tick: '2026-W38', claims: { ...w37.claims, issued_on_this_tick: null } })));
check('T7 a register that disagrees with the frozen count is shown, not hidden',
  B.claimsCoverageText({ ...w37, claims: { ...w37.claims, on_register: { ...w37.claims.on_register, claims: 54 } } })
    .includes('(the register holds 54)'));
check('T8 the funnel notes print the floor and ratio the way the pages do (0.20, 0.60)',
  B.funnelSteps(w37)[2].note.includes('0.20') && B.funnelSteps(w37)[3].note.includes('0.60'));
// A superseding tick (e.g. 2026-W37-r2) never issues: tick.ts issues on new
// ticks only. "Alternate ticks" would give it the wrong reason.
const r2 = { ...w37, tick: '2026-W37-r2', claims: { ...w37.claims, issued_on_this_tick: null,
  on_register: { ...w37.claims.on_register, claims: 0, complexes: 0, verdicts_without_claims: 295 } },
  supersession: { current: true, superseded_by: null, supersedes: '2026-W37' } };
const ccr2 = B.claimsCoverageText(r2);
check('T9 a superseding tick says it supersedes and issues none of its own — never "alternate ticks"',
  ccr2 === 'Tick 2026-W37-r2 supersedes tick 2026-W37 and, like every superseding tick, issues no claims of its own. Its 295 verdicts are published without one.',
  ccr2);
// W37 has no complex without a usable FIRMS day; a tick that has some must
// not count them under "a rate of 0.20 or less".
const hnoGap = B.heatNotObservableText({ ...w37, heat_not_observable: { ...w37.heat_not_observable,
  complexes: 150, with_baseline_detection: 63, without_baseline_detection: 78, without_usable_firms_days: 9 } });
check('T10 complexes with no usable FIRMS day are not counted as "a rate of 0.20 or less"',
  hnoGap.startsWith('141 observed complexes have a baseline heat-detection rate of 0.20 or less')
  && hnoGap.endsWith('9 observed complexes had no usable FIRMS day in the baseline or the window, so no heat-detection rate to read: also reported as heat not observable, never as heat steady.'),
  hnoGap);
check('T11 W37 (no FIRMS gap) renders exactly the sentence the pages agree with',
  B.heatNotObservableText({ ...w37, heat_not_observable: { ...w37.heat_not_observable, without_usable_firms_days: 0 } })
    === '141 observed complexes have a baseline heat-detection rate of 0.20 or less — 63 of them had detection days in the baseline and 78 had none. Either way that is too little heat to fall from: reported as heat not observable, never as heat steady.');

// ── 14 · no rendered sentence contradicts the published tick ────────────
// The W37 agents flagged these; the board must not say them again. Scanned
// over every string board.ts can render AND the board component's JSX text
// (comments stripped — the rule is about what reaches a screen).
const BOARD_TSX = readFileSync(join(WEB, 'components/intel/workspaces/realityCheck/RefineryBoard.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const rendered = [
  ...strings, hno, cc,
  B.claimsCoverageText({ ...w37, claims: { ...w37.claims, issued_on_this_tick: null } }),
  ccr2, hnoGap,
  B.robustnessNote(masked), B.robustnessNote(flipped), ...B.funnelSteps(w37).map((f) => f.note),
  BOARD_TSX,
].map((x) => String(x).toLowerCase().replace(/\s+/g, ' '));
for (const phrase of ['this week', 'stopped flaring', 'forward-testable claim', 'no thermal baseline',
                      'every verdict on this board', 'quiet week', 'went quiet', 'us_state']) {
  check(`B1 no board sentence says "${phrase}"`, !rendered.some((x) => x.includes(phrase)), phrase);
}
check('B2 the refutation is described in §2.2 terms ("heat detections fell")',
  B.VERDICTS.REFUTED.gloss.startsWith('Heat detections fell') && BOARD_TSX.includes('heat detections fell while the site stayed lit'));
check('B3 the board names the tick by its slug where it used to say "this week"',
  BOARD_TSX.includes('On tick {t.tick} a thermal-only feed')
  && BOARD_TSX.includes('Nothing was thermally dark on tick {t.tick}'));

// ── 15 · the verdict column stays on screen (fix 5) ─────────────────────
const CSS = readFileSync(join(WEB, 'app/globals.css'), 'utf8');
check('F10 the Verdict header and cell carry the pinned-column class',
  (BOARD_TSX.match(/className="rc-col-verdict"/g) ?? []).length === 2);
check('F11 the pinned column is sticky at the scroller\'s right edge over an opaque background',
  /\.rc-table \.rc-col-verdict \{[^}]*position: sticky;[^}]*right: 0;[^}]*background: var\(--bg-navy\)/.test(CSS));
check('F12 row hover and selection still out-rank the pinned background (specificity)',
  /\.rc-table tbody tr:hover td \{ background: var\(--bg-raised\); \}/.test(CSS)
  && CSS.indexOf('.rc-table .rc-col-verdict {') < CSS.indexOf('.rc-table tbody tr:hover td'));

// ── report ──────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`test-rc-board: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`test-rc-board: OK — ${pass} checks passed`);
