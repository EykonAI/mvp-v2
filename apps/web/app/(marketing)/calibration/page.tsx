import type { Metadata } from 'next';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Calibration Ledger — eYKON.ai',
  description:
    'Every prediction eYKON publishes, with its issue timestamp, audit hash, and resolution. Verifiable. Public. No backfilling.',
  alternates: { canonical: 'https://eykon.ai/calibration' },
  openGraph: {
    title: 'Calibration Ledger — eYKON.ai',
    description:
      'Every prediction eYKON publishes — issued, hashed, resolved. The public audit trail.',
    type: 'website',
    url: 'https://eykon.ai/calibration',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Calibration Ledger — eYKON.ai',
    description:
      'Every prediction eYKON publishes — issued, hashed, resolved. The public audit trail.',
  },
};

const NAIVE_BRIER_BASELINE = 0.25;
const AGGREGATE_MIN_N = 30;

interface ResolvedRow {
  id: string;
  public_id: string;
  statement: string;
  source: string;
  hash: string;
  issued_at: string;
  resolves_at: string;
  predicted_mean: number;
  observed_value: number;
  observed_at: string;
  brier: number;
  resolution_source_url: string | null;
}

interface CalibrationPageData {
  recent: ResolvedRow[];
  aggregate: {
    n: number;
    avg_brier: number | null;
    delta_vs_naive: number | null;
  };
  error: string | null;
}

async function loadCalibrationData(): Promise<CalibrationPageData> {
  try {
    const supabase = createServerSupabase();

    const { data: rows, error: rowsErr } = await supabase
      .from('prediction_outcomes')
      .select(
        'prediction_id, observed_value, observed_at, brier, resolution_source_url, predictions_register!inner(id, public_id, statement, source, hash, issued_at, resolves_at, predicted_distribution)',
      )
      .order('observed_at', { ascending: false })
      .limit(20);

    if (rowsErr) throw new Error(rowsErr.message);

    const recent: ResolvedRow[] = ((rows ?? []) as unknown as RawJoinedRow[])
      .map((r) => normaliseJoinedRow(r))
      .filter((r): r is ResolvedRow => r !== null);

    const { data: allBriers, error: aggErr } = await supabase
      .from('prediction_outcomes')
      .select('brier')
      .not('brier', 'is', null)
      .limit(5000);

    if (aggErr) throw new Error(aggErr.message);

    const values = (allBriers ?? [])
      .map((r) => Number((r as { brier?: number }).brier))
      .filter((x) => Number.isFinite(x));

    const n = values.length;
    const avgBrier = n > 0 ? values.reduce((a, b) => a + b, 0) / n : null;
    const deltaVsNaive =
      avgBrier != null && n >= AGGREGATE_MIN_N
        ? NAIVE_BRIER_BASELINE - avgBrier
        : null;

    return {
      recent,
      aggregate: { n, avg_brier: avgBrier, delta_vs_naive: deltaVsNaive },
      error: null,
    };
  } catch (err) {
    return {
      recent: [],
      aggregate: { n: 0, avg_brier: null, delta_vs_naive: null },
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

interface RawJoinedRow {
  observed_value: number | string | null;
  observed_at: string;
  brier: number | string | null;
  resolution_source_url: string | null;
  predictions_register:
    | {
        id: string;
        public_id: string;
        statement: string;
        source: string;
        hash: string;
        issued_at: string;
        resolves_at: string;
        predicted_distribution: { mean?: number | string } | null;
      }
    | Array<{
        id: string;
        public_id: string;
        statement: string;
        source: string;
        hash: string;
        issued_at: string;
        resolves_at: string;
        predicted_distribution: { mean?: number | string } | null;
      }>;
}

function normaliseJoinedRow(r: RawJoinedRow): ResolvedRow | null {
  const pr = Array.isArray(r.predictions_register)
    ? r.predictions_register[0]
    : r.predictions_register;
  if (!pr) return null;
  const observed = Number(r.observed_value);
  const brier = Number(r.brier);
  const predicted = Number(pr.predicted_distribution?.mean);
  if (!Number.isFinite(observed) || !Number.isFinite(brier)) return null;
  return {
    id: pr.id,
    public_id: pr.public_id,
    statement: pr.statement,
    source: pr.source,
    hash: pr.hash,
    issued_at: pr.issued_at,
    resolves_at: pr.resolves_at,
    predicted_mean: Number.isFinite(predicted) ? predicted : 0,
    observed_value: observed,
    observed_at: r.observed_at,
    brier,
    resolution_source_url: r.resolution_source_url ?? null,
  };
}

export default async function PublicCalibrationPage() {
  const data = await loadCalibrationData();

  return (
    <main
      style={{
        background: 'var(--bg)',
        color: 'var(--ink)',
        minHeight: '100vh',
        padding: '64px 24px 96px',
      }}
    >
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <PageHeader />
        <AggregateStrip aggregate={data.aggregate} />
        <FeedSection rows={data.recent} error={data.error} />
        <HowItWorks />
        <Footer />
      </div>
    </main>
  );
}

function PageHeader() {
  return (
    <header style={{ marginBottom: 40 }}>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 10,
        }}
      >
        Epistemic anchor · Public audit trail
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 36,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          margin: '0 0 16px',
          color: 'var(--ink)',
        }}
      >
        Calibration Ledger
      </h1>
      <p
        style={{
          fontSize: 16,
          lineHeight: 1.55,
          color: 'var(--ink-dim)',
          maxWidth: 720,
          margin: 0,
        }}
      >
        Every prediction eYKON publishes is timestamped, hashed at issue, and resolved
        against the source it points at. Nothing is edited after the fact. Wrong calls
        stay published.
      </p>
    </header>
  );
}

