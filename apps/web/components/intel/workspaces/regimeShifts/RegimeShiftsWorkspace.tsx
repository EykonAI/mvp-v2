'use client';
import { useEffect, useState } from 'react';

interface DailyPoint { d: string; v: number }

interface WindowStats {
  start: string;
  end: string;
  mean: number;
  std: number;
  count: number;
  daily?: DailyPoint[];
  reason?: string;
  test?: string;
}

interface Signal {
  signal: string;
  effect: number;
  direction: string;
  p_value: number | null;
  test_statistic?: number | null;
  test: string;
  thin: boolean;
  old_window?: WindowStats;
  new_window?: WindowStats;
}

interface Region {
  region: string;
  label: string;
  detected: boolean;
  shifted: string[];
  driving: string | null;
  p_value: number | null;
  test_statistic: number | null;
  old_window: WindowStats | null;
  new_window: WindowStats | null;
  signals: Signal[];
}

interface Payload {
  regions: Region[];
  computed_at?: string | null;
  degraded?: boolean;
  note?: string;
}

/**
 * Signal labels. The two sensor signals carry their caveat inline
 * because the reading is not self-evident from the name:
 *
 *  • a thermal DETECTION is a hot pixel, never a confirmed fire;
 *  • night-lights is a MEAN RADIANCE, not a count, so a downward
 *    effect means the region got DIMMER — the interesting direction —
 *    whereas for the count signals a rise is what draws attention.
 */
const SIGNAL_LABELS: Record<string, string> = {
  vessel_count: 'Vessel traffic',
  flight_count: 'Flight activity',
  acled_events: 'Conflict events',
  thermal_detections: 'Thermal detections · hot pixels',
  nightlights_radiance: 'Night-lights radiance · mean, clear nights',
};

/** Short names for the theatre-list SHIFT attribution chip. */
const SIGNAL_SHORT: Record<string, string> = {
  vessel_count: 'vessel',
  flight_count: 'flight',
  acled_events: 'conflict',
  thermal_detections: 'thermal',
  nightlights_radiance: 'lights',
};

/** Unit shown next to the window means. */
const SIGNAL_UNIT: Record<string, string> = {
  vessel_count: '/day',
  flight_count: '/day',
  acled_events: '/day',
  thermal_detections: '/day',
  nightlights_radiance: ' nW',
};

/**
 * The attention direction per signal: for activity counts a RISE draws
 * the eye; for night-lights radiance a FALL does — dimming is the
 * outage/blackout signature (Kuwait, Az Zour). The notable direction
 * renders red, its opposite green, flat grey.
 */
const ATTENTION_DIR: Record<string, 'up' | 'down'> = {
  vessel_count: 'up',
  flight_count: 'up',
  acled_events: 'up',
  thermal_detections: 'up',
  nightlights_radiance: 'down',
};

function prettySignal(s: string): string {
  return SIGNAL_LABELS[s] ?? s.replaceAll('_', ' ');
}

