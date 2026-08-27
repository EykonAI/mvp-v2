// ─── REDDIT CRAFT LINTS ──────────────────────────────────────────
//
// DELIBERATELY SEPARATE from lib/newsjack/lints.ts, same split as X:
// those are HONESTY gates (emoji, buzzword, coverage overclaim) that
// decide whether a draft may exist; these are CRAFT checks — shape,
// budgets, link position, community targeting, register.
//
// Enforcement level comes from CODEX_RULES, so a rule cannot be
// hard-gated here while being marked unverified there —
// scripts/copy/check-codex.mjs walks the codex and CI holds the line.
//
// The four gate rules this file is written against:
//   1 · a gate SAYS WHAT IT CAUGHT — every violation names the
//       construction and quotes the matched text;
//   2 · a gate is SATISFIABLE — every punctuation/character test runs
//       on stripUrls() prose, because the body always carries a URL
//       with '?utm_source=' (the unwinnable-gate lesson, #425);
//   3 · a gate must not fire on correct vocabulary — constructions,
//       not words; the only word list here is the shared harm list;
//   4 · every hard rule is stated in the system prompt in the same
//       words (voice.ts renders CODEX_RULES), and every budget lives
//       as maxLength on its own schema field (voice.ts tool schema).

import { CODEX_RULES, SUBREDDIT_ALLOWLIST, approvedSubreddits } from './codex';
import { TITLE_MAX_CHARS, TITLE_WARN_CHARS, BODY_MIN_METHOD_WORDS } from './voice';
import { HARM_SHAPED, harmRegisterForced, stripUrls } from '@/lib/copy/shared/harm';
import type { ChannelArtifact, CraftResult } from '@/lib/copy/shared/types';
import type { Evidence } from '@/lib/newsjack/template';

// A bare coordinate pair: "(35.0, 125.0)" or "35.0, 125.0" or
// "35.0N 125.0E" — the first form is what our own mechanical headline
// emits, and on X 87.8% of drafts opened on one.
const COORD_RE =
  /\(?\s*-?\d{1,3}\.\d+\s*[,°]\s*-?\d{1,3}\.\d+\s*\)?|\b-?\d{1,3}\.\d+\s*[NS]\s*,?\s*-?\d{1,3}\.\d+\s*[EW]\b/i;

// Non-global for .test (a /g regex keeps lastIndex across calls — the
// x-craft-lints file has to reset it by hand; simpler to not carry it).
const URL_ONE = /https?:\/\/\S+/i;
const URL_ALL = /https?:\/\/\S+/g;

// A community mention: r/Name. Run on stripUrls() prose only, so a
// reddit.com/r/... URL cannot trip the targeting gates.
const SUB_MENTION_RE = /\br\/([A-Za-z0-9_]{2,21})\b/g;

const INSTRUMENT_RE =
  /\b(FIRMS|Black Marble|VIIRS|GDELT|ACLED|AIS|ADS-B|EIA|OFAC|USGS|IEA|Comtrade|Copernicus|Sentinel|Polymarket)\b/i;

// The disclosure and the limit paragraph are separate schema fields
// precisely so these two lints can prove they SURVIVED into the final
// body — constructions, not exact strings, so a rephrased disclosure
// still passes.
const DISCLOSURE_RE = /\b(disclosure|disclosing|affiliat\w*|i (?:built|made|founded|work (?:on|at|for))|we (?:built|made) )\b/i;
const LIMIT_RE =
  /\b(does not establish|does not confirm|not (?:a )?confirmed|nothing (?:here )?is confirmed|no [a-z]+ is (?:confirmed|identified)|unconfirmed|no ground truth)\b/i;

const hard = (id: string) =>
  CODEX_RULES.find((r) => r.id === id)?.enforcement === 'hard';

