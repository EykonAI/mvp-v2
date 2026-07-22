import { getCurrentTier } from '@/lib/subscription';
import TopNav from '@/components/TopNav';
import AnalystWorkspace from '@/components/analyst/AnalystWorkspace';

// AI ANALYST v2 — the full-page workspace pillar (brief §6.1).
//
// Server wrapper only: resolves the EFFECTIVE tier (profile tier
// raised by an active Week Pass override) and hands it to the client
// workspace. Gating decision §9.6: Citizens see the upgrade gate here
// (the docked panel remains their surface); Member+ get sessions +
// history; projects/export/Deep Analysis stay Pro+ (v1 surfaces).
//
// Auth itself is enforced by the (app) layout + middleware.

export const dynamic = 'force-dynamic';

export default async function AnalystPage() {
  const tier = await getCurrentTier();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-void)' }}>
      {/* No onChatToggle: this page IS the analyst — no docked panel. */}
      <TopNav />
      <AnalystWorkspace tier={tier} />
    </div>
  );
}
