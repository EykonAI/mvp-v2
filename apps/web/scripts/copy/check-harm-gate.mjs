#!/usr/bin/env node
// ─── HARM REGISTER GATE — STRUCTURAL CHECK ───────────────────────
//
// Node built-ins only, no install step, same shape as scripts/a11y/*
// and scripts/copy/check-codex.mjs.
//
// This exists because the gate failed once, silently, in exactly the way a
// reviewer would not catch. The language check was nested inside a
// `severity === 'high'` branch, so an event whose analyst line read
// "fighting/assault events across Tehran" — carried at severity 'medium' —
// was written in the playful register. Nothing errored. The copy happened to
// come out sober. 31 drafted events were in that state when it was found.
//
// Two assertions, both cheap:
//
//   1 · STRUCTURAL — harmRegisterForced must not branch on severity. The
//       whole defect was that it did. A reviewer reading the diff would have
//       to notice an absent line; a grep notices it every time.
//
//   2 · BEHAVIOURAL — a corpus of real harm language must all match, and a
//       corpus of ordinary energy/logistics language must not all match
//       (a gate that fires on everything is not a gate, it is a constant).
//
// Run: node scripts/copy/check-harm-gate.mjs   (npm run copy:harm)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const VOICE = resolve(here, '../../lib/copy/x-voice.ts');
const src = readFileSync(VOICE, 'utf8');
const failures = [];

// ── 1 · structural ─────────────────────────────────────────────
const fn = src.match(/export function harmRegisterForced[\s\S]*?\n}/);
if (!fn) {
  failures.push('harmRegisterForced not found in lib/copy/x-voice.ts');
} else {
  const body = fn[0];
  // Comments legitimately discuss severity; code must not branch on it.
  const code = body
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  if (/severity/.test(code)) {
    failures.push(
      'harmRegisterForced branches on severity. It must not: severity measures signal strength, not whether people are being hurt. This is the exact regression that shipped once.',
    );
  }
  if (!/HARM_RE\.test|HARM_NEEDLES/.test(code)) {
    failures.push('harmRegisterForced no longer consults the harm needles');
  }
}

// ── 2 · behavioural ────────────────────────────────────────────
const needleBlock = src.match(/HARM_NEEDLES\s*=\s*\[([\s\S]*?)\];/);
if (!needleBlock) {
  failures.push('HARM_NEEDLES array not found');
} else {
  const needles = [...needleBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1].trim());
  if (needles.length < 10) failures.push(`HARM_NEEDLES has only ${needles.length} entries`);
  const re = new RegExp(`\\b(?:${needles.join('|')})`, 'i');

  // Real analyst lines, and the shapes of the ones that slipped through.
  const MUST_MATCH = [
    'GDELT confirms an active US-Iran-Israel conflict spike (fighting/assault events across Tehran, the Ahvaz area, and Iraq)',
    'Reports of energy-infrastructure strikes are riding alongside it',
    'Shelling reported near the substation overnight; casualties unconfirmed',
    'Civilian districts lost power after the airstrike',
    'Two killed and eleven wounded in the attack on the refinery',
    'Displaced households are concentrated around the southern corridor',
  ];
  const MUST_NOT_MATCH = [
    'FIRMS logged a hot-pixel cluster near Reno, NV on Aug 22, up to 2,030 MW radiative power',
    'NASA Black Marble flagged the Dege solar site at +15 sigma above its clear-night baseline',
    'Bosphorus tanker queuing shows up in AIS dwell-time data before any political trigger',
    'Cushing inventories drew for the fourth consecutive week per EIA',
    'Southwest China hydro corridor, Sichuan to Guizhou, sits near a confirmed nightlight surge',
  ];

  for (const s of MUST_MATCH) {
    if (!re.test(s)) failures.push(`harm language NOT caught: "${s.slice(0, 70)}…"`);
  }
  const falsePositives = MUST_NOT_MATCH.filter((s) => re.test(s));
  // A couple of false positives are acceptable and deliberate (see the note
  // in x-voice.ts). All of them means the gate has stopped discriminating.
  if (falsePositives.length === MUST_NOT_MATCH.length) {
    failures.push('every ordinary sensor line matches the harm needles — the gate no longer discriminates');
  }
  if (failures.length === 0) {
    console.log(`harm gate — ok · ${needles.length} needles · ${MUST_MATCH.length}/${MUST_MATCH.length} harm lines caught`);
    if (falsePositives.length) {
      console.log(`  ${falsePositives.length} deliberate false positive(s) on ordinary lines — cheaper than a miss:`);
      for (const f of falsePositives) console.log(`    · ${f.slice(0, 66)}…`);
    }
  }
}

