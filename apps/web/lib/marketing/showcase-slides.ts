import type { Slide } from '@/components/landing/ShowcaseRotator';
import { PLATFORM_STATS as PS, stat } from '@/lib/marketing/platform-stats';

/**
 * Slide copy for the two showcase rotators.
 *
 * Kept out of Landing.tsx so the page file stays a layout, not a content
 * store, and so the numbers resolve from platform-stats rather than being
 * retyped — the failure #441 existed to fix.
 *
 * Screenshots were captured from the live product at 1440×900 and downsampled
 * to 1100 wide. Anything recaptured must keep that aspect ratio or the rotator
 * frame will letterbox as it cycles.
 */

export const PILLAR_SLIDES: Slide[] = [
  {
    code: 'P-01 · GLOBE',
    title: 'The state of the world, on one screen — free for everyone.',
    body:
      `Aircraft, conflict events, thermal anomalies, night-time radiance, chokepoint vessel ` +
      `coverage and weather, over the infrastructure that makes them interpretable: ` +
      `${stat(PS.powerPlantUnits)} power-plant units across ${stat(PS.powerPlants)} plants, ` +
      `${stat(PS.refineries)} refineries, ${stat(PS.mineralDeposits)} mineral deposits, ` +
      `${stat(PS.seaports)} seaports, ${stat(PS.airfields)} airports and airfields. Every layer ` +
      `carries its source and refresh timestamp inline.`,
    shot: '/marketing/p01-globe.jpg',
    alt: 'The eYKON globe with its layer menu open, showing live aircraft, vessel, conflict, thermal and night-lights counts.',
  },
  {
    code: 'P-02 · AI ANALYST',
    title: 'Ask in plain English. It queries the database.',
    body:
      `A Claude analyst with a catalog of ${PS.analystTools} first-class tools wired directly ` +
      `into the live feeds and the platform's proprietary signal tables — no SQL, no guessing ` +
      `from documentation. When the data cannot support an answer, it says so.`,
    shot: '/marketing/p02-analyst.jpg',
    alt: 'The AI Analyst workspace with its session rail and query composer.',
  },
  {
    code: 'P-03 · INTEL',
    title: 'Nine workspaces where signals become decisions.',
    body:
      `Calibration Ledger, Shadow Fleet, Regime Shifts, Chokepoint Simulator, Sanctions ` +
      `Wargame, Cascade Propagation, Precursor Analogs, Commodities and Critical Minerals — ` +
      `compound signals computed on eYKON infrastructure, with posture scores for ` +
      `${PS.postureTheatres} named theatres refreshed every 30 minutes.`,
    shot: '/marketing/p03-intel.jpg',
    alt: 'The Intelligence Center dashboard with the nine workspaces listed in the sidebar.',
  },
  {
    code: 'P-04 · NOTIF',
    title: 'Alerts that watch four different ways.',
    body:
      `Single-event, multi-event, outcome-driven AI, and cross-data convergence rules — ` +
      `evaluated on 15-minute and hourly cadences, delivered by email, SMS and WhatsApp, with ` +
      `a persona-tuned starter library so a working pipeline takes three clicks.`,
    shot: '/marketing/p04-notif.jpg',
    alt: 'The Notification Center rule builder showing persona-tuned starter rules.',
  },
  {
    code: 'P-05 · COMM',
    title: 'The network where being right is measurable.',
    body:
      `Sealed, commit-reveal predictions scored against live outcomes; a leaderboard ranked by ` +
      `Brier-skill rather than follower count; rooms, DMs and an in-room analyst; paid Spaces ` +
      `in non-custodial USDC. Wrong calls are left standing.`,
    shot: '/marketing/p05-comm.jpg',
    alt: 'The COMM leaderboard, ranked by Brier skill.',
  },
  {
    code: 'P-06 · BRIEFS',
    title: 'What eYKON publishes back.',
    body:
      `A daily brief composed each morning from the live feeds, persona digests, the ` +
      `convergence wire — and eYKON's own forecasts, hashed at issue and scored in public ` +
      `when they resolve. Reporting you can audit, not just read.`,
    shot: '/marketing/p06-briefs.jpg',
    alt: 'The Forecasts board in BRIEFS, showing issued forecasts and their resolution state.',
  },
];

