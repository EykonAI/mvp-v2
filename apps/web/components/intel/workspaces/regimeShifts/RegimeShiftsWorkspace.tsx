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
  /**
   * True for signals riding a best-effort stream (free-tier AIS) whose
   * daily counts confound ingest throughput with real activity. They
   * display fully but never flag a SHIFT or drive the headline — the
   * reader enforces the exclusion; this flag drives the disclosure tag.
   */
  ingest_sensitive?: boolean;
  /** One entry per calendar day, oldest first — drives the persistence strip. */
  history?: Array<{ d: string; p: number | null; test: string }>;
  old_window?: WindowStats;
  new_window?: WindowStats;
}

interface Bbox { lat_min: number; lat_max: number; lon_min: number; lon_max: number }

interface Region {
  region: string;
  label: string;
  bbox?: Bbox | null;
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

/** Single-letter column heads for the shift matrix. */
const SIGNAL_INITIAL: Record<string, string> = {
  vessel_count: 'V',
  flight_count: 'F',
  acled_events: 'C',
  thermal_detections: 'T',
  nightlights_radiance: 'N',
};

/** Two-letter theatre codes for the matrix rows. */
function theatreCode(slug: string): string {
  const parts = slug.split('-').filter(w => !['of', 'the', 'strait'].includes(w));
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return slug.slice(0, 2).toUpperCase();
}

/**
 * Why a signal is ingest-sensitive, in the row itself — "ingest-sensitive"
 * alone tells a reader the number is discounted but not why, and the two
 * causes are opposite: the AIS feed degraded, the ADS-B feed grew.
 */
const INGEST_NOTE: Record<string, string> = {
  vessel_count: 'free-tier AIS · ingest-sensitive',
  flight_count: 'ADS-B coverage growing · ingest-sensitive',
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
        <ShiftMatrix
          regions={data.regions}
          selectedRegion={active?.region ?? null}
          selectedSignal={activeSignal?.signal ?? null}
          onPick={(region, signal) => { setSelected(region); setSelectedSignal(signal); }}
        />

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
            <PersistenceStrip signals={active.signals} />
            <HandOff region={active} signal={activeSignal} />
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
        <EcdfInset signal={activeSignal} />
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
        {s.ingest_sensitive && (
          <Tag>{INGEST_NOTE[s.signal] ?? 'ingest-sensitive'}</Tag>
        )}
        {s.p_value !== null && s.p_value < 0.01 && !s.ingest_sensitive && (
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
      <Sparkline signal={s} />
    </button>
  );
}

/**
 * 90-day shape of the signal's daily values, in the row itself: grey
 * preceding window, amber trailing — the same encoding as the big
 * Timeline, so no new visual language.
 *
 * Absent, never faked, when the row has no daily arrays (legacy rows)
 * or is thin. A sparkline is a claim like any other pixel here.
 */
function Sparkline({ signal: s }: { signal: Signal }) {
  const od = s.old_window?.daily ?? [];
  const nd = s.new_window?.daily ?? [];
  if (s.thin || od.length === 0 || nd.length === 0) return null;

  const all = [...od, ...nd];
  const vmax = Math.max(...all.map(p => p.v)) || 1;
  const W = 200;
  const H = 14;
  const bw = W / all.length;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 4 }} aria-hidden>
      {all.map((p, i) => (
        <rect
          key={p.d + i}
          x={i * bw}
          y={H - (p.v / vmax) * H}
          width={Math.max(bw - 0.4, 0.5)}
          height={(p.v / vmax) * H}
          fill={i < od.length ? 'var(--ink-faint)' : 'var(--amber)'}
          opacity={0.8}
        />
      ))}
    </svg>
  );
}

/**
 * ① Shift matrix — every theatre × every signal, one glance.
 *
 * The workspace otherwise forces serial clicking through theatres to
 * answer "what shifted anywhere tonight?". Cell states inherit the
 * payload's honesty markers exactly: only attribution-eligible shifts
 * are red, thin/no-data is hollow, and the ingest-sensitive column is
 * permanently demoted regardless of its p.
 */
