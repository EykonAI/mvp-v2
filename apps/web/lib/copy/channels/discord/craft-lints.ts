// ─── DISCORD CRAFT LINTS ─────────────────────────────────────────
//
// DELIBERATELY SEPARATE FROM lib/newsjack/lints.ts. Those are HONESTY
// gates (emoji, buzzword, coverage overclaim); they decide whether a
// draft is allowed to exist. These are CRAFT checks: budgets, shape,
// URL discipline, register. Enforcement level comes from CODEX_RULES,
// so a rule cannot be hard-gated here while being marked unverified
// there — scripts/copy/check-codex.mjs holds that invariant.
//
// THE FOUR GATE RULES this file is written against:
//   1 · a gate SAYS WHAT IT CAUGHT — every violation names the
//       construction AND quotes the matched text (length violations
//       quote the count against the budget);
//   2 · a gate is SATISFIABLE — every punctuation/character test runs
//       on stripUrls() prose, because the message always carries a URL
//       with '?utm_source=' (the unwinnable question-mark gate, #425);
//   3 · a gate does NOT fire on correct vocabulary — constructions are
//       matched, not words (zero '@everyone'/'@here' and zero markdown
//       table rows in docs/copywriters/SAMPLES-*.md);
//   4 · every hard rule is STATED in the system prompt in the same
//       words used here, and every budget lives as maxLength on its
//       own schema field — the lint reads the SAME constants.
//
// VALIDATE-BEFORE-SEND: every length is checked here, before any
// payload could exist. Exceeding a Discord embed limit errors the
// whole send rather than truncating — fail-loud is the house posture,
// so an over-budget artifact fails visibly and is never trimmed.

import { CODEX_RULES } from './codex';
import {
  MESSAGE_MAX_CHARS,
  EMBED_TITLE_MAX_CHARS,
  EMBED_DESC_MAX_CHARS,
  LIMIT_FIELD_MAX_CHARS,
  FOOTER_MAX_CHARS,
} from './voice';
import { HARM_SHAPED, harmRegisterForced, stripUrls } from '@/lib/copy/shared/harm';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact, CraftResult } from '@/lib/copy/shared/types';

const URL_RE = /https?:\/\/\S+/g;

// A bare coordinate pair: "(35.0, 125.0)" or "35.0, 125.0" or
// "35.0N 125.0E" — what our own mechanical headlines emit.
const COORD_RE =
  /\(?\s*-?\d{1,3}\.\d+\s*[,°]\s*-?\d{1,3}\.\d+\s*\)?|\b-?\d{1,3}\.\d+\s*[NS]\s*,?\s*-?\d{1,3}\.\d+\s*[EW]\b/i;

// Mass mentions, matched as the exact constructions Discord resolves —
// '@everyone', '@here', and the raw role-mention markup '<@&id>'.
// These strings do not occur in any approved sample.
const MASS_MENTION_RE = /@everyone|@here|<@&\d+>/;

// A markdown table row: a line that starts and ends with a pipe, or a
// separator cell (---|). A lone '|' or a bare '---' rule in prose does
// not match — the construction is matched, not the character.
const TABLE_ROW_RE = /^\s*\|.*\|\s*$|:?-{3,}\s*\|/m;

// Something that reads as a UTC observation time: an ISO-ish date, an
// explicit 'UTC', or Discord native timestamp markup.
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}|\bUTC\b|<t:\d+/;

const INSTRUMENT_RE =
  /\b(FIRMS|Black Marble|VIIRS|GDELT|ACLED|AIS|ADS-B|EIA|OFAC|USGS|IEA|Comtrade|Copernicus|Sentinel|Polymarket)\b/i;

interface DiscordEmbed {
  title: string;
  description: string;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  footer: { text: string };
}

function parseEmbed(json: string): DiscordEmbed | null {
  try {
    const e = JSON.parse(json) as Partial<DiscordEmbed>;
    if (
      typeof e?.title !== 'string' ||
      typeof e?.description !== 'string' ||
      !Array.isArray(e?.fields) ||
      typeof e?.footer?.text !== 'string'
    ) {
      return null;
    }
    return e as DiscordEmbed;
  } catch {
    return null;
  }
}

const hard = (id: string) =>
  CODEX_RULES.find((r) => r.id === id)?.enforcement === 'hard';

