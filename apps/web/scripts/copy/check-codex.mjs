#!/usr/bin/env node
// ─── CODEX INVARIANT CHECK ───────────────────────────────────────
//
// Node built-ins only, no install step — same shape as scripts/a11y/*,
// and for the same reason: a guardrail that is slow or needs setup is
// a guardrail somebody switches off.
//
// This enforces the ONE safety property the whole codex design rests
// on: a rule gathered from a secondary source is a hypothesis, and a
// hypothesis may not block a draft.
//
//   verified: true  → may be enforcement 'hard'
//   verified: false → 'warn' or 'guidance' ONLY
//
// Without this check the failure is silent and slow: someone reads a
// blog post, adds a confident-sounding rule, marks it hard, and the
// engine starts discarding good threads on the strength of a guess.
//
// Run: node scripts/copy/check-codex.mjs   (npm run copy:codex)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CODEX = resolve(here, '../../lib/copy/x-codex.ts');

const src = readFileSync(CODEX, 'utf8');
const failures = [];
const notes = [];

// ── version present and plausibly dated ────────────────────────
const version = src.match(/CODEX_VERSION\s*=\s*'([^']+)'/)?.[1];
if (!version) {
  failures.push('CODEX_VERSION is missing — a voice file with no version is a stale build you cannot see');
} else if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(version)) {
  failures.push(`CODEX_VERSION "${version}" is not in YYYY-MM-DD.N form`);
}

// ── parse the rule register ────────────────────────────────────
const block = src.match(/CODEX_RULES:\s*CodexRule\[\]\s*=\s*\[([\s\S]*?)\n\];/);
if (!block) {
  failures.push('CODEX_RULES array not found or not in the expected shape');
} else {
  const entries = block[1].split(/\n\s*\{\s*\n/).slice(1);
  if (entries.length === 0) failures.push('CODEX_RULES is empty');

  for (const e of entries) {
    const id = e.match(/id:\s*'([^']+)'/)?.[1] ?? '(unnamed rule)';
    const verified = /verified:\s*true/.test(e);
    const enforcement = e.match(/enforcement:\s*'([^']+)'/)?.[1];
    const verifiedOn = e.match(/verifiedOn:\s*'([^']+)'/)?.[1] ?? null;
    const source = e.match(/source:\s*\n?\s*'/.test(e) ? /source:\s*'([^']*)'/ : /source:\s*'([\s\S]*?)',\n/)?.[1];

    if (!enforcement) {
      failures.push(`${id}: no enforcement level`);
      continue;
    }
    if (!['hard', 'warn', 'guidance'].includes(enforcement)) {
      failures.push(`${id}: unknown enforcement "${enforcement}"`);
    }
    // THE INVARIANT.
    if (!verified && enforcement === 'hard') {
      failures.push(
        `${id}: marked verified:false but enforcement:'hard' — an unverified rule may not block a draft`,
      );
    }
    if (verified && !verifiedOn) {
      failures.push(`${id}: verified:true with no verifiedOn date`);
    }
    if (!source || !source.trim()) {
      failures.push(`${id}: no source recorded`);
    }
    if (!verified) notes.push(`${id} (warn-only, unverified)`);
  }
}

// ── the lead budget must live in the tool schema ───────────────
//
// It used to live only in prose while the schema said every post could
// be 265 characters. The model optimised to the number that was
// actually expressed: across three dry runs, every single lead came in
// over budget — 13 of 13, none under. An instruction that is not
// binding loses to one that is.
//
// This asserts the lead is its own schema field carrying maxLength, and
// that the lint reads the same constant rather than a second copy.
{
  const VOICE = resolve(here, '../../lib/copy/x-voice.ts');
  const LINTS = resolve(here, '../../lib/copy/x-craft-lints.ts');
  const voice = readFileSync(VOICE, 'utf8');
  const lints = readFileSync(LINTS, 'utf8');

  if (!/export const LEAD_MAX_CHARS\s*=\s*\d+/.test(voice)) {
    failures.push('LEAD_MAX_CHARS is not exported from x-voice.ts');
  }
  const leadField = voice.match(/lead:\s*\{[\s\S]*?\}/);
  if (!leadField) {
    failures.push('write_thread has no dedicated `lead` field — the lead budget is only advisory unless the schema carries it');
  } else if (!/maxLength:\s*LEAD_MAX_CHARS/.test(leadField[0])) {
    failures.push('the write_thread `lead` field does not set maxLength: LEAD_MAX_CHARS — the model only sees the budget it is actually given');
  }
  if (!/LEAD_MAX_CHARS/.test(lints)) {
    failures.push('x-craft-lints.ts does not read LEAD_MAX_CHARS — a budget stated twice drifts');
  }
}

// ── report ─────────────────────────────────────────────────────
if (failures.length) {
  console.error('\nCODEX CHECK FAILED\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`codex ${version} — ok`);
if (notes.length) {
  console.log(`  ${notes.length} unverified rule(s), warn-only as required:`);
  for (const n of notes) console.log(`    · ${n}`);
}
