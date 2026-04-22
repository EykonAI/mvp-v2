'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import CalibrationStrip from '@/components/intel/shell/CalibrationStrip';
import { PersonaProvider } from '@/components/intel/shell/PersonaContext';
import { captureBrowser } from '@/lib/analytics/client';

/**
 * Client-side /intel chrome: TopNav, calibration strip, chat panel, persona
 * provider. Extracted from the old app/(app)/intel/layout.tsx so the layout
 * itself can be a server component that runs the tier gate (Phase A).
 */
export function IntelShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('intel-view');
      document.body.classList.remove('globe-view');
      return () => document.body.classList.remove('intel-view');
    }
  }, []);

  // Capture module_opened on every intel-subpath change. The generic
  // page_viewed also fires; this is the denormalised signal dashboards
  // actually want when comparing workspace retention vs. other paths.
  useEffect(() => {
    if (!pathname || !pathname.startsWith('/intel/')) return;
    const slug = pathname.replace(/^\/intel\//, '').split('/')[0];
    if (slug) captureBrowser({ event: 'module_opened', module_slug: slug });
  }, [pathname]);

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
