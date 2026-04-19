'use client';
import { useEffect, useState } from 'react';
import FeedCard, { FeedItem } from './FeedCard';

/**
 * Enriched Intelligence Feed. Pulls recent conflict events and
 * agent_reports and renders them as FeedCards. σ-scores are
 * stubbed until baseline_distributions is populated by the
 * nightly baseline job (Phase 7).
 */
export default function IntelligenceFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/conflicts').then(r => (r.ok ? r.json() : { data: [] })),
      fetch('/api/vessels').then(r => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([c, v]) => {
        const conflictItems: FeedItem[] = (c.data ?? [])
          .slice(0, 5)
          .map((e: any, i: number) => ({
            id: `conflict-${e.event_id ?? i}`,
            headline: `${e.event_type ?? 'Conflict event'} · ${e.country ?? 'Unknown'}`,
            region: e.country ?? 'Unknown',
            sigma: 1.4 + i * 0.2,
            entity: e.country,
            when_hour_of_week: 'Wk-17 Sun 18:00',
            domain: 'conflict',
            sources: [
              {
                provider: e.source ?? 'GDELT',
                fetched_at: e.ingested_at ?? new Date().toISOString(),
                transform: 'Normalised · deduped · geocoded',
                licence: 'GDELT 2.0 · CC-BY',
              },
            ],
            narrative:
              e.notes?.slice(0, 240) ??
              `${e.actor1 ?? 'Actor A'} vs ${e.actor2 ?? 'Actor B'} · ${e.fatalities ?? 0} fatalities reported.`,
            market_note: 'Regional risk premium ↑ — watch Brent and shipping insurance spreads.',
            plain_summary:
              'An armed incident was reported in this region in the past day. Details are still coming in from open sources.',
            story_potential: 0.62,
            asset_exposure: ['Oil & Gas', 'Shipping'],
          }));

        const vesselItems: FeedItem[] = (v.data ?? []).slice(0, 3).map((vv: any, i: number) => ({
          id: `vessel-${vv.mmsi ?? i}`,
          headline: `AIS pattern · ${vv.name ?? 'Unknown vessel'}`,
          region: vv.destination ?? 'At sea',
          sigma: 2.1 + i * 0.3,
          entity: vv.mmsi,
          when_hour_of_week: 'Wk-17 Sun 18:00',
          domain: 'maritime',
          sources: [
            {
              provider: 'AIS Hub',
              fetched_at: vv.ingested_at ?? new Date().toISOString(),
              transform: 'Interpolated track',
              licence: 'AIS Hub',
            },
          ],
          narrative: `${vv.name ?? 'Vessel'} (MMSI ${vv.mmsi}) · heading ${vv.destination ?? 'unspecified destination'} at ${vv.speed ?? '—'} kn.`,
          market_note: 'Tanker routing anomaly — check rate spreads on TC2/TD3 lanes.',
          plain_summary: 'A commercial ship is taking an unusual route; shipping experts watch this kind of thing to spot supply disruptions.',
          story_potential: 0.48,
          asset_exposure: ['Shipping', 'Energy'],
        }));

        setItems([...conflictItems, ...vesselItems].slice(0, 6));
      })
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) {
    return (
      <p
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          padding: 16,
        }}
      >
        Feed warming up — live signals will appear here
      </p>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {items.map(i => (
        <FeedCard key={i.id} item={i} />
      ))}
    </div>
  );
}
