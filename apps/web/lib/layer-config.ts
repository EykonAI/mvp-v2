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
        dataKey: 'aircraft', predicate: () => true },
      { key: 'aircraft.military', label: 'Military', status: 'planned',
        comingSoon: 'Phase 2 — ADS-B Exchange unfiltered military feed' },
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
        dataKey: 'infrastructure', predicate: f => f?.infra_type === 'refinery' },
      { key: 'infrastructure.pipelines', label: 'Pipelines', status: 'live',
        dataKey: 'pipelines', predicate: () => true },
      { key: 'infrastructure.airports', label: 'Airports', status: 'live',
        dataKey: 'airports', predicate: () => true },
      { key: 'infrastructure.ports', label: 'Ports', status: 'live',
        dataKey: 'ports', predicate: () => true },
      { key: 'infrastructure.mines', label: 'Mines', status: 'live',
        dataKey: 'infrastructure', predicate: f => f?.infra_type === 'mine' },
    ],
  },
];

export type DataKey = 'aircraft' | 'vessels' | 'conflicts' | 'infrastructure' | 'airports' | 'ports' | 'power-plants' | 'pipelines';

export const DATA_KEYS: DataKey[] = ['aircraft', 'vessels', 'conflicts', 'infrastructure', 'airports', 'ports', 'power-plants', 'pipelines'];

/**
 * Default visibility: all live sub-layers on, all planned sub-layers off.
 * Planned sub-layers can never be turned on by the user since they have no
 * data path — keeping them `false` keeps the filtering logic uniform.
 */
export function defaultSublayerVisibility(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const cat of CATEGORIES) {
    for (const sub of cat.sublayers) {
      out[sub.key] = sub.status === 'live';
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
