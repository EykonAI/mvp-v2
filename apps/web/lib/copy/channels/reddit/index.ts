// ─── REDDIT WRITER — THE AGENT CHANNEL (PR-2a) ───────────────────
//
// Fills the PR-2a stub with the real writer: codex.ts (the versioned
// craft register + the checked-in subreddit allowlist), voice.ts (the
// prompts and the forced-tool schema, every budget a maxLength on its
// own field), craft-lints.ts (enforcement read from the codex, every
// violation quoting what it matched).
//
// THE ALLOWLIST SHIPS WITH ZERO APPROVED ENTRIES, AND THAT IS THE
// DESIGNED STATE: with no approved destination, assemble() returns
// null for every model output, the compose loop treats that as a
// normal failure, and the deterministic template writes — its target
// reads UNASSIGNED and is visibly not postable. Approving an entry is
// a founder act (reading the community's rules) recorded in codex.ts,
// not a code change here.

import { REDDIT_COPYWRITER_MODEL } from '@/lib/analyst/model';
import type { Evidence } from '@/lib/newsjack/template';
import type { ChannelArtifact, ChannelWriter } from '@/lib/copy/shared/types';
import { approvedSubreddits } from './codex';
import { redditCraftLint } from './craft-lints';
import { renderReddit } from './template';
import {
  CODEX_VERSION,
  systemPrompt,
  userPrompt,
  WRITE_REDDIT_POST_TOOL,
} from './voice';

const on = () => ['on', 'true', '1'].includes((process.env.NEWSJACK_COPYWRITER_REDDIT ?? '').toLowerCase());

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// Tool input → artifact, or null when the shape is unusable. Null is a
// normal failure (the loop degrades to the template), never a throw.
//
// The disclosure and the limit paragraph arrive as their own fields —
// so a lint can prove they survived — and are placed INSIDE the body
// here: limit paragraph after the method, disclosure directly above
// the link. The final selfText therefore always reads
// method → what-this-does-not-establish → disclosure → replay URL.
// Drop paragraphs this text already contains, verbatim.
//
// WHY THIS IS NEEDED, and why the lint did not catch it. The craft lint
// REQUIRES the limit paragraph and the disclosure to be present in the
// assembled body (craft-lints.ts: 'no affiliation disclosure found in the
// body', 'no limit statement found in the body'). A model that also writes
// them into `body` — roughly half of runs — therefore satisfies the lint,
// and the append below adds a SECOND copy. The lint only ever sees the
// finished text, so it cannot tell "model omitted, assembler added" from
// "model included, assembler added again": it passes the duplicate. The gate
// that enforces the honesty language is what produced the repetition.
//
// Measured over the stored Reddit drafts: 30 of the 56 POSTABLE two-part
// drafts (53.6%) carried a duplicated paragraph — 30 of 67 counting the
// unpostable template fallbacks. Replaying this exact rule over them removes
// 36 paragraphs and 4,182 characters, and touches nothing else. The other
// three channels carried zero duplicates across 479 drafts, because only
// Reddit splits the disclosure and limit paragraph into their own fields.
//
// Deduping here is deterministic; a prompt instruction is not, which is why
// this is the fix rather than sharper wording in the codex. It matches on
// exact text after trimming — every duplicate observed was byte-identical —
// and deliberately does NOT try to catch a rephrased near-duplicate, because
// guessing at semantic equality would silently delete real content. Short
// lines are left alone for the same reason: a repeated short line can be
// legitimate, a repeated paragraph cannot.
const DEDUPE_MIN_CHARS = 40;

function dedupeParagraphs(text: string): string {
  const seen = new Set<string>();
  return text
    .split('\n\n')
    .filter((p) => {
      const key = p.trim();
      if (key.length < DEDUPE_MIN_CHARS) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n');
}

function assembleReddit(input: unknown, refUrl: string): ChannelArtifact | null {
  if (typeof input !== 'object' || input === null) return null;
  const i = input as Record<string, unknown>;
  const subreddit = str(i.subreddit).replace(/^r\//i, '');
  const title = str(i.title);
  const body = str(i.body);
  const disclosure = str(i.disclosure);
  const limitParagraph = str(i.limitParagraph);
  if (!subreddit || !title || !body || !disclosure || !limitParagraph) return null;

  // No approved destination → no post-shaped draft, by design. This is
  // the allowlist-only rule applied at assembly: an empty approved set
  // (the shipped state) makes this unconditionally null.
  const approved = approvedSubreddits().map((e) => e.slug.toLowerCase());
  if (!approved.includes(subreddit.toLowerCase())) return null;

  // Insert the limit paragraph and the disclosure above the link. When
  // the model put the URL mid-body on its own closing line (as told),
  // split there; when it left the URL out, append it — the craft lint
  // then verifies exactly-once and unaltered either way.
  // Append only what the body does not ALREADY contain, matched on exact
  // trimmed text.
  //
  // The paragraph dedupe below cannot catch these: when the model writes the
  // disclosure at the end of an existing paragraph rather than as its own, the
  // appended copy and the inline one sit in DIFFERENT paragraphs, so neither
  // is an exact paragraph repeat. Measured: 5 of the 56 stored drafts repeat
  // the disclosure sentence exactly this way, invisible to paragraph dedupe.
  //
  // Matching is exact and never by regex. The lint's DISCLOSURE_RE and
  // LIMIT_RE detect PRESENCE, and they are deliberately loose so a rephrased
  // statement still passes — `affiliat\w*` matches "vessels affiliated with",
  // and `not confirmed` matches ordinary analysis like "the claim is not
  // independently confirmed by this second sensor". Suppressing an append on
  // a loose match would drop the real disclosure or the real limit paragraph
  // and publish a post without it. A duplicate reads badly; a missing
  // disclosure is a different category of problem. Exact match only.
  const has = (needle: string) => body.includes(needle.trim());
  const limitPart = has(limitParagraph) ? '' : limitParagraph;
  const disclosurePart = has(disclosure) ? '' : disclosure;

  const urlIdx = body.indexOf(refUrl);
  let selfText: string;
  if (urlIdx >= 0) {
    const lineStart = body.lastIndexOf('\n', urlIdx) + 1; // 0 when the URL opens the body
    const method = body.slice(0, lineStart).trimEnd();
    const linkLine = body.slice(lineStart).trim();
    selfText = [method, limitPart, disclosurePart, linkLine].filter(Boolean).join('\n\n');
  } else {
    selfText = [body, limitPart, disclosurePart, refUrl].filter(Boolean).join('\n\n');
  }

  // Both branches above append the limit paragraph and the disclosure
  // unconditionally, so either can duplicate what the model already wrote.
  selfText = dedupeParagraphs(selfText);

  return {
    body: `${title}\n\n${selfText}`,
    posts: [title, selfText],
    refUrl,
  };
}

export const REDDIT_WRITER: ChannelWriter = {
  channel: 'reddit',
  utmSource: 'reddit',
  utmMedium: 'community',
  codexVersion: CODEX_VERSION,
  enabled: on,
  model: () => REDDIT_COPYWRITER_MODEL,
  defaultRegister: 'dry', // founder decision, PR-0 (2026-08-27)
  registerEnvVar: 'COPYWRITER_REGISTER_REDDIT',
  template: renderReddit,
  tool: WRITE_REDDIT_POST_TOOL,
  systemPrompt,
  userPrompt,
  assemble: assembleReddit,
  craftLint: redditCraftLint,
  maxTokensOut: 2500,
};
