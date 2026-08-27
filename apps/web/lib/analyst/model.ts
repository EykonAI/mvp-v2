// ─── AI ANALYST v2 — model configuration (brief §8.7) ───────────
//
// SINGLE SOURCE OF TRUTH for every model id the analyst calls.
// Founder decision 2026-07-22: a model swap must be a config change,
// not a code hunt. No literal model string may appear anywhere else
// in the analyst path (engine, /api/chat, /api/analyst/*, run.ts,
// auto-title). The UI badge renders the value the server reports, so
// it can never mislabel again.
//
// Env overrides (optional — defaults below apply when unset):
//   ANALYST_MODEL          default interactive model
//   ANALYST_DEEP_MODEL     "Deep Analysis" mode (Pro+ only, §9.6)
//   ANALYST_UTILITY_MODEL  background calls: titles, summaries, tags
//
// Decided set (brief §8.6): Sonnet 5 default / Opus 4.8 deep /
// Haiku 4.5 utility.

export const DEFAULT_ANALYST_MODEL =
  process.env.ANALYST_MODEL || 'claude-sonnet-5';

export const DEEP_ANALYSIS_MODEL =
  process.env.ANALYST_DEEP_MODEL || 'claude-opus-4-8';

export const UTILITY_MODEL =
  process.env.ANALYST_UTILITY_MODEL || 'claude-haiku-4-5';

// ─── Beyond the analyst ──────────────────────────────────────────
// The NOTIF AI rule evaluator (lib/notifications/evaluator-ai.ts)
// used to carry its own literal — claude-opus-4-7, left behind when
// the analyst path was consolidated. That put the most expensive
// tier on the most repetitive job: an hourly cron, up to 50 events
// per rule, returning a single boolean.
//
// The evaluator makes ONE forced tool call and reads back a
// {fire, rationale} pair. That is orchestration, not deep synthesis
// — the same shape the analyst runs on Sonnet 5.
//
// Env override: NOTIF_EVALUATOR_MODEL.
export const EVALUATOR_MODEL =
  process.env.NOTIF_EVALUATOR_MODEL || 'claude-sonnet-5';

// The editorial path — the persisted daily brief and the legacy
// per-persona briefing. Plain prose from structured evidence, no
// tools. Kept separate from the analyst default so the writing voice
// can be tuned without touching the interactive workspace.
//
// Env override: EDITORIAL_MODEL.
export const EDITORIAL_MODEL =
  process.env.EDITORIAL_MODEL || 'claude-sonnet-5';

// The hourly anomaly-report cron (process-anomaly-flags): turns
// medium+ anomaly_flags into short grounded agent_reports.
//
// WHY THIS HAS ITS OWN KNOB. The cost ledger (mig 100) measured this
// as the platform's single largest variable cost — ~$0.0565 per
// report at Sonnet 5 against a MEASURED medium+ inflow of ~5.7/hour,
// i.e. roughly $230/month of pure platform overhead that no user pays
// for. It was invisible before the ledger existed.
//
// Note the cap (MAX_REPORTS_PER_TICK = 8) is NOT the cost driver:
// inflow is 5.7/hour and the backlog is zero, so the cap never binds.
// Lowering it would not save money, it would grow a backlog until the
// 14-day expiry silently discarded flags — cheaper only by dropping
// intelligence. Changing the MODEL is the one lever that halves cost
// with nothing degraded: the queue still drains at inflow and every
// medium+ flag still gets a report.
//
// Haiku 4.5 by default ($1/$5 vs Sonnet 5's $2/$10 — and vs $3/$15
// once Sonnet 5's intro pricing ends 2026-08-31). These are short
// summaries written from structured evidence the tools already
// fetched, which is the shape Haiku handles for auto-titles today.
//
// A/B IT BEFORE TRUSTING IT. Set ANOMALY_REPORT_MODEL=claude-sonnet-5
// in Railway to flip back with no deploy, and compare the narrative
// quality of a few agent_reports rows. These reports feed the
// analyst's query_agent_reports tool and the citizen briefing — the
// table that sat empty forever under the retired supervisor worker —
// so if Haiku reads thin, Sonnet at ~$230/month is the honest price
// of a feed that actually works.
//
// Caveat worth knowing: Haiku 4.5's context window is 200K, not the
// 1M of Sonnet 5 / Opus 4.8. That is ample for one flag plus its tool
// results, but a future prompt that grows the evidence block could
// hit it where Sonnet would not.
export const ANOMALY_REPORT_MODEL =
  process.env.ANOMALY_REPORT_MODEL || 'claude-haiku-4-5';

// The X copywriter (lib/copy/x-composer.ts): composes the newsjack X
// thread from an already-grounded evidence package.
//
// WHY SONNET AND NOT HAIKU, i.e. the opposite call to the one three
// lines above. That decision was about a repetitive job at volume:
// ~5.7 anomaly reports an HOUR, where the model writes a short
// summary from evidence the tools already fetched, and the choice was
// worth ~$115/month.
//
// This is the opposite shape. The SOP targets 4–8 newsjack events per
// 90 DAYS, so this fires roughly once a fortnight plus the occasional
// retry — cents per quarter at any tier. And the output is the entire
// public voice of the platform on the one channel where it does
// organic acquisition. Economising here saves nothing measurable and
// risks the only copy a cold reader ever sees.
//
// Env override: COPYWRITER_MODEL.
export const COPYWRITER_MODEL =
  process.env.COPYWRITER_MODEL || 'claude-sonnet-5';

// The three channel copywriters (lib/copy/channels/*). Same default and
// same reasoning as COPYWRITER_MODEL above: the volume is a handful of
// compositions a quarter, the output is public voice, and economising
// saves nothing measurable. Separate knobs so one channel can be
// cheapened later on evidence, not on a guess.
export const REDDIT_COPYWRITER_MODEL =
  process.env.REDDIT_COPYWRITER_MODEL || 'claude-sonnet-5';
export const DISCORD_COPYWRITER_MODEL =
  process.env.DISCORD_COPYWRITER_MODEL || 'claude-sonnet-5';
export const TIKTOK_COPYWRITER_MODEL =
  process.env.TIKTOK_COPYWRITER_MODEL || 'claude-sonnet-5';

// Models a session row may carry. Anything else is rejected on write.
export function allowedSessionModels(): string[] {
  return [DEFAULT_ANALYST_MODEL, DEEP_ANALYSIS_MODEL];
}

// Human label for the UI badge. Derived from the id so a config swap
// updates the badge automatically; falls back to the raw id rather
// than ever showing a stale hardcode.
export function modelLabel(modelId: string): string {
  const known: Array<[RegExp, string]> = [
    [/^claude-sonnet-5/, 'Sonnet 5'],
    [/^claude-opus-4-8/, 'Opus 4.8'],
    [/^claude-haiku-4-5/, 'Haiku 4.5'],
    [/^claude-sonnet-4-6/, 'Sonnet 4.6'],
    [/^claude-sonnet-4-5/, 'Sonnet 4.5'],
    [/^claude-opus-4-7/, 'Opus 4.7'],
  ];
  for (const [re, label] of known) {
    if (re.test(modelId)) return label;
  }
  return modelId;
}

// Output budget per leg of the agentic loop. Sonnet 5 runs adaptive
// thinking by default and its tokenizer counts ~30% more tokens than
// Sonnet 4.5, so the old 4096 would truncate — 8192 gives headroom
// for thinking + the answer without risking route timeouts.
export const ANALYST_MAX_TOKENS = 8192;

// Tool-use loop cap, unchanged from v1 behaviour.
export const ANALYST_MAX_ITERATIONS = 5;
