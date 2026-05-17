'use client';

import { useState } from 'react';

export interface AdminPredictionRow {
  id: string;
  public_id: string;
  statement: string;
  source: string;
  hash: string;
  target_observable: string;
  predicted_mean: number;
  observed_value: number;
  observed_at: string;
  brier: number;
  resolution_source_url: string | null;
  issued_at: string;
  resolves_at: string;
}

const PUBLIC_BASE = 'https://eykon.ai';

export function PredictionsAdminClient({ rows }: { rows: AdminPredictionRow[] }) {
  return (
    <main
      style={{
        padding: '32px 24px',
        maxWidth: 1200,
        margin: '0 auto',
        color: 'var(--ink)',
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 24,
            margin: '0 0 6px',
          }}
        >
          Predictions · Admin queue
        </h1>
        <p style={{ color: 'var(--ink-dim)', margin: 0, fontSize: 13 }}>
          Most-recently-resolved predictions. Use the actions to grab card URLs and X
          thread drafts for the Monday digest.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row) => (
            <AdminRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: 24,
        color: 'var(--ink-dim)',
        fontSize: 14,
      }}
    >
      No resolved predictions yet. The first EIA weekly resolution lands on the next
      Wednesday after the issuer cron fires.
    </div>
  );
}

function AdminRow({ row }: { row: AdminPredictionRow }) {
  const correct =
    Math.abs(row.predicted_mean - row.observed_value) <
    Math.abs(1 - row.predicted_mean - row.observed_value);
  const cardUrl = `${PUBLIC_BASE}/api/predictions/${encodeURIComponent(row.public_id)}/card.png`;
  const publicUrl = `${PUBLIC_BASE}/calibration`;
  const threadTemplate = buildXThreadTemplate(row, cardUrl, publicUrl);

  return (
    <article
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '18px 22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8,
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          color: 'var(--ink-dim)',
        }}
      >
        <SourcePill source={row.source} />
        <span>{row.public_id}</span>
        <span>·</span>
        <span>resolved {formatDate(row.observed_at)}</span>
        <span>·</span>
        <span style={{ color: correct ? 'var(--teal)' : '#c05a3e' }}>
          {correct ? 'right' : 'wrong'}
        </span>
      </div>

      <p
        style={{
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--ink)',
          margin: '0 0 14px',
        }}
      >
        {row.statement}
      </p>

      <div
        style={{
          display: 'flex',
          gap: 24,
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          color: 'var(--ink-dim)',
          marginBottom: 14,
        }}
      >
        <span>eYKON {row.predicted_mean.toFixed(2)}</span>
        <span>obs {row.observed_value.toFixed(2)}</span>
        <span>brier {row.brier.toFixed(3)}</span>
        {row.resolution_source_url && (
          <a
            href={row.resolution_source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--teal)', textDecoration: 'none' }}
          >
            evidence ↗
          </a>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <CopyButton label="Copy card URL" payload={cardUrl} />
        <CopyButton label="Copy X thread" payload={threadTemplate} />
        <a
          href={cardUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12,
            color: 'var(--teal)',
            textDecoration: 'none',
            border: '1px solid var(--rule)',
            padding: '6px 12px',
            borderRadius: 4,
          }}
        >
          Preview card ↗
        </a>
      </div>
    </article>
  );
}

function CopyButton({ label, payload }: { label: string; payload: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12,
        color: copied ? 'var(--teal)' : 'var(--ink)',
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '6px 12px',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {copied ? 'copied ✓' : label}
    </button>
  );
}

function SourcePill({ source }: { source: string }) {
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 3,
        background: 'rgba(127,200,193,0.12)',
        border: '1px solid var(--rule)',
        color: 'var(--teal)',
        textTransform: 'uppercase',
        fontSize: 10,
        letterSpacing: '0.1em',
      }}
    >
      {source}
    </span>
  );
}

function buildXThreadTemplate(
  row: AdminPredictionRow,
  cardUrl: string,
  publicUrl: string,
): string {
  const correct =
    Math.abs(row.predicted_mean - row.observed_value) <
    Math.abs(1 - row.predicted_mean - row.observed_value);
  const verdict = correct ? 'We were right.' : 'We were wrong — and that matters.';
  const eykonPct = Math.round(row.predicted_mean * 100);
  const observedPct = Math.round(row.observed_value * 100);
  const issuedDate = formatDate(row.issued_at);

  return [
    `${issuedDate} we said:`,
    ``,
    `"${row.statement}"`,
    ``,
    `eYKON: ${eykonPct}% · Observed: ${observedPct}% · Brier ${row.brier.toFixed(3)}`,
    ``,
    verdict,
    ``,
    `Card: ${cardUrl}`,
    row.resolution_source_url ? `Evidence: ${row.resolution_source_url}` : '',
    `Hashed at issue. Full audit: ${publicUrl}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}
