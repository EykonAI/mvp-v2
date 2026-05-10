'use client';
import { useCallback, useEffect, useState } from 'react';

// PR-NF-1 — slide-in drawer that surfaces one rule's fire history.
// Triggered by clicking a row in RulesList. Read-only for now;
// the same drawer is the planned host for an Edit-rule affordance
// in a follow-on PR.
//
// Width: 1/3 of viewport on desktop, full-screen on narrow viewports.
// Newest-first ordering, keyset pagination via the `nextCursor`
// returned by /api/notifications/rules/[id]/fires.

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

export interface DrawerRule {
  id: string;
  name: string;
  rule_type: 'single_event' | 'multi_event' | 'outcome_ai' | 'cross_data_ai';
  active: boolean;
  cooldown_minutes: number;
  channel_ids: string[];
  last_fired_at: string | null;
  created_at: string;
}

interface RuleDetailDrawerProps {
  rule: DrawerRule | null;
  onClose: () => void;
}

const MOBILE_BREAKPOINT_PX = 720;

export function RuleDetailDrawer({ rule, onClose }: RuleDetailDrawerProps) {
  const [fires, setFires] = useState<FireRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Reset state whenever the drawer is summoned for a different rule.
  useEffect(() => {
    if (!rule) {
      setFires(null);
      setError(null);
      setNextCursor(null);
      setExpanded(null);
      return;
    }
    let cancelled = false;
    setFires(null);
    setError(null);
    setExpanded(null);
    fetch(`/api/notifications/rules/${rule.id}/fires?limit=20`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { fires?: FireRow[]; nextCursor?: string | null }) => {
        if (cancelled) return;
        setFires(data.fires ?? []);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'network error');
        setFires([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rule]);

  // ESC closes.
  useEffect(() => {
    if (!rule) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rule, onClose]);

  const loadMore = useCallback(async () => {
    if (!rule || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `/api/notifications/rules/${rule.id}/fires?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
        { cache: 'no-store' },
      );
      if (!r.ok) {
        setError(`Could not load more fires (HTTP ${r.status}).`);
        return;
      }
      const data = (await r.json()) as { fires?: FireRow[]; nextCursor?: string | null };
      setFires(prev => [...(prev ?? []), ...(data.fires ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setLoadingMore(false);
    }
  }, [rule, nextCursor, loadingMore]);

  if (!rule) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Rule details for ${rule.name}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <aside
        style={{
          position: 'relative',
          height: '100%',
          width: 'min(100vw, 33.333vw)',
          minWidth: 'min(100vw, 360px)',
          background: 'var(--bg-base)',
          borderLeft: '1px solid var(--rule-strong)',
          boxShadow: '-12px 0 36px rgba(0, 0, 0, 0.4)',
          overflowY: 'auto',
          padding: '20px 22px 28px',
        }}
        // Stop propagation so clicks inside the panel don't close.
        onClick={e => e.stopPropagation()}
      >
        <Header rule={rule} onClose={onClose} />
        <Meta rule={rule} />

        {error && (
          <div
            style={{
              background: 'rgba(224, 93, 80, 0.1)',
              border: '1px solid rgba(224, 93, 80, 0.4)',
              color: 'var(--red)',
              padding: '8px 12px',
              borderRadius: 4,
              fontSize: 12.5,
              marginTop: 16,
            }}
          >
            {error}
          </div>
        )}

        <SectionLabel>Fires · last 30 days</SectionLabel>

        {fires === null ? (
          <p style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>Loading…</p>
        ) : fires.length === 0 ? (
          <EmptyState createdAt={rule.created_at} />
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {fires.map(fire => (
              <FireRow
                key={fire.id}
                fire={fire}
                expanded={expanded === fire.id}
                onToggle={() => setExpanded(prev => (prev === fire.id ? null : fire.id))}
              />
            ))}
          </ul>
        )}

        {fires && fires.length > 0 && nextCursor && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '8px 12px',
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              background: 'transparent',
              color: loadingMore ? 'var(--ink-faint)' : 'var(--ink-dim)',
              border: '1px solid var(--rule-strong)',
              borderRadius: 2,
              cursor: loadingMore ? 'default' : 'pointer',
            }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </aside>

      {/* Mobile breakpoint — full-screen overlay below 720px. */}
      <style>{`
        @media (max-width: ${MOBILE_BREAKPOINT_PX}px) {
          aside[role="dialog"] { width: 100vw !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function Header({ rule, onClose }: { rule: DrawerRule; onClose: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 6,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            marginBottom: 4,
          }}
        >
          Rule detail
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 500,
            color: 'var(--ink)',
            wordBreak: 'break-word',
          }}
        >
          {rule.name}
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: '1px solid var(--rule-strong)',
          color: 'var(--ink-dim)',
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          cursor: 'pointer',
          padding: '4px 10px',
          borderRadius: 2,
        }}
      >
        ✕
      </button>
    </div>
  );
}

function Meta({ rule }: { rule: DrawerRule }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        paddingTop: 8,
        paddingBottom: 14,
        borderBottom: '1px solid var(--rule-soft)',
      }}
    >
      <span style={{ color: rule.active ? 'var(--teal)' : 'var(--ink-dim)' }}>
        ● {rule.active ? 'active' : 'paused'}
      </span>
      <span>{rule.rule_type.replace('_', ' ')}</span>
      <span>cooldown: {rule.cooldown_minutes}m</span>
      <span>channels: {rule.channel_ids.length}</span>
      <span>created: {new Date(rule.created_at).toLocaleDateString()}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        marginTop: 18,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ createdAt }: { createdAt: string }) {
  return (
    <div
      style={{
        padding: '18px 18px',
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
          marginBottom: 6,
        }}
      >
        No fires yet
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
        This rule has not matched any events since it was created on{' '}
        {new Date(createdAt).toLocaleDateString()}. Once it fires, each event lands here with the
        matching payload and per-channel delivery status.
      </p>
    </div>
  );
}

function FireRow({
  fire,
  expanded,
  onToggle,
}: {
  fire: FireRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = fire.payload?.summary ?? '';
  const rationale = fire.payload?.rationale ?? null;
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
            {formatRelative(fire.fired_at)}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              color: 'var(--ink-faint)',
              letterSpacing: '0.1em',
              flexShrink: 0,
            }}
          >
            {new Date(fire.fired_at).toLocaleString()}
          </div>
        </div>
        {summary && (
          <div style={{ color: 'var(--ink-dim)', fontSize: 12.5, marginTop: 4, lineHeight: 1.4 }}>
            {summary}
          </div>
        )}
      </button>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          marginTop: 8,
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        {okCount > 0 && <span style={{ color: 'var(--teal)' }}>● {okCount} delivered</span>}
        {failCount > 0 && (
          <span style={{ color: 'var(--amber)' }}>● {failCount} suppressed</span>
        )}
        <button
          type="button"
          onClick={onToggle}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            cursor: 'pointer',
          }}
        >
          {expanded ? '▾ Hide details' : '▸ Show details'}
        </button>
      </div>

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
              <SubLabel>Event detail</SubLabel>
              {detailLines.slice(0, 8).map((line, i) => (
                <div key={i} style={{ marginBottom: 2, fontSize: 12 }}>
                  · {line}
                </div>
              ))}
            </div>
          )}
          {Object.keys(channels).length > 0 && (
            <div>
              <SubLabel>Delivery</SubLabel>
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
        </div>
      )}
    </li>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

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