// ── 3 · the prompt must state what the linter enforces ─────────
//
// The composer looped and fell back on 2026-08-26 because the harm
// output check rejected any question mark while the prompt never said
// so — and the codex was simultaneously asking for a question. A gate
// enforcing an unstated rule cannot correct the model; it just burns
// the retry budget and degrades to the template.
//
// So: every construction the harm output check bans must appear in the
// clause the writer is given.
{
  const LINTS = resolve(here, '../../lib/copy/x-craft-lints.ts');
  const lintSrc = readFileSync(LINTS, 'utf8');
  // HARM_SHAPED is the list the flat register forbids, each entry a
  // regex plus the label the writer is shown.
  const block = lintSrc.match(/HARM_SHAPED:\s*Array<\{[^>]*\}>\s*=\s*\[([\s\S]*?)\n\];/);
  const clause = src.match(/const HARM_CLAUSE\s*=\s*`([\s\S]*?)`\.trim\(\);/);

  if (!block) {
    failures.push('HARM_SHAPED not found in x-craft-lints.ts — the flat-register ban list must stay machine-readable so this check can compare it to the prompt');
  } else if (!clause) {
    failures.push('HARM_CLAUSE not found in x-voice.ts');
  } else {
    const entries = [...block[1].matchAll(/label:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
    const prompt = clause[1].toLowerCase();

    if (entries.length === 0) failures.push('HARM_SHAPED has no labelled entries');

    // The question ban is not a word, so it needs naming explicitly.
    if (/\[\^\?\]\*\\\?|\[\?\]/.test(block[1]) && !prompt.includes('question')) {
      failures.push(
        'the harm output check bans question marks but HARM_CLAUSE never mentions questions — the writer cannot comply with a rule it is not given',
      );
    }

    // Every quoted construction it bans must be named in the prompt.
    const unstated = entries
      .filter((l) => l.startsWith('"'))
      .map((l) => l.replace(/"/g, '').toLowerCase())
      .filter((w) => w && !prompt.includes(w));
    if (unstated.length) {
      failures.push(
        `the harm output check bans ${unstated.map((w) => `"${w}"`).join(', ')} but HARM_CLAUSE does not name them — state every hard rule in the prompt that is judged by it`,
      );
    }

    // And the violation must be actionable: it has to quote the match.
    const harmPush = lintSrc.match(/harm register is forced for this event[^`']*/);
    if (harmPush && !/\$\{m\[0\]/.test(lintSrc.slice(lintSrc.indexOf('harm register is forced'), lintSrc.indexOf('harm register is forced') + 400))) {
      failures.push('the harm violation does not quote the text it matched — a writer told only that it failed will guess, retry, and fall back');
    }
  }
}

// ── 4 · the punctuation test must ignore URLs ──────────────────
//
// Every thread is REQUIRED to carry the replay URL, and that URL
// carries "?utm_source=...". If the question-mark ban runs on the raw
// body, the query-string delimiter IS the question mark it finds, and
// no conflict-event thread can ever pass. That shipped, and it made the
// harm register unwinnable: 3 of 3 events, both attempts, every time.
//
// This asserts the ban is marked proseOnly and that a strip helper
// exists, so the bug cannot return by someone "simplifying" the check.
{
  const LINTS2 = resolve(here, '../../lib/copy/x-craft-lints.ts');
  const src2 = readFileSync(LINTS2, 'utf8');

  const questionEntry = src2.match(/\{[^}]*label:\s*'the question'[^}]*\}/);
  if (!questionEntry) {
    failures.push("the harm ban list no longer has a 'the question' entry");
  } else if (!/proseOnly:\s*true/.test(questionEntry[0])) {
    failures.push(
      "the question-mark ban is not marked proseOnly — it will match the '?' in the mandatory ?utm_source= tracking URL, which every thread must carry, making the harm register impossible to pass",
    );
  }
  if (!/stripUrls|https\?:\\\/\\\//.test(src2)) {
    failures.push('no URL-stripping helper found in x-craft-lints.ts');
  }
}

if (failures.length) {
  console.error('\nHARM GATE CHECK FAILED\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}
