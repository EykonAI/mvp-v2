'use client';

import { useState, type CSSProperties } from 'react';
import { canonicalPredictionString } from '@/lib/predictions/canonical';

/**
 * In-browser hash verifier for a published forecast.
 *
 * Rebuilds the canonical string from the fields rendered on the page and
 * hashes it with Web Crypto — the same formula the server used at issue
 * (lib/predictions/canonical.ts, shared module, cannot drift). A reader
 * clicks once and sees MATCH or MISMATCH; no trust in eYKON required,
 * which is the point.
 *
 * Deliberately client-side: verification through an eYKON API would ask
 * the reader to trust the thing being verified. The browser computes it.
 */

type Verdict = 'idle' | 'match' | 'mismatch' | 'unsupported';

interface Props {
  statement: string;
  targetObservable: string;
  resolvesAt: string;
  issuedAt: string;
  predictedMean: number | null;
  hash: string;
}

const mono: CSSProperties = { fontFamily: 'var(--f-mono)' };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function HashVerifier(props: Props) {
  const [verdict, setVerdict] = useState<Verdict>('idle');
  const [showForm, setShowForm] = useState(false);

  async function verify() {
    if (!globalThis.crypto?.subtle) {
      setVerdict('unsupported');
      return;
    }
    const canonical = canonicalPredictionString({
      statement: props.statement,
      targetObservable: props.targetObservable,
      resolvesAt: props.resolvesAt,
      issuedAt: props.issuedAt,
      predictedMean: props.predictedMean,
    });
    const recomputed = await sha256Hex(canonical);
    setVerdict(recomputed === props.hash.toLowerCase() ? 'match' : 'mismatch');
  }

  return (
    <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)', borderRadius: 3 }}>
      <div style={{ ...mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
        Hashed at issue · SHA-256
      </div>
      <div style={{ ...mono, fontSize: 10.5, color: 'var(--ink)', wordBreak: 'break-all', margin: '6px 0 10px' }}>
        {props.hash}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={verify}
          style={{ ...mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--teal)', background: 'none', border: '1px solid var(--teal)', borderRadius: 3, padding: '5px 12px', cursor: 'pointer' }}
        >
          Recompute in your browser
        </button>
        {verdict === 'match' && (
          <span style={{ ...mono, fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--teal)' }}>
            ✓ MATCH — this call has not been edited since issue
          </span>
        )}
        {verdict === 'mismatch' && (
          <span style={{ ...mono, fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--red, #e05d50)' }}>
            ✕ MISMATCH — the displayed fields do not produce this hash
          </span>
        )}
        {verdict === 'unsupported' && (
          <span style={{ ...mono, fontSize: 10.5, color: 'var(--ink-dim)' }}>
            Web Crypto unavailable in this browser
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          style={{ ...mono, fontSize: 10, color: 'var(--ink-dim)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
        >
          {showForm ? 'hide the formula' : 'what is being hashed?'}
        </button>
      </div>

      {showForm && (
        <div style={{ ...mono, fontSize: 10, color: 'var(--ink-dim)', lineHeight: 1.7, marginTop: 10 }}>
          SHA-256 over: statement + target_observable + resolves_at (ISO-8601 UTC, ms) + issued_at (ISO-8601 UTC, ms) + forecast mean — concatenated, no separator. All five fields are on this page; the computation runs in your browser, not on our server.
        </div>
      )}

      <div style={{ ...mono, fontSize: 9.5, color: 'var(--ink-faint)', lineHeight: 1.6, marginTop: 10 }}>
        A matching hash proves this call was not edited after publication. It cannot prove the issue time was not backdated — external anchoring of daily hashes is on the roadmap. We state the limit rather than imply more than the math gives.
      </div>
    </div>
  );
}
