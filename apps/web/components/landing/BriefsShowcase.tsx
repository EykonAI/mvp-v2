// BRIEFS landing section — the reading-room pillar surfaced on the
// marketing page (landing update brief 2026-07-06 §6). Four tiles mirror
// the product's four-item menu (Today · Briefings · Forecasts ·
// Convergence). Rendered inside .eykon-landing, so landing.css applies.

const BRIEFS_TILES = [
  {
    label: 'B-01 · TODAY',
    title: 'Today.',
    body: 'A unified feed of what eYKON issued for you — the fresh daily brief composed each morning from the live feeds, sources snapshotted for traceability, the newest forecasts, and the live convergence wire.',
  },
  {
    label: 'B-02 · BRIEFINGS',
    title: 'Briefings.',
    body: 'The plain-language daily brief, alongside persona digests tailored to the role you’ve selected — analyst, trader, journalist, commodities desk, NGO, corporate-risk officer or citizen.',
  },
  {
    label: 'B-03 · FORECASTS',
    title: 'Forecasts.',
    body: 'eYKON’s own calibrated forecasts — weekly chokepoint transit counts, EIA crude-inventory draws — each sealed at issue (SHA-256 commit hash) and scored when it resolves. Every item opens to the full call: forecast vs. observed, the Brier score, and the source that resolved it.',
  },
  {
    label: 'B-04 · CONVERGENCE',
    title: 'Convergence.',
    body: 'The live wire of multi-domain events, each drillable to its contributing anomalies and its mapped location.',
  },
];

export function BriefsShowcase() {
  return (
    <section className="section" id="briefs">
      <div className="section-head">
        <div className="section-kicker">·· BRIEFS · The reading room ··</div>
        <h2 className="section-title">
          Reporting you can <span className="accent">audit</span>, not just read.
        </h2>
        <p className="section-sub">
          Everywhere else, eYKON shows you the data. In BRIEFS it commits to a call — and
          lets you check how well it held up.
        </p>
      </div>

      <div className="briefs-tiles">
        {BRIEFS_TILES.map(t => (
          <div className="pillar" key={t.label}>
            <div className="pillar-label">{t.label}</div>
            <div className="pillar-title">{t.title}</div>
            <p className="pillar-body">{t.body}</p>
          </div>
        ))}
      </div>

      <p className="integrity-line">
        The public track record, one item at a time. Don&apos;t trust us — audit us.
      </p>
    </section>
  );
}
