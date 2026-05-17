import { ImageResponse } from 'next/og';
import { createServerSupabase } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WIDTH = 1200;
const HEIGHT = 630;

const BG = '#0e1414';
const PANEL = '#141c1c';
const INK = '#dbe8e5';
const DIM = '#7a8e8b';
const ACCENT = '#7fc8c1';
const POS = '#7fc8c1';
const NEG = '#c05a3e';

interface CardData {
  statement: string;
  source: string;
  public_id: string;
  hash: string;
  predicted_mean: number;
  observed_value: number | null;
  brier: number | null;
  resolved: boolean;
  polymarket_consensus: number | null;
}

/**
 * Server-side social card PNG for a single prediction.
 *
 * Path: /api/predictions/<public_id>/card.png
 *
 * Renders a 1200×630 PNG suitable for X / LinkedIn previews. Reads
 * the prediction + its outcome via createServerSupabase(); if the
 * public_id is unknown returns 404; if known but unresolved returns
 * the card with a "pending" outcome label so a queued admin preview
 * can still see what will ship.
 *
 * For source='polymarket' predictions, looks up the matching
 * polymarket_markets row and renders the consensus probability next
 * to eYKON's — the killer "we said 64%, Polymarket said 32%, we were
 * right" framing.
 *
 * Cache-Control: public, max-age 1h, s-maxage 1d, swr 1d. Resolved
 * cards never change so the long TTL is safe; unresolved cards can
 * pick up the resolution within the hour-long client cache window.
 */
export async function GET(
  _req: Request,
  ctx: { params: { publicId: string } },
) {
  const publicId = ctx.params.publicId;
  if (!publicId || !/^[A-Za-z0-9_-]{3,64}$/.test(publicId)) {
    return new Response('bad public_id', { status: 400 });
  }

  const data = await loadCardData(publicId);
  if (!data) return new Response('not found', { status: 404 });

  return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          background: BG,
          color: INK,
          padding: 56,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 18,
            color: ACCENT,
            letterSpacing: 4,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ display: 'flex' }}>eYKON · Calibration Ledger</span>
          <span style={{ display: 'flex', color: DIM, letterSpacing: 2 }}>
            {data.source.toUpperCase()}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            fontSize: 38,
            lineHeight: 1.3,
            marginTop: 28,
            color: INK,
          }}
        >
          {clampStatement(data.statement)}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 56,
            marginTop: 24,
            paddingTop: 24,
            borderTop: `1px solid ${PANEL}`,
          }}
        >
          <CardStat label="eYKON" value={`${pct(data.predicted_mean)}%`} />
          {data.polymarket_consensus != null && (
            <CardStat
              label="Polymarket"
              value={`${pct(data.polymarket_consensus)}%`}
            />
          )}
          {data.resolved ? (
            <>
              <CardStat
                label="Observed"
                value={`${pct(data.observed_value ?? 0)}%`}
              />
              <CardStat
                label="Brier"
                value={data.brier != null ? data.brier.toFixed(3) : '—'}
              />
              <CardStat
                label="Outcome"
                value={outcomeLabel(data)}
                tone={isCorrect(data) ? 'pos' : 'neg'}
              />
            </>
          ) : (
            <CardStat label="Status" value="pending" tone="dim" />
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 24,
            fontSize: 14,
            color: DIM,
          }}
        >
          <span style={{ display: 'flex' }}>
            {data.public_id} · sha256 {shortHash(data.hash)}
          </span>
          <span style={{ display: 'flex' }}>verified at eykon.ai/calibration</span>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        'Cache-Control':
          'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
      },
    },
  );
}

function CardStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'dim';
}) {
  const color = tone === 'pos' ? POS : tone === 'neg' ? NEG : tone === 'dim' ? DIM : INK;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span
        style={{
          display: 'flex',
          fontSize: 13,
          color: DIM,
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', fontSize: 32, color }}>{value}</span>
    </div>
  );
}

async function loadCardData(publicId: string): Promise<CardData | null> {
  const supabase = createServerSupabase();
  const { data: row } = await supabase
    .from('predictions_register')
    .select(
      'id, public_id, statement, source, hash, target_observable, predicted_distribution, prediction_outcomes(observed_value, brier)',
    )
    .eq('public_id', publicId)
    .maybeSingle();

  if (!row) return null;
  const outcome = Array.isArray(row.prediction_outcomes)
    ? row.prediction_outcomes[0]
    : row.prediction_outcomes;

  const predictedMean = Number(
    (row.predicted_distribution as Record<string, unknown> | null)?.mean ?? 0,
  );

  let polymarketConsensus: number | null = null;
  if (row.source === 'polymarket' && typeof row.target_observable === 'string') {
    polymarketConsensus = await fetchPolymarketConsensus(
      supabase,
      row.target_observable,
    );
  }

  return {
    statement: String(row.statement ?? ''),
    source: String(row.source ?? 'manual'),
    public_id: String(row.public_id ?? publicId),
    hash: String(row.hash ?? ''),
    predicted_mean: Number.isFinite(predictedMean) ? predictedMean : 0,
    observed_value: outcome ? Number(outcome.observed_value) : null,
    brier: outcome ? Number(outcome.brier) : null,
    resolved: Boolean(outcome),
    polymarket_consensus: polymarketConsensus,
  };
}

async function fetchPolymarketConsensus(
  supabase: ReturnType<typeof createServerSupabase>,
  targetObservable: string,
): Promise<number | null> {
  // polymarket:<market_id>:<outcome>
  if (!targetObservable.startsWith('polymarket:')) return null;
  const rest = targetObservable.slice('polymarket:'.length);
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) return null;
  const marketId = rest.slice(0, colon);
  const outcome = rest.slice(colon + 1);

  const { data: market } = await supabase
    .from('polymarket_markets')
    .select('outcome_prices')
    .eq('market_id', marketId)
    .maybeSingle();

  if (!market) return null;
  const prices = market.outcome_prices as Record<string, number> | null;
  if (!prices || !(outcome in prices)) return null;
  const value = Number(prices[outcome]);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function clampStatement(s: string): string {
  if (s.length <= 240) return s;
  return s.slice(0, 237) + '…';
}

function pct(n: number): string {
  return Math.round(n * 100).toString();
}

function shortHash(h: string): string {
  if (h.length <= 20) return h;
  return `${h.slice(0, 12)}…${h.slice(-6)}`;
}

function isCorrect(d: CardData): boolean {
  if (!d.resolved || d.observed_value == null) return false;
  return (
    Math.abs(d.predicted_mean - d.observed_value) <
    Math.abs(1 - d.predicted_mean - d.observed_value)
  );
}

function outcomeLabel(d: CardData): string {
  if (!d.resolved || d.observed_value == null) return 'pending';
  return isCorrect(d) ? 'right' : 'wrong';
}
