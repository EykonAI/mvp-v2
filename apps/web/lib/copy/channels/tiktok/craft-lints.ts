// ─── TIKTOK CRAFT LINTS ──────────────────────────────────────────
//
// Same family split as x-craft-lints.ts: lib/newsjack/lints.ts holds
// the HONESTY gates (emoji, buzzword, coverage overclaim); these are
// CRAFT checks — recordability, hook structure, budgets, furniture,
// register. Enforcement level comes from CODEX_RULES, so a rule cannot
// be hard-gated here while being marked unverified there.
//
// THE FOUR GATE RULES, inherited from the X hardening (#422/#425):
//   1 · a gate SAYS WHAT IT CAUGHT — every violation names the
//       construction and quotes the matched text; length violations
//       quote count vs budget;
//   2 · a gate is SATISFIABLE — punctuation tests run on stripUrls()
//       prose; the no-url-in-caption test runs on the RAW caption,
//       which legitimately contains no URL at all;
//   3 · a gate does NOT fire on correct vocabulary — constructions,
//       not words (the trending-sound check skips "no trending
//       audio"; the greeting check is anchored to the hook start);
//   4 · every hard rule here is stated in voice.ts in the same words,
//       and every budget binds as maxLength on its own schema field.
//
// The lint receives the ChannelArtifact, whose posts[] are the labeled
// script-package lines assemble() emits. The serializer and parser
// live side by side below so they cannot drift.

import { CODEX_RULES } from './codex';
import {
  BEATS_MAX, BEATS_MIN, CAPTION_MAX_CHARS, CTA_PATH, HASHTAGS_MAX,
  HOOK_MAX_CHARS, ONSCREEN_MAX_CHARS, ONSCREEN_MAX_WORDS,
  VOICEOVER_MAX_WORDS, VOICEOVER_MIN_WORDS,
} from './voice';
import { HARM_SHAPED, harmRegisterForced, stripUrls } from '@/lib/copy/shared/harm';
import type { ChannelArtifact, CraftResult } from '@/lib/copy/shared/types';
import type { Evidence } from '@/lib/newsjack/template';

// ─── The package shape and its line encoding ─────────────────────

export interface TikTokBeat {
  onScreen: string;
  spoken: string;
  shot: string;
}

export interface TikTokPackage {
  hook: string;
  beats: TikTokBeat[];
  voiceover: string;
  caption: string;
  hashtags: string[];
  limitBeat: string;
  lockupLowerThird: string;
  lockupEndCard: string;
}

// One line per package part; beats carry their three fields on one
// line with fixed separators. This is what lands in
// newsjack_drafts.posts and what the founder reads in the queue.
export function packageToLines(p: TikTokPackage): string[] {
  return [
    `HOOK: ${p.hook}`,
    ...p.beats.map(
      (b, i) => `BEAT ${i + 1} · ON SCREEN: ${b.onScreen} | SPOKEN: ${b.spoken} | SHOT: ${b.shot}`,
    ),
    `LIMIT BEAT: ${p.limitBeat}`,
    `VOICEOVER: ${p.voiceover}`,
    `CAPTION: ${p.caption}`,
    `HASHTAGS: ${p.hashtags.join(' ')}`,
    `LOCKUP LOWER THIRD: ${p.lockupLowerThird}`,
    `LOCKUP END CARD: ${p.lockupEndCard}`,
  ];
}

const BEAT_RE = /^BEAT \d+ · ON SCREEN: ([\s\S]*?) \| SPOKEN: ([\s\S]*?) \| SHOT: ([\s\S]*)$/;

function field(lines: string[], label: string): string | null {
  const line = lines.find((l) => l.startsWith(`${label}: `));
  return line === undefined ? null : line.slice(label.length + 2);
}

export function linesToPackage(lines: string[]): TikTokPackage | null {
  const hook = field(lines, 'HOOK');
  const limitBeat = field(lines, 'LIMIT BEAT');
  const voiceover = field(lines, 'VOICEOVER');
  const caption = field(lines, 'CAPTION');
  const hashtagsLine = field(lines, 'HASHTAGS');
  const lockupLowerThird = field(lines, 'LOCKUP LOWER THIRD');
  const lockupEndCard = field(lines, 'LOCKUP END CARD');
  if (
    hook === null || limitBeat === null || voiceover === null || caption === null ||
    hashtagsLine === null || lockupLowerThird === null || lockupEndCard === null
  ) {
    return null;
  }
  const beats: TikTokBeat[] = [];
  for (const l of lines) {
    const m = l.match(BEAT_RE);
    if (m) beats.push({ onScreen: m[1], spoken: m[2], shot: m[3] });
  }
  return {
    hook, beats, voiceover, caption,
    hashtags: hashtagsLine.split(/\s+/).filter(Boolean),
    limitBeat, lockupLowerThird, lockupEndCard,
  };
}

