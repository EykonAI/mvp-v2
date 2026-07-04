import ConvergenceFeed from '@/components/intel/dashboard/ConvergenceFeed';
import { loadForecasts } from '@/lib/briefs/forecasts';
import { loadDailyBrief } from '@/lib/briefs/dailyBrief';
import { SectionHeading, ForecastList, Empty, DailyBriefCard } from '@/components/briefs/parts';

// Today — the default landing: a unified view of what eYKON has issued for the
// user right now. Reads existing surfaces (the persisted daily brief, open
// forecasts, the convergence wire); each links through to its full reading room.
//
// The daily brief is the stored row written by the generate-daily-brief cron
// (daily_briefs, migration 071) — NOT regenerated per page view. The previous
// on-mount call to /api/intel/briefing composed from empty inputs
// (agent_reports has no production writer; anomaly_flags.processed is never
// set), so the brief never changed day to day.

export const dynamic = 'force-dynamic';

export default async function BriefsTodayPage() {
  const [{ open }, brief] = await Promise.all([loadForecasts(6), loadDailyBrief()]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
      <div>
        <SectionHeading title="Today’s brief" />
        {brief ? (
          <DailyBriefCard brief={brief} />
        ) : (
          <Empty>No brief issued yet — the first daily brief is generated at 06:00 UTC.</Empty>
        )}
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