function ShiftMatrix({
  regions, selectedRegion, selectedSignal, onPick,
}: {
  regions: Region[];
  selectedRegion: string | null;
  selectedSignal: string | null;
  onPick: (region: string, signal: string) => void;
}) {
  if (regions.length === 0) return null;
  const signalOrder = regions[0].signals.map(s => s.signal);

  return (
    <div style={{ marginTop: 14 }}>
      <Head accent="var(--amber)">All theatres × signals</Head>
      <table style={{ borderCollapse: 'separate', borderSpacing: 3, marginTop: 8 }}>
        <thead>
          <tr>
            <th />
            {signalOrder.map(sig => (
              <th
                key={sig}
                title={prettySignal(sig)}
                style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-faint)', fontWeight: 400 }}
              >
                {SIGNAL_INITIAL[sig] ?? sig[0].toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {regions.map(r => (
            <tr key={r.region}>
              <td
                title={r.label}
                style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-faint)', paddingRight: 2 }}
              >
                {theatreCode(r.region)}
              </td>
              {signalOrder.map(sig => {
                const s = r.signals.find(x => x.signal === sig);
                const isSel = selectedRegion === r.region && selectedSignal === sig;
                const shifted = !!s && s.p_value !== null && s.p_value < 0.01 && !s.ingest_sensitive;
                const style: React.CSSProperties = {
                  width: 15, height: 15, padding: 0, cursor: 'pointer',
                  outline: isSel ? '1px solid var(--amber)' : 'none',
                  outlineOffset: 1,
                };
                if (!s || s.thin) {
                  Object.assign(style, { background: 'transparent', border: '1px dashed var(--rule-soft)' });
                } else if (s.ingest_sensitive) {
                  Object.assign(style, { background: 'transparent', border: '1px solid var(--rule-soft)' });
                } else if (shifted) {
                  Object.assign(style, { background: 'var(--red)', border: '1px solid var(--red)' });
                } else {
                  Object.assign(style, { background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' });
                }
                const state = !s ? 'no data'
                  : s.thin ? 'thin — not scored'
                  : s.ingest_sensitive ? 'ingest-sensitive — never attributes'
                  : shifted ? `shift · p=${s.p_value?.toFixed(4)}`
                  : `quiet · p=${s.p_value?.toFixed(2)}`;
                return (
                  <td key={sig} style={{ padding: 0 }}>
                    <button
                      onClick={() => onPick(r.region, sig)}
                      title={`${r.label} · ${prettySignal(sig)} — ${state}`}
                      aria-label={`${r.label} ${prettySignal(sig)} ${state}`}
                      style={style}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 8, fontFamily: 'var(--f-mono)', fontSize: 9, lineHeight: 1.6, color: 'var(--ink-faint)' }}>
        filled red = shift · filled = quiet · dashed = thin/no data · outlined = ingest-sensitive
      </p>
    </div>
  );
}

/**
 * ② Persistence strip — the nightly p per signal over the last runs.
 *
 * Answers the question the multiple-comparisons footer raises: a flag
 * that has held for several consecutive nights is different evidence
 * from one that appeared tonight. Nights scored under the pre-2026-08-04
 * z-test render hollow rather than colored — showing the method change
 * honestly instead of implying continuity.
 */
function PersistenceStrip({ signals }: { signals: Signal[] }) {
  const any = signals.some(s => (s.history?.length ?? 0) > 0);
  if (!any) return null;
  const width = Math.max(...signals.map(s => s.history?.length ?? 0));

  return (
    <div style={{ border: '1px solid var(--rule-soft)', background: 'var(--bg-panel)', padding: 12, marginTop: 8 }}>
      <div className="eyebrow" style={{ marginBottom: 8, color: 'var(--ink-faint)' }}>
        Nightly p per signal · last {width} runs · hollow = pre-KS or thin
      </div>
      <div className="flex flex-col" style={{ gap: 4 }}>
        {signals.map(s => {
          const h = s.history ?? [];
          // Consecutive shift nights, counting back from the newest.
          let held = 0;
          for (let i = h.length - 1; i >= 0; i--) {
            if (h[i].test === 'ks' && h[i].p !== null && (h[i].p as number) < 0.01) held++;
            else break;
          }
          return (
            <div key={s.signal} className="flex items-center" style={{ gap: 6, fontFamily: 'var(--f-mono)', fontSize: 10 }}>
              <span style={{ width: 62, color: 'var(--ink-faint)' }}>{SIGNAL_SHORT[s.signal] ?? s.signal}</span>
              <span className="flex" style={{ gap: 3 }}>
                {h.map(n => {
                  const legacy = n.test !== 'ks';
                  const thin = n.p === null;
                  const shift = !legacy && !thin && (n.p as number) < 0.01 && !s.ingest_sensitive;
                  const st: React.CSSProperties = { width: 11, height: 11, display: 'inline-block' };
                  if (legacy || thin || s.ingest_sensitive) {
                    Object.assign(st, { background: 'transparent', border: `1px ${legacy || thin ? 'dashed' : 'solid'} var(--rule-soft)` });
                  } else if (shift) {
                    Object.assign(st, { background: 'var(--red)' });
                  } else {
                    Object.assign(st, { background: 'var(--rule-soft)' });
                  }
                  const label = legacy ? 'pre-KS run' : thin ? 'thin — not scored' : `p=${(n.p as number).toFixed(4)}`;
                  return <i key={n.d} title={`${n.d} · ${label}`} style={st} />;
                })}
              </span>
              {s.ingest_sensitive ? (
                <span style={{ color: 'var(--ink-faint)' }}>never attributes</span>
              ) : held >= 2 ? (
                <span style={{ color: 'var(--amber)' }}>held {held} nights</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ③ Evidence hand-off — the detector stops being a cul-de-sac.
 *
 * The convergence count is computed client-side over the LATEST N
 * events (the convergences API has no bbox filter) and the label says
 * so — "2 of latest 25" is a checkable claim; a bare "2" would imply
 * an exhaustive search that did not happen. The Globe button the
 * design sketched was dropped: the globe takes no URL parameters, and
 * inventing one is out of scope for this workspace.
 */
function HandOff({ region, signal }: { region: Region; signal: Signal | undefined }) {
  const [conv, setConv] = useState<{ hits: number; scanned: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const bbox = region.bbox;
    if (!bbox) { setConv(null); return; }
    fetch('/api/intel/convergences?latest=25')
      .then(r => r.json())
      .then((j: { events?: Array<{ bounding_box?: Bbox }> }) => {
        if (!alive) return;
        const events = j.events ?? [];
        const hits = events.filter(e => {
          const b = e.bounding_box;
          if (!b) return false;
          return b.lat_min <= bbox.lat_max && b.lat_max >= bbox.lat_min
            && b.lon_min <= bbox.lon_max && b.lon_max >= bbox.lon_min;
        }).length;
        setConv({ hits, scanned: events.length });
      })
      .catch(() => { if (alive) setConv(null); });
    return () => { alive = false; };
  }, [region.region, region.bbox]);

  const q = signal && signal.old_window && signal.new_window && !signal.thin
    ? `Explain the regime shift in ${region.label}: ${prettySignal(signal.signal)} moved from ${fmtMean(signal.old_window.mean)} to ${fmtMean(signal.new_window.mean)}${SIGNAL_UNIT[signal.signal] ?? ''} (KS p = ${signal.p_value}). What plausibly drives it? Use live data.`
    : `What is currently driving activity in ${region.label}? Use live data.`;

  const linkStyle: React.CSSProperties = {
    fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)',
    border: '1px solid var(--rule-soft)', padding: '5px 10px', textDecoration: 'none',
  };

  return (
    <div className="flex items-center" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      <a href="/briefs/convergence" style={linkStyle}>
        convergences{conv ? ` · ${conv.hits} of latest ${conv.scanned} here` : ''} →
      </a>
      <a href={`/analyst?q=${encodeURIComponent(q)}`} style={linkStyle}>
        ask AI Analyst →
      </a>
    </div>
  );
}

/**
 * ⑤ ECDF inset — the two empirical CDFs with the D gap marked, i.e.
 * literally what the KS statistic measures. KS rows with real windows
 * only; anything else renders nothing rather than a decorative curve.
 */
function EcdfInset({ signal: s }: { signal: Signal | undefined }) {
  const od = s?.old_window?.daily ?? [];
  const nd = s?.new_window?.daily ?? [];
  if (!s || s.test !== 'ks' || s.thin || od.length < 8 || nd.length < 8) return null;

  const a = od.map(p => p.v).sort((x, y) => x - y);
  const b = nd.map(p => p.v).sort((x, y) => x - y);
  const lo = Math.min(a[0], b[0]);
  const hi = Math.max(a[a.length - 1], b[b.length - 1]);
  const span = hi - lo || 1;
  const W = 280, H = 96, PAD = 6;
  const x = (v: number) => PAD + ((v - lo) / span) * (W - 2 * PAD);
  const y = (f: number) => H - PAD - f * (H - 2 * PAD);
  const ecdf = (arr: number[], v: number) => arr.filter(z => z <= v).length / arr.length;

  const path = (arr: number[]) => {
    const pts: string[] = [`${PAD},${y(0)}`];
    for (const v of arr) { pts.push(`${x(v)},${y(ecdf(arr, v) - 1 / arr.length)}`); pts.push(`${x(v)},${y(ecdf(arr, v))}`); }
    pts.push(`${W - PAD},${y(1)}`);
    return pts.join(' ');
  };

  // Where the two ECDFs are furthest apart — the D the test reports.
  let dv = lo, d = 0;
  for (const v of [...a, ...b]) {
    const gap = Math.abs(ecdf(a, v) - ecdf(b, v));
    if (gap > d) { d = gap; dv = v; }
  }

  return (
    <div style={{ border: '1px solid var(--rule-soft)', background: 'var(--bg-panel)', padding: 12, marginTop: 10 }}>
      <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--ink-faint)' }}>
        What KS measures · D = {d.toFixed(2)}
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <polyline points={path(a)} fill="none" stroke="var(--ink-faint)" strokeWidth={1.5} />
        <polyline points={path(b)} fill="none" stroke="var(--amber)" strokeWidth={1.5} />
        <line x1={x(dv)} y1={y(ecdf(a, dv))} x2={x(dv)} y2={y(ecdf(b, dv))} stroke="var(--red)" strokeWidth={1.5} strokeDasharray="3 2" />
      </svg>
      <p style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-faint)', margin: 0 }}>
        grey = preceding 60d · amber = trailing 30d · red = largest gap
      </p>
    </div>
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
