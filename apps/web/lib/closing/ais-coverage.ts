import type { ClosingStatus } from '@/lib/closing/status';

// Pure — no server imports — so the /start client components (ClosingPage,
// HonestyBoard, QualifyForm) can call it without pulling the service-role
// client into the browser bundle. The figures it formats are read on the
// server by loadClosingStatus().

/**
 * The AIS coverage clause every /start surface uses — the honesty board, the
 * LIMIT 1 line and the theatre hint — computed from ais_box_liveness so that a
 * recovery or a new outage changes the copy without a deploy.
 *
 *   "4 broad regional boxes and 6 chokepoints — Bab-el-Mandeb dark 62d, Strait of Hormuz dark 5d"
 *
 * null when the liveness table cannot be read: callers then say something
 * true and unquantified ("regional, not global") rather than a number.
 */
export interface AisCoverageClause {
  /** "4 broad regional boxes and 6 chokepoints" */
  boxes: string;
  /** "Bab-el-Mandeb dark 62d, Strait of Hormuz dark 5d", or null when none is dark (board cell) */
  dark: string | null;
  /** "Bab-el-Mandeb dark 62 days, Strait of Hormuz dark 5 days" (sentences) */
  darkProse: string | null;
  /** label of the box carrying the most vessels right now */
  densest: string | null;
}

export function aisCoverageClause(
  s: Pick<ClosingStatus, 'aisBoxes' | 'aisDeadBoxes'>,
): AisCoverageClause | null {
  if (!s.aisBoxes) return null;
  const { broad, chokepoint, densest } = s.aisBoxes;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const dead = s.aisDeadBoxes ?? [];
  return {
    boxes: `${plural(broad, 'broad regional box', 'broad regional boxes')} and ${plural(chokepoint, 'chokepoint', 'chokepoints')}`,
    dark: dead.length ? dead.map(b => `${b.label} dark ${b.daysSince}d`).join(', ') : null,
    darkProse: dead.length
      ? dead.map(b => `${b.label} dark ${plural(b.daysSince, 'day', 'days')}`).join(', ')
      : null,
    densest,
  };
}
