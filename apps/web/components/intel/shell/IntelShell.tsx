'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import CalibrationStrip from '@/components/intel/shell/CalibrationStrip';
import { PersonaProvider } from '@/components/intel/shell/PersonaContext';
import { AdvancedScenariosBanner } from '@/components/intel/AdvancedScenariosBanner';
import { captureBrowser } from '@/lib/analytics/client';
import {
  MODULE_SLUGS,
  MODULE_TIERS,
  type ModuleSlug,
  type ModuleTier,
} from '@/lib/intel/modules';

/**
 * Client-side /intel chrome: TopNav, calibration strip, chat panel, persona
 * provider. Extracted from the old app/(app)/intel/layout.tsx so the layout
 * itself can be a server component that runs the tier gate (Phase A).
 *
 * As of the workspace-tiering update: when the user is on /intel/advanced
 * OR any of the four advanced /intel/<slug> routes, an inline banner
 * (dismissable per session) renders directly above the main content to
 * frame those workspaces as institutional analysis.
 */

const VALID_SLUGS: ReadonlySet<string> = new Set(MODULE_SLUGS);
const ADVANCED_PATH = '/intel/advanced';

function isAdvancedRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === ADVANCED_PATH || pathname.startsWith(`${ADVANCED_PATH}/`)) return true;
  if (!pathname.startsWith('/intel/')) return false;
  const slug = pathname.replace(/^\/intel\//, '').split('/')[0];
  if (!slug || !VALID_SLUGS.has(slug)) return false;
  return MODULE_TIERS[slug as ModuleSlug] === 'advanced';
}

function tierForPath(pathname: string | null): ModuleTier | null {
  if (!pathname) return null;
  if (pathname === ADVANCED_PATH || pathname.startsWith(`${ADVANCED_PATH}/`)) return 'advanced';
  if (!pathname.startsWith('/intel/')) return null;
  const slug = pathname.replace(/^\/intel\//, '').split('/')[0];
  if (!slug || !VALID_SLUGS.has(slug)) return null;
  return MODULE_TIERS[slug as ModuleSlug] ?? null;
}

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
  // Now carries `tier` so the activation dashboard can plot open-rate
  // per Hero / Visible / Advanced without a join.
  useEffect(() => {
    if (!pathname || !pathname.startsWith('/intel/')) return;
    const slug = pathname.replace(/^\/intel\//, '').split('/')[0];
    if (!slug) return;
    const tier = tierForPath(pathname);
    captureBrowser({
      event: 'module_opened',
      module_slug: slug,
      ...(tier ? { tier } : {}),
    });
  }, [pathname]);

  const showInlineBanner = isAdvancedRoute(pathname);

  return (
    <PersonaProvider>
      <div className="min-h-screen flex flex-col intel-bg">
        <TopNav chatOpen={chatOpen} onChatToggle={() => setChatOpen(v => !v)} />
        <CalibrationStrip />
        {showInlineBanner && <AdvancedScenariosBanner isInline />}
        <div className="flex-1 flex" style={{ minHeight: 0 }}>
          <main className="flex-1 min-w-0">{children}</main>
          <aside
            className="transition-all duration-200 ease-in-out overflow-hidden"
            style={{
              width: chatOpen ? 'var(--chat-panel-width)' : 0,
              borderLeft: chatOpen ? '1px solid var(--rule-soft)' : 'none',
            }}
          >
            {chatOpen && <ChatPanel />}
          </aside>
        </div>
      </div>
    </PersonaProvider>
  );
}