/**
 * Eight worksheets, not nine.
 *
 * Critical Minerals is deliberately absent: the workspace is still
 * fixture-backed, and a screenshot of fixture data on the page that says
 * "Don't trust us. Audit us." is the one thing this section must not do.
 * Add the ninth slide when the panel is grounded — the rotator takes the
 * length of the array, so it is one entry and no other change.
 */
export const WORKSHEET_SLIDES: Slide[] = [
  {
    code: 'W-01 · CALIBRATION LEDGER',
    title: 'Every claim, scored in public.',
    body:
      `Brier and log-loss across 7-, 30- and 90-day windows, with a reliability curve and ` +
      `per-family skill. Machine, house and creator tracks that never blend. Voids are ` +
      `excluded from scoring, never counted as wins.`,
    shot: '/marketing/w01-calibration.jpg',
    alt: 'The Calibration Ledger showing the three tracks, a reliability curve and per-family Brier scores.',
  },
  {
    code: 'W-02 · SHADOW FLEET',
    title: 'Ranked vessel leads, with the evidence attached.',
    body:
      `AIS dark-gap detection and flag-of-convenience scoring, measured on the data clock ` +
      `rather than row age. Every lead drills to the observations that produced it.`,
    shot: '/marketing/w02-shadow-fleet.jpg',
    alt: 'The Shadow Fleet board listing ranked vessel leads with composite scores.',
  },
  {
    code: 'W-03 · REGIME SHIFTS',
    title: 'A real statistical test, not a percentage in disguise.',
    body:
      `A two-sample Kolmogorov–Smirnov test across six theatres and five signals, nightly, at ` +
      `p < 0.01. Nights before the test could run render hollow rather than implying continuity.`,
    shot: '/marketing/w03-regime-shifts.jpg',
    alt: 'The Regime Shifts matrix with its persistence strip and distribution inset.',
  },
  {
    code: 'W-04 · COMMODITIES',
    title: 'Grounded panel by panel, cited row by row.',
    body:
      `Primary-source seeds — USDA, ITC, EIA, USGS — cited per row, with a measured ` +
      `designation trend clamped to the ingest onset. Corridors write no row at all when the ` +
      `feed is stale, rather than recording a zero.`,
    shot: '/marketing/w04-commodities.jpg',
    alt: 'The Commodities workspace with per-row source citations.',
  },
  {
    code: 'W-05 · SANCTIONS WARGAME',
    title: 'Walks the real designation network.',
    body:
      `${stat(PS.ofacEntities)} OFAC entities rebuilt weekly, with counterparty exposure mapped ` +
      `from a primary designation. Synthetic fallback nodes are flagged individually; the ` +
      `elasticity dynamics remain a labelled model.`,
    shot: '/marketing/w05-sanctions.jpg',
    alt: 'The Sanctions Wargame entity network traced from a primary designation.',
  },
  {
    code: 'W-06 · CHOKEPOINT SIMULATOR',
    flag: 'Illustrative model',
    title: 'A stress test, and it says so.',
    body:
      `A deterministic model of closure and diversion, carrying a visible ILLUSTRATIVE banner ` +
      `in the product. Defensible as a model — never quoted as data.`,
    shot: '/marketing/w06-chokepoint.jpg',
    alt: 'The Chokepoint Simulator with its ILLUSTRATIVE banner visible.',
  },
  {
    code: 'W-07 · CASCADE PROPAGATION',
    flag: 'Illustrative model',
    title: 'Downstream impact, one step at a time.',
    body:
      `Refinery hit, product crack, affected tickers. Node state is observed from the sensors ` +
      `where coverage exists; the propagation itself is a labelled model.`,
    shot: '/marketing/w07-cascade.jpg',
    alt: 'The Cascade Propagation graph with its ILLUSTRATIVE banner visible.',
  },
  {
    code: 'W-08 · PRECURSOR ANALOGS',
    title: 'Pattern-matching against what happened before.',
    body:
      `The current-theatre vector and sidebar composites run live from posture scores on a ` +
      `30-day window. The episode library itself is still badged ILLUSTRATIVE.`,
    shot: '/marketing/w08-precursor.jpg',
    alt: 'Precursor Analogs showing the current-theatre vector beside sidebar composites.',
  },
];