export function redditCraftLint(
  a: ChannelArtifact,
  ev: Evidence,
  refUrl: string,
  recentTitles: string[] = [],
): CraftResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const push = (id: string, msg: string) =>
    (hard(id) ? violations : warnings).push(msg);

  // posts is [title, selfText] — the shape assemble() returns and
  // shared/types.ts documents for Reddit.
  const title = a.posts[0] ?? '';
  const selfText = a.posts[1] ?? '';
  if (!title.trim()) violations.push('title is empty');
  if (!selfText.trim()) violations.push('body is empty');

  const titleProse = stripUrls(title);
  const bodyProse = stripUrls(selfText);
  const allProse = `${titleProse}\n\n${bodyProse}`;

  // ── the title ──────────────────────────────────────────────────
  if (title.length > TITLE_MAX_CHARS) {
    push('title-hard-limit', `title is ${title.length} chars; the platform wall is ${TITLE_MAX_CHARS} — "${title.slice(0, 60)}…"`);
  } else if (title.length > TITLE_WARN_CHARS) {
    push('title-band', `title is ${title.length} chars; aim ${TITLE_WARN_CHARS} or fewer — mobile truncates`);
  }
  {
    const m = title.match(URL_ONE);
    if (m) {
      push('no-url-in-title', `title carries a URL — found "${m[0]}" — the URL lives inside the body of the self post`);
    }
  }
  {
    const m = titleProse.match(COORD_RE);
    if (m) {
      push('no-coordinate-title', `title opens on a bare coordinate pair — found "${m[0].trim()}" — name the place or the facilities instead`);
    }
  }

  // ── the method floor ───────────────────────────────────────────
  // Counted on URL-stripped prose so the tracking URL's length can
  // neither help nor hurt the count.
  const methodWords = bodyProse.split(/\s+/).filter(Boolean).length;
  if (methodWords < BODY_MIN_METHOD_WORDS) {
    push('body-carries-the-method', `body carries ${methodWords} words; at least ${BODY_MIN_METHOD_WORDS} words of method (window, baseline, instrument, sample size) are required`);
  }

  // ── the replay URL ─────────────────────────────────────────────
  // The conversion mechanism AND the attribution carrier (brief
  // §21.8). Always hard, never codex-keyed: an altered URL silently
  // destroys the channel attribution.
  const urls = selfText.match(URL_ALL) ?? [];
  if (urls.length !== 1) {
    violations.push(`body carries ${urls.length} URLs; must carry the replay URL exactly once${urls.length ? ` — found ${urls.map((u) => `"${u}"`).join(', ')}` : ''}`);
  } else if (urls[0].replace(/[.,;)\]]+$/, '') !== refUrl) {
    violations.push(`the replay URL was altered — found "${urls[0]}", expected "${refUrl}" — attribution would be lost`);
  }

  // ── no gated links ─────────────────────────────────────────────
  // r/OSINT's formal rules ban content behind a paywall OR a
  // REGISTRATION WALL (rules read 2026-08-27). Our /c/ replay pages are
  // public by design; /app, /intel, /analyst and /admin sit behind the
  // login wall, and the engine's anomaly fallback URL points at /app —
  // so a draft can legitimately arrive carrying one. Always hard: a
  // registration-walled link is a removal on sight in exactly the
  // communities this channel targets.
  for (const u of urls) {
    const path = u.replace(/^https?:\/\/[^/]+/i, '');
    const gated = path.match(/^\/(app|intel|analyst|admin)(?=[/?#]|$)/i);
    if (gated) {
      violations.push(
        `the link points at a login-walled surface — found "${u}" — r/OSINT bans registration-walled content; only public /c/ replay pages may be linked`,
      );
    }
  }

  // ── disclosure survives, above the link ────────────────────────
  const disc = selfText.match(DISCLOSURE_RE);
  if (!disc) {
    push('disclose-affiliation', 'no affiliation disclosure found in the body — one plain line, above the link');
  } else {
    const urlIdx = urls.length === 1 ? selfText.indexOf(urls[0]) : -1;
    if (urlIdx >= 0 && (disc.index ?? 0) > urlIdx) {
      push('disclose-affiliation', `the disclosure ("${disc[0]}") sits below the link — it must be stated above it`);
    }
  }

  // ── the limit paragraph survives ───────────────────────────────
  if (!LIMIT_RE.test(bodyProse)) {
    push('state-the-limit', 'no limit statement found in the body — say plainly what the observation does not establish (no confirmed cause, no ground truth)');
  }

  // ── community targeting ────────────────────────────────────────
  // Every r/Name the draft utters must be an APPROVED allowlist entry
  // — with the allowlist empty, ANY community mention fails, which is
  // the designed refusal, and a draft that names no community at all
  // still passes this gate (the gate stays satisfiable).
  const approved = new Set(approvedSubreddits().map((e) => e.slug.toLowerCase()));
  // Keyed lowercase for comparison; the value keeps the draft's own
  // casing so the violation quotes what the draft actually wrote.
  const mentioned = new Map<string, string>();
  for (const m of allProse.matchAll(SUB_MENTION_RE)) {
    if (!mentioned.has(m[1].toLowerCase())) mentioned.set(m[1].toLowerCase(), m[1]);
  }
  for (const [slug, asWritten] of mentioned) {
    if (!approved.has(slug)) {
      push('allowlist-only', `draft names "r/${asWritten}", which is not an APPROVED allowlist entry — the target comes from the approved allowlist only`);
    }
  }
  if (mentioned.size > 1) {
    push('one-subreddit-per-artifact', `draft names ${mentioned.size} communities (${[...mentioned.values()].map((s) => `"r/${s}"`).join(', ')}); one artifact targets one community`);
  }

  // ── required flair, where the entry records one ────────────────
  for (const slug of mentioned.keys()) {
    const entry = SUBREDDIT_ALLOWLIST.find((e) => e.slug.toLowerCase() === slug);
    if (entry && entry.status === 'approved' && entry.flairRequired) {
      const flairRe = new RegExp(entry.flairRequired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (!flairRe.test(allProse)) {
        push('flair', `r/${entry.slug} requires the flair "${entry.flairRequired}" and the draft never names it`);
      }
    }
  }

  // ── house rules ────────────────────────────────────────────────
  if (!INSTRUMENT_RE.test(allProse)) {
    push('name-a-source', 'no instrument or feed named anywhere in the post — "our data" is not a source');
  }

  if (recentTitles.length) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 6).join(' ');
    const n = norm(title);
    if (n && recentTitles.some((r) => norm(r) === n)) {
      push('no-repeat-title', `title opens the same way as a recent post ("${title.slice(0, 60)}…")`);
    }
  }

  // ── the harm register, re-checked on the output ────────────────
  // The prompt already forces flat for these events (voice.ts states
  // every banned construction in the linter's words). This is the
  // second gate, because a model told to be engaging will occasionally
  // find a way to be engaging about a casualty. Each violation quotes
  // the matched text — an anonymous violation cannot be fixed, only
  // guessed at (the X lesson, 2026-08-26).
  if (harmRegisterForced(ev)) {
    const full = `${title}\n\n${selfText}`;
    for (const { re, label, proseOnly } of HARM_SHAPED) {
      // Punctuation tests run on URL-stripped prose only — the body
      // always carries '?utm_source=' and a gate that reads it is
      // unwinnable. Word tests can run on the whole text.
      const m = (proseOnly ? stripUrls(full) : full).match(re);
      if (m) {
        violations.push(
          `harm register is forced for this event: remove ${label} — found "${m[0].trim()}" — and rewrite flat`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}
