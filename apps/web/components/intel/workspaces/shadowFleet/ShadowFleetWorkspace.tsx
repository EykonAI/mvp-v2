'use client';
import ChartFigure from '@/components/intel/shared/ChartFigure';
import { useEffect, useMemo, useState } from 'react';
import weights from '@/lib/fixtures/shadow_fleet_weights.json';
import { AIS_BOXES } from '@/lib/intel/aisCoverage';

/**
 * The Dark Contact Board — events, not vessels.
 *
 * Concept (build brief rev. B, BACKEND/III - INTEL /Shadow Fleet/): a live
 * board of dark-contact EVENTS over a map, with coverage stated as plainly as
 * the findings. Four honesty rules govern every pixel:
 *   - a marker is a LAST KNOWN position; absence of a marker is absence of a
 *     look, not absence of a ship;
 *   - a dead coverage box is drawn dead, and its contacts are held VOID —
 *     listed, dimmed, never counted;
 *   - the track and the timeline are real observed fixes, never interpolated;
 *   - still_dark is always glossed "not re-observed" — a statement about our
 *     instrument, not the transponder.
 *
 * The map is deliberately SCHEMATIC: coarse landmasses as orientation, while
 * coverage boxes and contact positions are projected to scale (equirectangular,
 * 20°W–110°E). Contacts outside the frame surface as an off-frame chip, never
 * silently dropped.
 *
 * TWO DOMAINS, ASYMMETRIC ON PURPOSE (PR F). SEA contacts are scored events
 * with a lifecycle. AIR contacts are OBSERVED ACTIVITY — recency-ranked
 * military/anomalous tracks with no confidence number, because no aerial
 * cadence baseline exists and a quiet transponder usually means a landed
 * aircraft; dressing that as a probability would fabricate the exact signal
 * class this workspace removed. The AIR domain earns its place through
 * coverage complementarity: contacts inside a dead AIS box are flagged
 * AIS BLIND HERE — the remaining sensor over water we cannot hear.
 *
 * The v2 leads list and its OIL/LNG/GRAIN tabs are gone: the tabs never
 * filtered (the parameter was read and ignored) and vessel_type exists on 0.8%
 * of the fleet, so they could not be honestly implemented. The queue reads
 * dark_contact_events (mig 112).
 */

interface DarkEvent {
  id: string;
  mmsi: string;
  name: string | null;
  flag: string | null;
  box_slug: string | null;
  last_fix_lat: number | null;
  last_fix_lon: number | null;
  last_speed_kn: number | null;
  cadence_hours: number;
  silence_ratio_at_open: number;
  confidence_at_open: number;
  indicators: Record<string, number> | null;
  gap_started_at: string;
  opened_at: string;
  deadline_at: string;
  status: 'open' | 'resolved' | 'void';
  resolution: 'reappeared' | 'still_dark' | null;
  void_reason: string | null;
  closed_at: string | null;
  final_gap_hours: number | null;
}

interface CoverageBox {
  slug: string;
  label: string;
  kind: string;
  state: 'live' | 'stale' | 'dead' | 'unknown';
  newest_fix: string | null;
  fixes_last_hour: number;
  silent_hours: number | null;
}
interface Coverage {
  boxes: CoverageBox[];
  dead_boxes: number;
  box_dead_after_h: number;
}
interface EventsSummary {
  open: number | null;
  reappeared_24h: number | null;
  still_dark_24h: number | null;
  void_24h: number | null;
}
interface TrackFix {
  recorded_at: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
}
interface AirContact {
  icao24: string;
  callsign: string | null;
  type: string | null;
  registration: string | null;
  squawk: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude_ft: number | null;
  velocity_kn: number | null;
  on_ground: boolean | null;
  last_seen_at: string;
  last_seen_hours: number;
  box_slug: string | null;
  ais_blind_here: boolean;
  tags: string[];
}
type Domain = 'both' | 'sea' | 'air';
type Selection = { kind: 'event'; id: string } | { kind: 'air'; icao24: string };

