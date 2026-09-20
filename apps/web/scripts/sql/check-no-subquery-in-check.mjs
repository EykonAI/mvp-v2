#!/usr/bin/env node
// ─── NO SUB-SELECT INSIDE A CHECK CONSTRAINT ──────────────────────────
//
// Node built-ins only, no install step — same shape as scripts/a11y/*,
// scripts/copy/*, scripts/marketing/* and scripts/reality-check/check-no-mean.mjs.
//
// WHY THIS GATE EXISTS. Migration 171 was reviewed by three agents and
// passed four CI jobs, and still could not be applied: PostgreSQL refuses a
// sub-SELECT inside a CHECK constraint outright —
//
//   ERROR: 0A000: cannot use subquery in check constraint
//
// and because a migration is one transaction, that one statement aborts the
// whole file in the founder's SQL Editor. Nothing in review catches it,
// because it is not a logic error: it is a statement PostgreSQL will not
// accept, and only running it says so.
//
// So this gate runs it in the only way CI can without a database: it reads
// every file in supabase/migrations, strips comments, takes the balanced
// argument of every CHECK ( … ), and fails on any `( SELECT` inside one.
//
// There is NO waiver. A waived line here would still fail to apply, so a
// waiver would only move the failure back to the SQL Editor. The fix is
// always to rewrite the assertion as a subquery-free expression over the
// row's own columns (171 replaced a `(SELECT count(*) FROM
// jsonb_object_keys(j)) = 8` with `j ?& ARRAY[…] AND j - ARRAY[…] = '{}'`),
// or, when the assertion genuinely needs another table, to move it into a
// trigger, where it belongs.
//
// The detector tests itself first, so it cannot rot into a gate that passes
// everything.
//
// Run: node apps/web/scripts/sql/check-no-subquery-in-check.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../..');
const REPO = resolve(WEB, '../..');
const MIGRATIONS = resolve(REPO, 'supabase/migrations');

// ── comment stripping (keeps line numbers, leaves string bodies alone) ──
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
      out += ' '.repeat(stop - i);
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

// ── the detector ────────────────────────────────────────────────────────
// Returns [{ line, text }] for every CHECK whose balanced argument contains
// a parenthesised SELECT. A sub-SELECT in an expression always needs its
// own parentheses — `= (SELECT …)`, `IN (SELECT …)`, `EXISTS (SELECT …)`,
// `ARRAY(SELECT …)` — so `( SELECT` is the whole surface.
function findSubqueryChecks(code) {
  const hits = [];
  const lines = code.split('\n');
  const lineAt = (idx) => code.slice(0, idx).split('\n').length;

  const check = /\bCHECK\s*\(/gi;
  let m;
  while ((m = check.exec(code)) !== null) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < code.length; j += 1) {
      if (code[j] === '(') depth += 1;
      else if (code[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    const body = code.slice(m.index + m[0].length, j);
    const sub = /\(\s*SELECT\b/i.exec(body);
    if (sub) {
      const at = m.index + m[0].length + sub.index;
      hits.push({ line: lineAt(at), text: (lines[lineAt(at) - 1] ?? '').trim() });
    }
  }
  return hits;
}

// ── self-test: the detector must catch these and pass those ─────────────
const mustHit = [
  `ALTER TABLE t ADD CONSTRAINT c CHECK ((SELECT count(*) FROM jsonb_object_keys(j)) = 8);`,
  `CREATE TABLE t (a int, CHECK (a > (SELECT min(x) FROM y)));`,
  `ALTER TABLE t ADD CONSTRAINT c\n  CHECK (jsonb_typeof(j) = 'object'\n         AND (select count(*) from jsonb_object_keys(j)) = 8);`,
  `CHECK (a = 1 AND EXISTS (SELECT 1 FROM other o WHERE o.id = t.id))`,
];
const mustPass = [
  `CHECK (j ?& ARRAY['a','b']::text[] AND j - ARRAY['a','b']::text[] = '{}'::jsonb)`,
  `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'x') THEN NULL; END IF;`,
  `CHECK (status = ANY (ARRAY['running','complete','failed']))`,
  `-- CHECK ((SELECT 1) = 1) — only a comment\nSELECT 1;`,
  `CHECK (selected > 0 AND selection_count >= 0)`,
  `CREATE VIEW v AS SELECT (SELECT max(x) FROM y) AS m;`,
];
const selfFailures = [];
for (const sample of mustHit) {
  if (findSubqueryChecks(stripSqlComments(sample)).length === 0) selfFailures.push(`should flag: ${sample}`);
}
for (const sample of mustPass) {
  if (findSubqueryChecks(stripSqlComments(sample)).length !== 0) selfFailures.push(`should pass: ${sample}`);
}
if (selfFailures.length) {
  console.error('check-no-subquery-in-check: the detector failed its own self-test:');
  for (const f of selfFailures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// ── scan every migration ────────────────────────────────────────────────
if (!existsSync(MIGRATIONS)) {
  console.error(`check-no-subquery-in-check: ${relative(REPO, MIGRATIONS)} not found`);
  process.exit(1);
}
const files = readdirSync(MIGRATIONS).sort()
  .filter((name) => name.endsWith('.sql'))
  .map((name) => join(MIGRATIONS, name));

const hits = [];
for (const path of files) {
  const code = stripSqlComments(readFileSync(path, 'utf8'));
  for (const h of findSubqueryChecks(code)) hits.push({ file: relative(REPO, path), ...h });
}

if (hits.length) {
  console.error(`check-no-subquery-in-check: ${hits.length} sub-SELECT(s) inside a CHECK constraint:`);
  for (const h of hits) console.error(`  ✗ ${h.file}:${h.line}  ${h.text}`);
  console.error('PostgreSQL refuses these with 0A000 "cannot use subquery in check constraint", and a');
  console.error('migration is one transaction — the whole file would abort in the SQL Editor. Rewrite the');
  console.error('assertion over the row\'s own columns, or move it into a trigger. There is no waiver,');
  console.error('because a waived line would still fail to apply.');
  process.exit(1);
}
console.log(`check-no-subquery-in-check: OK — ${files.length} migration(s) scanned, no sub-SELECT in a CHECK.`);
