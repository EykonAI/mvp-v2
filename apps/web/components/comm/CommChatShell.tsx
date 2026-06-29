'use client';
import { useState, type ReactNode } from 'react';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';

// Chrome for the COMM (app) pages: the global TopNav with the AI Analyst chat
// panel wired in, mirroring the GLOBE/INTEL/NOTIF shells. Without this the COMM
// pages rendered a bare <TopNav/> with no onChatToggle, so the AI ANALYST tab
// rendered DISABLED there (active everywhere else). Now the analyst panel opens
// on COMM pages too. The page's content is passed as children and lives in the
// scrollable main column; the panel pushes it (does not overlay), same as
// NotifShell / IntelShell.
export function CommChatShell({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-void)' }}>
      <TopNav chatOpen={chatOpen} onChatToggle={() => setChatOpen((v) => !v)} />
      <div className="flex-1 flex" style={{ minHeight: 0 }}>
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
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
  );
}