export default function ShadowFleetWorkspace() {
  const [events, setEvents] = useState<DarkEvent[]>([]);
  const [summary, setSummary] = useState<EventsSummary | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [dataClock, setDataClock] = useState<string | null>(null);
  const [feedLag, setFeedLag] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [domain, setDomain] = useState<Domain>('both');
  const [air, setAir] = useState<AirContact[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved' | 'void'>('all');
  const [track, setTrack] = useState<TrackFix[]>([]);
  const [trackLoading, setTrackLoading] = useState(false);

  useEffect(() => {
    fetch('/api/intel/shadow-fleet/events?limit=80')
      .then(r => r.json())
      .then(j => {
        setEvents(j.events ?? []);
        setSummary(j.summary ?? null);
        setCoverage(j.coverage ?? null);
        setDataClock(j.data_clock ?? null);
        setFeedLag(j.feed_lag_minutes ?? null);
        if (j.events?.[0]) setSelection((prev) => prev ?? { kind: 'event', id: j.events[0].id });
      })
      .catch(() => {});
    fetch('/api/intel/shadow-fleet/air?limit=200')
      .then(r => r.json())
      .then(j => setAir(j.contacts ?? []))
      .catch(() => {});
  }, []);

  const filtered = useMemo(
    () =>
      events.filter(
        e =>
          (filter === 'all' || e.status === filter) &&
          (!search ||
            e.mmsi.includes(search) ||
            (e.name ?? '').toLowerCase().includes(search.toLowerCase())),
      ),
    [events, filter, search],
  );

  const selected = selection?.kind === 'event'
    ? (events.find(e => e.id === selection.id) ?? null)
    : null;
  const selectedAir = selection?.kind === 'air'
    ? (air.find(a => a.icao24 === selection.icao24) ?? null)
    : null;

  const filteredAir = useMemo(
    () =>
      air.filter(a =>
        !search ||
        a.icao24.includes(search.toLowerCase()) ||
        (a.callsign ?? '').toLowerCase().includes(search.toLowerCase())),
    [air, search],
  );

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setTrackLoading(true);
    fetch(`/api/intel/shadow-fleet/track?mmsi=${encodeURIComponent(selected.mmsi)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        setTrack(j.fixes ?? []);
        setTrackLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setTrack([]); setTrackLoading(false); }
      });
    return () => { cancelled = true; };
  }, [selected?.mmsi]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 235px)', minHeight: 560 }}>
      <BoardStrip coverage={coverage} summary={summary} dataClock={dataClock} feedLag={feedLag} domain={domain} onDomain={setDomain} />

      <div
        className="grid flex-1"
        style={{
          gridTemplateColumns: '322px minmax(0, 1fr) 326px',
          gap: 1,
          background: 'var(--rule-soft)',
          minHeight: 0,
        }}
      >
        {/* EVENT QUEUE */}
        <aside style={{ background: 'var(--bg-navy)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--rule-soft)', flex: 'none' }}>
            <PanelHead>Event Queue</PanelHead>
            <div className="flex" style={{ gap: 4, marginTop: 8 }}>
              {(['all', 'open', 'resolved', 'void'] as const).map(fk => (
                <button
                  key={fk}
                  onClick={() => setFilter(fk)}
                  style={{
                    padding: '3px 8px',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 8.5,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: filter === fk ? 'var(--red)' : 'var(--ink-faint)',
                    background: filter === fk ? 'rgba(224,93,80,0.12)' : 'transparent',
                    border: `1px solid ${filter === fk ? 'var(--red)' : 'var(--rule)'}`,
                    borderRadius: 2,
                    cursor: 'pointer',
                  }}
                >
                  {fk}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="MMSI / Name"
              style={{
                width: '100%',
                padding: '5px 8px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--rule)',
                color: 'var(--ink)',
                fontFamily: 'var(--f-body)',
                fontSize: 12,
                marginTop: 8,
                borderRadius: 2,
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {domain !== 'air' && (
              filtered.length === 0 ? (
                <p style={{ padding: 14, fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
                  No dark-contact events{filter !== 'all' ? ` with status "${filter}"` : ''} yet.
                  Events open when a vessel goes silent ≥ 12× its own observed cadence inside
                  a live coverage box.
                </p>
              ) : (
                filtered.map(ev => (
                  <EventRow
                    key={ev.id}
                    ev={ev}
                    active={selected?.id === ev.id}
                    onClick={() => setSelection({ kind: 'event', id: ev.id })}
                  />
                ))
              )
            )}
            {domain !== 'sea' && filteredAir.length > 0 && (
              <>
                <div style={{ padding: '7px 12px 4px', fontFamily: 'var(--f-mono)', fontSize: 8, letterSpacing: '0.16em', color: 'var(--violet)', borderBottom: '1px solid var(--rule-soft)' }}>
                  AIR · OBSERVED ACTIVITY — NOT SCORED
                </div>
                {filteredAir.slice(0, domain === 'air' ? 60 : 20).map(a => (
                  <AirRow
                    key={a.icao24}
                    a={a}
                    active={selectedAir?.icao24 === a.icao24}
                    onClick={() => setSelection({ kind: 'air', icao24: a.icao24 })}
                  />
                ))}
              </>
            )}
          </div>
        </aside>

        {/* MAP + TIMELINE */}
        <section style={{ background: 'var(--bg-navy)', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <BoardMap events={events} coverage={coverage} selected={selected} track={track} air={air} selectedAir={selectedAir} domain={domain} />
          {selection?.kind !== 'air' && (
            <CadenceTimeline selected={selected} track={track} loading={trackLoading} dataClock={dataClock} />
          )}
        </section>

        {/* DOSSIER */}
        <aside style={{ background: 'var(--bg-navy)', overflowY: 'auto', minHeight: 0 }}>
          {selectedAir ? (
            <AirDossier a={selectedAir} />
          ) : selected ? (
            <EventDossier ev={selected} dataClock={dataClock} />
          ) : (
            <p style={{ padding: 16, fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)' }}>
              Select a contact.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── The strip: coverage + resolution tallies + the data clock ─────────── */

function BoardStrip({
  coverage, summary, dataClock, feedLag, domain, onDomain,
}: { coverage: Coverage | null; summary: EventsSummary | null; dataClock: string | null; feedLag: number | null; domain: Domain; onDomain: (d: Domain) => void }) {
  const order = { dead: 0, stale: 1, unknown: 2, live: 3 } as const;
  const boxes = coverage ? [...coverage.boxes].sort((a, b) => order[a.state] - order[b.state]) : [];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        padding: '7px 12px',
        background: 'var(--bg-navy)',
        borderBottom: '1px solid var(--rule-soft)',
        marginBottom: 1,
        flex: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', border: '1px solid var(--rule)', borderRadius: 2, overflow: 'hidden', flex: 'none' }}>
        {(['both', 'sea', 'air'] as const).map(d => (
          <button
            key={d}
            onClick={() => onDomain(d)}
            style={{
              padding: '3px 10px',
              fontFamily: 'var(--f-mono)',
              fontSize: 8.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              border: 'none',
              borderRight: d !== 'air' ? '1px solid var(--rule)' : 'none',
              background: domain === d ? 'var(--teal)' : 'transparent',
              color: domain === d ? 'var(--bg-void)' : 'var(--ink-dim)',
            }}
          >
            {d}
          </button>
        ))}
      </span>
      <span className="eyebrow" style={{ flex: 'none' }}>Coverage</span>
      {!coverage ? (
        <Chip color="var(--ink-faint)">STATE UNAVAILABLE</Chip>
      ) : (
        boxes.map(b => {
          const up = b.label.toUpperCase();
          if (b.state === 'dead') {
            const days = b.silent_hours != null ? (b.silent_hours / 24).toFixed(1) : '?';
            return <Chip key={b.slug} color="var(--red)" solid>{up} · NO AIS {days}d</Chip>;
          }
          if (b.state === 'stale') return <Chip key={b.slug} color="var(--amber)">{up} · {b.silent_hours ?? '?'}h STALE</Chip>;
          if (b.state === 'unknown') return <Chip key={b.slug} color="var(--ink-faint)">{up} · —</Chip>;
          return <Chip key={b.slug} color="var(--teal-dim)">{up} · {b.fixes_last_hour.toLocaleString()}/h</Chip>;
        })
      )}
      <span style={{ marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>
        {summary && summary.open != null && (
          <>
            <span className="text-eykon-red">{summary.open} open</span>
            {' · 24h: '}{summary.reappeared_24h ?? 0} back / {summary.still_dark_24h ?? 0} not re-observed / {summary.void_24h ?? 0} void
            {' · '}
          </>
        )}
        DATA CLOCK{' '}
        <span className="text-eykon-teal">
          {dataClock ? `${dataClock.slice(0, 16).replace('T', ' ')}Z` : '—'}
        </span>
        {feedLag != null && ` · lag ${feedLag}m`}
      </span>
    </div>
  );
}

function Chip({ children, color, solid = false }: { children: React.ReactNode; color: string; solid?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        border: `1px solid ${color}`,
        borderRadius: 2,
        fontFamily: 'var(--f-mono)',
        fontSize: 9,
        letterSpacing: '0.06em',
        color,
        background: solid ? 'rgba(224,93,80,0.08)' : 'transparent',
        whiteSpace: 'nowrap',
        flex: 'none',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {children}
    </span>
  );
}

/* ── Event queue row ───────────────────────────────────────────────────── */

function eventBadge(ev: DarkEvent): { text: string; color: string } {
  if (ev.status === 'open') return { text: 'DARK', color: 'var(--red)' };
  if (ev.status === 'void') return { text: 'VOID', color: 'var(--ink-faint)' };
  return ev.resolution === 'reappeared'
    ? { text: 'BACK', color: 'var(--teal)' }
    : { text: 'NOT RE-OBSERVED', color: 'var(--amber)' };
}

function liveSilenceHours(ev: DarkEvent, dataClock?: string | null): number {
  const end = ev.closed_at
    ? new Date(ev.closed_at).getTime()
    : dataClock
      ? new Date(dataClock).getTime()
      : Date.now();
  return Math.max(0, (end - new Date(ev.gap_started_at).getTime()) / 3600_000);
}

function EventRow({ ev, active, onClick }: { ev: DarkEvent; active: boolean; onClick: () => void }) {
  const b = eventBadge(ev);
  const dim = ev.status === 'void';
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        background: active ? 'rgba(224,93,80,0.07)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--rule-soft)',
        borderLeft: `2px solid ${active ? 'var(--red)' : 'transparent'}`,
        cursor: 'pointer',
        color: 'var(--ink)',
        opacity: dim ? 0.55 : 1,
      }}
    >
      <div className="flex items-baseline" style={{ gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 7.5,
            letterSpacing: '0.1em',
            padding: '1px 5px',
            borderRadius: 2,
            flex: 'none',
            background: ev.status === 'open' ? 'var(--red)' : 'transparent',
            border: ev.status === 'open' ? 'none' : `1px solid ${b.color}`,
            color: ev.status === 'open' ? 'var(--bg-void)' : b.color,
          }}
        >
          {b.text}
        </span>
        <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ev.name ?? ev.mmsi}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 10.5, color: b.color, flex: 'none' }}>
          {(ev.confidence_at_open * 100).toFixed(0)}
        </span>
      </div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 8.5, color: 'var(--ink-faint)', marginTop: 3 }}>
        {ev.mmsi} · {ev.flag ?? '—'} · {ev.silence_ratio_at_open.toFixed(0)}× cadence
        {ev.final_gap_hours != null ? ` · gap ${ev.final_gap_hours.toFixed(0)}h` : ''}
        {ev.box_slug ? ` · ${ev.box_slug}` : ''}
        {ev.indicators?.ofac_designation_match === 1 && (
          <span style={{ color: 'var(--red)', fontWeight: 500 }}> · OFAC DESIGNATED (IMO)</span>
        )}
        {ev.indicators?.ofac_name_match === 1 && (
          <span className="text-eykon-amber"> · OFAC NAME (weak match)</span>
        )}
      </div>
    </button>
  );
}

function AirRow({ a, active, onClick }: { a: AirContact; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        background: active ? 'rgba(139,127,216,0.08)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--rule-soft)',
        borderLeft: `2px solid ${active ? 'var(--violet)' : 'transparent'}`,
        cursor: 'pointer',
        color: 'var(--ink)',
      }}
    >
      <div className="flex items-baseline" style={{ gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--f-mono)', fontSize: 7.5, letterSpacing: '0.1em',
            padding: '1px 5px', borderRadius: 2, flex: 'none',
            background: 'var(--violet)', color: 'var(--bg-void)',
          }}
        >
          AIR
        </span>
        <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.callsign ?? a.icao24}{a.type ? ` · ${a.type}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-dim)', flex: 'none' }}>
          seen {a.last_seen_hours.toFixed(1)}h
        </span>
      </div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 8.5, color: 'var(--ink-faint)', marginTop: 3 }}>
        {a.icao24} · reg {a.registration ?? '—'}
        {a.tags.includes('no_callsign') ? ' · NO CALLSIGN' : ''}
        {a.squawk && ['7500','7600','7700'].includes(a.squawk) ? ` · SQUAWK ${a.squawk}` : ''}
        {a.ais_blind_here && <span style={{ color: 'var(--violet)' }}> · AIS BLIND HERE</span>}
      </div>
    </button>
  );
}