function fmtMean(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtDate(iso: string | undefined | null): string {
  return iso ? String(iso).slice(0, 10) : '—';
}

export default function RegimeShiftsWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/intel/regime-shifts')
      .then(r => r.json())
      .then((j: Payload) => {
        setData(j);
        const first = j.regions[0];
        setSelected(first?.region ?? null);
        setSelectedSignal(first?.driving ?? first?.signals[0]?.signal ?? null);
      });
  }, []);

  if (!data) {
    return <div style={{ padding: 24 }}><p className="eyebrow">Loading regimes…</p></div>;
  }

  const active = data.regions.find(r => r.region === selected) ?? data.regions[0];
  const activeSignal =
    active?.signals.find(s => s.signal === selectedSignal) ??
    active?.signals.find(s => s.signal === active?.driving) ??
    active?.signals[0];

  function selectRegion(r: Region) {
    setSelected(r.region);
    setSelectedSignal(r.driving ?? r.signals[0]?.signal ?? null);
  }

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '280px 1fr 340px',
        gap: 1,
        background: 'var(--rule-soft)',
        minHeight: 620,
      }}
    >
      <aside style={{ background: 'var(--bg-navy)', padding: 14 }}>
        <Head accent="var(--amber)">Pinned Theatres</Head>
        {data.degraded && (
          <p className="eyebrow" style={{ marginTop: 8, color: 'var(--ink-faint)' }}>
            {data.note ?? 'Illustrative data'}
          </p>
        )}
        <div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
          {data.regions.map(r => (
            <button
              key={r.region}
              onClick={() => selectRegion(r)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                background: selected === r.region ? 'rgba(212, 162, 76, 0.08)' : 'var(--bg-panel)',
                border: `1px solid ${selected === r.region ? 'var(--amber)' : 'var(--rule-soft)'}`,
                color: 'var(--ink)',
                fontFamily: 'var(--f-body)',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>{r.label ?? r.region}</span>
              {r.detected ? (
                <span
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 9,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    background: 'var(--red)',
                    color: 'var(--bg-void)',
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Shift · {r.shifted.map(s => SIGNAL_SHORT[s] ?? s).join(', ')}
                </span>
              ) : (
                <span className="num-lg" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
                  {r.p_value === null ? 'thin' : `p=${r.p_value.toFixed(2)}`}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* 5 signals × N theatres tested nightly: at p<0.01 an occasional
            single-signal flag is EXPECTED, not news. Disclosure beats a
            silently tightened threshold; corroboration is Convergence's job. */}
        <p
          style={{
            marginTop: 14,
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            lineHeight: 1.5,
            color: 'var(--ink-faint)',
          }}
        >
          {data.regions[0]?.signals.length ?? 5} signals × {data.regions.length} theatres tested
          nightly · occasional single-signal flags are expected · cross-sensor corroboration lives
          in Convergence
        </p>
      </aside>

      <section style={{ background: 'var(--bg-navy)', padding: 16 }}>
        {active && (
          <>
            {active.detected && (
              <div
                style={{
                  padding: 10,
                  background: 'rgba(224, 93, 80, 0.08)',
                  borderLeft: '2px solid var(--red)',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  letterSpacing: '0.1em',
                  color: 'var(--red)',
                  textTransform: 'uppercase',
                  marginBottom: 14,
                }}
              >
                Regime shift detected · {activeSignalTest(active)} p ={' '}
                {active.p_value === null ? '—' : active.p_value.toFixed(4)} · driven by{' '}
                {SIGNAL_SHORT[active.driving ?? ''] ?? active.driving}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <Head accent="var(--amber)">
                Trailing 30d vs preceding 60d · {active.label ?? active.region} ·{' '}
                {prettySignal(activeSignal?.signal ?? '')}
              </Head>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>
                {fmtDate(activeSignal?.old_window?.start)} → {fmtDate(activeSignal?.old_window?.end)} vs{' '}
                {fmtDate(activeSignal?.new_window?.start)} → {fmtDate(activeSignal?.new_window?.end)}
                {data.computed_at ? ` · computed ${fmtDate(data.computed_at)}` : ''}
              </span>
            </div>
            <Histograms signal={activeSignal} />
            <Timeline signal={activeSignal} />
          </>
        )}
      </section>

      <aside style={{ background: 'var(--bg-navy)', padding: 14 }}>
        <Head accent="var(--amber)">Per-Signal Shift</Head>
        <div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
          {active?.signals.map(s => (
            <SignalRow
              key={s.signal}
              s={s}
              selected={activeSignal?.signal === s.signal}
              onSelect={() => setSelectedSignal(s.signal)}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}

function activeSignalTest(r: Region): string {
  const driving = r.signals.find(s => s.signal === r.driving);
  return driving?.test === 'ks' ? 'KS' : '';
}

function SignalRow({ s, selected, onSelect }: { s: Signal; selected: boolean; onSelect: () => void }) {
  const unit = SIGNAL_UNIT[s.signal] ?? '';
  const attention = ATTENTION_DIR[s.signal] ?? 'up';
  const arrowColor =
    s.direction === 'flat'
      ? 'var(--ink-faint)'
      : s.direction === attention
        ? 'var(--red)'
        : 'var(--green)';
  const oldMean = s.old_window?.mean;
  const newMean = s.new_window?.mean;
  // AIS is chokepoint-only: a theatre outside the sampled polygons has
  // structurally zero rows. Two all-zero windows are "no coverage",
  // never a measured flat regime.
  const noCoverage =
    s.signal !== 'nightlights_radiance' && oldMean === 0 && newMean === 0;

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '7px 8px',
        background: selected ? 'rgba(212, 162, 76, 0.08)' : 'var(--bg-panel)',
        border: `1px solid ${selected ? 'var(--amber)' : 'var(--rule-soft)'}`,
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        color: 'var(--ink)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span className="flex items-center" style={{ gap: 6, width: '100%' }}>
        <span style={{ flex: 1, color: 'var(--ink-dim)', fontSize: 10.5 }}>{prettySignal(s.signal)}</span>
        {s.signal === 'nightlights_radiance' && (
          <Tag>lags ~9d (NASA)</Tag>
        )}
        {s.p_value !== null && s.p_value < 0.01 && (
          <span
            style={{
              fontSize: 8.5,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              background: 'var(--red)',
              color: 'var(--bg-void)',
              padding: '0px 5px',
            }}
          >
            Shift
          </span>
        )}
      </span>
      {noCoverage ? (
        <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>no data in window</span>
      ) : s.thin ? (
        <span className="flex items-center" style={{ gap: 6 }}>
          <Tag>
            thin · {s.old_window?.count ?? 0}/{s.new_window?.count ?? 0} d
          </Tag>
          <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>
            {fmtMean(oldMean)} → {fmtMean(newMean)}{unit}
          </span>
        </span>
      ) : (
        <span className="flex items-center" style={{ gap: 8 }}>
          <span style={{ color: arrowColor }}>
            {s.direction === 'up' ? '▲' : s.direction === 'down' ? '▼' : '→'}
          </span>
          <span className="num-lg" style={{ fontSize: 11 }}>
            {s.effect >= 0 ? '+' : ''}
            {s.effect.toFixed(1)}σ
          </span>
          <span style={{ color: 'var(--ink-dim)', fontSize: 10.5 }}>
            {fmtMean(oldMean)} → {fmtMean(newMean)}{unit}
          </span>
          {s.p_value !== null && (
            <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)', fontSize: 9.5 }}>
              p={s.p_value >= 0.995 ? '1.0' : s.p_value.toFixed(s.p_value < 0.01 ? 4 : 2)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 8.5,
        letterSpacing: '0.06em',
        color: 'var(--ink-faint)',
        border: '1px solid var(--rule-soft)',
        padding: '0px 4px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/**
 * REAL histograms — binned from the daily arrays the cron persists,
 * over shared bin edges and a shared y-scale, which is what a KS test
 * actually compares. Rows written before the 2026-08 uplift carry no
 * daily arrays; they get the fallback line, never a synthetic curve.
 */
function Histograms({ signal }: { signal: Signal | undefined }) {
  const od = signal?.old_window?.daily;
  const nd = signal?.new_window?.daily;

  if (!od?.length || !nd?.length) {
    return (
      <div
        style={{
          border: '1px solid var(--rule-soft)',
          background: 'var(--bg-panel)',
          padding: 24,
          marginTop: 8,
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          color: 'var(--ink-faint)',
        }}
      >
        Distribution detail available from the next nightly run.
      </div>
    );
  }

  const all = [...od, ...nd].map(p => p.v);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const BINS = 11;
  const width = (max - min) / BINS || 1;
  const binOf = (v: number) => Math.min(BINS - 1, Math.floor((v - min) / width));
  const h1 = new Array(BINS).fill(0);
  const h2 = new Array(BINS).fill(0);
  for (const p of od) h1[binOf(p.v)]++;
  for (const p of nd) h2[binOf(p.v)]++;
  // Compare SHAPES, not sample sizes: 60 old days vs 30 new days would
  // otherwise make the old histogram look uniformly taller.
  const f1 = h1.map(c => c / od.length);
  const f2 = h2.map(c => c / nd.length);
  const ymax = Math.max(...f1, ...f2) || 1;
  const fmtEdge = (v: number) => (max >= 100 ? String(Math.round(v)) : v.toFixed(1));

  const panels = [
    { label: `Preceding 60d · n=${od.length} days · μ=${fmtMean(signal?.old_window?.mean)}`, h: f1, colour: 'var(--ink-faint)' },
    { label: `Trailing 30d · n=${nd.length} days · μ=${fmtMean(signal?.new_window?.mean)}`, h: f2, colour: 'var(--amber)' },
  ];

  const BW = 14;
  const W = BINS * BW + 8;

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-soft)', border: '1px solid var(--rule-soft)', marginTop: 8 }}
    >
      {panels.map(({ label, h, colour }, idx) => (
        <div key={idx} style={{ background: 'var(--bg-panel)', padding: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 10, color: idx === 0 ? 'var(--ink-faint)' : 'var(--amber)' }}>
            {label}
          </div>
          <svg width="100%" height={156} viewBox={`0 0 ${W} 156`} aria-hidden>
            {h.map((v, i) => (
              <rect
                key={i}
                x={4 + i * BW}
                y={140 - (v / ymax) * 120 - 4}
                width={BW - 4}
                height={(v / ymax) * 120}
                fill={colour}
                opacity={0.85}
              />
            ))}
            {[0, Math.floor(BINS / 2), BINS - 1].map(i => (
              <text
                key={i}
                x={4 + i * BW + (BW - 4) / 2}
                y={152}
                fontSize={8}
                fill="var(--ink-faint)"
                textAnchor="middle"
                fontFamily="var(--f-mono)"
              >
                {fmtEdge(min + i * width)}
              </text>
            ))}
          </svg>
        </div>
      ))}
    </div>
  );
}

/**
 * 90-day strip of the actual daily values across both windows with a
 * marker at the window boundary — the histograms show THAT the
 * distribution moved; this shows WHEN.
 */
function Timeline({ signal }: { signal: Signal | undefined }) {
  const od = signal?.old_window?.daily ?? [];
  const nd = signal?.new_window?.daily ?? [];
  if (!od.length || !nd.length) return null;

  const all = [...od, ...nd];
  const vmax = Math.max(...all.map(p => p.v)) || 1;
  const n = all.length;
  const W = 640;
  const H = 64;
  const bw = W / n;
  const boundary = od.length * bw;

  return (
    <div style={{ border: '1px solid var(--rule-soft)', background: 'var(--bg-panel)', padding: 12, marginTop: 8 }}>
      <div className="eyebrow" style={{ marginBottom: 8, color: 'var(--ink-faint)' }}>
        Daily values · {all[0]?.d} → {all[n - 1]?.d}
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {all.map((p, i) => (
          <rect
            key={p.d + i}
            x={i * bw}
            y={H - 6 - (p.v / vmax) * (H - 12)}
            width={Math.max(bw - 0.6, 0.6)}
            height={(p.v / vmax) * (H - 12)}
            fill={i < od.length ? 'var(--ink-faint)' : 'var(--amber)'}
            opacity={0.85}
          />
        ))}
        <line x1={boundary} y1={0} x2={boundary} y2={H} stroke="var(--red)" strokeWidth={1} strokeDasharray="3 2" />
      </svg>
    </div>
  );
}

function Head({ children, accent = 'var(--teal)' }: { children: React.ReactNode; accent?: string }) {
  return (
    <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 12, background: accent }} />
      {children}
    </h3>
  );
}
