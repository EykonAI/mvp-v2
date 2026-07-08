'use client';
import { useEffect, useState } from 'react';
import IllustrativeBadge from '@/components/intel/shared/IllustrativeBadge';

interface Data {
  groups: Array<{
    slug: string;
    label: string;
    minerals: Array<{ slug: string; label: string; china_refining_share: number | null; risk_band: string | null }>;
  }>;
  refining_dominance: Array<{ mineral: string; share: number; year?: number }> | null;
  mines: Array<{
    mineral: string;
    name: string;
    country: string;
    owner: string | null;
    tonnage_pct: number | null;
    status: string | null;
    source_url?: string | null;
    as_of?: string | null;
    notes?: string | null;
  }> | null;
  supply_risk_index: Array<{
    mineral: string;
    slug?: string;
    band: string;
    hhi?: number;
    top_refiner?: string | null;
    top_refining_share?: number;
  }> | null;
  in_transit: Array<{
    vessel_name: string;
    flag: string | null;
    mineral: string;
    origin_port: string | null;
    origin_country: string | null;
    dest_hint: string | null;
    dwt: number | null;
    inferred_from: 'destination' | 'destination+port_call';
    last_seen: string;
  }> | null;
  in_transit_source?: string;
  tiles: Array<{
    aoi_kind: 'mine' | 'port';
    aoi_ref: string;
    mineral: string;
    acquisition_date: string;
    image_url: string;
    index_name: string;
    index_mean: number | null;
    prev_mean: number | null;
    change_pct: number | null;
  }> | null;
}

