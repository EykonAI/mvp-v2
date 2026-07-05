'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminPartnerRow } from './page';

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--teal)',
  warned: 'var(--amber)',
  gated: 'var(--amber)',
  graduated: 'var(--ink-faint)',
};

const btn: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
  padding: '6px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid var(--rule)',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
};

export default function PartnerAdmin({
  partners,
  capReached,
}: {
  partners: AdminPartnerRow[];
  capReached: boolean;
}) {
  const router = useRouter();
  const [lookup, setLookup] = useState('');
  const [vetting, setVetting] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    setError(null);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
    router.refresh();
  }

  async function grant() {
    setBusy('grant');
    try {
      await post('/api/admin/partners', { lookup: lookup.trim(), vetting_note: vetting.trim() || undefined });
      setLookup('');
      setVetting('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'grant failed');
    } finally {
      setBusy(null);
    }
  }

  async function action(userId: string, act: string) {
    setBusy(`${act}:${userId}`);
    try {
      await post(`/api/admin/partners/${userId}`, { action: act });
    } catch (e) {
      setError(e instanceof Error ? e.message : `${act} failed`);
    } finally {
      setBusy(null);
    }
  }

  const daysLeft = (deadline: string) =>
    Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* grant form */}
      <div style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: '14px 16px', background: 'var(--bg-panel)' }}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 10 }}>
          Grant a slot
        </div>
        {capReached ? (
          <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: 0 }}>
            All 20 slots are granted — the cap is a public promise.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={lookup}
              onChange={e => setLookup(e.target.value)}
              placeholder="@handle or email"
              style={{ flex: 1, minWidth: 180, fontFamily: 'var(--f-mono)', fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--rule)', background: 'var(--bg-raised)', color: 'var(--ink)' }}
            />
            <input
              value={vetting}
              onChange={e => setVetting(e.target.value)}
              placeholder="vetting note (tone / reach / credibility)"
              style={{ flex: 2, minWidth: 220, fontFamily: 'var(--f-mono)', fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--rule)', background: 'var(--bg-raised)', color: 'var(--ink)' }}
            />
            <button onClick={grant} disabled={busy !== null || !lookup.trim()} style={{ ...btn, border: '1px solid var(--teal)', background: 'var(--teal-deep)' }}>
              {busy === 'grant' ? '…' : 'Grant partner + Creator Pro'}
            </button>
          </div>
        )}
        {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--amber)' }}>{error}</div>}
      </div>

      {/* partner list */}
      {partners.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>
          No partners yet. First grant recommended: your own creator account, to exercise the full path.
        </div>
      ) : (
        partners.map(p => {
          const d = daysLeft(p.note_deadline);
          return (
            <div key={p.user_id} style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: '12px 16px', background: 'var(--bg-panel)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 14 }}>
                  <strong>{p.name}</strong>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: STATUS_COLOR[p.status] ?? 'var(--ink-faint)', marginLeft: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {p.status}{p.extended_once ? ' · extended' : ''}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
                  {p.n_resolved}/10 resolved ·{' '}
                  {p.status === 'graduated' ? 'Note live' : d >= 0 ? `${d}d to deadline` : `${-d}d past deadline`}
                </div>
              </div>
              {p.vetting_note && (
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 4 }}>{p.vetting_note}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {(p.status === 'active' || p.status === 'warned') && (
                  <button onClick={() => action(p.user_id, 'gate')} disabled={busy !== null} style={btn}>
                    Gate now
                  </button>
                )}
                {(p.status === 'warned' || p.status === 'gated') && !p.extended_once && (
                  <button onClick={() => action(p.user_id, 'extend')} disabled={busy !== null} style={btn}>
                    Extend +3 months (once)
                  </button>
                )}
                {p.status !== 'graduated' && (
                  <button
                    onClick={() => {
                      if (confirm(`Revoke ${p.name} for cause? This deletes the partnership and its bundled Creator Pro grant.`)) {
                        void action(p.user_id, 'revoke');
                      }
                    }}
                    disabled={busy !== null}
                    style={{ ...btn, color: 'var(--ink-faint)', background: 'transparent' }}
                  >
                    Revoke for cause
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
