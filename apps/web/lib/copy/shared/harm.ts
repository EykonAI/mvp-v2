// ─── THE HARM REGISTER — SHARED, ONE COPY, FOUR CONSUMERS ────────
//
// Moved here verbatim from x-voice.ts / x-craft-lints.ts in the
// multi-channel foundation. A channel that quietly narrowed this list
// would be flippant about people being killed on that channel only,
// and nothing would report it. One list; every channel's voice file and
// craft lints import it; scripts/copy/check-harm-gate.mjs gates it.
//
// The history that shaped it (kept, because each line cost a defect):
// keyed on severity once (#419); enforced an unstated question ban
// (#422, which did not work, then #425); its punctuation test matched
// the mandatory ?utm_source= query string until stripUrls (#425).

import type { Evidence } from '@/lib/newsjack/template';

export const HARM_NEEDLES = [
  'strike', 'struck', 'missile', 'shelling', 'shelled', 'casualt',
  'killed', 'fatalit', 'wounded', 'civilian', 'bomb', 'airstrike',
  'attack', 'assault', 'fighting', 'siege', 'massacre', 'refugee',
  'displaced', 'militant', 'insurgen', 'hostage', 'war ', 'warfare',
];

// Prefix-anchored so 'casualt' catches casualty/casualties and 'attack'
// catches attacked/attacks, while a needle cannot match mid-word.
const HARM_RE = new RegExp(`\\b(?:${HARM_NEEDLES.map((n) => n.trim()).join('|')})`, 'i');

export function harmRegisterForced(ev: Evidence): boolean {
  if ((ev.domain ?? '').toLowerCase() === 'conflict') return true;

  // THE LANGUAGE CHECK RUNS ON EVERY EVENT, AT EVERY SEVERITY.
  // Severity is a statement about SIGNAL STRENGTH — how far the sensor
  // moved — not about whether people are being hurt. It was never the
  // right key, and check-harm-gate.mjs fails CI if a branch on it
  // reappears.
  //
  // FALSE POSITIVES ARE CHEAP AND DELIBERATE. 'strike' also means
  // strike price and labour strike. The cost of a false positive is one
  // duller post; the cost of a false negative is being flippant about
  // people being killed, in public. Do not narrow this to reduce noise.
  return HARM_RE.test(`${ev.headline} ${ev.analystLine}`);
}

// URLs are not prose and must be excluded before any punctuation test —
// every artifact carries the replay URL, and the replay URL carries
// '?utm_source='. The first question mark in any body is the query
// string, and a gate that reads it is unwinnable (#425).
const URL_IN_TEXT = /https?:\/\/\S+/gi;
export const stripUrls = (s: string): string => s.replace(URL_IN_TEXT, ' ');

// The constructions the flat register forbids, each with a label the
// writer can act on. Kept in step with each channel's HARM_CLAUSE by
// scripts/copy/check-harm-gate.mjs.
export const HARM_SHAPED: Array<{ re: RegExp; label: string; proseOnly?: boolean }> = [
  { re: /[^?]*\?/, label: 'the question', proseOnly: true },
  { re: /\bimagine\b[^.]*/i, label: '"imagine"' },
  { re: /\bhere's the thing\b[^.]*/i, label: '"here\'s the thing"' },
  { re: /\bplot twist\b[^.]*/i, label: '"plot twist"' },
  { re: /\bturns out\b[^.]*/i, label: '"turns out"' },
  { re: /\bspoiler\b[^.]*/i, label: '"spoiler"' },
  { re: /\bwild\b[^.]*/i, label: '"wild"' },
  { re: /\bbuckle\b[^.]*/i, label: '"buckle"' },
];
