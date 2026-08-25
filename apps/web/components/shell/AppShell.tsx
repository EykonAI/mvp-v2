'use client';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { EykonSidebar } from '@/components/shell/EykonSidebar';

/**
 * Authenticated-app chrome: shadcn sidebar shell around every (app) route.
 *
 * Pages keep rendering <TopNav/> exactly as before — TopNav is now the
 * shell *header* (sidebar trigger + trust badges + bell + account), so it
 * lands at the top of the SidebarInset. Navigation itself moved into
 * EykonSidebar. No page logic or backend surface changes.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <EykonSidebar />
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  );
}
