'use client';
import { useEffect, useState } from 'react';

// Shared recent-fires list, used in two places:
//   • /notif?filter=recent  — 24-hour window, deep-linked from the
//     bell glyph in TopNav (PR 2).
//   • /settings             — 30-day window, mounted as
//     RecentNotificationsCard.
//
// Both consume /api/notifications/recent?hours=N (built in PR 6).

interface FireRow {
  id: string;
  rule_id: string | null;
  fired_at: string;
  channel_ids: string[];
  payload: {
    ruleName?: string;
    summary?: string;
    rationale?: string | null;
    detailLines?: string[];
    ruleType?: 'single_event' | 'multi_event' | 'outcome_ai' | 'cross_data_ai';
    cap_state?: {
      monthly_sms_wa_count?: number;
      soft_warn_triggered?: boolean;
      warning_email_sent?: boolean;
    };
  } & Record<string, unknown>;
  delivery_status: Record<
    string,
    {
      ok?: boolean;
      provider?: string;
      provider_id?: string;
      error?: string;
      suppressed_reason?: string;
    }
  > | null;
}

interface RecentFiresListProps {
  hours: number;
  /** Optional title override for the heading slot rendered above
   *  the list (used by the settings card; the /notif page draws
   *  its own SectionHeading instead). */
  title?: string;
  /** Compact mode hides the rule type / channel count chips, used
   *  when the host already shows them elsewhere. */
  compact?: boolean;
}

export function RecentFiresList({ hours, title, compact }: RecentFiresListProps) {
  const [fires, setFires] = useState<FireRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/notifications/recent?hours=${encodeURIComponent(hours)}`, {
      cache: 'no-store',
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { fires?: FireRow[] }) => {
        if (cancelled) return;
        setFires(data.fires ?? []);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'network error');
        setFires([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hours]);

  return (
    <div>
      {title && (
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            marginBottom: 10,
          }}
        >
          {title}
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(224, 93, 80, 0.1)',
            border: '1px solid rgba(224, 93, 80, 0.4)',
            color: 'var(--red)',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 12.5,
            marginBottom: 10,
          }}
        >
          Could not load recent fires: {error}
        </div>
      )}

      {fires === null ? (
        <p style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>Loading…</p>
      ) : fires.length === 0 ? (
        <div
          style={{
            padding: '20px 22px',
            background: 'var(--bg-panel)',
            border: '1px dashed var(--rule)',
            borderRadius: 4,
            color: 'var(--ink-dim)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              marginBottom: 8,
            }}
          >
            No fires in the last {windowLabel(hours)}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            Once a rule fires, it lands here with the matching event payload, AI rationale (if
            applicable), and per-channel delivery status.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {fires.map(fire => (
            <FireRowItem
              key={fire.id}
              fire={fire}
              expanded={expanded === fire.id}
              onToggle={() => setExpanded(prev => (prev === fire.id ? null : fire.id))}
              compact={compact ?? false}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FireRowItem({
  fire,
  expanded,
  onToggle,
  compact,
}: {
  fire: FireRow;
  expanded: boolean;
  onToggle: () => void;
  compact: boolean;
}) {
  const ruleName = fire.payload?.ruleName ?? '(unnamed rule)';
  const summary = fire.payload?.summary ?? '';
  const rationale = fire.payload?.rationale ?? null;
  const ruleType = fire.payload?.ruleType ?? null;
  const detailLines = fire.payload?.detailLines ?? [];
  const channels = fire.delivery_status ?? {};

  const okCount = Object.values(channels).filter(c => c?.ok === true).length;
  const failCount = Object.values(channels).filter(c => c?.ok === false).length;

  return (
    <li
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        padding: '12px 14px',
        marginBottom: 8,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          color: 'var(--ink)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{ruleName}</div>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              color: 'var(--ink-faint)',
              letterSpacing: '0.1em',
              flexShrink: 0,
            }}
          >
            {formatRelative(fire.fired_at)}
          </div>
        </div>
        {summary && (
          <div style={{ color: 'var(--ink-dim)', fontSize: 12.5, marginTop: 4, lineHeight: 1.4 }}>
            {summary}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 8,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
          }}
        >
          {!compact && ruleType && <span>{ruleType.replace('_', ' ')}</span>}
          {okCount > 0 && (
            <span style={{ color: 'var(--teal)' }}>● {okCount} delivered</span>
          )}
          {failCount > 0 && (
            <span style={{ color: 'var(--amber)' }}>● {failCount} suppressed</span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--ink-dim)' }}>
            {expanded ? '▾ Hide details' : '▸ Show details'}
          </span>
        </div>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid var(--rule-soft)',
            fontSize: 12.5,
            color: 'var(--ink-dim)',
            lineHeight: 1.55,
          }}
        >
          {rationale && (
            <div style={{ marginBottom: 10 }}>
              <span style={{ color: 'var(--teal)' }}>AI rationale: </span>
              {rationale}
            </div>
          )}
          {detailLines.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-faint)',
                  marginBottom: 4,
                }}
              >
                Event detail
              </div>
              {detailLines.slice(0, 8).map((line, i) => (
                <div key={i} style={{ marginBottom: 2, fontSize: 12 }}>
                  · {line}
                </div>
              ))}
            </div>
          )}
          {Object.keys(channels).length > 0 && (
            <div>
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-faint)',
                  marginBottom: 4,
                }}
              >
                Delivery
              </div>
              {Object.entries(channels).map(([channelId, status]) => (
                <div key={channelId} style={{ marginBottom: 2, fontSize: 12 }}>
                  · {status?.ok ? '✓' : '✗'} {status?.provider ?? 'unknown'}
                  {status?.suppressed_reason && (
                    <span style={{ color: 'var(--amber)' }}> · {status.suppressed_reason}</span>
                  )}
                  {!status?.ok && status?.error && (
                    <span style={{ color: 'var(--red)' }}> · {status.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {fire.payload?.cap_state && (
            <div
              style={{
                marginTop: 8,
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.14em',
                color: 'var(--ink-faint)',
              }}
            >
              Cap state: {fire.payload.cap_state.monthly_sms_wa_count ?? 0} SMS/WA this month
              {fire.payload.cap_state.soft_warn_triggered && ' · soft-warn band'}
              {fire.payload.cap_state.warning_email_sent && ' · warned'}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

function windowLabel(hours: number): string {
  if (hours <= 24) return '24 hours';
  const d = Math.round(hours / 24);
  return `${d} days`;
}
