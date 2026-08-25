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
const CSS = resolve(HERE, '../../app/globals.css');

/** Tokens used as `color:` on text. */
const TEXT_TOKENS = ['ink', 'ink-dim', 'ink-faint'];
/** Every surface text can land on. */
const SURFACES = ['bg-void', 'bg-navy', 'bg-panel', 'bg-raised', 'bg-hover'];
const AA_NORMAL = 4.5;

/**
 * Declared exception, deliberately visible rather than silently excluded.
 * --ink-ghost is 1.77:1 and has one `color:` consumer. It is intended as a
 * disabled/placeholder tint, not readable text. If it ever gains real text
 * usage it must be raised or the usage changed — this entry is the record
 * of that decision, not permission to add more.
 */
const KNOWN_EXCEPTIONS = { 'ink-ghost': 'non-text tint (disabled/placeholder); 1 color: consumer' };

const tokens = parseTokens(readFileSync(CSS, 'utf8'));
const failures = [];
const rows = [];

for (const t of TEXT_TOKENS) {
  if (!tokens[t]) { failures.push(`token --${t} not found in globals.css`); continue; }
  for (const s of SURFACES) {
    if (!tokens[s]) continue;
    const ratio = contrast(hexToRgb(tokens[t]), hexToRgb(tokens[s]));
    rows.push({ t, s, ratio });
    if (ratio < AA_NORMAL) {
      failures.push(`--${t} ${tokens[t]} on --${s} ${tokens[s]} = ${ratio.toFixed(2)}:1 (AA needs ${AA_NORMAL}:1)`);
    }
  }
}

const worst = rows.reduce((a, b) => (a && a.ratio < b.ratio ? a : b), null);
console.log('a11y/contrast — text tokens vs every surface');
for (const t of TEXT_TOKENS) {
  const mine = rows.filter(r => r.t === t);
  if (!mine.length) continue;
  const lo = Math.min(...mine.map(r => r.ratio));
  console.log(`  --${t.padEnd(10)} ${tokens[t]}  worst ${lo.toFixed(2)}:1  ${lo >= AA_NORMAL ? 'PASS' : 'FAIL'}`);
}
for (const [k, why] of Object.entries(KNOWN_EXCEPTIONS)) {
  if (tokens[k]) console.log(`  --${k.padEnd(10)} ${tokens[k]}  EXEMPT — ${why}`);
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
