// In-Space artifact embeds (monetisation review §4.2, MVP).
//
// When a room/Space/DM message contains an eYKON public-artifact URL —
// a convergence page /c/<uuid> or a proactive-content page /q/<uuid> —
// the Thread renders an artifact card under the message. The detector
// is deliberately narrow: only those two public, no-login route shapes,
// absolute (any host) or relative, UUID ids only.

export type ArtifactRef = { kind: 'c' | 'q'; id: string };

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const REF_RE = new RegExp(`(?:^|[\\s(])(?:https?://[^\\s/]+)?/(c|q)/(${UUID})(?=[\\s).,;!?]|$)`, 'g');

export function extractArtifactRefs(body: string, max = 2): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(REF_RE)) {
    const kind = m[1] as 'c' | 'q';
    const id = m[2].toLowerCase();
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id });
    if (out.length >= max) break;
  }
  return out;
}

export type ArtifactPreview = {
  kind: 'c' | 'q';
  id: string;
  href: string;       // the public artifact page
  badge: string;      // small uppercase tag on the card
  title: string;
  excerpt: string;
  createdAt: string | null;
  // Tier-aware call-to-action (computed server-side): Citizens get the
  // upgrade hook, paying tiers get nothing extra (the card itself links
  // to the artifact).
  cta: { href: string; label: string } | null;
};
