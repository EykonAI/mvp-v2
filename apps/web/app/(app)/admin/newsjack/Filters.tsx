import Link from 'next/link';
import type { CSSProperties } from 'react';
import { type FacetGroup, type ReviewFacets, activeCount } from '@/lib/newsjack/review-filters';

// Server component: every control is a Link, so the whole bar works with
// JavaScript off, the current view is a shareable URL, and there is no
// client bundle for a page four people will ever load.

const bar: CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 10,
  padding: '12px 14px 14px',
  marginBottom: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const row: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' };
const groupLabel: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-faint)',
  minWidth: 92,
};
const chipBase: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
  padding: '3px 9px',
  borderRadius: 999,
  border: '1px solid var(--rule)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};
const chipIdle: CSSProperties = { ...chipBase, color: 'var(--ink-dim)' };
const chipOn: CSSProperties = { ...chipBase, color: 'var(--bg, #0b0f14)', background: 'var(--teal)', borderColor: 'var(--teal)' };
// A zero-count option is kept visible rather than hidden: knowing that
// nothing on this channel fell back is the answer to the question, and
// a chip that disappears makes you wonder whether you mis-read the bar.
const chipEmpty: CSSProperties = { ...chipBase, color: 'var(--ink-faint)', opacity: 0.55 };
const note: CSSProperties = { fontSize: 11, color: 'var(--ink-faint)' };
const clearLink: CSSProperties = { ...chipBase, color: 'var(--amber)', borderColor: 'var(--amber)' };

export default function Filters({
  groups,
  facets,
  showing,
  matched,
  scanned,
  scanCapped,
}: {
  groups: FacetGroup[];
  facets: ReviewFacets;
  showing: number;
  matched: number;
  scanned: number;
  scanCapped: boolean;
}) {
  const n = activeCount(facets);
  return (
    <div style={bar}>
      {groups.map((g) => (
        <div key={g.key} style={row}>
          <span style={groupLabel}>{g.title}</span>
          {g.options.map((o) => (
            <Link
              key={o.value}
              href={o.href}
              style={o.active ? chipOn : o.count === 0 ? chipEmpty : chipIdle}
              aria-pressed={o.active}
            >
              {o.label} {o.count}
            </Link>
          ))}
        </div>
      ))}

      <div style={{ ...row, justifyContent: 'space-between', borderTop: '1px solid var(--rule)', paddingTop: 10 }}>
        <span style={note}>
          {matched === showing
            ? `${matched} draft${matched === 1 ? '' : 's'} shown`
            : `showing ${showing} of ${matched} matching — narrow the filter to see the rest`}
          {' · '}
          {/* Say what the counts are computed over. A facet count that
              silently covers only part of the table is the same defect
              class as a window with no stated width. */}
          {scanCapped
            ? `counts cover the ${scanned} most recent drafts only`
            : `counts cover all ${scanned} drafts`}
        </span>
        {n > 0 && (
          <Link href="/admin/newsjack" style={clearLink}>
            clear {n} filter{n === 1 ? '' : 's'}
          </Link>
        )}
      </div>
    </div>
  );
}
