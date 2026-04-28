'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import LayerControls from '@/components/LayerControls';
import { POLL_INTERVALS } from '@/lib/constants';
import {
  CATEGORIES,
  DATA_KEYS,
  defaultSublayerVisibility,
  filterByVisibleSublayers,
  type DataKey,
} from '@/lib/layer-config';
import type { LayerState, BBox } from '@/lib/types';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const initialDataState = (): LayerState => ({
  loading: false,
  error: null,
  count: 0,
  lastFetch: null,
});

// Build a /api/<layer> URL with bbox params. Three of the four legacy routes
// use snake_case (lat_min/lon_max); /api/vessels uses the camel-mashed form
// (latmin/lonmax). Keep the inconsistency contained here. Airports and ports
// also forward the current zoom so the server can thin to a top-tier subset
// at globe view.
function buildUrl(layer: string, b: BBox | null): string {
  if (!b) return `/api/${layer}`;
  if (layer === 'vessels') {
    return `/api/vessels?latmin=${b.latmin}&latmax=${b.latmax}&lonmin=${b.lonmin}&lonmax=${b.lonmax}`;
  }
  let url = `/api/${layer}?lat_min=${b.latmin}&lat_max=${b.latmax}&lon_min=${b.lonmin}&lon_max=${b.lonmax}`;
  if ((layer === 'airports' || layer === 'ports' || layer === 'power-plants') && typeof b.zoom === 'number') {
    url += `&zoom=${b.zoom.toFixed(2)}`;
  }
  return url;
}

