#!/usr/bin/env node
/**
 * RATCHET — two structural counts that may fall but never rise.
 *
 * 1. Inline style objects. 2,300+ of them are why hover, focus and
 *    reduced-motion were unreachable for most of the codebase: a
 *    pseudo-class and a media query have no inline form. Migrating them
 *    is long work; what this stops is the pile growing while that work
 *    happens.
 *
 * 2. SVGs with neither an accessible name nor aria-hidden. Every chart
 *    must either announce itself (ChartFigure, role="img") or declare
 *    itself decorative. Silence is the one thing that is not allowed.
 *
 * Raising a baseline is legitimate — new UI sometimes needs inline
 * styles — but it must be an explicit line in the diff, not a silent
 * drift. Run with --update, and justify it in the PR.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '../..');
const BUDGET = resolve(HERE, 'budgets.json');
const UPDATE = process.argv.includes('--update');
const ROOTS = ['components', 'app'];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap(r => { try { return walk(join(WEB, r)); } catch { return []; } });

let inline = 0;
const inlineFiles = new Set();
let unnamed = 0;
const unnamedAt = [];
const spreadAt = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const hits = src.match(/style=\{\{/g);
  if (hits) { inline += hits.length; inlineFiles.add(f); }

  // Each <svg ...> opening tag: does it declare a name or declare itself decorative?
  for (const m of src.matchAll(/<svg\b[^>]*>/g)) {
    const tag = m[0];
    const named = /\brole=["']img["']/.test(tag) || /\baria-label(?:ledby)?=/.test(tag);
    const hidden = /\baria-hidden/.test(tag);
    // A <title> child immediately after also counts as a name.
    const after = src.slice(m.index, m.index + 400);
    const hasTitle = /<title[\s>]/.test(after);
    // A spread ({...a11y}) can carry role/aria-hidden but cannot be resolved
    // statically. Count it separately and print it rather than silently
    // passing it — an unverifiable pass is not the same as a pass.
    const spread = /\{\s*\.\.\./.test(tag);
    if (spread && !named && !hidden && !hasTitle) {
      spreadAt.push(`${f.replace(WEB + '/', '')}:${src.slice(0, m.index).split('\n').length}`);
      continue;
    }
    if (!named && !hidden && !hasTitle) {
      unnamed++;
      unnamedAt.push(`${f.replace(WEB + '/', '')}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
}

const budgets = JSON.parse(readFileSync(BUDGET, 'utf8'));
if (UPDATE) {
  budgets.inlineStyleObjects = inline;
  budgets.unnamedSvgs = unnamed;
  writeFileSync(BUDGET, JSON.stringify(budgets, null, 2) + '\n');
  console.log(`a11y/budgets — baseline updated: ${inline} inline styles, ${unnamed} unnamed svgs`);
  process.exit(0);
}

console.log('a11y/budgets — structural ratchets');
console.log(`  inline style={{}}   ${String(inline).padStart(5)}  (budget ${budgets.inlineStyleObjects}) in ${inlineFiles.size} files`);
console.log(`  unnamed <svg>       ${String(unnamed).padStart(5)}  (budget ${budgets.unnamedSvgs})`);
if (spreadAt.length) {
  console.log(`  aria via spread     ${String(spreadAt.length).padStart(5)}  — not statically decidable, verify by hand:`);
  spreadAt.forEach(l => console.log(`      ${l}`));
}

const fail = [];
if (inline > budgets.inlineStyleObjects)
  fail.push(`inline style objects rose ${budgets.inlineStyleObjects} -> ${inline}. Use a primitive in components/ui, or run --update and justify it.`);
if (unnamed > budgets.unnamedSvgs) {
  fail.push(`unnamed <svg> rose ${budgets.unnamedSvgs} -> ${unnamed}. Wrap it in ChartFigure, or add aria-hidden if decorative.`);
  unnamedAt.slice(0, 8).forEach(l => fail.push(`    at ${l}`));
}
if (fail.length) { console.error('\n  FAILED:'); fail.forEach(f => console.error('   · ' + f)); process.exit(1); }

const slackI = budgets.inlineStyleObjects - inline, slackS = budgets.unnamedSvgs - unnamed;
if (slackI > 0 || slackS > 0) console.log(`  improved since baseline — run --update to lock it in (${slackI} styles, ${slackS} svgs)`);
console.log('  OK\n');