/* ── The map — schematic basemap, to-scale boxes and contacts ──────────── */
/* Frame: 20°W–110°E, 75°N–40°S. Landmass paths are deliberately coarse       */
/* orientation shapes; boxes and markers are projected exactly.               */

const FRAME = { lonMin: -20, lonMax: 110, latMin: -40, latMax: 75, w: 790, h: 727 };
const px = (lon: number) => ((lon - FRAME.lonMin) / (FRAME.lonMax - FRAME.lonMin)) * FRAME.w;
const py = (lat: number) => ((FRAME.latMax - lat) / (FRAME.latMax - FRAME.latMin)) * FRAME.h;
const inFrame = (lat: number, lon: number) =>
  lon >= FRAME.lonMin && lon <= FRAME.lonMax && lat >= FRAME.latMin && lat <= FRAME.latMax;

const LANDMASSES = [
  'M60,190 L94,162 L130,146 L182,131 L186,92 L210,60 L240,35 L273,24 L322,37 L430,18 L580,14 L700,22 L790,28 L790,300 L750,300 L720,318 L659,319 L640,300 L610,377 L593,408 L564,341 L540,300 L500,290 L470,300 L440,330 L431,352 L400,372 L383,383 L375,360 L360,320 L345,290 L332,262 L340,240 L355,232 L340,215 L300,210 L270,222 L240,228 L215,218 L195,232 L175,215 L130,222 L90,228 L67,215 Z',
  'M85,250 L130,244 L182,240 L243,262 L304,268 L330,290 L346,335 L372,380 L431,390 L395,444 L363,481 L360,498 L333,577 L310,638 L233,663 L209,596 L202,510 L178,454 L142,417 L120,423 L41,405 L16,367 L24,347 L42,316 L63,271 Z',
  'M87,152 L130,146 L112,122 L103,100 L85,110 L94,137 Z',
  'M61,131 L85,122 L85,140 L61,143 Z',
  'M385,529 L422,551 L407,609 L391,578 Z',
  'M608,414 L619,414 L614,397 Z',
  'M700,423 L765,492 L741,490 L699,469 Z',
  'M729,417 L753,448 L747,449 L717,408 Z',
  'M723,335 L766,335 L784,390 L760,402 L729,377 Z',
];

