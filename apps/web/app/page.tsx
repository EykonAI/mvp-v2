'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import LayerControls from '@/components/LayerControls';
import Dashboard from '@/components/Dashboard';
import { POLL_INTERVALS } from '@/lib/constants';
import type { LayerState } from '@/lib/types';

// Dynamic import for Deck.gl (no SSR — requires WebGL)
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

type ViewMode = 'globe' | 'dashboard';

const initialLayerState = (): LayerState => ({
  visible: true, loading: false, error: null, count: 0, lastFetch: null,
});

export default function Home() {
  const [mode, setMode] = useState<ViewMode>('globe');
  const [chatOpen, setChatOpen] = useState(true);

  // Layer data
  const [aircraft, setAircraft] = useState<any[]>([]);
  const [vessels, setVessels] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [infrastructure, setInfrastructure] = useState<any[]>([]);

  // Layer status
  const [layers, setLayers] = useState<Record<string, LayerState>>({
    aircraft: initialLayerState(),
    vessels: initialLayerState(),
    conflicts: initialLayerState(),
    infrastructure: initialLayerState(),
  });

  const intervalsRef = useRef<Record<string, NodeJS.Timeout>>({});

  // ─── Data Fetchers ───
  const fetchLayer = useCallback(async (
    name: string,
    url: string,
    setter: (d: any[]) => void
  ) => {
    setLayers(prev => ({ ...prev, [name]: { ...prev[name], loading: true, error: null } }));
    try {
      const res = await fetch(url);
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
      setLayers(prev => ({
        ...prev,
        [name]: { ...prev[name], loading: false, error: err.message },
      }));
    }
  }, []);

  // ─── Initial Load + Polling ───
  useEffect(() => {
    // Fetch all layers immediately
    fetchLayer('aircraft', '/api/aircraft', setAircraft);
    fetchLayer('vessels', '/api/vessels', setVessels);
    fetchLayer('conflicts', '/api/conflicts', setConflicts);
    fetchLayer('infrastructure', '/api/infrastructure', setInfrastructure);

    // Set up polling for dynamic layers
    intervalsRef.current.aircraft = setInterval(
      () => fetchLayer('aircraft', '/api/aircraft', setAircraft),
      POLL_INTERVALS.aircraft
    );
    intervalsRef.current.vessels = setInterval(
      () => fetchLayer('vessels', '/api/vessels', setVessels),
      POLL_INTERVALS.vessels
    );
    intervalsRef.current.conflicts = setInterval(
      () => fetchLayer('conflicts', '/api/conflicts', setConflicts),
      POLL_INTERVALS.conflicts!
    );

    return () => {
      Object.values(intervalsRef.current).forEach(clearInterval);
    };
  }, [fetchLayer]);

  const toggleLayer = (name: string) => {
    setLayers(prev => ({
      ...prev,
      [name]: { ...prev[name], visible: !prev[name].visible },
    }));
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {/* Top Navigation */}
      <TopNav
        mode={mode}
        onModeChange={setMode}
        chatOpen={chatOpen}
        onChatToggle={() => setChatOpen(!chatOpen)}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map or Dashboard */}
        <div className="flex-1 relative">
          {mode === 'globe' ? (
            <>
              <MapView
                aircraft={layers.aircraft.visible ? aircraft : []}
                vessels={layers.vessels.visible ? vessels : []}
                conflicts={layers.conflicts.visible ? conflicts : []}
                infrastructure={layers.infrastructure.visible ? infrastructure : []}
              />
              <LayerControls layers={layers} onToggle={toggleLayer} />
            </>
          ) : (
            <Dashboard />
          )}
        </div>

        {/* Chat Panel (slides in/out) */}
        <div className={`transition-all duration-300 ease-in-out ${chatOpen ? 'w-[380px]' : 'w-0'} overflow-hidden border-l border-eykon-border`}>
          {chatOpen && <ChatPanel />}
        </div>
      </div>
    </div>
  );
}
