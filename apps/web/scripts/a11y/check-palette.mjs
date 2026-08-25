#!/usr/bin/env node
/**
 * RATCHET — the signal palette may not get harder to tell apart.
 *
 * Deliberately NOT a hard gate. The audit established that six distinct
 * signal colours cannot all reach the ΔE>=15 normal-vision floor in this
 * hue space, so a pass/fail threshold would fail on day one and be
 * switched off by the second person who hit it. Instead this records the
 * current worst separations and fails only if a change makes any of them
 * worse, or adds a colour that collides below the floor.
 *
 * eYKON's palette is a STATUS palette, not a categorical series: identity
 * is carried by the text label beside the mark, which is what makes the
 * sub-floor pairs survivable. If that ever stops being true, this ratchet
 * is not sufficient protection on its own.
 *
 * NOTE ON NUMBERS: the normal-vision figures here match the dataviz
 * skill's validator exactly (teal/green 6.5, coral/red 7.1). The CVD
 * figures do not — this uses Vienot-Brettel-Mollon, the validator uses a
 * different model — so the thresholds below are calibrated to THIS
 * scale and should not be compared against that tool's output.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hexToRgb, worstSeparation, parseTokens } from './lib/color.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = resolve(HERE, '../../app/globals.css');
const BUDGET = resolve(HERE, 'budgets.json');
const UPDATE = process.argv.includes('--update');

const SIGNALS = ['teal', 'amber', 'green', 'violet', 'coral', 'red'];
const TOLERANCE = 0.15;   // ignore float noise

const tokens = parseTokens(readFileSync(CSS, 'utf8'));
const present = SIGNALS.filter(s => tokens[s]);

const pairs = {};
for (let i = 0; i < present.length; i++) {
  for (let j = i + 1; j < present.length; j++) {
    const a = present[i], b = present[j];
    const sep = worstSeparation(hexToRgb(tokens[a]), hexToRgb(tokens[b]));
    pairs[`${a}|${b}`] = +Math.min(sep.normal, sep.protan, sep.deutan, sep.tritan).toFixed(2);
  }
}

const budgets = JSON.parse(readFileSync(BUDGET, 'utf8'));
if (UPDATE) {
  budgets.palette = pairs;
  writeFileSync(BUDGET, JSON.stringify(budgets, null, 2) + '\n');
  console.log('a11y/palette — baseline updated'); process.exit(0);
}

const base = budgets.palette || {};
const regressions = [], added = [];
for (const [k, v] of Object.entries(pairs)) {
  if (!(k in base)) { added.push(`${k} = ${v} (new pair — record it with --update once reviewed)`); continue; }
  if (v < base[k] - TOLERANCE) regressions.push(`${k} worsened ${base[k]} -> ${v}`);
}

const sorted = Object.entries(pairs).sort((a, b) => a[1] - b[1]);
console.log('a11y/palette — worst separation per pair (min across normal/protan/deutan/tritan)');
sorted.slice(0, 4).forEach(([k, v]) => console.log(`  ${k.replace('|', ' <-> ').padEnd(22)} ${String(v).padStart(6)}`));
console.log(`  ...${sorted.length} pairs total, best ${sorted[sorted.length - 1][1]}`);

if (regressions.length || added.length) {
  console.error('\n  FAILED:');
  [...regressions, ...added].forEach(f => console.error('   · ' + f));
  process.exit(1);
}
console.log('  OK — no pair worse than baseline\n');
