/**
 * SnapshotAgeChip — the ingested-at age chip for a static reference registry.
 *
 * Renders a STALE SNAPSHOT chip with the registry's age when the snapshot is
 * older than its declared refresh interval (migration 167,
 * reference_snapshot_freshness), an AGE UNKNOWN chip when the load date could
 * not be read, and NOTHING when the snapshot is inside its interval. The
 * decision lives in lib/reference/freshness.ts so every surface applies the
 * same rule; this component only draws it, through the shared ProvenanceChip.
 *
 * Pure presentational, no client state — safe in server and client components.
 */
import ProvenanceChip from './ProvenanceChip';
import { snapshotChip, type ReferenceSnapshot } from '@/lib/reference/freshness';

export default function SnapshotAgeChip({
  snapshot,
  compact = false,
}: {
  snapshot: ReferenceSnapshot | null | undefined;
  /** Narrow rows (the map layer panel): visible label "Stale" + age. The
   *  tooltip and screen-reader text keep the full sentence. */
  compact?: boolean;
}) {
  const chip = snapshotChip(snapshot);
  if (!chip) return null;
  return (
    <ProvenanceChip
      state={chip.state}
      ageHours={chip.ageHours}
      label={compact && chip.state === 'stale' ? 'Stale' : chip.label}
      title={chip.title}
      sr={chip.sr}
    />
  );
}