function AggregateStrip({
  aggregate,
}: {
  aggregate: CalibrationPageData['aggregate'];
}) {
  const { n, avg_brier, delta_vs_naive } = aggregate;
  const ready = avg_brier != null && n >= AGGREGATE_MIN_N;

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '20px 24px',
        marginBottom: 32,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 24,
      }}
    >
      <Stat
        label="Resolved predictions"
        value={n > 0 ? String(n) : '—'}
        hint={n === 0 ? 'awaiting first resolutions' : null}
      />
      <Stat
        label="Aggregate Brier"
        value={ready ? avg_brier!.toFixed(3) : '—'}
        hint={
          ready
            ? `lower is better · naive baseline ${NAIVE_BRIER_BASELINE.toFixed(2)}`
            : `available at ${AGGREGATE_MIN_N}+ resolved`
        }
      />
      <Stat
        label="Edge vs naive"
        value={
          ready && delta_vs_naive != null
            ? `${(delta_vs_naive >= 0 ? '+' : '−')}${Math.abs(delta_vs_naive).toFixed(3)}`
            : '—'
        }
        hint={
          ready
            ? delta_vs_naive! >= 0
              ? 'better than always-guess-0.5'
              : 'worse than always-guess-0.5'
            : 'requires ≥30 resolved'
        }
      />
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string | null;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 22,
          color: 'var(--ink)',
          lineHeight: 1.2,
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>{hint}</div>
      )}
    </div>
  );
}

function FeedSection({ rows, error }: { rows: ResolvedRow[]; error: string | null }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          margin: '0 0 16px',
          color: 'var(--ink)',
        }}
      >
        Recent resolutions
      </h2>

      {error && (
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            padding: 16,
            color: 'var(--ink-dim)',
            fontSize: 13,
          }}
        >
          Data layer warming up. Check back in a few minutes.
        </div>
      )}

      {!error && rows.length === 0 && (
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            padding: 24,
            color: 'var(--ink-dim)',
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          No resolutions yet. The first wave of weekly EIA inventory predictions resolves
          on the next EIA publication Wednesday.
        </div>
      )}

      {!error &&
        rows.map((row) => <ResolutionCard key={row.id} row={row} />)}
    </section>
  );
}