export default function MineralsWorkspace() {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState('cobalt');

  useEffect(() => {
    fetch('/api/intel/minerals/overview')
      .then(r => r.json())
      .then((j: Data) => setData(j));
  }, []);

  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <p className="eyebrow">Loading minerals overview…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ padding: 16, gap: 14 }}>
      <div
        className="flex flex-wrap items-center"
        style={{ gap: 16, padding: 12, background: 'var(--bg-panel)', border: '1px solid var(--rule-soft)' }}
      >
        {data.groups.map(g => (
          <div key={g.slug} className="flex items-center" style={{ gap: 8 }}>
            <span className="eyebrow" style={{ color: 'var(--violet)' }}>{g.label}</span>
            {g.minerals.map(m => (
              <button
                key={m.slug}
                onClick={() => setSelected(m.slug)}
                style={{
                  padding: '5px 10px',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10.5,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  background: selected === m.slug ? 'var(--violet)' : 'var(--bg-raised)',
                  color: selected === m.slug ? 'var(--bg-void)' : 'var(--ink-dim)',
                  border: `1px solid ${selected === m.slug ? 'var(--violet)' : 'var(--rule)'}`,
                  borderRadius: 2,
                  cursor: 'pointer',
                  fontWeight: selected === m.slug ? 500 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: '2fr 1.3fr 1.3fr',
          gap: 1,
          background: 'var(--rule-soft)',
          border: '1px solid var(--rule-soft)',
        }}
      >
        <Panel title="01 · Mine Tonnage" source="Curated · operator reports / USGS MCS 2026 · annual">
          {data.mines === null ? (
            <Unavailable />
          ) : (
            <table style={{ width: '100%', fontFamily: 'var(--f-mono)', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Mine</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Owner</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>%</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.mines
                  .filter(m => m.mineral === selected)
                  .map((m, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--rule-soft)' }} title={m.notes ?? undefined}>
                      <td style={{ padding: '6px 4px', color: 'var(--ink)' }}>
                        {m.name} <span style={{ color: 'var(--ink-faint)' }}>· {m.country}</span>
                      </td>
                      <td style={{ padding: '6px 4px', color: 'var(--ink-dim)' }}>{m.owner ?? '—'}</td>
                      <td style={{ padding: '6px 4px', color: 'var(--ink)', textAlign: 'right' }}>
                        {m.tonnage_pct === null ? '—' : `${(m.tonnage_pct * 100).toFixed(0)}%`}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        <StatusBadge status={m.status ?? 'unknown'} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="02 · China Refining" source="IEA Global Critical Minerals Outlook 2025 · 2024 shares">
          {data.refining_dominance === null ? (
            <Unavailable />
          ) : (
            <div className="flex flex-col" style={{ gap: 6 }}>
              {data.refining_dominance.map(r => (
                <div key={r.mineral} className="flex items-center" style={{ gap: 10 }}>
                  <span style={{ width: 40, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)' }}>{r.mineral}</span>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-raised)', border: '1px solid var(--rule)' }}>
                    <div style={{ width: `${r.share * 100}%`, height: '100%', background: r.share >= 0.7 ? 'var(--red)' : r.share >= 0.5 ? 'var(--amber)' : 'var(--green)' }} />
                  </div>
                  <span className="num-lg" style={{ width: 40, fontSize: 11, color: 'var(--ink)', textAlign: 'right' }}>
                    {(r.share * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="03 · Supply Risk Index" source="Computed · USGS MCS 2026 + IEA GCMO 2025">
          {data.supply_risk_index === null ? (
            <Unavailable />
          ) : (
            <div className="flex flex-col" style={{ gap: 4 }}>
              {data.supply_risk_index.map(r => {
                const active = (r.slug ?? r.mineral.toLowerCase()) === selected;
                return (
                  <div
                    key={r.mineral}
                    style={{
                      padding: '5px 8px',
                      background: active ? 'rgba(139, 127, 216, 0.08)' : 'var(--bg-panel)',
                      border: `1px solid ${active ? 'var(--violet)' : 'var(--rule-soft)'}`,
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--ink-dim)' }}>{r.mineral}</span>
                      <span
                        style={{
                          padding: '1px 6px',
                          background: bandColour(r.band),
                          color: 'var(--bg-void)',
                          fontSize: 9.5,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {r.band}
                      </span>
                    </div>
                    {r.hhi !== undefined && r.top_refining_share !== undefined && (
                      <div style={{ marginTop: 2, fontSize: 9.5, color: 'var(--ink-faint)' }}>
                        HHI {r.hhi.toFixed(2)} · {countryCode(r.top_refiner)} refining {r.top_refining_share.toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title="04 · In-Transit Shipments"
          span={3}
          source="AIS-derived · cargo inferred from vessel class + route — not manifest data"
        >
          {data.in_transit === null ? (
            <Unavailable />
          ) : data.in_transit.length === 0 ? (
            <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
              No inferred shipments yet — AIS derivation warming up (port-call history accrues daily).
            </p>
          ) : (
            <table style={{ width: '100%', fontFamily: 'var(--f-mono)', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Vessel · Flag</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Route</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Mineral</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>DWT</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Confidence</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {data.in_transit.map((s, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '6px 4px', color: 'var(--ink)' }}>
                      {s.vessel_name}
                      {s.flag ? <span style={{ color: 'var(--ink-faint)' }}> · {s.flag}</span> : null}
                    </td>
                    <td style={{ padding: '6px 4px', color: 'var(--ink-dim)' }}>
                      {s.origin_port ?? s.origin_country ?? '—'}
                      {s.origin_port && s.origin_country ? (
                        <span style={{ color: 'var(--ink-faint)' }}> ({s.origin_country})</span>
                      ) : null}
                      {' → '}
                      {s.dest_hint ?? '—'}
                    </td>
                    <td style={{ padding: '6px 4px', color: 'var(--violet)' }}>{s.mineral}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--ink)', textAlign: 'right' }}>
                      {s.dwt === null ? 'DWT n/a' : s.dwt.toLocaleString()}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      <ConfidenceTag inferredFrom={s.inferred_from} />
                    </td>
                    <td style={{ padding: '6px 4px', color: 'var(--ink)', textAlign: 'right' }}>{daysAgo(s.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel
          title="05 · Sentinel-2 Stockpile Imagery"
          span={3}
          badge={!data.tiles || data.tiles.length === 0}
          source={
            data.tiles && data.tiles.length > 0
              ? `Sentinel-2 L2A via Copernicus · ${data.tiles[0].index_name} change proxy — not volumetric measurement`
              : undefined
          }
        >
          {data.tiles === null ? (
            <Unavailable />
          ) : data.tiles.length === 0 ? (
            <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
              Awaiting first Sentinel-2 acquisition — tiles land after the monthly cron&apos;s first run.
            </p>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {data.tiles.map(t => (
                <figure
                  key={t.aoi_ref}
                  style={{
                    margin: 0,
                    border: '1px solid var(--rule)',
                    background: 'var(--bg-raised)',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={t.image_url}
                    alt={`Sentinel-2 ${t.index_name} tile — ${t.aoi_ref} (${t.aoi_kind}), acquired ${t.acquisition_date}`}
                    style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }}
                    loading="lazy"
                  />
                  <figcaption style={{ padding: '6px 8px', fontFamily: 'var(--f-mono)', fontSize: 10 }}>
                    <div className="flex items-center justify-between" style={{ gap: 6 }}>
                      <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.aoi_ref}
                      </span>
                      {t.change_pct !== null ? (
                        <span
                          className="num-lg"
                          style={{
                            fontSize: 12,
                            color: Math.abs(t.change_pct) >= 15 ? 'var(--red)' : Math.abs(t.change_pct) >= 5 ? 'var(--amber)' : 'var(--ink-dim)',
                          }}
                        >
                          {t.change_pct > 0 ? '+' : ''}
                          {t.change_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ink-faint)' }}>baseline pass</span>
                      )}
                    </div>
                    <div style={{ marginTop: 2, color: 'var(--ink-faint)' }}>
                      {t.acquisition_date}
                      {t.change_pct !== null ? ' · vs prior pass' : ''}
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Section panel. `badge` is OPT-IN: panels 01-03 are grounded on seeded
 * USGS/IEA datasets (mig 079), 04 on AIS-derived mineral_shipments and 05
 * on sentinel_tiles — all show a `source` line. The badge only remains on
 * panel 05's empty state (no acquisition yet → placeholder framing).
 */
function Panel({
  title,
  children,
  span = 1,
  badge = false,
  source,
}: {
  title: string;
  children: React.ReactNode;
  span?: number;
  badge?: boolean;
  source?: string;
}) {
  return (
    <section
      style={{
        gridColumn: span === 3 ? 'span 3' : undefined,
        background: 'var(--bg-navy)',
        padding: 14,
      }}
    >
      <h3 className="panel-title" style={{ marginBottom: source ? 4 : 10 }}>
        <span className="idx">{title.split(' · ')[0]}</span>
        {title.split(' · ')[1]}
        {badge && (
          <span style={{ marginLeft: 8 }}>
            <IllustrativeBadge title="No live data yet — awaiting first acquisition" />
          </span>
        )}
      </h3>
      {source && (
        <p
          style={{
            marginBottom: 10,
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            letterSpacing: '0.06em',
            color: 'var(--ink-faint)',
          }}
        >
          {source}
        </p>
      )}
      {children}
    </section>
  );
}

function Unavailable() {
  return (
    <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
      Data unavailable — table not reachable.
    </p>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; colour: string }> = {
    running: { label: 'RUNNING', colour: 'var(--green)' },
    'permit-review': { label: 'PERMIT', colour: 'var(--amber)' },
    suspended: { label: 'SUSPENDED', colour: 'var(--red)' },
    expansion: { label: 'EXPANSION', colour: 'var(--violet)' },
  };
  const e = map[status] ?? { label: status.toUpperCase(), colour: 'var(--ink-faint)' };
  return (
    <span
      style={{
        padding: '2px 6px',
        fontFamily: 'var(--f-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        background: 'transparent',
        color: e.colour,
        border: `1px solid ${e.colour}`,
      }}
    >
      {e.label}
    </span>
  );
}

/** Confidence tag for panel 04 — derived from how the cargo was inferred. */
function ConfidenceTag({ inferredFrom }: { inferredFrom: 'destination' | 'destination+port_call' }) {
  const strong = inferredFrom === 'destination+port_call';
  const colour = strong ? 'var(--green)' : 'var(--amber)';
  return (
    <span
      title={strong ? 'Inferred from AIS route AND an origin port call' : 'Inferred from AIS destination only'}
      style={{
        padding: '2px 6px',
        fontFamily: 'var(--f-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        background: 'transparent',
        color: colour,
        border: `1px solid ${colour}`,
        whiteSpace: 'nowrap',
      }}
    >
      {strong ? 'AIS route + port call' : 'AIS destination'}
    </span>
  );
}

/** Compact "how stale is this AIS fix" formatter for panel 04. */
function daysAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const hours = Math.max(0, (Date.now() - t) / 3_600_000);
  if (hours < 1) return '<1 h ago';
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function bandColour(band: string): string {
  return band === 'red' ? 'var(--red)' : band === 'amber' ? 'var(--amber)' : 'var(--green)';
}

function countryCode(country?: string | null): string {
  if (!country) return '—';
  const map: Record<string, string> = { China: 'CN', Indonesia: 'ID', 'United States': 'US' };
  return map[country] ?? country.slice(0, 2).toUpperCase();
}
