import type { ClosingStatus } from '@/lib/closing/status';

/**
 * Screen 4 — the honesty block (brief v1.3 §4.4). Live / degraded /
 * model, generated from the database at request time. §14.9's hardest-won
 * outreach lesson, generalised to a page: honesty about a thin feed is
 * the strongest opener to a specialist in that feed — and it inoculates
 * against the falsification that otherwise arrives in the comments.
 *
 * Null counts render as "—", never as a number. The AIS cell computes its
 * own state: fresh within 24h reads LIVE (thin), anything older reads
 * DOWN with real days-since — so if the feed recovers, this page notices
 * before the marketing team does.
 */
const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));

export function HonestyBoard({ status }: { status: ClosingStatus }) {
  const ais =
    status.aisDaysSince == null
      ? { label: 'AIS vessels', note: '—' }
      : status.aisDaysSince < 1
        ? { label: 'AIS vessels', note: 'LIVE · thin, chokepoint-only' }
        : { label: 'AIS vessels', note: `DOWN ${status.aisDaysSince}d · provider quota` };

  return (
    <section className="cs-section" id="honesty">
      <div className="cs-kicker">·· Queried live · not a marketing claim ··</div>
      <h2 className="cs-h2">
        What is live, what is thin,
        <br />
        and what we don&apos;t have.
      </h2>
      <p className="cs-sub">
        Every intelligence vendor shows you the green lights. Here are ours, and the red
        ones, on the same screen — generated from the database when this page loaded.
      </p>

      <div className="cs-hon">
        <div className="cs-hcol">
          <div className="cs-hhead cs-hg">■ LIVE &amp; DENSE</div>
          <div className="cs-hrow"><span>FIRMS thermal</span><em>{fmt(status.thermal48h)} / 48h</em></div>
          <div className="cs-hrow"><span>GDELT conflict</span><em>{fmt(status.conflict48h)} / 48h</em></div>
          <div className="cs-hrow"><span>Night-lights</span><em>{fmt(status.nightlightsFacilities)} facilities · night of {status.nightlightsNewestNight ?? '—'}</em></div>
          <div className="cs-hrow"><span>Convergence</span><em>{fmt(status.convergences21d)} / 21d</em></div>
          <div className="cs-hrow"><span>OFAC entity graph</span><em>weekly</em></div>
          <div className="cs-hrow" style={{ borderBottom: 0 }}><span>Infrastructure</span><em>~183k assets</em></div>
        </div>
        <div className="cs-hcol">
          <div className="cs-hhead cs-ha">▲ DEGRADED — AND WE SAY SO</div>
          <div className="cs-hrow"><span>{ais.label}</span><em>{ais.note}</em></div>
          <div className="cs-hrow"><span>ADS-B aircraft</span><em>ingest-sensitive</em></div>
          <div className="cs-hrow"><span>Night-lights lag</span><em>~9d structural</em></div>
          <div className="cs-hnote">
            Displayed with a disclosure chip in-product. Cannot flag a regime shift or
            attribute one.
          </div>
        </div>
        <div className="cs-hcol">
          <div className="cs-hhead cs-hr">✕ MODEL, NOT DATA</div>
          <div className="cs-hrow"><span>Chokepoint simulator</span><em>fixture</em></div>
          <div className="cs-hrow"><span>Cascade propagation</span><em>fixture</em></div>
          <div className="cs-hrow"><span>Critical minerals</span><em>seeded</em></div>
          <div className="cs-hnote">
            Badged ILLUSTRATIVE in-product. Defensible as models — never quoted as
            observation.
          </div>
        </div>
      </div>

      <p className="cs-honline">
        A system that declines to explain its own instrument error is more credible than one
        that explains everything.
      </p>
    </section>
  );
}
