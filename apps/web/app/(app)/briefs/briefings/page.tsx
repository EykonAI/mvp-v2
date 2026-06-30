import CitizenBrief from '@/components/intel/dashboard/CitizenBrief';
import { Empty } from '@/components/briefs/parts';

// Briefings — the editorial archive. MVP surfaces today's brief (regenerated on
// each visit); the weekly briefing and the persona-digest archive land here
// once issues are persisted (v1).

export const dynamic = 'force-dynamic';

export default function BriefsBriefingsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 20, margin: '0 0 4px' }}>Briefings</h1>
        <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 16px', lineHeight: 1.5 }}>
          Today’s brief is below. The weekly briefing and the persona-digest archive land here as they are issued.
        </p>
        <CitizenBrief />
      </div>
      <div>
        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 15, fontWeight: 500, margin: '0 0 10px' }}>Archive</h2>
        <Empty>The weekly briefing and the persona-digest archive will appear here as issues are stored. Until then, the daily brief above is regenerated on each visit.</Empty>
      </div>
    </div>
  );
}