function BoardMap({
  events, coverage, selected, track, air, selectedAir, domain,
}: { events: DarkEvent[]; coverage: Coverage | null; selected: DarkEvent | null; track: TrackFix[]; air: AirContact[]; selectedAir: AirContact | null; domain: Domain }) {
  const stateBySlug = new Map((coverage?.boxes ?? []).map(b => [b.slug, b] as const));

  const seaVisible = domain !== 'air';
  const airVisible = domain !== 'sea';
  const placed = seaVisible ? events.filter(e => e.last_fix_lat != null && e.last_fix_lon != null) : [];
  const onMap = placed.filter(e => inFrame(e.last_fix_lat as number, e.last_fix_lon as number));
  const airPlaced = airVisible ? air.filter(a => a.latitude != null && a.longitude != null) : [];
  const airOnMap = airPlaced.filter(a => inFrame(a.latitude as number, a.longitude as number));
  const offFrame = (placed.length - onMap.length) + (airPlaced.length - airOnMap.length);

  const tail = (track ?? [])
    .filter(f => f.latitude != null && f.longitude != null && inFrame(f.latitude, f.longitude))
    .slice(-12);

  return (
    <div style={{ flex: 1, minHeight: 0, background: '#070C16', position: 'relative', overflow: 'hidden' }}>
      <ChartFigure
        title="Shadow-fleet frame — last known fixes"
        desc={`${onMap.length} vessel${onMap.length === 1 ? '' : 's'} and ${airOnMap.length} aircraft plotted in frame${offFrame ? `, ${offFrame} outside it` : ''}.`}
        className="w-full h-full"
      >
      <svg viewBox={`0 0 ${FRAME.w} ${FRAME.h}`} aria-hidden="true" style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="sfgrid" width="60.8" height="60.9" patternUnits="userSpaceOnUse">
            <path d="M60.8 0 L0 0 0 60.9" fill="none" stroke="#0E1729" strokeWidth="1" />
          </pattern>
          <radialGradient id="sfpulse">
            <stop offset="0%" stopColor="#E05D50" stopOpacity=".5" />
            <stop offset="100%" stopColor="#E05D50" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={FRAME.w} height={FRAME.h} fill="#070C16" />
        <rect width={FRAME.w} height={FRAME.h} fill="url(#sfgrid)" />

        <g fill="#101B2E" stroke="#1B2941" strokeWidth=".9">
          {LANDMASSES.map((d, i) => <path key={i} d={d} />)}
        </g>

        {/* coverage boxes, to scale */}
        {AIS_BOXES.map(box => {
          const [lat0, lon0, lat1, lon1] = box.bounds;
          if (!inFrame(lat0, lon0) && !inFrame(lat1, lon1)) return null;
          const st = stateBySlug.get(box.slug)?.state ?? 'unknown';
          const x = px(lon0), y = py(lat1), w = px(lon1) - px(lon0), h = py(lat0) - py(lat1);
          const dead = st === 'dead';
          return (
            <g key={box.slug}>
              <rect
                x={x} y={y} width={w} height={h}
                fill={dead ? 'rgba(224,93,80,.13)' : 'none'}
                stroke={dead ? '#E05D50' : st === 'stale' ? '#D4A24C' : '#19D0B8'}
                strokeWidth={dead ? 1.2 : 1}
                strokeDasharray={dead ? '3 3' : '4 4'}
                opacity={dead ? 1 : 0.5}
              />
              {(dead || box.kind === 'chokepoint') && (
                <text
                  x={x + w + 4} y={y + 8}
                  fontFamily="var(--f-mono)" fontSize="8"
                  fill={dead ? '#E05D50' : '#19D0B8'}
                  opacity={dead ? 1 : 0.7}
                >
                  {box.label.toUpperCase()}
                  {dead && stateBySlug.get(box.slug)?.silent_hours != null
                    ? ` · NO AIS ${((stateBySlug.get(box.slug)!.silent_hours as number) / 24).toFixed(1)}d`
                    : ''}
                </text>
              )}
            </g>
          );
        })}

        {/* selection track tail — real fixes, drawn as points joined faintly */}
        {selected && tail.length > 1 && (
          <g>
            <path
              d={tail.map((f, i) => `${i === 0 ? 'M' : 'L'}${px(f.longitude as number).toFixed(1)},${py(f.latitude as number).toFixed(1)}`).join(' ')}
              stroke="#E05D50" strokeWidth="1.1" fill="none" strokeDasharray="2.5 2.5" opacity=".8"
            />
            {tail.map((f, i) => (
              <circle key={i} cx={px(f.longitude as number)} cy={py(f.latitude as number)} r="1.6" fill="#E05D50" opacity=".7" />
            ))}
          </g>
        )}

        {/* event markers at last known positions */}
        {onMap.map(ev => {
          const x = px(ev.last_fix_lon as number), y = py(ev.last_fix_lat as number);
          const isSel = selected?.id === ev.id;
          const color = ev.status === 'open' ? '#E05D50'
            : ev.status === 'void' ? '#3A4256'
            : ev.resolution === 'reappeared' ? '#19D0B8' : '#D4A24C';
          return (
            <g key={ev.id}>
              {isSel && ev.status === 'open' && <circle cx={x} cy={y} r="16" fill="url(#sfpulse)" />}
              <circle
                cx={x} cy={y} r={isSel ? 4 : 2.8}
                fill={ev.status === 'void' ? 'none' : color}
                stroke={ev.status === 'void' ? color : '#05080F'}
                strokeWidth="1"
              />
              {isSel && (
                <text x={x + 8} y={y - 6} fontFamily="var(--f-mono)" fontSize="8.5" fill={color}>
                  {ev.name ?? ev.mmsi} · {liveSilenceHours(ev).toFixed(0)}h
                </text>
              )}
            </g>
          );
        })}

        {/* AIR contacts — triangles; violet; AIS-blind ones pulse-highlighted */}
        {airOnMap.map(a => {
          const x = px(a.longitude as number), y = py(a.latitude as number);
          const isSel = selectedAir?.icao24 === a.icao24;
          const r = isSel ? 5 : 3.4;
          return (
            <g key={a.icao24}>
              {a.ais_blind_here && <circle cx={x} cy={y} r="12" fill="#8B7FD8" opacity=".12" />}
              <path
                d={`M${x},${y - r} L${x + r * 0.87},${y + r * 0.6} L${x - r * 0.87},${y + r * 0.6} Z`}
                fill="#8B7FD8"
                stroke="#05080F"
                strokeWidth=".8"
                opacity={a.last_seen_hours > 12 ? 0.5 : 1}
              />
              {isSel && (
                <text x={x + 8} y={y - 6} fontFamily="var(--f-mono)" fontSize="8.5" fill="#8B7FD8">
                  {a.callsign ?? a.icao24} · seen {a.last_seen_hours.toFixed(1)}h
                </text>
              )}
            </g>
          );
        })}

        {offFrame > 0 && (
          <text x="12" y={FRAME.h - 40} fontFamily="var(--f-mono)" fontSize="8.5" fill="#98A3B5">
            +{offFrame} contact{offFrame > 1 ? 's' : ''} off-frame — listed in the queue, never dropped
          </text>
        )}

        <text x={FRAME.w - 12} y={FRAME.h - 26} textAnchor="end" fontFamily="var(--f-mono)" fontSize="8" fill="#3A4256">
          Marker = LAST KNOWN position. Absence of a marker is absence of a look, not absence of a ship.
        </text>
        <text x={FRAME.w - 12} y={FRAME.h - 14} textAnchor="end" fontFamily="var(--f-mono)" fontSize="8" fill="#3A4256">
          Schematic basemap · frame 20°W–110°E · to scale · ▲ AIR = observed activity, not scored
        </text>
      </svg>
      </ChartFigure>
    </div>
  );
}

