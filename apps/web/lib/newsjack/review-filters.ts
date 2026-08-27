// ─── REVIEW QUEUE FACETS ─────────────────────────────────────────
//
// Pure functions. No DB, no React, no Next — so the matching rules can
// be reasoned about (and later tested) without standing up a page.
//
// WHY FACETS AND NOT A SEARCH BOX. The queue is about to carry SIX
// channels per event instead of three (the multi-channel copywriter
// build), and every draft already carries a composer stamp whose whole
// purpose is to make a silent fallback visible. A stamp nobody can
// filter on is a stamp nobody reads: "three template badges in a row
// means the agent is down" only works if you can ask for the template
// badges.
//
// Counts are FACETED, not global: each option is counted against the
// other active filters, so the number on a chip is the number of rows
// you get if you click it. A count that ignores the rest of the filter
// state is a label claiming something the click does not deliver.

import type { ReviewDraft } from '@/lib/newsjack/store';

export type StateFacet = 'pending' | 'blocked' | 'approved' | 'published' | 'rejected';
export type ComposerFacet = 'agent' | 'template';
export type FlagFacet = 'fallback' | 'warned' | 'valuefail' | 'revised';

export interface ReviewFacets {
  channel?: string;
  state?: StateFacet;
  composer?: ComposerFacet;
  flag?: FlagFacet;
}

export const FACET_KEYS = ['channel', 'state', 'composer', 'flag'] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

const STATES: StateFacet[] = ['pending', 'blocked', 'approved', 'published', 'rejected'];
const COMPOSERS: ComposerFacet[] = ['agent', 'template'];
const FLAGS: FlagFacet[] = ['fallback', 'warned', 'valuefail', 'revised'];

// Channel is NOT a closed list here on purpose. It is derived from the
// rows themselves, so reddit / discord / tiktok appear in this bar the
// first time the engine writes one — no deploy, no edit to this file.
// Same reason the channel union lives in one place in the writer layer.
const CHANNEL_RE = /^[a-z0-9_-]{1,32}$/;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = (s ?? '').trim().toLowerCase();
  return t || undefined;
}

/** Parse and VALIDATE. An unknown value is dropped rather than matched,
 *  so a hand-edited or crawled query string cannot produce a view whose
 *  chips disagree with its rows. */
export function parseFacets(
  sp: { [key: string]: string | string[] | undefined } | undefined,
): ReviewFacets {
  const channel = one(sp?.channel);
  const state = one(sp?.state);
  const composer = one(sp?.composer);
  const flag = one(sp?.flag);
  return {
    channel: channel && CHANNEL_RE.test(channel) ? channel : undefined,
    state: STATES.includes(state as StateFacet) ? (state as StateFacet) : undefined,
    composer: COMPOSERS.includes(composer as ComposerFacet) ? (composer as ComposerFacet) : undefined,
    flag: FLAGS.includes(flag as FlagFacet) ? (flag as FlagFacet) : undefined,
  };
}

// PENDING is the existing definition, unchanged: the header has counted
// event drafted + draft status since this page shipped, and the chip
// must agree with the headline or one of them is lying.
export function matchesState(d: ReviewDraft, s: StateFacet): boolean {
  switch (s) {
    case 'pending': return d.event_status === 'drafted' && d.status === 'draft';
    case 'blocked': return d.event_status === 'blocked';
    case 'approved': return d.status === 'approved';
    case 'published': return d.status === 'published';
    case 'rejected': return d.status === 'rejected';
  }
}

export function matchesFlag(d: ReviewDraft, f: FlagFacet): boolean {
  switch (f) {
    // The agent tried and the template answered. The alarm.
    case 'fallback': return Boolean(d.fallback_reason);
    case 'warned': return (d.craft_warnings?.length ?? 0) > 0;
    case 'valuefail': return !d.value_pass;
    // A draft saved from the dry-run recompose, sitting beside its
    // original (migration 115). Useful when comparing the two.
    case 'revised': return d.revision > 0;
  }
}

function matchesKey(d: ReviewDraft, f: ReviewFacets, key: FacetKey): boolean {
  switch (key) {
    case 'channel': return !f.channel || d.channel === f.channel;
    case 'state': return !f.state || matchesState(d, f.state);
    case 'composer': return !f.composer || d.composer === f.composer;
    case 'flag': return !f.flag || matchesFlag(d, f.flag);
  }
}

export function matches(d: ReviewDraft, f: ReviewFacets): boolean {
  return FACET_KEYS.every((k) => matchesKey(d, f, k));
}

export function filterDrafts(rows: ReviewDraft[], f: ReviewFacets): ReviewDraft[] {
  return rows.filter((d) => matches(d, f));
}

/** Rows matching every active facet EXCEPT `key` — the population a
 *  chip in that group is counted against. */
export function rowsExcept(rows: ReviewDraft[], f: ReviewFacets, key: FacetKey): ReviewDraft[] {
  return rows.filter((d) => FACET_KEYS.every((k) => (k === key ? true : matchesKey(d, f, k))));
}

export interface FacetOption {
  key: FacetKey;
  value: string;
  label: string;
  count: number;
  active: boolean;
  href: string;
}

/** Toggle semantics: clicking the active chip clears it. Other facets
 *  are preserved, so the bar composes instead of resetting. */
export function hrefWith(f: ReviewFacets, key: FacetKey, value?: string): string {
  const next: Record<string, string> = {};
  for (const k of FACET_KEYS) {
    const v = f[k];
    if (v) next[k] = v;
  }
  if (!value || next[key] === value) delete next[key];
  else next[key] = value;
  const qs = new URLSearchParams(next).toString();
  return qs ? `/admin/newsjack?${qs}` : '/admin/newsjack';
}

const LABELS: Record<string, string> = {
  pending: 'pending',
  blocked: 'blocked',
  approved: 'approved',
  published: 'published',
  rejected: 'rejected',
  agent: 'agent-written',
  template: 'template',
  fallback: 'fell back',
  warned: 'craft warnings',
  valuefail: 'value fail',
  revised: 'recomposed',
};

export interface FacetGroup {
  key: FacetKey;
  title: string;
  options: FacetOption[];
}

export function buildGroups(rows: ReviewDraft[], f: ReviewFacets): FacetGroup[] {
  const channels = Array.from(new Set(rows.map((r) => r.channel))).sort();
  const spec: Array<{ key: FacetKey; title: string; values: string[] }> = [
    { key: 'channel', title: 'channel', values: channels },
    { key: 'state', title: 'state', values: STATES },
    { key: 'composer', title: 'writer', values: COMPOSERS },
    { key: 'flag', title: 'needs a look', values: FLAGS },
  ];

  return spec.map(({ key, title, values }) => {
    const pool = rowsExcept(rows, f, key);
    return {
      key,
      title,
      options: values.map((value) => ({
        key,
        value,
        label: LABELS[value] ?? value,
        count: pool.filter((d) => matchesKey(d, { ...f, [key]: value } as ReviewFacets, key)).length,
        active: f[key] === value,
        href: hrefWith(f, key, value),
      })),
    };
  });
}

export function activeCount(f: ReviewFacets): number {
  return FACET_KEYS.filter((k) => Boolean(f[k])).length;
}
