import ConvergenceFeed from '@/components/intel/dashboard/ConvergenceFeed';

// Convergence wire — multi-domain convergences, where independent anomalies
// across maritime, air, conflict and energy line up on one place and time.
// System-authored and rare by design; the feed self-labels cold-start and
// quiet states. A NOTIF rule can fire when one lands near a watchlist — the
// reading lives here, the alert lives in NOTIF.

export const dynamic = 'force-dynamic';

export default function BriefsConvergencePage() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 20, margin: '0 0 4px' }}>Convergence wire</h1>
      <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 18px', lineHeight: 1.5 }}>
        Where independent anomalies across maritime, air, conflict and energy converge on one place and time. System-authored and rare by design. To be alerted when one fires near your watchlist, set a rule in NOTIF.
      </p>
      <ConvergenceFeed />
    </div>
  );
}