/* ── Cadence timeline — every tick a real fix, then the gap ────────────── */

function CadenceTimeline({
  selected, track, loading, dataClock,
}: { selected: DarkEvent | null; track: TrackFix[]; loading: boolean; dataClock: string | null }) {
  if (!selected) return null;

  const W = 758, H = 56;
  const nowMs = dataClock ? new Date(dataClock).getTime() : Date.now();
  const startMs = nowMs - 14 * 24 * 3600_000;
  const gapStartMs = new Date(selected.gap_started_at).getTime();
  const endMs = selected.closed_at ? new Date(selected.closed_at).getTime() : nowMs;
  const tx = (ms: number) => Math.max(0, Math.min(W, ((ms - startMs) / (nowMs - startMs)) * W));

  const ticks = track
    .map(f => new Date(f.recorded_at).getTime())
    .filter(ms => ms >= startMs && ms <= nowMs);
  const silence = liveSilenceHours(selected, dataClock);
  const b = eventBadge(selected);

  return (
    <div style={{ borderTop: '1px solid var(--rule)', background: 'var(--bg-navy)', padding: '8px 14px 9px', flex: 'none' }}>
      <div className="flex items-baseline" style={{ gap: 9, marginBottom: 6 }}>
        <b style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: b.color, fontWeight: 500 }}>
          {selected.name ?? selected.mmsi} · silence vs its own cadence
        </b>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8.5, color: 'var(--ink-faint)' }}>
          baseline {selected.cadence_hours.toFixed(1)} h between fixes ·{' '}
          {loading ? 'loading track…' : `${ticks.length} real fixes / 14 d — none interpolated`}
        </span>
      </div>
      <ChartFigure
        title={`${selected.name ?? selected.mmsi} — silence against its own cadence`}
        desc={`${ticks.length} real position fixes over 14 days against a ${selected.cadence_hours.toFixed(1)} hour baseline. None interpolated.`}
      >
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block', maxHeight: 56 }}>
        <line x1="0" y1="40" x2={W} y2="40" stroke="#1E2C49" />
        {ticks.map((ms, i) => (
          <rect key={i} x={tx(ms)} y="27" width="1.6" height="13" fill="#19D0B8" />
        ))}
        <rect
          x={tx(gapStartMs)} y="22"
          width={Math.max(2, tx(endMs) - tx(gapStartMs))} height="18"
          fill="rgba(224,93,80,.14)" stroke="#E05D50" strokeDasharray="3 3" strokeWidth="1"
        />
        <text x={(tx(gapStartMs) + tx(endMs)) / 2} y="35" textAnchor="middle" fontFamily="var(--f-mono)" fontSize="9" fill="#E05D50" letterSpacing=".08em">
          {selected.status === 'open' ? `SILENT — ${silence.toFixed(1)} h AND COUNTING` : `GAP ${silence.toFixed(1)} h · ${b.text}`}
        </text>
        <text x="2" y="14" fontFamily="var(--f-mono)" fontSize="7.5" fill="#5A6478">−14 d</text>
        <text x={W - 2} y="14" textAnchor="end" fontFamily="var(--f-mono)" fontSize="7.5" fill="#5A6478">DATA CLOCK</text>
      </svg>
      </ChartFigure>
    </div>
  );
}