// ─── Pattern registers ───────────────────────────────────────────

// hook-first: greetings/introductions/context-setting, ANCHORED to the
// start of the hook so ordinary vocabulary mid-sentence never fires
// ("they" contains "hey"; anchoring plus \b keeps it out).
const GREETING_OPEN_RE =
  /^(hey|hi|hello|welcome|what's up|good (morning|afternoon|evening)|today (i|we)\b|in this video|let me (show|tell|explain)|so,)/i;

// recordable-in-one-take: the producible allowlist. A shot passes when
// it names a real eYKON surface or a talking head.
const PRODUCIBLE_SHOT_RE =
  /talking head|globe|intel|workspace|\/start|\/c\b|\/c\/|\/analyst|\/u\//i;
const PRODUCIBLE_SURFACE_RE =
  /replay|evidence|convergence|calibration|radiance|thermal|night[- ]?lights?|shadow[- ]fleet|table|panel|layer|map|board|dashboard|feed|ledger|timeline/i;
const producible = (shot: string) =>
  PRODUCIBLE_SHOT_RE.test(shot) || PRODUCIBLE_SURFACE_RE.test(shot);

const URL_RE = /https?:\/\/\S+|\bwww\.\S+/i;

// sound-policy: match the SUGGESTION of a trending sound, not the
// vocabulary — "no trending audio" is the correct, sample-verified
// phrasing of our own sound policy and must not fire the gate
// (SAMPLES grep: the term's only occurrence is that negation).
const TRENDING_SOUND_RE = /(?<!no )(?<!not )(?<!without )(?<!never )\btrending (?:sound|audio|track)\b/i;

// no-inbound-formats: duets, stitches, reply-videos.
const INBOUND_FORMAT_RE = /\b(?:duets?|stitch(?:es|ing|ed)?|reply[- ]videos?)\b/i;

// Harm extras beyond the shared HARM_SHAPED list — the withheld reveal
// and the countdown, TikTok's native shaping devices. Each is stated
// verbatim in HARM_CLAUSE in voice.ts (gate rule 4).
const TIKTOK_HARM_SHAPED: Array<{ re: RegExp; label: string }> = [
  { re: /\bwait for it\b[^.]*/i, label: 'the withheld reveal ("wait for it")' },
  { re: /\bwatch (?:till|until) the end\b[^.]*/i, label: 'the withheld reveal ("watch till the end")' },
  { re: /\byou won'?t believe\b[^.]*/i, label: 'the withheld reveal ("you won\'t believe")' },
  { re: /\bcountdowns?\b[^.]*/i, label: 'the countdown' },
];

// Furniture: same instrument register as the X lint, plus the states
// the platform's own ledgers emit.
const INSTRUMENT_RE =
  /\b(FIRMS|Black Marble|VIIRS|GDELT|ACLED|AIS|ADS-B|EIA|OFAC|USGS|IEA|Comtrade|Copernicus|Sentinel|Polymarket)\b/i;
const PROVENANCE_STATE_RE =
  /\b(CONFIRMED|UNCONFIRMED|CORROBORATED|DETECTED|SUGGESTIVE|ELEVATED|VOID|OBSERVED|SINGLE[- ]SENSOR|NOT CONFIRMED)\b/;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const hard = (id: string) =>
  CODEX_RULES.find((r) => r.id === id)?.enforcement === 'hard';

// ─── The lint ────────────────────────────────────────────────────

export function tiktokCraftLint(
  a: ChannelArtifact,
  ev: Evidence,
  _refUrl: string,
  _recent: string[] = [],
): CraftResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const push = (id: string, msg: string) =>
    (hard(id) ? violations : warnings).push(msg);

  const pkg = linesToPackage(a.posts);
  if (!pkg) {
    // Only reachable if assemble() and this parser drift — a code bug,
    // surfaced as a normal fallback rather than an exception.
    return {
      ok: false,
      violations: ['script package lines are malformed — assemble() and linesToPackage() disagree'],
      warnings: [],
    };
  }

  // ── the hook ───────────────────────────────────────────────────
  if (!pkg.hook.trim()) {
    push('hook-first', 'the hook is empty — the first line is the observation, stated');
  } else {
    const m = pkg.hook.match(GREETING_OPEN_RE);
    if (m) {
      push('hook-first', `the hook opens on a greeting/introduction — found "${m[0].trim()}" — no greeting, no introduction, no context-setting before the observation`);
    }
  }
  if (pkg.hook.length > HOOK_MAX_CHARS) {
    push('hook-budget', `the hook is ${pkg.hook.length} chars; budget is ${HOOK_MAX_CHARS}`);
  }

  // ── the beats — recordable in one take ─────────────────────────
  if (pkg.beats.length < BEATS_MIN || pkg.beats.length > BEATS_MAX) {
    violations.push(`script has ${pkg.beats.length} beats; must be ${BEATS_MIN}–${BEATS_MAX}`);
  }
  pkg.beats.forEach((b, i) => {
    if (!b.shot.trim()) {
      push('recordable-in-one-take', `beat ${i + 1} has an empty shot — every beat names a real eYKON screen or 'talking head'`);
    } else if (!producible(b.shot)) {
      push('recordable-in-one-take', `beat ${i + 1} shot "${b.shot.trim()}" does not name a real eYKON screen (GLOBE view or layer, INTEL workspace, /start, the /c replay page, an evidence panel) or 'talking head'`);
    }
    if (!b.spoken.trim()) {
      push('subtitles-burned-in', `beat ${i + 1} has an empty spoken line`);
    }
    if (!b.onScreen.trim()) {
      push('subtitles-burned-in', `beat ${i + 1} has an empty on-screen line — every spoken line carries a burned-in subtitle`);
    } else {
      const w = words(b.onScreen);
      if (w > ONSCREEN_MAX_WORDS) {
        push('onscreen-text-density', `beat ${i + 1} on-screen line "${b.onScreen.trim()}" is ${w} words; at most ${ONSCREEN_MAX_WORDS}`);
      }
      if (b.onScreen.length > ONSCREEN_MAX_CHARS) {
        push('onscreen-text-density', `beat ${i + 1} on-screen line is ${b.onScreen.length} chars; budget is ${ONSCREEN_MAX_CHARS}`);
      }
    }
  });

  // ── the limit beat ─────────────────────────────────────────────
  if (!pkg.limitBeat.trim()) {
    push('state-the-limit', 'the limit beat is empty — a dedicated beat states what the observation does NOT establish');
  }

  // ── the voiceover band ─────────────────────────────────────────
  const vo = words(pkg.voiceover);
  if (vo < VOICEOVER_MIN_WORDS || vo > VOICEOVER_MAX_WORDS) {
    push('length-band', `voiceover is ${vo} words; target band is ${VOICEOVER_MIN_WORDS}–${VOICEOVER_MAX_WORDS} (21–34 s spoken)`);
  }

  // ── the caption ────────────────────────────────────────────────
  // RAW caption on purpose (gate rule 2): the caption legitimately
  // contains NO URL, so there is nothing to strip and the test cannot
  // be made unwinnable by a mandatory link. The path CTA is not a URL
  // and passes by construction.
  const urlInCaption = pkg.caption.match(URL_RE);
  if (urlInCaption) {
    push('no-clickable-link', `the caption carries a URL — found "${urlInCaption[0]}" — no URL in the caption; the CTA is the spoken/on-screen path ${CTA_PATH}`);
  }
  if (pkg.caption.length > CAPTION_MAX_CHARS) {
    push('caption-budget', `the caption is ${pkg.caption.length} chars; budget is ${CAPTION_MAX_CHARS}`);
  }

  // ── hashtags ───────────────────────────────────────────────────
  if (pkg.hashtags.length > HASHTAGS_MAX) {
    push('hashtags-max-5', `${pkg.hashtags.length} hashtags; at most ${HASHTAGS_MAX}`);
  }

  // ── the furniture ──────────────────────────────────────────────
  const lower = pkg.lockupLowerThird;
  if (!/eYKON/i.test(lower)) {
    push('lockup-and-end-card', `the lower third omits the eYKON wordmark — got "${lower.trim() || '(empty)'}"`);
  }
  if (!INSTRUMENT_RE.test(lower)) {
    push('lockup-and-end-card', `the lower third omits the instrument name — got "${lower.trim() || '(empty)'}" — name the instrument the evidence cites (FIRMS, GDELT, Black Marble, VIIRS, AIS, ADS-B, EIA, OFAC), copied verbatim; an invented feed title like "Convergence Watch Feed" is fabricated provenance and does not count`);
  }
  if (!/\bUTC\b/.test(lower)) {
    push('lockup-and-end-card', `the lower third omits the observation timestamp UTC — got "${lower.trim() || '(empty)'}"`);
  }
  if (!PROVENANCE_STATE_RE.test(lower)) {
    push('lockup-and-end-card', `the lower third omits the provenance state (e.g. CONFIRMED, UNCONFIRMED, DETECTED) — got "${lower.trim() || '(empty)'}"`);
  }
  if (!pkg.lockupEndCard.includes(CTA_PATH)) {
    push('lockup-and-end-card', `the end card does not carry the path CTA ${CTA_PATH} — got "${pkg.lockupEndCard.trim() || '(empty)'}"`);
  }
  const urlInEndCard = pkg.lockupEndCard.match(URL_RE);
  if (urlInEndCard) {
    push('lockup-and-end-card', `the end card carries a URL — found "${urlInEndCard[0]}" — the CTA is the bare path, and nothing competes with it`);
  }

  // ── write-only boundary ────────────────────────────────────────
  const pkgText = a.posts.join('\n');
  const inbound = pkgText.match(INBOUND_FORMAT_RE);
  if (inbound) {
    push('no-inbound-formats', `the script proposes an inbound-reactive format — found "${inbound[0]}" — duets, stitches and reply-videos are out of scope`);
  }

  // ── sound policy ───────────────────────────────────────────────
  const trending = pkgText.match(TRENDING_SOUND_RE);
  if (trending && !harmRegisterForced(ev)) {
    push('sound-policy', `a trending sound is suggested — "${trending[0]}" — permitted only where it does not shape the meaning; flagged for founder review`);
  }

  // ── on-screen sourcing ─────────────────────────────────────────
  const onScreenSurfaces = [pkg.hook, ...pkg.beats.map((b) => b.onScreen), lower].join(' ');
  if (!INSTRUMENT_RE.test(onScreenSurfaces)) {
    push('name-a-source', 'no instrument or feed named on screen (hook, overlays, lower third) — a muted viewer never hears the source');
  }

  // ── keyword in four places ─────────────────────────────────────
  if (ev.region) {
    const key = ev.region.split(/[,(]/)[0].trim().toLowerCase();
    if (key.length >= 4) {
      const surfaces: Array<[string, string]> = [
        ['voiceover', `${pkg.hook} ${pkg.beats.map((b) => b.spoken).join(' ')} ${pkg.voiceover}`],
        ['overlays', `${pkg.hook} ${pkg.beats.map((b) => b.onScreen).join(' ')}`],
        ['caption', pkg.caption],
        ['hashtags', pkg.hashtags.join(' ')],
      ];
      const missing = surfaces.filter(([, text]) => !text.toLowerCase().includes(key)).map(([name]) => name);
      if (missing.length) {
        push('keyword-in-four-places', `the primary phrase "${ev.region}" is missing from: ${missing.join(', ')} (voiceover, overlay, caption, hashtags is the full set)`);
      }
    }
  }

  // ── the harm register, re-checked on the output ────────────────
  // The prompt already forces flat for these events; this is the
  // second gate. Punctuation tests run on stripUrls() prose (gate
  // rule 2 — no package text should carry a URL, but the test must
  // not become unwinnable if one sneaks in); word tests run on the
  // whole package text. Every violation quotes what it matched.
  if (harmRegisterForced(ev)) {
    const prose = [
      pkg.hook,
      ...pkg.beats.flatMap((b) => [b.onScreen, b.spoken]),
      pkg.limitBeat, pkg.voiceover, pkg.caption,
      pkg.lockupLowerThird, pkg.lockupEndCard,
    ].join('\n');
    for (const { re, label, proseOnly } of HARM_SHAPED) {
      const m = (proseOnly ? stripUrls(prose) : prose).match(re);
      if (m) {
        violations.push(
          `harm register is forced for this event: remove ${label} — found "${m[0].trim()}" — and rewrite flat`,
        );
      }
    }
    for (const { re, label } of TIKTOK_HARM_SHAPED) {
      const m = prose.match(re);
      if (m) {
        violations.push(
          `harm register is forced for this event: remove ${label} — found "${m[0].trim()}" — and rewrite flat`,
        );
      }
    }
    if (trending) {
      violations.push(
        `harm register is forced for this event: no trending sound, and no suggestion of one — found "${trending[0]}" — spoken voiceover only`,
      );
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}
