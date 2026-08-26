// ─── CRAFT LINTS ─────────────────────────────────────────────────
//
// DELIBERATELY SEPARATE FROM lib/newsjack/lints.ts.
//
// Those are HONESTY gates: emoji, buzzword, coverage overclaim, the
// value test. They decide whether a draft is allowed to exist.
//
// These are CRAFT checks: shape, length, link position, register.
// Most of them warn. Collapsing the two families would either let a
// style preference suppress a true post, or let a soft check quietly
// become the thing standing between a false claim and the founder's
// thumb.
//
// Enforcement level comes from CODEX_RULES, so a rule cannot be
// hard-gated here while being marked unverified there.

import { CODEX_RULES } from '@/lib/copy/x-codex';
import { harmRegisterForced } from '@/lib/copy/x-voice';
import type { Evidence } from '@/lib/newsjack/template';

export interface CraftResult {
  ok: boolean;          // false only when a HARD rule failed
  violations: string[]; // hard failures — force a retry, then fallback
  warnings: string[];   // surfaced in the queue, never blocking
}

const MAX_POST = 270;
const LEAD_SOFT_MAX = 150;

// A bare coordinate pair: "(35.0, 125.0)" or "35.0, 125.0" or
// "35.0N 125.0E". The first form is what our own template emits.
const COORD_RE =
  /\(?\s*-?\d{1,3}\.\d+\s*[,°]\s*-?\d{1,3}\.\d+\s*\)?|\b-?\d{1,3}\.\d+\s*[NS]\s*,?\s*-?\d{1,3}\.\d+\s*[EW]\b/i;

const URL_RE = /https?:\/\/\S+/gi;

// Clipped mid-word: ends in an ellipsis (ours or the model's) that is
// not preceded by sentence-final punctuation.
const TRUNCATED_RE = /[^.!?]\s*(…|\.\.\.)\s*$/;

const hard = (id: string) =>
  CODEX_RULES.find((r) => r.id === id)?.enforcement === 'hard';

export function craftLint(
  posts: string[],
  ev: Evidence,
  refUrl: string,
  recentLeads: string[] = [],
): CraftResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const push = (id: string, msg: string) =>
    (hard(id) ? violations : warnings).push(msg);

  // ── shape ──────────────────────────────────────────────────────
  if (posts.length < 3 || posts.length > 6) {
    push('thread-shape-bounds', `thread is ${posts.length} posts; must be 3–6`);
  } else if (posts.length < 4) {
    push('thread-length-band', `thread is ${posts.length} posts; 4–6 reportedly reads better`);
  }
  posts.forEach((p, i) => {
    if (!p.trim()) violations.push(`post ${i + 1} is empty`);
    if (p.length > MAX_POST) {
      violations.push(`post ${i + 1} is ${p.length} chars; max ${MAX_POST}`);
    }
    if (TRUNCATED_RE.test(p)) {
      push('never-truncate', `post ${i + 1} ends mid-thought (clipped, not written to fit)`);
    }
  });

  const lead = posts[0] ?? '';
  const last = posts[posts.length - 1] ?? '';

  // ── the lead ───────────────────────────────────────────────────
  if (COORD_RE.test(lead)) {
    push('no-coordinate-lead', 'lead opens on a bare coordinate pair — name the place or the facilities');
  }
  if (lead.length > LEAD_SOFT_MAX) {
    push('lead-length', `lead is ${lead.length} chars; aim under ${LEAD_SOFT_MAX}`);
  }

  // ── link position ──────────────────────────────────────────────
  posts.slice(0, -1).forEach((p, i) => {
    if (URL_RE.test(p)) {
      URL_RE.lastIndex = 0;
      push('no-link-in-lead', `post ${i + 1} carries a URL; only the final post may`);
    }
    URL_RE.lastIndex = 0;
  });

  // The replay URL is the conversion mechanism AND the attribution
  // carrier (brief §21.8). The writer may rewrite the sentence around
  // it; it may never rewrite the URL. Always hard — an altered URL
  // silently destroys the channel attribution.
  const urlsInLast = last.match(URL_RE) ?? [];
  URL_RE.lastIndex = 0;
  if (urlsInLast.length !== 1) {
    violations.push(`final post carries ${urlsInLast.length} URLs; must carry exactly 1`);
  } else if (urlsInLast[0].replace(/[.,;]$/, '') !== refUrl) {
    violations.push('final post URL was altered — attribution would be lost');
  }

  // ── house rules ────────────────────────────────────────────────
  const body = posts.join(' ');
  const namesAnInstrument =
    /\b(FIRMS|Black Marble|VIIRS|GDELT|ACLED|AIS|ADS-B|EIA|OFAC|USGS|IEA|Comtrade|Copernicus|Sentinel|Polymarket)\b/i.test(body);
  if (!namesAnInstrument) {
    push('name-a-source', 'no instrument or feed named anywhere in the thread');
  }

  if (recentLeads.length) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 6).join(' ');
    const n = norm(lead);
    if (n && recentLeads.some((r) => norm(r) === n)) {
      push('no-repeat-lead', 'lead opens the same way as a recent post');
    }
  }

  // ── the harm register, re-checked on the output ────────────────
  // The prompt already forces flat for these events. This is the
  // second gate, because a model told to be engaging will occasionally
  // find a way to be engaging about a casualty.
  if (harmRegisterForced(ev)) {
    const shaped = /[?]|\bimagine\b|\bhere's the thing\b|\bplot twist\b|\bturns out\b|\bspoiler\b|\bwild\b|\bbuckle\b/i;
    if (shaped.test(body)) {
      violations.push('harm register is forced for this event, but the copy is rhetorically shaped — rewrite flat');
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}