/* ── Dossier ───────────────────────────────────────────────────────────── */

function EventDossier({ ev, dataClock }: { ev: DarkEvent; dataClock: string | null }) {
  const b = eventBadge(ev);
  const silence = liveSilenceHours(ev, dataClock);
  return (
    <div>
      <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--rule-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Vessel</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 16, fontWeight: 500, letterSpacing: '0.05em', marginTop: 2 }}>
            {ev.name ?? 'Unknown vessel'}
          </div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--ink-dim)', marginTop: 3 }}>
            MMSI {ev.mmsi} · {ev.flag ?? '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow">Confidence at open</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 26, color: b.color, lineHeight: 1.1 }}>
            {ev.confidence_at_open.toFixed(2)}
          </div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: b.color }}>{b.text}</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-soft)' }}>
        <Fact k="Gap started" v={`${ev.gap_started_at.slice(0, 16).replace('T', ' ')}Z`} />
        <Fact k={ev.status === 'open' ? 'Silent for' : 'Final gap'} v={`${silence.toFixed(1)} h`} accent={ev.status === 'open'} />
        <Fact k="Own cadence" v={`${ev.cadence_hours.toFixed(1)} h`} />
        <Fact k="Ratio at open" v={`${ev.silence_ratio_at_open.toFixed(1)}×`} />
        <Fact k="Last speed" v={ev.last_speed_kn != null ? `${ev.last_speed_kn} kn` : '—'} />
        <Fact k="Box at last fix" v={ev.box_slug ?? 'outside boxes'} />
        <Fact
          k="Last position"
          v={ev.last_fix_lat != null && ev.last_fix_lon != null ? `${ev.last_fix_lat.toFixed(3)}, ${ev.last_fix_lon.toFixed(3)}` : '—'}
        />
        <Fact k="Deadline" v={`${ev.deadline_at.slice(5, 16).replace('T', ' ')}Z`} />
      </div>

      {ev.status !== 'open' && (
        <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--rule-soft)', fontFamily: 'var(--f-mono)', fontSize: 9.5, lineHeight: 1.6, color: 'var(--ink-dim)' }}>
          {ev.resolution === 'reappeared' && <>Resolved <b className="text-eykon-teal">REAPPEARED</b> — a newer fix was observed; the gap closed at {ev.final_gap_hours?.toFixed(1)} h.</>}
          {ev.resolution === 'still_dark' && <>Resolved <b className="text-eykon-amber">NOT RE-OBSERVED</b> — no fix reached our coverage within 72 h. A statement about the instrument's view, never proof the transponder was off.</>}
          {ev.status === 'void' && <>VOID — <b>{ev.void_reason}</b>. The box measuring this silence went dead; the claim resolves neither way. Absence of an observation is not a result.</>}
        </div>
      )}

      <div style={{ padding: '9px 13px 0' }}>
        <div className="eyebrow">Why this scored — full arithmetic</div>
        <IndicatorMath indicators={ev.indicators ?? {}} composite={ev.confidence_at_open} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '10px 13px 4px' }}>
        <a
          href={`/api/intel/shadow-fleet/evidence-pack?event_id=${encodeURIComponent(ev.id)}`}
          style={actionStyle('var(--teal)')}
        >
          ↧ EXPORT EVIDENCE PACK (PDF)
        </a>
        <a href={analystHref(ev)} style={actionStyle('var(--teal)')}>
          ⎇ OPEN IN AI ANALYST
        </a>
      </div>

      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'var(--ink-faint)', lineHeight: 1.6, padding: '10px 13px', letterSpacing: '0.01em' }}>
        PROVENANCE — dark_contact_events (mig 112) · vessel_positions.updated_at · vessel_cadence (mig 111) ·
        ais_box_liveness (mig 110) · AISStream free tier. Identity denormalised at open. No registry, owner or
        cargo record is held for this vessel: those rows are absent, not empty.
        OFAC join is IMO-exact against the weekly SDN entity graph — IMO exists on ~0.5% of AIS records, so
        absence of a match is overwhelmingly absence of an identifier, not evidence of a clean vessel. A
        name-only match is tagged separately and never scored.
      </div>
    </div>
  );
}

