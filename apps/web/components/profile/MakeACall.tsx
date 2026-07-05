'use client';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

// Owner-only "make a call" form (Reputation Engine A3b). Pick an open
// Polymarket market + outcome, state your probability; the call is
// recorded as a public, auto-scored prediction. Brier-skill is measured
// against the crowd price shown here.

interface Market {
  market_id: string;
  question: string;
  outcomes: string[];
  prices: Record<string, number>;
}

export function MakeACall() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [marketId, setMarketId] = useState('');
  const [outcome, setOutcome] = useState('');
  const [prob, setProb] = useState(50);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setOpen(true);
    if (markets) return;
    setLoading(true);
    try {
      const res = await fetch('/api/comm/markets');
      const json = (await res.json().catch(() => ({}))) as { markets?: Market[] };
      setMarkets(Array.isArray(json.markets) ? json.markets : []);
    } catch {
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }

  // First Ten prefill (?call=<market_id> — set by FirstTenPanel links).
  // Read via window.location rather than useSearchParams so this client
  // component needs no Suspense boundary. Runs once on mount.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('call');
    if (id) {
      setMarketId(id);
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const market = markets?.find((m) => m.market_id === marketId) ?? null;
  const baseline = market && outcome ? market.prices[outcome] : undefined;

  async function submit() {
    if (!marketId || !outcome || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/comm/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market_id: marketId, outcome, probability: prob / 100 }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error === 'already_called' ? 'You already called this market.' : 'Could not record the call.' });
      } else {
        setMsg({ ok: true, text: 'Call recorded — it scores when the market resolves.' });
        setMarketId('');
        setOutcome('');
        setProb(50);
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: 'Network error — try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={load} style={primaryBtn}>
        + Make a call
      </button>
    );
  }

  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: 16, marginBottom: 16, background: 'var(--bg-panel)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="eyebrow" style={{ color: 'var(--teal)' }}>Make a call · Polymarket</span>
        <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 14 }}>
          ✕
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-dim)', fontSize: 12 }}>Loading open markets…</div>
      ) : (
        <>
          <label style={lbl}>Market</label>
          <select
            value={marketId}
            onChange={(e) => {
              setMarketId(e.target.value);
              setOutcome('');
            }}
            style={box}
          >
            <option value="">Select an open market…</option>
            {(markets ?? []).map((m) => (
              <option key={m.market_id} value={m.market_id}>
                {m.question.length > 90 ? `${m.question.slice(0, 90)}…` : m.question}
              </option>
            ))}
          </select>

          {market && (
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Outcome</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {market.outcomes.map((o) => (
                  <button key={o} onClick={() => setOutcome(o)} style={{ ...chip, ...(outcome === o ? chipActive : {}) }}>
                    {o}
                    {market.prices[o] != null ? ` · ${Math.round(market.prices[o] * 100)}%` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {outcome && (
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>
                Your probability: <span style={{ color: 'var(--teal)' }}>{prob}%</span>
                {baseline != null ? <span style={{ color: 'var(--ink-faint)' }}> · crowd {Math.round(baseline * 100)}%</span> : null}
              </label>
              <input type="range" min={1} max={99} value={prob} onChange={(e) => setProb(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <button onClick={submit} disabled={!marketId || !outcome || busy} style={{ ...primaryBtn, opacity: !marketId || !outcome || busy ? 0.5 : 1 }}>
              {busy ? 'Recording…' : 'Record call'}
            </button>
            {msg && <span style={{ fontSize: 12, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</span>}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
            Calls are public and auto-scored against the market’s resolution — your Brier-skill is measured vs the crowd price at call time.
          </p>
        </>
      )}
    </div>
  );
}

const primaryBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal-dim)',
  borderRadius: 3,
  padding: '8px 16px',
  cursor: 'pointer',
};
const lbl: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-dim)',
  marginBottom: 6,
};
const box: CSSProperties = {
  width: '100%',
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 13,
};
const chip: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  padding: '6px 12px',
  borderRadius: 4,
  border: '1px solid var(--rule)',
  background: 'var(--bg-void)',
  color: 'var(--ink-dim)',
  cursor: 'pointer',
};
const chipActive: CSSProperties = {
  borderColor: 'var(--teal)',
  color: 'var(--teal)',
  background: 'var(--teal-glow)',
};
