/**
 * Screen 1 — the proof. The Kuwait outage as the opening argument
 * (brief v1.3 §4.1): lead with the single most defensible thing the
 * platform has ever done, presented as evidence rather than as a claim.
 *
 * The table is STATIC AND HARD-CODED on purpose. This is a historical
 * event (2026-07-21→23, founder-confirmed) — wiring it to a live query
 * could only make it wrong. Figures are the verified radiance values
 * from the Consolidated Brief §6.3, in nW·cm⁻²·sr⁻¹.
 *
 * The copy must never say "detected a fire", "confirmed strike" or
 * "predicted" — radiance is not power state, and the honesty invariant
 * holds in marketing copy exactly as it holds in the resolver.
 */
export function ProofBlock() {
  return (
    <section className="cs-section" id="proof">
      <div className="cs-kicker">·· 2026-08-01 · Kuwait ··</div>
      <h1 className="cs-h1">
        We saw a national
        <br />
        blackout <span className="cs-dim">from orbit.</span>
      </h1>
      <p className="cs-sub" style={{ marginTop: 16 }}>
        No news input. No analyst tip. Three neighbouring facilities, three consecutive
        confidently-clear nights, one monotonic collapse in emitted light. The founder
        confirmed it independently the next morning.
      </p>

      <div className="cs-evidence">
        <div className="cs-evhead">
          <span>NASA VIIRS VNP46A2 · NIGHT-TIME RADIANCE · nW·cm⁻²·sr⁻¹</span>
          <span>CONFIDENT_CLEAR · 9/9 PX</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>FACILITY</th>
              <th>BASELINE</th>
              <th>JUL 21</th>
              <th>JUL 22</th>
              <th>JUL 23</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="cs-f">Az Zour South power plant</td>
              <td className="cs-base">~97</td>
              <td className="cs-drop">7.2</td>
              <td className="cs-drop">5.5</td>
              <td className="cs-drop">4.7</td>
            </tr>
            <tr>
              <td className="cs-f">Az Zour North power plant</td>
              <td className="cs-base">~46</td>
              <td className="cs-drop">5.4</td>
              <td className="cs-drop">4.6</td>
              <td className="cs-drop">3.4</td>
            </tr>
            <tr>
              <td className="cs-f">Mina Al Ahmadi Refinery</td>
              <td className="cs-base">~104</td>
              <td className="cs-drop">16.7</td>
              <td className="cs-base">—</td>
              <td className="cs-base">—</td>
            </tr>
          </tbody>
        </table>
        <div className="cs-evfoot">
          A cloud artefact appears once and vanishes.{' '}
          <span className="cs-ok">
            A monotonic decline across three neighbouring facilities on confidently-clear
            nights is a regional event.
          </span>
        </div>
      </div>
    </section>
  );
}
