// ─── Provenance envelope for MCP tool results ────────────────────
//
// WHY THIS EXISTS
//
// A tool result returned over MCP lands inside somebody else's agent
// with no eYKON page around it. There is no ILLUSTRATIVE banner, no
// ProvenanceChip, no honesty board and no footnote — just numbers, in
// a context window, being reasoned over. This is the same argument
// §13.4.2 makes about visual assets: "a card is the only artifact we
// produce that travels WITHOUT its caveats". An MCP response is the
// second such artifact, and it travels further.
//
// So every result carries its own caveats inline.
//
// WHAT THIS IS NOT
//
// It is NOT a liveness reading. These are STATIC declarations of what
// each tool reads and what is known to be wrong with it, transcribed
// from the groundedness audit in the Consolidated Brief §14 (verified
// 2026-08-19). They do not know whether AIS died this morning.
//
// Two dates ride on every envelope and they must never be confused:
// `as_of` is the READ time (the moment this result was produced) and
// `groundedness_audited_on` is the date these declarations were last
// verified. They used to be one field, which made a constant look
// like a clock.
//
// That limitation is stated in the payload itself rather than hidden,
// and the honest upgrade is to drive `freshness` from the live
// feed-liveness records (migration 089 / the /start honesty board)
// instead of a hand-maintained table. Until that happens, a static
// declaration that says it is static beats a dynamic-looking field
// that is actually a constant — which is the §16.4 trap exactly.
//
// A tool with NO entry here reports 'not_characterised'. Silence must
// never read as health.

export type Grounding =
  | 'live'          // real ingest, and the audit found it dense
  | 'live_thin'     // real ingest, known-sparse coverage
  | 'live_lagging'  // real ingest, structural publication delay
  | 'model'         // deterministic simulation over stored inputs — not an observation
  | 'fixture'       // seeded/illustrative data — never quote as measurement
  | 'not_characterised';

export interface ToolProvenance {
  grounding: Grounding;
  /** What the tool actually reads. */
  source: string;
  /** Known limits a reader MUST have to interpret the numbers. */
  caveats: string[];
}

/**
 * Date the groundedness audit behind these declarations was verified
 * (Consolidated Brief §14). NOT the read time — that is `as_of`.
 */
export const GROUNDEDNESS_AUDITED_ON = '2026-08-19';

const COUNT_SITES =
  'Counts rows, not sites: the facility registry stores one row per generating unit, so several rows can share one physical location.';
const INGEST_SENSITIVE =
  'INGEST-SENSITIVE: volume is set partly by our own collection, so a change over time may describe our pipeline rather than the world. Do not treat a count change as an event.';