function AirDossier({ a }: { a: AirContact }) {
  return (
    <div>
      <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--rule-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Aircraft</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 16, fontWeight: 500, letterSpacing: '0.05em', marginTop: 2 }}>
            {a.callsign ?? a.icao24}
          </div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--ink-dim)', marginTop: 3 }}>
            ICAO24 {a.icao24}{a.type ? ` · ${a.type}` : ''}{a.tags.includes('military') ? ' · MILITARY' : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow">Last seen</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 26, color: 'var(--violet)', lineHeight: 1.1 }}>
            {a.last_seen_hours.toFixed(1)}h
          </div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'var(--violet)' }}>OBSERVED · NOT SCORED</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-soft)' }}>
        <Fact k="Registration" v={a.registration ?? '—'} />
        <Fact k="Squawk" v={a.squawk ?? '—'} accent={['7500','7600','7700'].includes(a.squawk ?? '')} />
        <Fact k="Altitude" v={a.altitude_ft != null ? `${a.altitude_ft.toLocaleString()} ft` : '—'} />
        <Fact k="Speed" v={a.velocity_kn != null ? `${a.velocity_kn} kn` : '—'} />
        <Fact
          k="Position"
          v={a.latitude != null && a.longitude != null ? `${a.latitude.toFixed(3)}, ${a.longitude.toFixed(3)}` : '—'}
        />
        <Fact k="AIS box here" v={a.box_slug ?? 'outside boxes'} accent={a.ais_blind_here} />
      </div>

      {a.ais_blind_here && (
        <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--rule-soft)', fontFamily: 'var(--f-mono)', fontSize: 9.5, lineHeight: 1.6, color: 'var(--violet)' }}>
          AIS BLIND HERE — the AIS box at this position has been silent past the dead
          threshold. This aircraft track is the remaining sensor over water we cannot
          currently hear.
        </div>
      )}

      <div style={{ padding: '9px 13px', fontFamily: 'var(--f-mono)', fontSize: 9, lineHeight: 1.6, color: 'var(--ink-dim)' }}>
        Aerial contacts carry no confidence number by design: no aerial cadence
        baseline exists (there is no aircraft position history), and a quiet
        transponder usually means a landed aircraft. Recency is shown as recency.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '2px 13px 8px' }}>
        <a href={airAnalystHref(a)} style={actionStyle('var(--violet)')}>
          ⎇ OPEN IN AI ANALYST
        </a>
      </div>

      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'var(--ink-faint)', lineHeight: 1.6, padding: '2px 13px 10px', letterSpacing: '0.01em' }}>
        PROVENANCE — aircraft_positions (ADSBexchange / RapidAPI) · ingested_at is a
        true last-seen (refreshed on every upsert) · "Registration" is the
        registration string from the feed, not a country · ais_box_liveness (mig 110).
      </div>
    </div>
  );
}

function Fact({ k, v, accent = false }: { k: string; v: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-panel)', padding: '7px 10px' }}>
      <div className="eyebrow" style={{ fontSize: 8 }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, marginTop: 2, color: accent ? 'var(--red)' : 'var(--ink)' }}>{v}</div>
    </div>
  );
}

function PanelHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="panel-title flex items-center gap-[8px]" >
      <span style={{ width: 3, height: 12, background: 'var(--red)' }} />
      {children}
    </h3>
  );
}

/* ── Working actions (PR G) ────────────────────────────────────────────── */

function actionStyle(color: string): React.CSSProperties {
  return {
    display: 'block',
    padding: '7px 9px',
    background: 'var(--bg-panel)',
    border: `1px solid ${color}`,
    color,
    fontFamily: 'var(--f-mono)',
    fontSize: 9.5,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderRadius: 2,
    textDecoration: 'none',
    textAlign: 'left',
  };
}

/** Prefills the analyst composer (/analyst?q= — prefill only, never auto-sends). */
function analystHref(ev: DarkEvent): string {
  const pos = ev.last_fix_lat != null && ev.last_fix_lon != null
    ? `${ev.last_fix_lat.toFixed(3)}, ${ev.last_fix_lon.toFixed(3)}`
    : 'unknown';
  const q =
    `Dark-contact event: vessel ${ev.name ?? ev.mmsi} (MMSI ${ev.mmsi}, flag ${ev.flag ?? 'unknown'}) ` +
    `has been silent ${ev.silence_ratio_at_open.toFixed(0)}× its own reporting cadence since ` +
    `${ev.gap_started_at.slice(0, 16).replace('T', ' ')}Z. Last known position ${pos}` +
    `${ev.box_slug ? ` in the ${ev.box_slug} coverage box` : ''}` +
    `${ev.last_speed_kn != null && ev.last_speed_kn > 5 ? `, last seen under way at ${ev.last_speed_kn} kn` : ''}. ` +
    `Investigate: port calls for this MMSI, OFAC/sanctions exposure for the name and flag, ` +
    `thermal or night-lights activity near the last position, and any convergence signals in the area.`;
  return `/analyst?q=${encodeURIComponent(q)}`;
}

function airAnalystHref(a: AirContact): string {
  const q =
    `Aerial contact: ${a.callsign ?? a.icao24} (ICAO24 ${a.icao24}${a.type ? `, type ${a.type}` : ''}, ` +
    `registration ${a.registration ?? 'unknown'})${a.tags.includes('military') ? ', military' : ''}, ` +
    `last seen ${a.last_seen_hours.toFixed(1)} h ago at ` +
    `${a.latitude != null && a.longitude != null ? `${a.latitude.toFixed(3)}, ${a.longitude.toFixed(3)}` : 'unknown position'}` +
    `${a.ais_blind_here ? ` — inside the ${a.box_slug} box, where AIS is currently dead, so this track is the remaining sensor` : ''}. ` +
    `What else is observable in this area right now across aircraft, conflict events and thermal anomalies?`;
  return `/analyst?q=${encodeURIComponent(q)}`;
}

/* ── Score arithmetic, recomputable by eye ─────────────────────────────── */

function prettyKey(k: string): string {
  return k.replaceAll('_', ' ');
}

function IndicatorMath({ indicators, composite }: { indicators: Record<string, number>; composite: number }) {
  const terms = weights.features.map(f => {
    const raw = Number(indicators?.[f.key] ?? 0);
    const value = Math.max(f.clip[0], Math.min(f.clip[1], raw));
    return { key: f.key, value, weight: f.weight, contribution: value * f.weight };
  });
  const z = terms.reduce((acc, t) => acc + t.contribution, weights.intercept);

  return (
    <div style={{ marginTop: 8, fontFamily: 'var(--f-mono)', fontSize: 10.5 }}>
      <div className="flex items-center justify-between" style={{ color: 'var(--ink-faint)', fontSize: 9, letterSpacing: '0.08em', paddingBottom: 4 }}>
        <span>value × weight</span>
        <span>contribution</span>
      </div>
      {terms.map(t => (
        <div key={t.key} style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <div className="flex items-center justify-between">
            <span className="text-eykon-ink-dim">{prettyKey(t.key)}</span>
            <span className="text-eykon-red">{t.contribution >= 0 ? '+' : ''}{t.contribution.toFixed(3)}</span>
          </div>
          <div style={{ color: 'var(--ink-faint)', fontSize: 9.5, marginTop: 1 }}>
            {t.value.toFixed(2)} × {t.weight}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
        <span className="text-eykon-ink-dim">intercept</span>
        <span className="text-eykon-ink-dim">{weights.intercept.toFixed(3)}</span>
      </div>
      <div className="flex items-center justify-between" style={{ padding: '6px 0 2px' }}>
        <span className="text-eykon-ink-dim">z = {z.toFixed(3)}</span>
        <span style={{ color: 'var(--red)', fontSize: 12 }}>{(composite * 100).toFixed(0)}</span>
      </div>
      {typeof indicators?.silence_hours === 'number' && typeof indicators?.cadence_hours === 'number' && (
        <div style={{ color: 'var(--ink-dim)', fontSize: 9.5, marginTop: 5 }}>
          at open: silent {indicators.silence_hours} h = {(indicators.silence_hours / Math.max(0.5, indicators.cadence_hours)).toFixed(1)}×
          its own cadence ({indicators.cadence_hours} h between fixes, 14 d)
        </div>
      )}
      <div style={{ color: 'var(--ink-faint)', fontSize: 9, lineHeight: 1.5, marginTop: 4 }}>
        composite = 1 / (1 + e^−z). Silence is judged against this vessel's own
        observed cadence, measured from its last AIS fix against the box's data
        clock — never from the age of its database row.
      </div>
    </div>
  );
}
