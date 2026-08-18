import type { Persona } from '@/lib/closing/personas';

/**
 * Step 2 — the pitch, tailored (brief v1.4 §4.0).
 *
 * These three USPs replace the generic three cards of the linear page:
 * same slot, personalised, strictly better. Every claim here was checked
 * against production on 2026-08-16 (§4.9) — "six theatres × five signals"
 * and "2,113-entity actor graph" are true and verified; "six chokepoints"
 * was not, and is absent by design.
 */
export function PersonaPitch({ persona }: { persona: Persona }) {
  return (
    <>
      <div className="cs-kicker">S-02 {persona.tag}</div>
      <h2 className="cs-h2">
        {persona.head}
        <br />
        <span className="cs-dim">{persona.headAccent}</span>
      </h2>

      <div className="cs-quotebox">
        <span className="cs-plabel">The problem we&apos;re solving for you</span>
        <p className="cs-quote">{persona.issue}</p>
      </div>

      <div className="cs-usps">
        {persona.usps.map((u) => (
          <div className="cs-usp" key={u.title}>
            <h3>{u.title}</h3>
            <p>{u.body}</p>
          </div>
        ))}
      </div>
    </>
  );
}