export const TOOL_PROVENANCE: Record<string, ToolProvenance> = {
  query_thermal_anomalies: {
    grounding: 'live',
    source: 'NASA FIRMS, 8 regional shards, 8 km proximity filter',
    caveats: [
      'A detection is a HOT PIXEL, not a confirmed fire and never a strike. Attribution is inference.',
      'Absence of detection is NOT absence of fire — cloud cover and overpass timing both suppress detections.',
      'Gas flaring at a working refinery is baseline, not news. Deviation from a facility\'s own baseline is the signal.',
      'Coverage is 10,556 of 13,262 facilities (79.6%). South America, Africa and Oceania are OUTSIDE the ingest boxes — those facilities have NO DATA, not zero.',
    ],
  },
  query_nightlights: {
    grounding: 'live_lagging',
    source: 'NASA VIIRS Black Marble VNP46A2, nightly at the FIRMS-watched facilities',
    caveats: [
      'Radiance is not power state. Cloud, snow and moon geometry all hide light.',
      'NASA publication lag is roughly 9 DAYS. Any answer here describes last week, not last night.',
      'Only confident_clear pixels are trustworthy; cloudy readings run ~100x higher because cloud scatters city light back at the sensor.',
      'Absence of a row is absence of a LOOK, never darkness.',
      COUNT_SITES,
    ],
  },
  query_conflicts: {
    grounding: 'live',
    source: 'GDELT event feed',
    caveats: [
      'Media-derived: this measures REPORTING, not ground truth. A quiet region may be unreported rather than quiet.',
      'GDELT fails odd ticks and self-recovers.',
    ],
  },
  query_vessels: {
    grounding: 'live',
    source: 'AIS',
    caveats: [
      // Was 'CHOKEPOINT-ONLY on the free tier. This is not global vessel
      // coverage.' That stopped being true on 2026-08-24, when ingest
      // stepped up roughly 120x to four broad boxes plus six chokepoints.
      // The line survived because these caveats are a STATIC declaration
      // from the 2026-08-19 audit — five days before the change — so the
      // envelope went on denying coverage the payload was visibly
      // returning: a North Sea query came back with vessels off Stavanger,
      // Peterhead and the German Bight under a caveat saying chokepoints
      // only. A caveat contradicted by the rows beside it is worse than no
      // caveat: it teaches a reader to discount the honest ones too.
      // Re-measured against production 2026-09-10: 186,789 vessels,
      // 33,726 refreshed in 24h, spanning -90..89.9 lat / -180..179.9 lon.
      'GLOBAL IN EXTENT, PARTIAL IN DENSITY. ~33.7k vessels refresh in any 24h against a world AIS fleet several times that — a box can be genuinely covered and still be missing ships. Absence of a vessel is not absence of a vessel.',
      'The feed was fully down for at least ten days in August 2026 on a provider quota, and ingest stepped up sharply on 2026-08-24 — a count compared across that date measures our pipeline, not the world.',
      'vessel_positions is a CURRENT-STATE snapshot keyed per MMSI — one row per vessel, not a position history.',
      INGEST_SENSITIVE,
    ],
  },
  query_aircraft: {
    grounding: 'live',
    source: 'ADS-B via ADSBexchange',
    caveats: [
      'aircraft_positions is a current-state snapshot, not a track history.',
      INGEST_SENSITIVE,
    ],
  },
  query_calibration: {
    grounding: 'live',
    source: 'eYKON forecast register — resolved outcomes, Brier and skill by family',
    caveats: [
      'Three tracks that never blend: machine (sensor observables), house (eYKON\'s own forecasts), creator.',
      'The house track is HASHED at issue and publicly recomputable. "Sealed" is the creator-track word and means something different — do not swap them.',
      'Small n. Read the n on every family before quoting a score.',
      'Skill measures DISCRIMINATION against a family\'s own base rate. A negative skill means worse than always predicting the base rate, not "wrong".',
    ],
  },
  query_convergences: {
    grounding: 'live',
    source: 'convergence engine, scored on distinct independent source classes',
    caveats: [
      'Scored on INDEPENDENT SOURCE CLASSES, not domain count. Conflict and Energy are both GDELT-derived and count as ONE class.',
      'Every row carries a corroboration level: single-source (reported, not confirmed), multi-source, or sensor-confirmed.',
      'Rows predating the source-class model read as unknown and were deliberately not back-filled.',
    ],
  },
  query_regime_shifts: {
    grounding: 'live',
    source: 'nightly two-sample Kolmogorov-Smirnov over 6 theatres x 5 signals',
    caveats: [
      'Detection threshold is p < 0.01.',
      'Ingest-sensitive signals (vessel and flight counts) can never raise a flag here, by construction.',
    ],
  },
  query_shadow_fleet_leads: {
    grounding: 'live',
    source: 'AIS dark-gap and flag-of-convenience scoring',
    caveats: [
      'Depends on the AIS feed, which is thin and chokepoint-only. Gaps are measured on the DATA CLOCK, not the wall clock.',
      'A lead is a lead, not a finding.',
    ],
  },
  query_posture_scores: {
    grounding: 'live',
    source: 'computed posture by theatre',
    caveats: ['Derived score, not an observation. State the window when quoting.'],
  },
  query_agent_reports: {
    grounding: 'live',
    source: 'hourly grounded reports derived from anomaly flags',
    caveats: ['LLM-written prose grounded on flagged anomalies. Treat as analysis, not measurement.'],
  },
  query_mines: {
    grounding: 'fixture',
    source: 'Critical-minerals workspace — seeded reference data',
    caveats: [
      'FIXTURE-BACKED. Excluded from demos in the platform\'s own groundedness rule. Do NOT quote as a measurement.',
    ],
  },
  run_chokepoint_scenario: {
    grounding: 'model',
    source: 'deterministic chokepoint closure simulation',
    caveats: [
      'This is a MODEL, not an observation. Output is a consequence of the assumptions supplied, not evidence about the world.',
      'Defensible as a scenario. Never quote as data.',
    ],
  },
  run_sanctions_wargame: {
    grounding: 'model',
    source: 'sanctions wargame over the OFAC entity graph',
    caveats: [
      'The entity graph is real (OFAC SDN). The elasticity dynamics are a LABELLED MODEL.',
      'Never quote a modelled second-order effect as a measurement.',
    ],
  },
};

export interface Envelope {
  /** When this result was read: ISO 8601, server clock. */
  as_of: string;
  /** Date the grounding and caveats below were last verified. */
  groundedness_audited_on: string;
  grounding: Grounding;
  source: string;
  caveats: string[];
  /** Says out loud that grounding is declared, not measured live. */
  note: string;
}

export function envelopeFor(toolName: string): Envelope {
  const as_of = new Date().toISOString();
  const p = TOOL_PROVENANCE[toolName];
  if (!p) {
    return {
      as_of,
      groundedness_audited_on: GROUNDEDNESS_AUDITED_ON,
      grounding: 'not_characterised',
      source: 'unknown',
      caveats: [
        'This tool has no provenance declaration. Absence of a caveat here is NOT a statement that the data is sound — it means nobody has characterised it.',
      ],
      note: `as_of is when this result was read. Grounding and caveats are a static declaration from the groundedness audit of ${GROUNDEDNESS_AUDITED_ON}; they do not reflect current feed liveness.`,
    };
  }
  return {
    as_of,
    groundedness_audited_on: GROUNDEDNESS_AUDITED_ON,
    grounding: p.grounding,
    source: p.source,
    caveats: p.caveats,
    note: `as_of is when this result was read. Grounding and caveats are a static declaration from the groundedness audit of ${GROUNDEDNESS_AUDITED_ON}; they do not reflect current feed liveness — a feed can be down while this still reads "live".`,
  };
}
