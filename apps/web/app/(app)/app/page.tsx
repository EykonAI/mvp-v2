'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import LayerControls from '@/components/LayerControls';
import { POLL_INTERVALS } from '@/lib/constants';
import type { LayerState } from '@/lib/types';

// Dynamic import for Deck.gl (no SSR — requires WebGL)
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const initialLayerState = (): LayerState => ({
  visible: true,
  loading: false,
  error: null,
  count: 0,
  lastFetch: null,
});

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

  const intervalsRef = useRef<Record<string, NodeJS.Timeout>>({});

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
        setLayers(prev => ({ ...prev, [name]: { ...prev[name], loading: false, error: err.message } }));
      }
    },
    []
  );

  useEffect(() => {
    fetchLayer('aircraft', '/api/aircraft', setAircraft);
    fetchLayer('vessels', '/api/vessels', setVessels);
    fetchLayer('conflicts', '/api/conflicts', setConflicts);
    fetchLayer('infrastructure', '/api/infrastructure', setInfrastructure);

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