export function discordCraftLint(
  a: ChannelArtifact,
  ev: Evidence,
  refUrl: string,
  recentLeads: string[] = [],
): CraftResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const push = (id: string, msg: string) =>
    (hard(id) ? violations : warnings).push(msg);

  // ── shape: [message, embed JSON], per shared/types.ts ──────────
  // Structural, unconditional: an artifact that is not one message
  // plus one embed is not a Discord artifact at all.
  if (a.posts.length !== 2) {
    violations.push(
      `artifact must be exactly [message, embed JSON]; got ${a.posts.length} parts`,
    );
    return { ok: false, violations, warnings };
  }
  const message = a.posts[0] ?? '';
  const embed = parseEmbed(a.posts[1] ?? '');
  if (!message.trim()) violations.push('message is empty');
  if (!embed) {
    violations.push('second part is not a parseable embed (title, description, fields, footer.text)');
    return { ok: false, violations, warnings };
  }
  if (embed.fields.some((f) => typeof f?.name !== 'string' || typeof f?.value !== 'string')) {
    violations.push('an embed field is missing a string name or value');
    return { ok: false, violations, warnings };
  }

  // ── validate-before-send: every budget, checked here, fail-loud ─
  // Exceeding a Discord embed limit errors the whole send rather than
  // truncating; an over-budget artifact must therefore fail VISIBLY at
  // lint time and is never trimmed silently. Each violation quotes the
  // count against the budget (gate rule 1).
  const budgets: Array<[string, string, number, string]> = [
    ['message-budget', 'message', MESSAGE_MAX_CHARS, message],
    ['embed-budget', 'embed title', EMBED_TITLE_MAX_CHARS, embed.title],
    ['embed-budget', 'embed description', EMBED_DESC_MAX_CHARS, embed.description],
    ['embed-budget', 'embed footer', FOOTER_MAX_CHARS, embed.footer.text],
  ];
  for (const f of embed.fields) budgets.push(['embed-budget', `embed field "${f.name}"`, LIMIT_FIELD_MAX_CHARS, f.value]);
  for (const [id, name, max, text] of budgets) {
    if (text.length > max) {
      push(id, `${name} is ${text.length} chars; budget is ${max} — an over-budget embed errors the whole send, write to fit`);
    }
  }

  // ── one embed, structurally [message, embedJson] ───────────────
  // The schema can only express one embed; if the JSON smuggled in an
  // array, that is a second embed. Warn per the codex.
  if (a.posts[1].trim().startsWith('[')) {
    push('one-embed', 'embed JSON is an array — one embed per message; ten is a limit, not a target');
  }

  // ── URL discipline — ALWAYS HARD, not codex-scoped ─────────────
  // The replay URL is the conversion mechanism AND the attribution
  // carrier (brief §21.8). The writer may rewrite the sentence around
  // it; it may never rewrite the URL. An altered URL silently destroys
  // the channel attribution, so this never downgrades.
  const urlsInMessage = message.match(URL_RE) ?? [];
  if (urlsInMessage.length !== 1) {
    violations.push(
      `message carries ${urlsInMessage.length} URLs; must carry the replay URL exactly once — found ${urlsInMessage.length ? `"${urlsInMessage.join('", "')}"` : 'none'}`,
    );
  } else if (urlsInMessage[0].replace(/[.,;)]$/, '') !== refUrl) {
    violations.push(
      `message URL was altered — attribution would be lost: found "${urlsInMessage[0]}", expected "${refUrl}"`,
    );
  }
  const embedText = [embed.title, embed.description, ...embed.fields.map((f) => `${f.name} ${f.value}`), embed.footer.text].join('\n');
  const urlsInEmbed = embedText.match(URL_RE) ?? [];
  if (urlsInEmbed.length > 0) {
    violations.push(
      `embed carries a URL; no URL is allowed outside the message — found "${urlsInEmbed[0]}"`,
    );
  }

  // ── no mass mentions, ever ─────────────────────────────────────
  const whole = `${message}\n${embedText}`;
  const mention = whole.match(MASS_MENTION_RE);
  if (mention) {
    push('no-mass-mention', `mass mention present: found "${mention[0]}" — no @everyone, @here, or role mention, ever, from an automated poster`);
  }

  // ── no markdown tables — they do not render ────────────────────
  const tableRow = whole.match(TABLE_ROW_RE);
  if (tableRow) {
    push('no-tables', `markdown table row present — Discord does not render tables, use embed fields: found "${tableRow[0].trim().slice(0, 60)}"`);
  }

  // ── state-the-limit: the field must exist and say something ────
  const limitField = embed.fields.find((f) => /does not establish|limit/i.test(f.name));
  if (!limitField || !limitField.value.trim()) {
    push('state-the-limit', 'embed has no populated "What this does not establish" field — the limit of the observation is stated as a field of its own');
  }

  // ── name-a-source: instrument named, not implied ───────────────
  if (!INSTRUMENT_RE.test(whole)) {
    push('name-a-source', 'no instrument or feed named anywhere in the message or embed — "our data" is not a source');
  }
  if (!TIMESTAMP_RE.test(embed.footer.text)) {
    warnings.push(`footer carries no observation timestamp — a screenshot out of context should still say when: found "${embed.footer.text.slice(0, 60)}"`);
  }

  // ── the opening sentence is the channel-list preview ───────────
  const prose = stripUrls(message);
  const opening = prose.trimStart().slice(0, 120);
  if (message.trimStart().startsWith('http')) {
    warnings.push('message opens on the URL — the first sentence is the channel-list preview and must carry the observation');
  }
  const coord = opening.match(COORD_RE);
  if (coord) {
    warnings.push(`message opens on a bare coordinate pair — name the place or the facilities: found "${coord[0]}"`);
  }
  if (recentLeads.length) {
    const norm = (s: string) => stripUrls(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 6).join(' ');
    const n = norm(message);
    if (n && recentLeads.some((r) => norm(r) === n)) {
      warnings.push('message opens the same way as a recent post');
    }
  }

  // ── the harm register, re-checked on the output ────────────────
  // The prompt already forces flat for these events. This is the
  // second gate, because a model told to be engaging will occasionally
  // find a way to be engaging about a casualty. Punctuation tests run
  // on stripUrls() prose ONLY — the message always carries the replay
  // URL and that URL carries '?utm_source=' (gate rule 2, #425); word
  // tests may run on the whole body, since a banned word inside a URL
  // is not a thing. Every violation quotes the matched text.
  if (harmRegisterForced(ev)) {
    const body = whole;
    for (const { re, label, proseOnly } of HARM_SHAPED) {
      const m = (proseOnly ? stripUrls(body) : body).match(re);
      if (m) {
        violations.push(
          `harm register is forced for this event: remove ${label} — found "${m[0].trim()}" — and rewrite flat`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}
