'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Status transitions: pending → approved → paid; anything → void.
const NEXT: Record<string, { action: string; label: string }[]> = {
  pending: [
    { action: 'approve', label: 'Approve' },
    { action: 'void', label: 'Void' },
  ],
  approved: [
    { action: 'mark_paid', label: 'Mark paid (USDC sent)' },
    { action: 'void', label: 'Void' },
  ],
  paid: [],
  void: [],
};

export default function BountyActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = NEXT[status] ?? [];
  if (actions.length === 0) return null;

  async function run(action: string) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bounties/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      {actions.map(a => (
        <button
          key={a.action}
          onClick={() => run(a.action)}
          disabled={busy !== null}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.04em',
            padding: '6px 12px',
            borderRadius: 6,
            cursor: busy ? 'wait' : 'pointer',
            border: '1px solid var(--rule)',
            background: a.action === 'void' ? 'transparent' : 'var(--bg-raised)',
            color: a.action === 'void' ? 'var(--ink-faint)' : 'var(--ink)',
          }}
        >
          {busy === a.action ? '…' : a.label}
        </button>
      ))}
      {error && <span style={{ fontSize: 11, color: 'var(--amber)' }}>{error}</span>}
    </div>
  );
}
