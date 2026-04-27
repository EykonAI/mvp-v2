'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import LayerControls from '@/components/LayerControls';
import { POLL_INTERVALS } from '@/lib/constants';
import type { LayerState, BBox } from '@/lib/types';

// Dynamic import for Deck.gl (no SSR — requires WebGL)
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const initialLayerState = (): LayerState => ({
  visible: true,
  loading: false,
  error: null,
  count: 0,
  lastFetch: null,
});

// Build a /api/<layer> URL with bbox params. Three of the four routes use
// snake_case (lat_min/lon_max); /api/vessels uses the camel-mashed form
// (latmin/lonmax). Keep the inconsistency contained here.
function buildUrl(layer: string, b: BBox | null): string {
  if (!b) return `/api/${layer}`;
  if (layer === 'vessels') {
    return `/api/vessels?latmin=${b.latmin}&latmax=${b.latmax}&lonmin=${b.lonmin}&lonmax=${b.lonmax}`;
  }
  return `/api/${layer}?lat_min=${b.latmin}&lat_max=${b.latmax}&lon_min=${b.lonmin}&lon_max=${b.lonmax}`;
}

export default function Home() {
  const [chatOpen, setChatOpen] = useState(true);

  const [aircraft, setAircraft] = useState<any[]>([]);
  const [vessels, setVessels] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [infrastructure, setInfrastructure] = useState<any[]>([]);

  const [layers, setLayers] = useState<Record<string, LayerState>>({
    aircraft: initialLayerState(),
    vessels: initialLayerState(),
    conflicts: initialLayerState(),
    infrastructure: initialLayerState(),
  });

  // Latest viewport bbox emitted by MapView (debounced ~500ms after last
  // user pan/zoom). bboxRef mirrors it so the polling intervals can read
  // the freshest value without re-creating the timers on every change.
  const [bbox, setBbox] = useState<BBox | null>(null);
  const bboxRef = useRef<BBox | null>(null);

  const intervalsRef = useRef<Record<string, NodeJS.Timeout>>({});
  // One AbortController per layer — when bbox changes mid-fetch we cancel
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

  const fetchLayer = useCallback(
    async (name: string, url: string, setter: (d: any[]) => void) => {
      abortRefs.current[name]?.abort();
      const ctrl = new AbortController();
      abortRefs.current[name] = ctrl;

      setLayers(prev => ({ ...prev, [name]: { ...prev[name], loading: true, error: null } }));
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        const data = json.data || json || [];
        setter(data);
        setLayers(prev => ({
          ...prev,
          [name]: {
            ...prev[name],
            loading: false,
            count: data.length,
            lastFetch: new Date().toISOString(),
          },
        }));
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setLayers(prev => ({ ...prev, [name]: { ...prev[name], loading: false, error: err.message } }));
      }
    },
    []
  );

  const refetchAll = useCallback(
    (b: BBox | null) => {
      fetchLayer('aircraft',       buildUrl('aircraft', b),       setAircraft);
      fetchLayer('vessels',        buildUrl('vessels', b),        setVessels);
      fetchLayer('conflicts',      buildUrl('conflicts', b),      setConflicts);
      fetchLayer('infrastructure', buildUrl('infrastructure', b), setInfrastructure);
    },
    [fetchLayer],
  );

  // Initial fetch (bbox=null → server defaults to global) + viewport-driven
  // refetches when MapView emits a new bbox.
  useEffect(() => {
    bboxRef.current = bbox;
    refetchAll(bbox);
  }, [bbox, refetchAll]);

  // Polling intervals stay registered for the component's lifetime and
  // always read the latest bbox via bboxRef.
  useEffect(() => {
    intervalsRef.current.aircraft = setInterval(
      () => fetchLayer('aircraft', buildUrl('aircraft', bboxRef.current), setAircraft),
      POLL_INTERVALS.aircraft
    );
    intervalsRef.current.vessels = setInterval(
      () => fetchLayer('vessels', buildUrl('vessels', bboxRef.current), setVessels),
      POLL_INTERVALS.vessels
    );
    intervalsRef.current.conflicts = setInterval(
      () => fetchLayer('conflicts', buildUrl('conflicts', bboxRef.current), setConflicts),
      POLL_INTERVALS.conflicts!
    );

    return () => {
      Object.values(intervalsRef.current).forEach(clearInterval);
      Object.values(abortRefs.current).forEach(c => c?.abort());
    };
  }, [fetchLayer]);

  const toggleLayer = (name: string) => {
    setLayers(prev => ({ ...prev, [name]: { ...prev[name], visible: !prev[name].visible } }));
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <TopNav chatOpen={chatOpen} onChatToggle={() => setChatOpen(!chatOpen)} />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <MapView
            aircraft={layers.aircraft.visible ? aircraft : []}
            vessels={layers.vessels.visible ? vessels : []}
            conflicts={layers.conflicts.visible ? conflicts : []}
            infrastructure={layers.infrastructure.visible ? infrastructure : []}
            onViewportChange={setBbox}
          />
          <LayerControls layers={layers} onToggle={toggleLayer} />
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
