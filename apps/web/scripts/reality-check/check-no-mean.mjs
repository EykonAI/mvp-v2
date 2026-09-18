#!/usr/bin/env node
// ─── REALITY CHECK: NO MEAN OVER RADIANCE IN THE PATH ────────────
//
// Node built-ins only, no install step — same shape as scripts/a11y/*,
// scripts/copy/* and scripts/marketing/*.
//
// Build prompt §3.2, guard 1: "Means manufacture collapses." Flare and
// gas-turbine radiance is right-skewed — Maysan's baseline runs 12.2 to
// 814.8, where the mean reads a 5.5x collapse and the median 1.8x. The
// Reality Check classifier reads medians only (refinery_complex_light_nights,
// migration 161), and this gate keeps an average from creeping back in:
//
//   * every migration numbered 159 or higher (the programme's band), and
//   * every file under apps/web whose path names the Reality Check
//     (reality-check / reality_check / refinery-rc), plus the night-lights
//     resolver PR-1 touched,
//
// are scanned, comments stripped, for an average whose argument mentions
// radiance: SQL avg(… radiance …), PostgREST radiance.avg(), and a JS
// mean()/average()/avg() call over radiance. Zero hits, or the job fails.
//
// A migration that must re-create a legacy object containing such an
// average (the pre-programme night-lights detector uses AVG(radiance)) can
// waive ONE line with a trailing comment `rc-allow-mean: <reason>`. The
// waiver is visible in review, which is the point.
//
// The detector tests itself first, so it cannot rot into a gate that
// passes everything.
//
// Run: node apps/web/scripts/reality-check/check-no-mean.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../..');
const REPO = resolve(WEB, '../..');
const MIGRATIONS = resolve(REPO, 'supabase/migrations');
const FIRST_PROGRAMME_MIGRATION = 159;
const EXTRA_FILES = ['lib/predictions/resolvers/blackmarble.ts'];
const WAIVER = 'rc-allow-mean:';

// ── comment stripping (keeps line numbers) ──────────────────────
function stripSqlComments(src) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "'") inStr = false;
      i += 1;
    } else if (c === "'") {
      inStr = true; out += c; i += 1;
    } else if (c === '-' && n === '-') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      // keep a waiver visible to the line check below
      const comment = src.slice(i, stop);
      out += comment.includes(WAIVER) ? ` ${WAIVER}` : '';
      i = stop;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c; i += 1;
    }
  }
  return out;
}

function stripTsComments(src) {
  // Good enough for a gate: removes // line comments and /* */ blocks while
  // leaving string contents (where SQL lives) alone.
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c; out += c; i += 1;
    } else if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      const comment = src.slice(i, stop);
      out += comment.includes(WAIVER) ? ` ${WAIVER}` : '';
      i = stop;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c; i += 1;
    }
  }
  return out;
}

