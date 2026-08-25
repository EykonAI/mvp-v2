#!/usr/bin/env node
/**
 * GATE — text tokens must clear WCAG 2.2 AA against every surface.
 *
 * This is a hard gate, not a ratchet: it passed the moment PR #406
 * landed and there is no reason for it ever to fail again. Before that
 * PR, --ink-faint rendered at 2.98:1 and produced 26 distinct failures
 * on /intel alone, including the "sample" fixture warning — the least
 * legible text on the page was the one telling you the data was fake.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hexToRgb, contrast, parseTokens } from './lib/color.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * There are TWO token systems, and a gate that reads only one is a gate
 * with a blind spot. globals.css drives the product surfaces; the
 * marketing pages carry their own set scoped under .eykon-landing. The
 * second one shipped a 2.89:1 text token that this gate could not see
 * until the DOM check found it on the rendered page.
 */
const SHEETS = [
  { file: resolve(HERE, '../../app/globals.css'),
    text: ['ink', 'ink-dim', 'ink-faint'],
    surfaces: ['bg-void', 'bg-navy', 'bg-panel', 'bg-raised', 'bg-hover'] },
  { file: resolve(HERE, '../../app/(marketing)/landing.css'),
    text: ['text-primary', 'text-secondary', 'text-tertiary'],
    surfaces: ['bg-base', 'bg-panel', 'bg-panel-hi', 'bg-panel-mute'] },
];

const AA_NORMAL = 4.5;

/**
 * Declared exception, deliberately visible rather than silently excluded.
 * --ink-ghost is 1.77:1 and has one `color:` consumer. It is intended as a
 * disabled/placeholder tint, not readable text. If it ever gains real text
 * usage it must be raised or the usage changed — this entry is the record
 * of that decision, not permission to add more.
 */
const KNOWN_EXCEPTIONS = { 'ink-ghost': 'non-text tint (disabled/placeholder); 1 color: consumer' };

const failures = [];
const rows = [];

for (const sheet of SHEETS) {
  const name = sheet.file.split('/').slice(-1)[0];
  let tokens;
  try { tokens = parseTokens(readFileSync(sheet.file, 'utf8')); }
  catch { failures.push(`stylesheet not readable: ${sheet.file}`); continue; }
  for (const t of sheet.text) {
    if (!tokens[t]) { failures.push(`token --${t} not found in ${name}`); continue; }
    for (const s of sheet.surfaces) {
      if (!tokens[s]) continue;
      const ratio = contrast(hexToRgb(tokens[t]), hexToRgb(tokens[s]));
      rows.push({ sheet: name, t, s, ratio, hex: tokens[t] });
      if (ratio < AA_NORMAL) {
        failures.push(`${name}: --${t} ${tokens[t]} on --${s} ${tokens[s]} = ${ratio.toFixed(2)}:1 (AA needs ${AA_NORMAL}:1)`);
      }
    }
  }
}

const worst = rows.reduce((a, b) => (a && a.ratio < b.ratio ? a : b), null);
console.log('a11y/contrast — text tokens vs every surface, both stylesheets');
for (const sheet of SHEETS) {
  const name = sheet.file.split('/').slice(-1)[0];
  const mineAll = rows.filter(r => r.sheet === name);
  if (!mineAll.length) continue;
  console.log(`  ${name}`);
  for (const t of sheet.text) {
    const mine = mineAll.filter(r => r.t === t);
    if (!mine.length) continue;
    const lo = Math.min(...mine.map(r => r.ratio));
    console.log(`    --${t.padEnd(15)} ${mine[0].hex}  worst ${lo.toFixed(2)}:1  ${lo >= AA_NORMAL ? 'PASS' : 'FAIL'}`);
  }
}
for (const [k, why] of Object.entries(KNOWN_EXCEPTIONS)) {
  console.log(`  --${k.padEnd(10)} EXEMPT — ${why}`);
}
if (worst) console.log(`  worst overall: --${worst.t} on --${worst.s} = ${worst.ratio.toFixed(2)}:1`);

if (failures.length) {
  console.error('\n  FAILED:');
  failures.forEach(f => console.error('   · ' + f));
  console.error('\n  Raise the token in app/globals.css. It is consumed through var(),');
  console.error('  so one value change propagates to every call site.');
  process.exit(1);
}
console.log('  OK\n');