export default function Home() {
  const [chatOpen, setChatOpen] = useState(true);

  const [aircraft, setAircraft] = useState<any[]>([]);
  const [vessels, setVessels] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [infrastructure, setInfrastructure] = useState<any[]>([]);
  const [airports, setAirports] = useState<any[]>([]);
  const [ports, setPorts] = useState<any[]>([]);
  const [powerPlants, setPowerPlants] = useState<any[]>([]);

  // Per-data-source fetch state (one entry per /api/* route).
  const [dataState, setDataState] = useState<Record<DataKey, LayerState>>({
    aircraft: initialDataState(),
    vessels: initialDataState(),
    conflicts: initialDataState(),
    infrastructure: initialDataState(),
    airports: initialDataState(),
    ports: initialDataState(),
    'power-plants': initialDataState(),
  });

  // Per-sub-layer visibility — independent of fetch state, since one parent
  // fetch can serve multiple sub-layer cards (e.g. infrastructure → 6).
  const [sublayerVisible, setSublayerVisible] = useState<Record<string, boolean>>(
    defaultSublayerVisibility(),
  );

  // Accordion: at most one category expanded at a time so the panel never
  // grows beyond ~11 rows even when Infrastructure is open.
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Latest viewport bbox emitted by MapView (debounced ~500ms after last
  // user pan/zoom). bboxRef mirrors it so the polling intervals can read
  // the freshest value without re-creating the timers on every change.
  const [bbox, setBbox] = useState<BBox | null>(null);
  const bboxRef = useRef<BBox | null>(null);

  const intervalsRef = useRef<Record<string, NodeJS.Timeout>>({});
  // One AbortController per data source — when bbox changes mid-fetch we cancel
  // the in-flight request so a slow response can't overwrite the fresh one.
  const abortRefs = useRef<Record<string, AbortController | null>>({});

  // Complete the upgrade handoff. The email-confirm callback and paywall flows
  // land users on /app?plan=<variant>; bounce them to /pricing so the launcher
  // can fire checkout. window.location.replace keeps /app out of history, so
  // the NOWPayments hosted cancel doesn't loop back and re-trigger.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const plan = new URLSearchParams(window.location.search).get('plan');
    if (plan) {
      window.location.replace(`/pricing?plan=${encodeURIComponent(plan)}`);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('globe-view');
      document.body.classList.remove('intel-view');
      return () => document.body.classList.remove('globe-view');
    }
  }, []);

  const setterFor = (name: DataKey) =>
    name === 'aircraft' ? setAircraft :
    name === 'vessels' ? setVessels :
    name === 'conflicts' ? setConflicts :
    name === 'infrastructure' ? setInfrastructure :
    name === 'airports' ? setAirports :
    name === 'ports' ? setPorts :
    setPowerPlants;

  const fetchLayer = useCallback(
    async (name: DataKey, url: string) => {
      abortRefs.current[name]?.abort();
      const ctrl = new AbortController();
      abortRefs.current[name] = ctrl;

      setDataState(prev => ({ ...prev, [name]: { ...prev[name], loading: true, error: null } }));
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        const data = json.data || json || [];
        setterFor(name)(data);
        setDataState(prev => ({
          ...prev,
          [name]: {
            loading: false,
            error: null,
            count: data.length,
            lastFetch: new Date().toISOString(),
          },
        }));
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setDataState(prev => ({
          ...prev,
          [name]: { ...prev[name], loading: false, error: err.message },
        }));
      }
    },
    [],
  );

  const refetchAll = useCallback(
    (b: BBox | null) => {
      DATA_KEYS.forEach(k => fetchLayer(k, buildUrl(k, b)));
    },
    [fetchLayer],
  );

  useEffect(() => {
    bboxRef.current = bbox;
    refetchAll(bbox);
  }, [bbox, refetchAll]);

  useEffect(() => {
    intervalsRef.current.aircraft = setInterval(
      () => fetchLayer('aircraft', buildUrl('aircraft', bboxRef.current)),
      POLL_INTERVALS.aircraft,
    );
    intervalsRef.current.vessels = setInterval(
      () => fetchLayer('vessels', buildUrl('vessels', bboxRef.current)),
      POLL_INTERVALS.vessels,
    );
    intervalsRef.current.conflicts = setInterval(
      () => fetchLayer('conflicts', buildUrl('conflicts', bboxRef.current)),
      POLL_INTERVALS.conflicts!,
    );

    return () => {
      Object.values(intervalsRef.current).forEach(clearInterval);
      Object.values(abortRefs.current).forEach(c => c?.abort());
    };
  }, [fetchLayer]);

  const onToggleSublayer = useCallback((key: string) => {
    setSublayerVisible(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Toggle a whole category: if any live sub-layers are on, turn them all off;
  // otherwise turn them all on. Planned sub-layers stay off — they have no
  // data path so flipping them on would create a "visible but empty" sub-layer.
  const onToggleCategory = useCallback((catKey: string) => {
    const cat = CATEGORIES.find(c => c.key === catKey);
    if (!cat) return;
    const live = cat.sublayers.filter(s => s.status === 'live');
    if (live.length === 0) return;
    setSublayerVisible(prev => {
      const anyOn = live.some(s => prev[s.key]);
      const next = { ...prev };
      live.forEach(s => { next[s.key] = !anyOn; });
      return next;
    });
  }, []);

  // Per-sub-layer counts: predicate match against the parent's raw data,
  // independent of visibility so the count stays stable as the user toggles.
  const sublayerCounts = useMemo(() => {
    const out: Record<string, number> = {};
    const sources: Record<DataKey, any[]> = {
      aircraft, vessels, conflicts, infrastructure, airports, ports,
      'power-plants': powerPlants,
    };
    for (const cat of CATEGORIES) {
      for (const sub of cat.sublayers) {
        if (sub.status === 'live' && sub.dataKey && sub.predicate) {
          out[sub.key] = sources[sub.dataKey].filter(sub.predicate).length;
        } else {
          out[sub.key] = 0;
        }
      }
    }
    return out;
  }, [aircraft, vessels, conflicts, infrastructure, airports, ports, powerPlants]);

  const visibleAircraft = useMemo(
    () => filterByVisibleSublayers(aircraft, 'aircraft', sublayerVisible),
    [aircraft, sublayerVisible],
  );
  const visibleVessels = useMemo(
    () => filterByVisibleSublayers(vessels, 'vessels', sublayerVisible),
    [vessels, sublayerVisible],
  );
  const visibleConflicts = useMemo(
    () => filterByVisibleSublayers(conflicts, 'conflicts-crisis', sublayerVisible),
    [conflicts, sublayerVisible],
  );
  const visibleInfrastructure = useMemo(
    () => filterByVisibleSublayers(infrastructure, 'infrastructure', sublayerVisible),
    [infrastructure, sublayerVisible],
  );
  // Airports & ports each have a single live sub-layer with a `() => true`
  // predicate, so visibility collapses to "is the sub-layer toggle on?".
  const visibleAirports = useMemo(
    () => sublayerVisible['infrastructure.airports'] ? airports : [],
    [airports, sublayerVisible],
  );
  const visiblePorts = useMemo(
    () => sublayerVisible['infrastructure.ports'] ? ports : [],
    [ports, sublayerVisible],
  );
  const visiblePowerPlants = useMemo(
    () => sublayerVisible['infrastructure.power-plants'] ? powerPlants : [],
    [powerPlants, sublayerVisible],
  );

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <TopNav chatOpen={chatOpen} onChatToggle={() => setChatOpen(!chatOpen)} />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <MapView
            aircraft={visibleAircraft}
            vessels={visibleVessels}
            conflicts={visibleConflicts}
            infrastructure={visibleInfrastructure}
            airports={visibleAirports}
            ports={visiblePorts}
            powerPlants={visiblePowerPlants}
            onViewportChange={setBbox}
          />
          <LayerControls
            dataState={dataState}
            sublayerVisible={sublayerVisible}
            sublayerCounts={sublayerCounts}
            expandedCategory={expandedCategory}
            onToggleSublayer={onToggleSublayer}
            onToggleCategory={onToggleCategory}
            onExpandCategory={setExpandedCategory}
          />
        </div>

        <div
          className={`transition-all duration-300 ease-in-out ${chatOpen ? 'w-[380px]' : 'w-0'} overflow-hidden`}
          style={{ borderLeft: '1px solid var(--rule-soft)' }}
        >
          {chatOpen && <ChatPanel />}
        </div>
      </div>
    </div>
  );
}
