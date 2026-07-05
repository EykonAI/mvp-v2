import Link from 'next/link';
import type { FastMarket } from '@/lib/comm/firstTen';
import { FIRST_TEN_TARGET } from '@/lib/comm/firstTen';

// "The First Ten" (Founding Partner build-prompt §7) — the owner-only
// sprint to a shown Reputation Note. Renders only while the Note is
// not yet shown. Every entry is a REAL open Polymarket market closing
// within the fast window; "Make this call" prefills the ordinary
// commit-reveal composer (?call=<market_id> — read by MakeACall).
// Nothing here is a shortcut: ten honest resolved calls, just chosen
// so they resolve in days, not months.
export function FirstTenPanel({
  resolvedCount,
  markets,
  deadline,
}: {
  resolvedCount: number;
  markets: FastMarket[];
  deadline: string | null; // Founding Partner note_deadline, if any
}) {
  const remaining = Math.max(FIRST_TEN_TARGET - resolvedCount, 0);
  const deadlineDays = deadline
    ? Math.max(Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000), 0)
    : null;

  return (
    <section
      aria-label="The First Ten"
      style={{
        border: '1px solid var(--rule)',
        borderLeft: '2px solid var(--teal)',
        borderRadius: 8,
        padding: '16px 20px',
        background: 'var(--bg-panel)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>
          The First Ten — {resolvedCount} of {FIRST_TEN_TARGET} resolved
        </div>
        {deadlineDays != null && (
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: deadlineDays < 30 ? 'var(--amber)' : 'var(--ink-faint)' }}>
            Founding Partner deadline · {deadlineDays}d
          </div>
        )}
      </div>

      {/* progress dots */}
      <div style={{ display: 'flex', gap: 5, margin: '10px 0 8px' }}>
        {Array.from({ length: FIRST_TEN_TARGET }, (_, i) => (
          <span
            key={i}
            style={{
              width: 14,
              height: 6,
              borderRadius: 3,
              background: i < resolvedCount ? 'var(--teal)' : 'var(--bg-raised)',
              border: '1px solid var(--rule)',
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.55, margin: '0 0 12px', maxWidth: 560 }}>
        {remaining} more resolved call{remaining === 1 ? '' : 's'} unlock your Reputation Note.
        These open markets close soonest — a call here is sealed, scored against the crowd, and
        resolves in days. Same rules as every other call; wrong ones stay published.
      </p>

      {markets.length === 0 ? (
        <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)', margin: 0 }}>
          Fast-closing markets refresh every 30 minutes — check back shortly, or make any call
          from the composer below.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {markets.slice(0, 6).map(m => (
            <div
              key={m.market_id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, border: '1px solid var(--rule-soft)', borderRadius: 6, padding: '8px 12px' }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.question}
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>
                  closes in {m.days_to_close}d · resolves automatically
                </div>
              </div>
              <Link
                href={`?tab=predictions&call=${encodeURIComponent(m.market_id)}`}
                scroll={false}
                style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--teal)', border: '1px solid var(--teal-dim)', borderRadius: 5, padding: '5px 10px', textDecoration: 'none', flexShrink: 0 }}
              >
                Make this call →
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
