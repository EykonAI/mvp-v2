#!/usr/bin/env node
// ─── ANALYST TOOL-COUNT INVARIANT ────────────────────────────────
//
// Node built-ins only, no install step — same shape as scripts/a11y/*
// and scripts/copy/*, for the same reason: a guardrail that is slow or
// needs setup is a guardrail somebody switches off.
//
// This enforces the property the public tool count rests on:
//
//   PLATFORM_STATS.analystTools === |CLAUDE_TOOLS| === |executor cases|
//
// and that the two sets are IDENTICAL, not merely the same size. The
// marketing surface says "N tools"; a reader who buys on that number is
// owed a tool that actually fires, so a definition with no executor
// case must not be counted, and an executor case with no definition is
// dead code that hides a mistake.
//
// Why this exists: the figure has now been wrong in both directions.
// PR #441 corrected an overcount (24 -> 23) after the landing page
// contradicted itself nineteen lines apart. Then query_dark_contact_events
// landed with the Shadow Fleet dark-events work and nobody re-ran the
// count, so 23 became an undercount and the page contradicted itself
// again — the FAQ had been hand-typed with its own literal.
//
// The durable fix would be deriving the constant from CLAUDE_TOOLS.length
// at build time. It is deliberately NOT done that way: platform-stats.ts
// is imported by Landing.tsx, which is 'use client'. Importing
// lib/anthropic.ts into that graph would pull @anthropic-ai/sdk — a
// runtime default import, alongside a getAnthropic() that reads
// process.env.ANTHROPIC_API_KEY — into the client bundle of the highest-
// traffic public page. A static constant plus this check buys the same
// guarantee without shipping the SDK to browsers.
//
// Run: node scripts/marketing/check-tool-count.mjs   (npm run marketing:tools)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(here, '../../lib/anthropic.ts');
const EXEC = resolve(here, '../../lib/tool-executor.ts');
const STATS = resolve(here, '../../lib/marketing/platform-stats.ts');

const failures = [];

// ── the tool definitions, scoped to the CLAUDE_TOOLS array ─────
//
// Scoped rather than whole-file: a `name:` key elsewhere in the module
// (a helper, a future second array) must not inflate the public count.
const toolSrc = readFileSync(TOOLS, 'utf8');
const block = toolSrc.match(
  /export const CLAUDE_TOOLS: Anthropic\.Tool\[\] = \[\n([\s\S]*?)\n\];/,
);
let defined = [];
if (!block) {
  failures.push(
    'CLAUDE_TOOLS array not found in lib/anthropic.ts, or no longer in the expected shape — this check cannot vouch for the public count until that is fixed',
  );
} else {
  defined = [...block[1].matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(m => m[1]);
  if (defined.length === 0) failures.push('CLAUDE_TOOLS parsed as empty');
}

// ── the executor cases ─────────────────────────────────────────
const wired = [
  ...readFileSync(EXEC, 'utf8').matchAll(/^\s+case '([a-z_]+)':/gm),
].map(m => m[1]);

// ── the sets must be identical, not just equinumerous ──────────
const definedSet = new Set(defined);
const wiredSet = new Set(wired);
const orphanDefs = defined.filter(t => !wiredSet.has(t));
const orphanCases = wired.filter(t => !definedSet.has(t));

for (const t of orphanDefs) {
  failures.push(
    `${t}: defined in CLAUDE_TOOLS but has no case in lib/tool-executor.ts — it cannot fire, so it must not be counted on the marketing surface`,
  );
}
for (const t of orphanCases) {
  failures.push(
    `${t}: has an executor case but no CLAUDE_TOOLS definition — dead branch, or a definition was dropped`,
  );
}
if (defined.length !== definedSet.size) {
  failures.push('CLAUDE_TOOLS contains a duplicate tool name');
}

// ── the published figure ───────────────────────────────────────
const statsSrc = readFileSync(STATS, 'utf8');
const declared = statsSrc.match(/^\s+analystTools: (\d+),$/m)?.[1];
if (declared === undefined) {
  failures.push('analystTools not found in lib/marketing/platform-stats.ts');
} else if (Number(declared) !== defined.length) {
  failures.push(
    `PLATFORM_STATS.analystTools is ${declared} but ${defined.length} tools are wired — the public figure is ${
      Number(declared) < defined.length ? 'an UNDERCOUNT' : 'an OVERCOUNT'
    }. Set it to ${defined.length} and update the verified-on date in its comment.`,
  );
}

// ── no second copy of the number in marketing copy ─────────────
//
// §16.4: a label duplicated from a condition is a label that will
// outlive it. The FAQ literal is exactly how the page came to contradict
// itself twice; every surface must render PS.analystTools, never a digit.
const COPY = [
  ['app/(marketing)/Landing.tsx', resolve(here, '../../app/(marketing)/Landing.tsx')],
  ['components/landing/AnalystWithTools.tsx', resolve(here, '../../components/landing/AnalystWithTools.tsx')],
  ['lib/marketing/showcase-slides.ts', resolve(here, '../../lib/marketing/showcase-slides.ts')],
];
// A bare integer immediately qualifying "tool"/"tools". Deliberately
// narrow: "25/month on the full tool surface" is a query quota, not a
// tool count, and must not trip this.
const LITERAL = /\b\d+\s+(?:live |first-class |wired |analyst |Claude |AI )*tools?\b/gi;
for (const [label, path] of COPY) {
  let src;
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    continue; // renamed or removed; the count checks above still hold
  }
  for (const m of src.matchAll(LITERAL)) {
    failures.push(
      `${label}: hardcoded tool count "${m[0].trim()}" — render {PS.analystTools} instead, so this number has exactly one home`,
    );
  }
}

// ── report ─────────────────────────────────────────────────────
if (failures.length) {
  console.error('\nTOOL COUNT CHECK FAILED\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log(
  `tool count — ok · ${defined.length} tools defined, ${wired.length} wired, published as ${declared}`,
);