// ── the detector ────────────────────────────────────────────────
// Returns [{ line, text }] for every average whose argument mentions radiance.
function findMeans(code) {
  const hits = [];
  const lineAt = (idx) => code.slice(0, idx).split('\n').length;
  const lineText = (idx) => code.split('\n')[lineAt(idx) - 1] ?? '';

  // avg( / mean( / average( — take the balanced argument, look for radiance
  const call = /\b(avg|mean|average)\s*\(/gi;
  let m;
  while ((m = call.exec(code)) !== null) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < code.length; j += 1) {
      if (code[j] === '(') depth += 1;
      else if (code[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    const arg = code.slice(m.index + m[0].length, j);
    if (/radiance/i.test(arg) && !lineText(m.index).includes(WAIVER)) {
      hits.push({ line: lineAt(m.index), text: lineText(m.index).trim() });
    }
  }
  // PostgREST aggregate syntax: .select('radiance.avg()')
  const rest = /radiance\w*\s*\.\s*avg\s*\(/gi;
  while ((m = rest.exec(code)) !== null) {
    if (!lineText(m.index).includes(WAIVER)) {
      hits.push({ line: lineAt(m.index), text: lineText(m.index).trim() });
    }
  }
  return hits;
}

// ── self-test: the detector must catch these and pass those ─────
const mustHit = [
  ['sql', 'SELECT avg(b.radiance) FROM blackmarble_facility_radiance b'],
  ['sql', 'SELECT AVG(coalesce(radiance_3x3, radiance)) AS m'],
  ['sql', 'SELECT avg(\n  b.radiance -- one per night\n) FROM b'],
  ['ts', "supabase.from('blackmarble_facility_radiance').select('facility_id, radiance.avg()')"],
  ['ts', 'const m = mean(rows.map((r) => r.radiance));'],
];
const mustPass = [
  ['sql', 'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b.radiance) FROM b'],
  ['sql', '-- no avg( over radiance anywhere in the path\nSELECT 1'],
  ['sql', 'SELECT avg(detection_count) FROM firms_facility_observations'],
  ['sql', 'SELECT AVG(radiance) AS mean_rad -- rc-allow-mean: legacy night-lights detector, not the Reality Check path'],
  ['ts', '// never avg(radiance)\nconst med = median(values);'],
];
const selfFailures = [];
for (const [kind, sample] of mustHit) {
  const code = kind === 'sql' ? stripSqlComments(sample) : stripTsComments(sample);
  if (findMeans(code).length === 0) selfFailures.push(`should flag: ${sample}`);
}
for (const [kind, sample] of mustPass) {
  const code = kind === 'sql' ? stripSqlComments(sample) : stripTsComments(sample);
  if (findMeans(code).length !== 0) selfFailures.push(`should pass: ${sample}`);
}
if (selfFailures.length) {
  console.error('check-no-mean: the detector failed its own self-test:');
  for (const f of selfFailures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// ── collect the files in scope ──────────────────────────────────
const files = [];
if (existsSync(MIGRATIONS)) {
  for (const name of readdirSync(MIGRATIONS).sort()) {
    const num = Number.parseInt(name, 10);
    if (name.endsWith('.sql') && Number.isFinite(num) && num >= FIRST_PROGRAMME_MIGRATION) {
      files.push({ path: join(MIGRATIONS, name), kind: 'sql' });
    }
  }
}
const SKIP = new Set(['node_modules', '.next', '.git', 'public']);
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(ts|tsx|mjs|js|sql)$/.test(name)
             && /reality[-_]check|refinery[-_]rc/i.test(relative(WEB, full))) {
      files.push({ path: full, kind: name.endsWith('.sql') ? 'sql' : 'ts' });
    }
  }
}
for (const top of ['app', 'lib', 'components']) {
  const d = join(WEB, top);
  if (existsSync(d)) walk(d);
}
for (const rel of EXTRA_FILES) {
  const full = join(WEB, rel);
  if (existsSync(full)) files.push({ path: full, kind: 'ts' });
}

// ── scan ────────────────────────────────────────────────────────
const hits = [];
for (const f of files) {
  const src = readFileSync(f.path, 'utf8');
  const code = f.kind === 'sql' ? stripSqlComments(src) : stripTsComments(src);
  for (const h of findMeans(code)) hits.push({ file: relative(REPO, f.path), ...h });
}

if (hits.length) {
  console.error(`check-no-mean: ${hits.length} average(s) over radiance in the Reality Check path:`);
  for (const h of hits) console.error(`  ✗ ${h.file}:${h.line}  ${h.text}`);
  console.error('The classifier reads medians only (build prompt §3.2, guard 1). Use percentile_cont(0.5) / a median,');
  console.error(`or, for a legacy object outside the path, waive the line with "-- ${WAIVER} <reason>".`);
  process.exit(1);
}
console.log(`check-no-mean: OK — ${files.length} file(s) scanned, no average over radiance.`);
for (const f of files) console.log(`  · ${relative(REPO, f.path)}`);
