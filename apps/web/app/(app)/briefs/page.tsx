import CitizenBrief from '@/components/intel/dashboard/CitizenBrief';
import ConvergenceFeed from '@/components/intel/dashboard/ConvergenceFeed';
import { loadForecasts } from '@/lib/briefs/forecasts';
import { SectionHeading, ForecastList, Empty } from '@/components/briefs/parts';

// Today — the default landing: a unified view of what eYKON has issued for the
// user right now. Reads existing surfaces (the daily brief, open forecasts, the
// convergence wire); each links through to its full reading room.

export const dynamic = 'force-dynamic';

export default async function BriefsTodayPage() {
  const { open } = await loadForecasts(6);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
      <div>
        <SectionHeading title="Today’s brief" />
        <CitizenBrief />
      </div>

      <div>
        <SectionHeading title="Open forecasts" href="/briefs/forecasts" cta="All forecasts" />
        {open.length ? <ForecastList rows={open.slice(0, 4)} /> : <Empty>No open forecasts right now — the next weekly calls are issued on schedule.</Empty>}
      </div>

      <div>
        <SectionHeading title="Convergence wire" href="/briefs/convergence" cta="Full wire" />
        <ConvergenceFeed />
      </div>
    </div>
  );
}
