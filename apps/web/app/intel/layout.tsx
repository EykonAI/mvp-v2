'use client';
import { useState, useEffect } from 'react';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import CalibrationStrip from '@/components/intel/shell/CalibrationStrip';
import { PersonaProvider } from '@/components/intel/shell/PersonaContext';

/**
 * /intel shell — top bar, calibration strip, persona provider, chat panel.
 * Every workspace page mounts inside this layout.
 */
export default function IntelLayout({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('intel-view');
      document.body.classList.remove('globe-view');
      return () => document.body.classList.remove('intel-view');
    }
  }, []);

  return (
    <PersonaProvider>
      <div className="min-h-screen flex flex-col intel-bg">
        <TopNav chatOpen={chatOpen} onChatToggle={() => setChatOpen(v => !v)} />
        <CalibrationStrip />
        <div className="flex-1 flex" style={{ minHeight: 0 }}>
          <main className="flex-1 min-w-0">{children}</main>
          <aside
            className={`transition-all duration-200 ease-in-out ${chatOpen ? 'w-[380px]' : 'w-0'} overflow-hidden`}
            style={{ borderLeft: chatOpen ? '1px solid var(--rule-soft)' : 'none' }}
          >
            {chatOpen && <ChatPanel />}
          </aside>
        </div>
      </div>
    </PersonaProvider>
  );
}
