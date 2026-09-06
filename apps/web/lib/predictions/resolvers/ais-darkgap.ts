import type { Resolver, SupabaseAny } from './types';

/**
 * Dark-contact reappearance resolver (machine track).
 *
 * HOW THE EVENT ROW IS FOUND — and why it is no longer found by timestamp.
 *
 * The claim's target_observable is `ais:dark_contact:<mmsi>:<gap_started_at ISO>`,
 * which mirrors the event table's UNIQUE (mmsi, gap_started_at) dedup key. That
 * makes it a good IDEMPOTENCY key and a terrible LOOKUP key: the issuer builds it
 * with Date#toISOString(), which is MILLISECOND precision, while
 * dark_contact_events.gap_started_at is a timestamptz holding MICROSECONDS. So
 * `.eq('gap_started_at', '2026-08-25T01:06:42.842Z')` never matched a row stored
 * as 01:06:42.842297+00 — it missed by 297 microseconds.
 *
 * The resolver then read that miss as evidence the event did not exist and, after
 * the 7-day grace, VOIDed the claim with "event row not found". Measured on
 * production 2026-09-06: 450 of 450 voided claims had their event row present and
 * RESOLVED, and 0 were genuinely missing. Exact-timestamp matching returned 0/450;
 * second-truncated matching returned 450/450. A further 34,081 overdue claims were
 * in the same state, unresolved rather than voided only because they had not yet
 * aged past the grace window.
 *
 * That is worse than a missed score. VOID is reserved for "we did not look" — the
 * platform's first directive. Here we looked, the answer was there, and the
 * resolver filed it as absence. It MANUFACTURED voids on the one track that is
 * supposed to prove the instruments work.
 *
 * THE FIX: resolve by context.event_id — the event's own uuid primary key, written
 * onto every claim at issue time by issue-dark-contact.ts and present on 46,936 of
 * 46,936 machine rows in production. An identifier that never round-trips through
 * string formatting cannot drift. The timestamp path is kept only for rows with no
 * event_id (none exist today) and is now a half-open RANGE over the millisecond the
 * key encodes, so sub-millisecond precision can never bite again.
 *
 * The event lifecycle (hourly compute-shadow-fleet-scores, mig 112) remains the
 * single source of truth; this resolver only translates its terminal states:
 *
 *   reappeared  -> observed = 1  (a newer fix arrived — positive observation)
 *   still_dark  -> observed = 0  (not re-observed in 72 h — what the claim denied)
 *   void        -> VOID with the event's own coverage_lost reason
 *   open        -> null (defer to the next tick)
 *   MISSING     -> defer 7 days past resolution, then VOID with a stated reason.
 *                  This path is correct and stays; it is simply no longer reached
 *                  by rows whose event exists.
 */

const VOID_AFTER_MISSING_DAYS = 7;

type EventRow = {
  status: string | null;
  resolution: string | null;
  void_reason: string | null;
  closed_at: string | null;
};

export const resolveAisDarkgap: Resolver = async (row, supabase) => {
  const ev = await findEvent(row, supabase);

  // A transient lookup failure must not be read as absence — that is the whole
  // bug this file exists to correct. undefined = "could not ask", retry later.
  if (ev === undefined) return null;

  if (ev === null) {
    const overdueMs = Date.now() - Date.parse(row.resolves_at);
    if (overdueMs > VOID_AFTER_MISSING_DAYS * 86_400_000) {
      return {
        observed: 0,
        source_url: '/intel/shadow-fleet',
        void_reason: `event row not found for ${row.target_observable} within ${VOID_AFTER_MISSING_DAYS} days of resolution`,
      };
    }
    return null;
  }

  if (ev.status === 'open') return null;

  if (ev.status === 'void') {
    return {
      observed: 0,
      source_url: '/intel/shadow-fleet',
      void_reason: ev.void_reason ?? 'coverage_lost',
    };
  }

  return {
    observed: ev.resolution === 'reappeared' ? 1 : 0,
    source_url: '/intel/shadow-fleet',
  };
};

const EVENT_COLUMNS = 'status, resolution, void_reason, closed_at';

/**
 * Returns the event row, null when it provably does not exist, or undefined when
 * the lookup itself failed. The three states are distinct on purpose: collapsing
 * "could not ask" into "not there" is what produced 450 false voids.
 */
async function findEvent(
  row: { target_observable: string; context: Record<string, unknown> | null },
  supabase: SupabaseAny,
): Promise<EventRow | null | undefined> {
  const eventId = readEventId(row.context);

  if (eventId) {
    const { data, error } = await supabase
      .from('dark_contact_events')
      .select(EVENT_COLUMNS)
      .eq('id', eventId)
      .maybeSingle();
    if (error) return undefined;
    if (data) return data as EventRow;
    // Fall through: an event_id that resolves to nothing is worth one more
    // attempt on the natural key before we call it missing.
  }

  const parsed = parse(row.target_observable);
  if (!parsed) return eventId ? null : undefined;

  // Half-open range over the millisecond the observable encodes. The key carries
  // ms precision; the column stores µs. Exact equality cannot match, so bound it.
  const startMs = Date.parse(parsed.gapStartedAt);
  if (Number.isNaN(startMs)) return undefined;
  const from = new Date(startMs).toISOString();
  const to = new Date(startMs + 1).toISOString();

  const { data, error } = await supabase
    .from('dark_contact_events')
    .select(EVENT_COLUMNS)
    .eq('mmsi', parsed.mmsi)
    .gte('gap_started_at', from)
    .lt('gap_started_at', to)
    .maybeSingle();

  if (error) return undefined;
  return (data as EventRow | null) ?? null;
}

function readEventId(context: Record<string, unknown> | null): string | null {
  const raw = context?.event_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function parse(observable: string): { mmsi: string; gapStartedAt: string } | null {
  // ais:dark_contact:<mmsi>:<ISO timestamp — itself contains colons>
  const prefix = 'ais:dark_contact:';
  if (!observable.startsWith(prefix)) return null;
  const rest = observable.slice(prefix.length);
  const firstColon = rest.indexOf(':');
  if (firstColon <= 0) return null;
  const mmsi = rest.slice(0, firstColon);
  const gapStartedAt = rest.slice(firstColon + 1);
  if (!mmsi || Number.isNaN(Date.parse(gapStartedAt))) return null;
  return { mmsi, gapStartedAt };
}
