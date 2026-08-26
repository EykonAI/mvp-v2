'use client';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { usePersona } from '@/components/intel/shell/PersonaContext';
import Sparkline from '@/components/intel/shared/Sparkline';
import IllustrativeBadge from '@/components/intel/shared/IllustrativeBadge';

// Live inputs (grounding audit P1): chokepoint transits + EIA inventory
// from /api/intel/commodities/live. Per-commodity market inputs
// (grounding P2b): prices / export shares / computed sanction bands /
// heuristic 72h ribbon from /api/intel/commodities/markets. Sections
// render an honest "unavailable" state when a feed is missing — never
// fixture numbers.
interface LiveChokepoint {
  chokepoint: string;
  label: string;
  // Coverage state (2026-08-09): when no_data is true the corridor has
  // not been observed for days_since days — latest_* then carries the
  // LAST OBSERVED look and delta_pct is withheld by the server.
  no_data: boolean;
  days_since: number;
  latest_count: number;
  latest_period: string;
  window_hours: number;
  trailing_avg: number | null;
  delta_pct: number | null;
}
interface LiveEia {
  series_id: string;
  unit: string;
  latest: { period: string; value: number };
  prev: { period: string; value: number } | null;
  weekly_delta_pct: number | null;
  series: number[];
  fetched_at: string;
}
interface LiveData {
  chokepoints: LiveChokepoint[] | null;
  eia: LiveEia | null;
}

// /api/intel/commodities/markets?commodity=<slug> — per-commodity payload
interface MarketPrices {
  source: string;
  unit: string;
  cadence: 'daily' | 'monthly';
  series: number[];
  latest: { period: string; value: number };
}
// PR 2 shape (lib/intel/commodities/markets.ts): export shares carry
// their layer (comtrade | seed | production) + source + basis so the
// panel can always name what the reader is looking at.
interface ExportShares {
  layer: 'comtrade' | 'seed' | 'production';
  period: string;
  source: string;
  basis: string;
  rows: Array<{ reporter: string; share: number; value?: number; unit?: string | null }>;
  notes?: string[];
}
interface SanctionRiskRow {
  country: string;
  band: 'red' | 'amber' | 'green';
  ofac_active_designations: number | null;
  designation_delta_90d: number | null; // measured, never predicted
  fatalities_30d: number | null;
  conflict_events_30d: number | null;
}
interface RibbonData {
  heuristic: true;
  base: number;
  maritime_degraded: boolean;
  maritime_degraded_reason: string | null;
  inputs: { flags_72h: number; weighted_density: number };
  buckets: Array<{ t_plus_h: number; value: number }>;
}
interface FuturesData {
  label: string;
  benchmark_note: string | null;
  unit: string;
  period: string;
  points: Array<{ month: number; price: number }>;
  structure: 'backwardated' | 'contango' | 'flat';
}
interface MarketsData {
  prices: MarketPrices | null;
  volatility_30d: { pct: number; method: string } | null;
  futures: FuturesData | null;
  futures_unavailable: { reason: string; detail: string; last_curve_period: string | null } | null;
  export_shares: ExportShares | null;
  sanction_risk: { computed: boolean; trend_window_days: number; rows: SanctionRiskRow[] } | null;
  ribbon: RibbonData | null;
}
// Panel 07 (PR 2, D4 — designed for the paid AIS tier, degraded today).
interface ShipmentRow {
  mmsi: string;
  vessel_name: string | null;
  flag: string | null;
  cargo_class: string | null;
  laden: 'laden' | 'ballast' | null;
  origin_port: string | null;
  destination: string | null;
  destination_kind: 'declared' | 'inferred' | 'unknown';
  eta: string | null;
  confidence: 'high' | 'medium' | 'low';
  dark_gap_hours: number | null;
}
interface ShipmentsData {
  supported: boolean;
  reason?: string;
  coverage_scope: 'global' | 'chokepoint';
  feed_stale_days: number | null;
  inference_note: string;
  rows: ShipmentRow[];
}