function ResolutionCard({ row }: { row: ResolvedRow }) {
  const correct =
    Math.abs(row.predicted_mean - row.observed_value) <
    Math.abs(1 - row.predicted_mean - row.observed_value);

  return (
    <article
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '18px 22px',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          color: 'var(--ink-dim)',
        }}
      >
        <SourceBadge source={row.source} />
        <span>{shortPublicId(row.public_id)}</span>
        <span>·</span>
        <span>issued {formatDate(row.issued_at)}</span>
        <span>·</span>
        <span>resolved {formatDate(row.observed_at)}</span>
      </div>

      <p
        style={{
          fontSize: 15,
          lineHeight: 1.55,
          color: 'var(--ink)',
          margin: '0 0 14px',
        }}
      >
        {row.statement}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 18,
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
        }}
      >
        <Mini label="eYKON" value={row.predicted_mean.toFixed(2)} />
        <Mini label="Observed" value={row.observed_value.toFixed(2)} />
        <Mini label="Brier" value={row.brier.toFixed(3)} />
        <Mini label="Outcome" value={correct ? 'right' : 'wrong'} tone={correct ? 'good' : 'bad'} />
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px dashed var(--rule)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          color: 'var(--ink-dim)',
        }}
      >
        <span style={{ wordBreak: 'break-all' }}>
          sha256 {row.hash.slice(0, 16)}…{row.hash.slice(-8)}
        </span>
        {row.resolution_source_url ? (
          <a
            href={row.resolution_source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--teal)', textDecoration: 'none' }}
          >
            Evidence ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  const color =
    tone === 'good' ? 'var(--teal)' : tone === 'bad' ? 'var(--rust, #c05a3e)' : 'var(--ink)';
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ color, fontSize: 14 }}>{value}</div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
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

function HowItWorks() {
  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 48,
      }}
    >
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 20,
          margin: '0 0 14px',
          color: 'var(--ink)',
        }}
      >
        How this works
      </h2>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 14,
          lineHeight: 1.65,
          color: 'var(--ink-dim)',
        }}
      >
        <li style={{ marginBottom: 8 }}>
          Every prediction is committed to a public Postgres row before its resolution
          window opens. The five issuance fields — statement, target observable,
          resolve-by timestamp, issue timestamp, and predicted probability — are
          concatenated and SHA-256 hashed at insert. The hash is stored on the row.
        </li>
        <li style={{ marginBottom: 8 }}>
          Anyone can recompute the hash from the displayed fields and verify the
          prediction has not been edited. The formula and a reference implementation are
          published at{' '}
          <code
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 13,
              color: 'var(--ink)',
              background: 'var(--bg)',
              padding: '1px 5px',
              borderRadius: 3,
            }}
          >
            apps/web/lib/predictions/hash.ts
          </code>{' '}
          in the public repo.
        </li>
        <li style={{ marginBottom: 8 }}>
          Resolution is automatic. For each source — Polymarket, EIA, OFAC, manual — a
          dedicated resolver reads the underlying public dataset, computes the observed
          outcome, and writes the resulting Brier score. The evidence link on every card
          deep-links to the dataset entry.
        </li>
        <li>
          Wrong predictions stay published with the same prominence as right ones. A
          ledger that only shows wins is not a ledger.
        </li>
      </ul>
    </section>
  );
}

function Footer() {
  return (
    <footer
      style={{
        fontSize: 12,
        color: 'var(--ink-dim)',
        textAlign: 'center',
        paddingTop: 24,
        borderTop: '1px solid var(--rule)',
      }}
    >
      <Link href="/" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
        ← eykon.ai
      </Link>
    </footer>
  );
}

function shortPublicId(id: string): string {
  if (id.length <= 12) return id;
  return id;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
