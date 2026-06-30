import { loadForecasts } from '@/lib/briefs/forecasts';
import { ForecastsBoard } from '@/components/briefs/ForecastsBoard';

// Forecasts & scores — eYKON's own calibrated forecasts (weekly chokepoint
// transits, EIA inventories), sealed at issue and scored when they resolve.
// Track Record is folded in here as the Resolved tab (four-item menu).

export const dynamic = 'force-dynamic';

export default async function BriefsForecastsPage() {
  const { open, resolved } = await loadForecasts(60);
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 20, margin: '0 0 4px' }}>Forecasts &amp; scores</h1>
      <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 18px', lineHeight: 1.5 }}>
        eYKON’s own calibrated forecasts — weekly chokepoint transits and EIA inventories — sealed at issue and scored when they resolve. Open calls are live now; resolved calls show the observed outcome and the Brier score. This is the public track record.
      </p>
      <ForecastsBoard open={open} resolved={resolved} />
    </div>
  );
}
