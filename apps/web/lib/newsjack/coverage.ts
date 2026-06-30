// Coverage honesty (Newsjacking SOP §4) — the non-negotiable rule that a post
// must never imply live coverage of a region eYKON cannot see. Source of truth
// for the coverage gate (see lints.ts).
//
// Live today (free AIS receivers dense enough): Strait of Malacca, Suez,
// Bosphorus. NOT live (paid / Phase-2, dark on the free tier): Strait of
// Hormuz, Persian Gulf, Bab-el-Mandeb, Panama Canal. Conflict (GDELT) and
// energy (EIA/GEM) feeds are broad/global, so non-maritime events are framed
// 'live' by default — but any draft that names an uncovered region alongside a
// live-coverage claim is still flagged, regardless of domain.

export const COVERED_CHOKEPOINTS = ['malacca', 'suez', 'bosphorus'] as const;

export const UNCOVERED_REGIONS: { label: string; needles: string[] }[] = [
  { label: 'Strait of Hormuz', needles: ['hormuz'] },
  { label: 'Persian Gulf', needles: ['persian gulf', 'arabian gulf'] },
  { label: 'Bab-el-Mandeb', needles: ['bab-el-mandeb', 'bab el mandeb', 'bab al-mandab', 'mandeb'] },
  { label: 'Panama Canal', needles: ['panama canal'] },
];

// Live-coverage phrasing that, next to an uncovered region, is an overclaim.
const LIVE_CLAIM_NEEDLES = [
  'live on', 'watch it live', 'on the globe', 'real-time', 'realtime',
  'live feed', 'tracking live', 'live ais', 'live vessel', 'live now',
];

// Is this region safe to describe with live-coverage language?
export function isCoveredRegion(label: string | null | undefined): boolean {
  if (!label) return true; // unknown / non-maritime — not a chokepoint claim
  const l = label.toLowerCase();
  return !UNCOVERED_REGIONS.some((r) => r.needles.some((n) => l.includes(n)));
}

// Scan a drafted post for an uncovered region named alongside a live claim.
// Returns the offending region labels (empty = clean). Naming an uncovered
// region analytically (no live claim) is allowed.
export function scanOverclaim(text: string): string[] {
  const t = text.toLowerCase();
  const claimsLive = LIVE_CLAIM_NEEDLES.some((n) => t.includes(n));
  if (!claimsLive) return [];
  const hits: string[] = [];
  for (const r of UNCOVERED_REGIONS) {
    if (r.needles.some((n) => t.includes(n))) hits.push(r.label);
  }
  return hits;
}

// How to frame an event in this region: a live view, or analytical-only.
export function framingFor(label: string | null | undefined): 'live' | 'analytical' {
  return isCoveredRegion(label) ? 'live' : 'analytical';
}
