import ProvenanceChip from './ProvenanceChip';

/**
 * Small inline badge marking a widget or dataset as illustrative /
 * fixture-backed rather than live.
 *
 * P0 honesty item from the INTEL grounding audit: paying analysts must be
 * able to tell real data from illustrative fixtures at a glance.
 *
 * Retained as a thin alias so existing call sites keep working. The
 * rendering now comes from ProvenanceChip, which is the single source of
 * truth for provenance state across the product and additionally carries
 * a screen-reader description — this badge previously announced only the
 * bare word "ILLUSTRATIVE" with no explanation of what it meant.
 */
export default function IllustrativeBadge({
  label = 'ILLUSTRATIVE',
  title,
}: {
  label?: string;
  title?: string;
}) {
  return <ProvenanceChip state="fixture" label={label} title={title} />;
}
