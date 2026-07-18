import type { CategoryDef } from './types';

/**
 * Globe layer taxonomy. Five top-level categories surface in the layer panel,
 * each with its own colour and icon. Sub-layers either:
 *   - 'live'    → wired to a /api/* route via `dataKey`, with a `predicate`
 *                 that picks out items belonging to this sub-layer from the
 *                 parent's raw data.
 *   - 'planned' → reserved slot. Greyed in the UI; `comingSoon` surfaces as a
 *                 tooltip on hover.
 *
 * Map rendering: page.tsx filters each parent's data array by the union of
 * its visible sub-layers' predicates and passes the slice to MapView.
 */
export const CATEGORIES: CategoryDef[] = [
  {
    key: 'aircraft',
    label: 'Aircraft',
    color: 'var(--amber)',
    icon: '✈',
    sublayers: [
      { key: 'aircraft.civilian', label: 'Civilian', status: 'live',
        dataKey: 'aircraft', predicate: (a: any) => !a.military },
      { key: 'aircraft.military', label: 'Military', status: 'live',
        dataKey: 'aircraft', predicate: (a: any) => !!a.military },
    ],
  },
  {
    key: 'vessels',
    label: 'Vessels',
    color: 'var(--teal)',
    icon: '⚓',
    sublayers: [
      { key: 'vessels.commercial', label: 'Commercial', status: 'live',
        dataKey: 'vessels', predicate: () => true },
      { key: 'vessels.naval', label: 'Naval', status: 'planned',
        comingSoon: 'Phase 2 — BarentsWatch + naval AIS class filter' },
    ],
  },
  {
    key: 'conflicts-crisis',
    label: 'Conflicts & crisis',
    color: 'var(--red)',
    icon: '⚔',
    sublayers: [
      { key: 'conflicts-crisis.armed', label: 'Armed conflict', status: 'live',
        dataKey: 'conflicts', predicate: () => true },
      { key: 'conflicts-crisis.humanitarian', label: 'Humanitarian crisis', status: 'planned',
        comingSoon: 'Phase 1 — UN OCHA ReliefWeb' },
    ],
  },
  {
    key: 'thermal',
    label: 'Thermal anomalies',
    color: 'var(--coral)',
    icon: '◈',
    // Surfaced verbatim in the layer panel. A FIRMS row is a hot pixel, not a
    // confirmed fire and never a strike — see app/api/firms/route.ts.
    note: 'Satellite hot-pixel detections, not confirmed fires. Many are routine industrial gas flares. Attribution is inference; cloud cover means no detection ≠ no fire.',
    sublayers: [
      { key: 'thermal.high', label: 'High confidence', status: 'live',
        dataKey: 'firms', predicate: (d: any) => d.confidence_band === 'high' },
      { key: 'thermal.nominal', label: 'Nominal confidence', status: 'live',
        dataKey: 'firms', predicate: (d: any) => d.confidence_band === 'nominal' },
      { key: 'thermal.low', label: 'Low confidence', status: 'live',
        dataKey: 'firms', predicate: (d: any) => d.confidence_band === 'low', defaultHidden: true },
    ],
  },
  {
    key: 'imagery',
    label: 'Imagery',
    color: 'var(--violet)',
    icon: '◉',
    sublayers: [
      { key: 'imagery.cctv', label: 'Open CCTV', status: 'planned',
        comingSoon: 'Phase 3 — Windy Webcams API' },
      { key: 'imagery.satellite', label: 'Satellite imagery', status: 'planned',
        comingSoon: 'Phase 3 — Copernicus Sentinel Hub' },
    ],
  },
  {
    key: 'infrastructure',
    label: 'Infrastructure',
    color: 'var(--green)',
    icon: '⚡',
    sublayers: [
      { key: 'infrastructure.power-plants', label: 'Power plants', status: 'live',
        dataKey: 'power-plants', predicate: () => true },
      { key: 'infrastructure.refineries', label: 'Refineries', status: 'live',
        dataKey: 'refineries', predicate: () => true },
      { key: 'infrastructure.pipelines', label: 'Pipelines', status: 'live',
        dataKey: 'pipelines', predicate: () => true, defaultHidden: true },
      { key: 'infrastructure.airports', label: 'Airports', status: 'live',
        dataKey: 'airports', predicate: () => true },
      { key: 'infrastructure.ports', label: 'Ports', status: 'live',
        dataKey: 'ports', predicate: () => true },
      { key: 'infrastructure.mines', label: 'Mines', status: 'live',
        dataKey: 'mines', predicate: () => true },
    ],
  },
];

export type DataKey = 'aircraft' | 'vessels' | 'conflicts' | 'airports' | 'ports' | 'power-plants' | 'pipelines' | 'refineries' | 'mines' | 'firms';

export const DATA_KEYS: DataKey[] = ['aircraft', 'vessels', 'conflicts', 'airports', 'ports', 'power-plants', 'pipelines', 'refineries', 'mines', 'firms'];

/**
 * Default visibility: live sub-layers on (except those flagged
 * `defaultHidden`, which start off to keep the globe uncluttered — e.g.
 * pipelines), all planned sub-layers off. Planned sub-layers can never be
 * turned on by the user since they have no data path — keeping them `false`
 * keeps the filtering logic uniform. `defaultHidden` layers remain fully
 * toggleable; only their initial state changes.
 */
export function defaultSublayerVisibility(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const cat of CATEGORIES) {
    for (const sub of cat.sublayers) {
      out[sub.key] = sub.status === 'live' && !sub.defaultHidden;
    }
  }
  return out;
}

/**
 * Filter a parent's raw data array down to items belonging to currently-visible
 * sub-layers. Used for what to render on the map; per-sub-layer counts are
 * computed separately in page.tsx so they stay non-zero even when toggled off.
 */
export function filterByVisibleSublayers<T>(
  arr: T[],
  parentKey: string,
  sublayerVisible: Record<string, boolean>,
): T[] {
  const cat = CATEGORIES.find(c => c.key === parentKey);
  if (!cat) return arr;
  const preds = cat.sublayers
    .filter(s => s.status === 'live' && sublayerVisible[s.key] && s.predicate)
    .map(s => s.predicate!);
  if (preds.length === 0) return [];
  return arr.filter(item => preds.some(p => p(item)));
}