const COMMODITIES = [
  { slug: 'wheat',   label: 'Wheat',        family: 'agri' },
  { slug: 'brent',   label: 'Brent',        family: 'oil' },
  { slug: 'wti',     label: 'WTI',          family: 'oil' },
  { slug: 'ttf',     label: 'TTF Gas',      family: 'gas' },
  { slug: 'cobalt',  label: 'Cobalt',       family: 'mineral' },
  { slug: 'lithium', label: 'Lithium',      family: 'mineral' },
  { slug: 'ree',     label: 'Rare Earths',  family: 'mineral' },
  { slug: 'copper',  label: 'Copper',       family: 'mineral' },
];

export default function CommoditiesWorkspace() {
  const { persona } = usePersona();
  const [selected, setSelected] = useState('wheat');
  const [live, setLive] = useState<LiveData | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [markets, setMarkets] = useState<MarketsData | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [shipments, setShipments] = useState<ShipmentsData | null>(null);
  const [memo, setMemo] = useState<{ text: string; label: string } | null>(null);
  const [memoState, setMemoState] = useState<'idle' | 'drafting' | 'error'>('idle');
  const [memoError, setMemoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/intel/commodities/live')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: LiveData) => {
        if (!cancelled) setLive(data);
      })
      .catch(() => {
        if (!cancelled) setLiveError(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMarketsLoading(true);
    fetch(`/api/intel/commodities/markets?commodity=${selected}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: MarketsData) => {
        if (!cancelled) {
          setMarkets(data);
          setMarketsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMarkets(null);
          setMarketsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    setShipments(null);
    fetch(`/api/intel/commodities/shipments?commodity=${selected}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ShipmentsData) => {
        if (!cancelled) setShipments(data);
      })
      .catch(() => {
        if (!cancelled) setShipments(null);
      });
    return () => { cancelled = true; };
  }, [selected]);

  // Memo drafts are per-commodity; a stale memo for another slug must
  // not linger under the new selection.
  useEffect(() => {
    setMemo(null);
    setMemoState('idle');
    setMemoError(null);
  }, [selected]);

  const draftMemo = async () => {
    setMemoState('drafting');
    setMemoError(null);
    try {
      const res = await fetch('/api/intel/commodities/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commodity: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMemoState('error');
        setMemoError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setMemo({ text: data.memo, label: data.label });
      setMemoState('idle');
    } catch (err) {
      setMemoState('error');
      setMemoError(err instanceof Error ? err.message : 'request failed');
    }
  };

  const isEnergy = ['brent', 'wti', 'ttf'].includes(selected);

  return (
    <div className="flex flex-col" style={{ padding: 16, gap: 14 }}>
      {/* Selector */}
      <div
        className="flex flex-wrap items-center"
        style={{ gap: 6, padding: 12, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}
      >
        <span className="eyebrow" style={{ marginRight: 8 }}>Commodity</span>
        {COMMODITIES.map(c => (
          <button
            key={c.slug}
            onClick={() => setSelected(c.slug)}
            style={{
              padding: '5px 10px',
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              background: selected === c.slug ? 'var(--amber)' : 'var(--bg-raised)',
              color: selected === c.slug ? 'var(--bg-void)' : 'var(--ink-dim)',
              border: `1px solid ${selected === c.slug ? 'var(--amber)' : 'var(--rule)'}`,
              borderRadius: 2,
              cursor: 'pointer',
              fontWeight: selected === c.slug ? 500 : 400,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {persona === 'commodities' || persona === 'day-trader' ? (
        <div
          style={{
            padding: 10,
            background: 'rgba(212, 162, 76, 0.04)',
            borderLeft: '2px solid var(--amber)',
            fontSize: 11.5,
            color: 'var(--ink-dim)',
          }}
        >
          {persona === 'day-trader'
            ? 'Market framing: named instruments with direction + magnitude + horizon. Persona footer on every card.'
            : 'Commodities desk framing: supply-demand balance + chokepoint exposure + disruption risk.'}
        </div>
      ) : null}

      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 1.4fr 1fr',
          gap: 1,
          background: 'var(--rule-soft)',
          border: '1px solid var(--rule-soft)',
        }}
      >
        <Panel title="01 · Production & Export Share" badge={!markets?.export_shares}>
          {markets?.export_shares ? (
            <>
              <div className="flex flex-col" style={{ gap: 4 }}>
                {markets.export_shares.rows.map(d => (
                  <div key={d.reporter} className="flex items-center" style={{ gap: 8 }}>
                    <span style={{ width: 80, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)' }}>
                      {d.reporter}
                    </span>
                    <div style={{ flex: 1, height: 5, background: 'var(--bg-raised)', border: '1px solid var(--rule)' }}>
                      <div style={{ width: `${Math.min(100, d.share * 100)}%`, height: '100%', background: 'var(--amber)' }} />
                    </div>
                    <span className="num-lg" style={{ width: 40, fontSize: 10.5, color: 'var(--ink)', textAlign: 'right' }}>
                      {(d.share * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="eyebrow mt-[8px]" >
                {markets.export_shares.source} · {markets.export_shares.period}
                {markets.export_shares.layer !== 'comtrade' && (
                  // The reader must always know whether this is a live
                  // Comtrade period or a seeded/production vintage (D2).
                  <> · {markets.export_shares.layer === 'seed' ? 'seeded primary source' : 'production share'}</>
                )}
              </div>
              {markets.export_shares.notes?.map(n => (
                <div key={n} className="eyebrow" style={{ marginTop: 2 }}>{n}</div>
              ))}
            </>
          ) : (
            // No sourced trade flows yet (Comtrade ingest may lag its API
            // key) — keep the illustrative stub, clearly badged as such.
            <div className="flex flex-col" style={{ gap: 4 }}>
              {DONUT_STUB.map(d => (
                <div key={d.country} className="flex items-center" style={{ gap: 8 }}>
                  <span style={{ width: 80, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)' }}>
                    {d.country}
                  </span>
                  <div style={{ flex: 1, height: 5, background: 'var(--bg-raised)', border: '1px solid var(--rule)' }}>
                    <div style={{ width: `${d.share * 100}%`, height: '100%', background: 'var(--amber)' }} />
                  </div>
                  <span className="num-lg" style={{ width: 40, fontSize: 10.5, color: 'var(--ink)', textAlign: 'right' }}>
                    {(d.share * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={`02 · Price Volatility & Futures · ${selected.toUpperCase()}`}
          badge={!marketsLoading && !markets?.prices}
        >
          {markets?.prices ? (
            <>
              <Sparkline
                values={markets.prices.series}
                width={420}
                height={120}
                stroke="var(--amber)"
                fill="rgba(212, 162, 76, 0.14)"
              />
              <div className="flex items-baseline justify-between mt-[8px]" >
                <span className="eyebrow">
                  Spot · {markets.prices.series.length} obs ·{' '}
                  {markets.prices.source === 'eia_spot' ? 'EIA daily' : 'IMF PCPS monthly'}
                </span>
                <span className="flex items-baseline" style={{ gap: 8 }}>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)' }}>
                    {markets.prices.latest.period}
                  </span>
                  <span className="num-lg" style={{ fontSize: 18, color: 'var(--amber)' }}>
                    {markets.prices.latest.value.toLocaleString()} {markets.prices.unit}
                  </span>
                </span>
              </div>
              {(markets.futures || markets.volatility_30d) && (
                <div className="flex" style={{ gap: 1, marginTop: 10, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}>
                  {markets.futures?.points.map(p => (
                    <div key={p.month} style={{ flex: 1, padding: '6px 4px', background: 'var(--bg-panel)', textAlign: 'center' }}>
                      <div className="eyebrow" style={{ marginBottom: 2 }}>M{p.month}</div>
                      <div className="num-lg" style={{ fontSize: 12.5, color: 'var(--ink)' }}>{p.price}</div>
                    </div>
                  ))}
                  {markets.volatility_30d && (
                    <div style={{ flex: 1.4, padding: '6px 4px', background: 'var(--bg-panel)', textAlign: 'center' }} title={markets.volatility_30d.method}>
                      <div className="eyebrow" style={{ marginBottom: 2 }}>30d vol</div>
                      <div className="num-lg" style={{ fontSize: 12.5, color: 'var(--amber)' }}>{markets.volatility_30d.pct}%</div>
                    </div>
                  )}
                </div>
              )}
              {markets.futures && (
                <div className="eyebrow" style={{ marginTop: 6 }}>
                  {markets.futures.label} · {markets.futures.structure}
                  {markets.volatility_30d ? ' · vol computed from stored dailies (realized, not implied)' : ''}
                </div>
              )}
              {markets.futures?.benchmark_note && (
                <div className="eyebrow" style={{ marginTop: 2, color: 'var(--amber)' }}>
                  {markets.futures.benchmark_note}
                </div>
              )}
              {!markets.futures && markets.futures_unavailable && (
                <div className="eyebrow" style={{ marginTop: 6, color: 'var(--amber)' }}>
                  No forward curve · {markets.futures_unavailable.detail}
                </div>
              )}
              {!markets.futures && !markets.futures_unavailable && markets.volatility_30d && (
                <div className="eyebrow" style={{ marginTop: 6 }}>
                  30d realized vol from stored dailies · futures for this instrument need a licensed source — not substituted
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">
              {marketsLoading
                ? 'Loading price series…'
                : 'No sourced price series yet — awaiting the commodity_prices ingest for this instrument.'}
            </p>
          )}
        </Panel>

        <Panel title="03 · Chokepoint Transits · 24h">
          {!liveError && live?.chokepoints?.length ? (
            <>
              <div className="eyebrow mb-[8px]" >
                {live.chokepoints[0].latest_period}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
                {live.chokepoints.map(cp => (
                  <li
                    key={cp.chokepoint}
                    className="flex items-center justify-between"
                    style={{ gap: 8, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}
                  >
                    <span className="text-eykon-ink-dim">{cp.label}</span>
                    {cp.no_data ? (
                      // Uncovered corridor: the feed has not delivered a
                      // look for days_since days. NO DATA is the honest
                      // state — never 0, never a delta (absence of an
                      // observation is not a result).
                      <span style={{ fontSize: 10.5, color: 'var(--ink-dim)', letterSpacing: '0.08em' }}>
                        NO DATA · {cp.days_since}d
                      </span>
                    ) : (
                      <span className="flex items-baseline" style={{ gap: 8 }}>
                        {cp.delta_pct != null && (
                          <span
                            style={{
                              fontSize: 9.5,
                              color:
                                Math.abs(cp.delta_pct) >= 25
                                  ? 'var(--red)'
                                  : Math.abs(cp.delta_pct) >= 10
                                    ? 'var(--amber)'
                                    : 'var(--ink-dim)',
                            }}
                          >
                            {cp.delta_pct >= 0 ? '+' : '−'}{Math.abs(cp.delta_pct)}% vs 14d avg
                          </span>
                        )}
                        <span className="num-lg" style={{ fontSize: 14, color: 'var(--amber)' }}>
                          {cp.latest_count}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {live.chokepoints.some(cp => cp.no_data) && (
                <p style={{ marginTop: 8, marginBottom: 0, fontSize: 10, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                  Last observed{' '}
                  {live.chokepoints
                    .filter(cp => cp.no_data)
                    .map(cp => `${cp.label} ${cp.latest_count} (${cp.latest_period})`)
                    .join(' · ')}
                  <br />
                  free-tier AIS · ingest-sensitive · baseline covered days only
                </p>
              )}
            </>
          ) : (
            <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">
              {!liveError && live === null ? 'Loading live transit feed…' : 'Live transit feed unavailable'}
            </p>
          )}
        </Panel>

        <Panel title="04 · Top Exporters & Sanction Risk">
          {markets?.sanction_risk?.rows.length ? (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
                {markets.sanction_risk.rows.map(r => (
                  <li
                    key={r.country}
                    className="flex items-center justify-between"
                    style={{ gap: 8, padding: '5px 0', borderBottom: '1px solid var(--rule-soft)' }}
                  >
                    <span style={{ color: 'var(--ink)' }}>{r.country}</span>
                    <span className="flex items-center" style={{ gap: 8 }}>
                      <span style={{ fontSize: 9.5, color: 'var(--ink-dim)' }}>
                        {r.ofac_active_designations != null
                          ? `${r.ofac_active_designations.toLocaleString()} OFAC`
                          : 'OFAC n/a'}
                        {r.designation_delta_90d != null && r.designation_delta_90d !== 0 && (
                          <span style={{ color: r.designation_delta_90d > 0 ? 'var(--red)' : 'var(--green)' }}>
                            {' '}{r.designation_delta_90d > 0 ? '▲ +' : '▼ −'}{Math.abs(r.designation_delta_90d)} / 90d
                          </span>
                        )}
                        {r.fatalities_30d != null && r.fatalities_30d > 0
                          ? ` · ${r.fatalities_30d.toLocaleString()} fatal/30d`
                          : ''}
                      </span>
                      <span
                        style={{
                          padding: '1px 6px',
                          background: r.band === 'red' ? 'var(--red)' : r.band === 'amber' ? 'var(--amber)' : 'var(--green)',
                          color: 'var(--bg-void)',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          fontSize: 9.5,
                        }}
                      >
                        {r.band}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: 8, fontSize: 10, color: 'var(--ink-dim)', lineHeight: 1.5 }}>
                Computed from OFAC designations + 30d conflict reporting — not an asserted rating.
                Trend = measured Δ over {markets.sanction_risk.trend_window_days}d of designation history — computed, never predicted.
              </p>
            </>
          ) : (
            <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">
              {marketsLoading ? 'Computing risk bands…' : 'Risk bands unavailable — OFAC and conflict feeds could not be read.'}
            </p>
          )}
        </Panel>

        <Panel
          title="05 · Trade-Flow Horizon · 72h"
          span={2}
          tag={markets?.ribbon ? { label: 'HEURISTIC', title: 'Computed from live anomaly densities — not a forecast model' } : undefined}
        >
          {markets?.ribbon ? (
            <>
              {markets.ribbon.maritime_degraded && (
                // The heuristic inherits its inputs' instrument problems:
                // a dead AIS feed silently deflates the Maritime density,
                // so the panel says so instead of understating risk quietly.
                <p
                  style={{
                    margin: '0 0 6px',
                    fontSize: 10,
                    color: 'var(--red)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                  title={markets.ribbon.maritime_degraded_reason ?? undefined}
                >
                  Maritime degraded — {markets.ribbon.maritime_degraded_reason}
                </p>
              )}
              <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">
                HEURISTIC · live anomaly densities · 72h — severity- and recency-weighted Maritime + Energy
                anomaly flags ({markets.ribbon.inputs.flags_72h} in window), decayed over the next three days.
              </p>
              <div className="flex" style={{ gap: 1, marginTop: 10, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)' }}>
                {markets.ribbon.buckets.map(b => (
                  <div
                    key={b.t_plus_h}
                    style={{
                      flex: 1,
                      padding: 8,
                      background: 'var(--bg-panel)',
                      color: 'var(--ink)',
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10.5,
                      borderBottom: `3px solid ${b.value >= 0.5 ? 'var(--red)' : b.value >= 0.3 ? 'var(--amber)' : 'var(--green)'}`,
                      textAlign: 'center',
                    }}
                  >
                    <div className="eyebrow" style={{ marginBottom: 4 }}>T+{b.t_plus_h}h</div>
                    <div className="num-lg" style={{ fontSize: 14 }}>{(b.value * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">
              {marketsLoading ? 'Loading anomaly densities…' : 'Anomaly density feed unavailable — no ribbon rendered.'}
            </p>
          )}
        </Panel>

        {isEnergy && (
          <Panel title="06 · Cushing Crude Stocks · EIA weekly">
            {!liveError && live?.eia ? (
              <>
                <Sparkline values={live.eia.series} width={420} height={120} stroke="var(--amber)" fill="rgba(212, 162, 76, 0.14)" />
                <div className="flex items-baseline justify-between mt-[8px]" >
                  <span className="eyebrow">Week of {live.eia.latest.period}</span>
                  <span className="flex items-baseline" style={{ gap: 8 }}>
                    {live.eia.weekly_delta_pct != null && (
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--amber)' }}>
                        {live.eia.weekly_delta_pct >= 0 ? '+' : '−'}{Math.abs(live.eia.weekly_delta_pct)}% w/w
                      </span>
                    )}
                    <span className="num-lg" style={{ fontSize: 18, color: 'var(--amber)' }}>
                      {live.eia.latest.value.toLocaleString()} MBBL
                    </span>
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">
                {!liveError && live === null ? 'Loading EIA inventory feed…' : 'EIA inventory feed unavailable'}
              </p>
            )}
          </Panel>
        )}

        {/* Panel 07 — designed for the paid AIS tier, running degraded
            on free (D4). Same table either way: the paid provider only
            fills the columns the free tier cannot (class, laden, ETA). */}
        <Panel
          title="07 · Commodity Shipments · AIS-inferred"
          span={3}
          tag={
            shipments?.supported
              ? {
                  label: shipments.feed_stale_days ? `CHOKEPOINT SCOPE · FEED STALE ${shipments.feed_stale_days}d` : 'CHOKEPOINT SCOPE',
                  title: shipments.inference_note,
                }
              : undefined
          }
        >
          {!shipments ? (
            <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">Loading shipments…</p>
          ) : !shipments.supported ? (
            <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">{shipments.reason}</p>
          ) : shipments.rows.length === 0 ? (
            <p className="text-[12px] leading-[1.5] text-eykon-ink-dim">
              No inferred shipments in the current window
              {shipments.feed_stale_days ? ` — AIS feed stale ${shipments.feed_stale_days}d, derivation frozen at the last covered day.` : '.'}
            </p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--f-mono)', fontSize: 10.5 }}>
                <thead>
                  <tr>
                    {['Vessel', 'Class', 'Laden', 'Flag', 'From', 'Destination', 'Conf'].map(h => (
                      <th
                        key={h}
                        style={{
                          textAlign: h === 'Conf' ? 'right' : 'left',
                          padding: '4px 6px',
                          color: 'var(--ink-dim)',
                          fontSize: 8.5,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          fontWeight: 400,
                          borderBottom: '1px solid var(--rule-soft)',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shipments.rows.slice(0, 6).map(r => (
                    <tr key={r.mmsi}>
                      <td style={{ padding: '5px 6px', color: 'var(--ink)', borderBottom: '1px solid var(--rule-soft)' }}>
                        {r.vessel_name ?? r.mmsi}
                      </td>
                      {/* "—" is the honest free-tier value: static data absent, not zero. */}
                      <td style={{ padding: '5px 6px', color: 'var(--ink-dim)', borderBottom: '1px solid var(--rule-soft)' }}>
                        {r.cargo_class ?? '—'}
                      </td>
                      <td style={{ padding: '5px 6px', color: r.laden === 'laden' ? 'var(--green)' : 'var(--ink-dim)', borderBottom: '1px solid var(--rule-soft)' }}>
                        {r.laden ? (r.laden === 'laden' ? '▲ laden' : '▽ ballast') : '—'}
                      </td>
                      <td style={{ padding: '5px 6px', color: 'var(--ink-dim)', borderBottom: '1px solid var(--rule-soft)' }}>
                        {r.flag ?? '—'}
                      </td>
                      <td style={{ padding: '5px 6px', color: 'var(--ink-dim)', borderBottom: '1px solid var(--rule-soft)' }}>
                        {r.origin_port ?? '—'}
                      </td>
                      <td style={{ padding: '5px 6px', color: r.dark_gap_hours ? 'var(--red)' : 'var(--ink-dim)', borderBottom: '1px solid var(--rule-soft)' }}>
                        {r.dark_gap_hours
                          ? `unknown · dark gap ${Math.round(r.dark_gap_hours)}h`
                          : r.destination
                            ? `${r.destination} (${r.destination_kind === 'declared' ? 'decl' : 'inf'})`
                            : 'unknown'}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', borderBottom: '1px solid var(--rule-soft)' }}>
                        <span
                          style={{
                            padding: '1px 6px',
                            fontSize: 8.5,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            background: r.confidence === 'high' ? 'var(--green)' : 'var(--bg-raised)',
                            color: r.confidence === 'high' ? 'var(--bg-void)' : 'var(--amber)',
                            border: r.confidence === 'high' ? 'none' : '1px solid var(--rule)',
                          }}
                        >
                          {r.confidence}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ marginTop: 8, marginBottom: 0, fontSize: 10, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                {shipments.inference_note} Class and laden state fill in with the paid AIS tier — “—” means the free tier has no static data, not that the value is zero.
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* Footer actions — grounded (PR 2, D5). Export/compliance are
          deterministic downloads of the panel payloads; the memo is
          the one labeled-LLM feature, wallet-debited server-side. */}
      <div
        className="flex items-center flex-wrap"
        style={{ gap: 8, padding: 10, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}
      >
        <a href={`/api/intel/commodities/export?commodity=${selected}&format=pdf`} style={{ textDecoration: 'none' }}>
          <Button variant="eykonToolbar" size="eykonToolbar">◆ Export PDF</Button>
        </a>
        <a href={`/api/intel/commodities/export?commodity=${selected}&format=json`} style={{ textDecoration: 'none' }}>
          <Button variant="eykonToolbar" size="eykonToolbar">Export JSON</Button>
        </a>
        <span className="eyebrow" style={{ fontSize: 8 }}>live payload snapshot</span>
        <Button variant="eykonToolbar" size="eykonToolbar" onClick={draftMemo} disabled={memoState === 'drafting'}>
          {memoState === 'drafting'
            ? 'Drafting…'
            : `Draft ${persona === 'day-trader' ? 'trade memo' : persona === 'journalist' ? 'lead brief' : 'commodities memo'}`}
        </Button>
        <span className="eyebrow" style={{ fontSize: 8 }}>analyst engine · Pro</span>
        <a href={`/api/intel/commodities/compliance?commodity=${selected}`} style={{ textDecoration: 'none' }}>
          <Button variant="eykonToolbar" size="eykonToolbar">Compliance review</Button>
        </a>
        <span className="eyebrow" style={{ fontSize: 8 }}>deterministic OFAC snapshot · no LLM</span>
      </div>

      {memoState === 'error' && memoError && (
        <div style={{ padding: 10, background: 'rgba(228, 105, 92, 0.06)', borderLeft: '2px solid var(--red)', fontSize: 11.5, color: 'var(--ink-dim)' }}>
          Memo unavailable: {memoError}
        </div>
      )}

      {memo && (
        <div style={{ padding: 14, background: 'var(--bg-navy)', border: '1px solid var(--rule-soft)' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8, gap: 8 }}>
            <span className="eyebrow">{memo.label}</span>
            <span className="flex" style={{ gap: 6 }}>
              <Button variant="eykonToolbar" size="eykonToolbar" onClick={() => navigator.clipboard?.writeText(memo.text)}>Copy</Button>
              <Button variant="eykonToolbar" size="eykonToolbar" onClick={() => setMemo(null)}>Dismiss</Button>
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{memo.text}</div>
        </div>
      )}
    </div>
  );
}

// Illustrative fallback for Panel 01 only — shown badged until the
// Comtrade trade-flow ingest delivers real export shares.
const DONUT_STUB = [
  { country: 'Russia',    share: 0.18 },
  { country: 'USA',       share: 0.14 },
  { country: 'Canada',    share: 0.11 },
  { country: 'Australia', share: 0.10 },
  { country: 'Ukraine',   share: 0.08 },
  { country: 'France',    share: 0.06 },
];

function Panel({
  title,
  children,
  span = 1,
  badge = false,
  tag,
}: {
  title: string;
  children: React.ReactNode;
  span?: number;
  badge?: boolean;
  tag?: { label: string; title?: string };
}) {
  return (
    <section
      style={{
        gridColumn: span === 2 ? 'span 2' : span === 3 ? 'span 3' : undefined,
        background: 'var(--bg-navy)',
        padding: 14,
      }}
    >
      <h3 className="panel-title" style={{ marginBottom: 10 }}>
        <span className="idx">{title.split(' · ')[0]}</span>
        {title.split(' · ').slice(1).join(' · ')}
        {badge && (
          <span style={{ marginLeft: 8 }}>
            <IllustrativeBadge title="Fixture data — not a live feed" />
          </span>
        )}
        {tag && (
          <span style={{ marginLeft: 8 }}>
            <IllustrativeBadge label={tag.label} title={tag.title} />
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

const footerBtn: React.CSSProperties = {
  padding: '6px 10px',
  fontFamily: 'var(--f-mono)',
  fontSize: 10.5,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  border: '1px solid var(--rule)',
  borderRadius: 2,
  cursor: 'pointer',
};
