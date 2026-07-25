// ─── ACLED API client ──────────────────────────────────────────────
// Fetches curated conflict events from ACLED (Armed Conflict Location &
// Event Data) for ingest into conflict_events (source='ACLED').
//
// Why ACLED alongside GDELT: GDELT is a 15-minute media firehose — fast
// but noisy (political-crisis reporting gets coded as Fight/Assault,
// inflating clusters) and it writes FIPS country codes ('UP' for Ukraine),
// which is why query_conflicts(country="Ukraine") returns 0. ACLED is
// human-curated, precisely geocoded, carries REAL fatality counts, and
// writes full country names. conflict_events was in fact built for ACLED
// (source DEFAULT 'ACLED', a fatalities column, a metric literally named
// acled_events); GDELT was bolted on. This client feeds the source it was
// designed for.
//
// ─── Auth, deliberately dual-mode ──────────────────────────────────
// ACLED moved to OAuth2 (~2024); legacy key+email accounts still work.
// Rather than hardcode one and guess wrong, this supports BOTH and logs
// which path it used, so the first real run confirms the auth cheaply:
//   • OAuth2   — set ACLED_USERNAME + ACLED_PASSWORD (password grant)
//   • Legacy   — set ACLED_API_KEY + ACLED_EMAIL (query-param auth)
// The field mapping and pagination below are identical either way and are
// the durable part; only getReadContext() differs by mode.

const OAUTH_TOKEN_URL = 'https://acleddata.com/oauth/token';
const NEW_READ_URL = 'https://acleddata.com/api/acled/read';
const LEGACY_READ_URL = 'https://api.acleddata.com/acled/read';

const PAGE_LIMIT = 5000; // ACLED default page size
const MAX_PAGES = 40; // safety bound (~200k events) so a bad window can't loop forever

export interface AcledRawEvent {
  event_id_cnty?: string;
  data_id?: string | number;
  event_date?: string;
  event_type?: string;
  sub_event_type?: string;
  actor1?: string;
  actor2?: string;
  country?: string;
  latitude?: string | number;
  longitude?: string | number;
  fatalities?: string | number;
  notes?: string;
}

interface AcledResponse {
  success?: boolean;
  count?: number;
  data?: AcledRawEvent[];
  error?: unknown;
  message?: string;
}

interface ReadContext {
  mode: 'oauth2' | 'legacy';
  baseUrl: string;
  headers: Record<string, string>;
  authParams: Record<string, string>; // merged into the query string (legacy key/email)
}

async function getOAuthToken(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    client_id: 'acled',
    scope: 'authenticated', // required by ACLED's OAuth2 token endpoint (verified against acleddata.com docs, 2026-07)
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`ACLED OAuth token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('ACLED OAuth response had no access_token');
  return j.access_token;
}

async function resolveReadContext(): Promise<ReadContext> {
  const username = process.env.ACLED_USERNAME;
  const password = process.env.ACLED_PASSWORD;
  const key = process.env.ACLED_API_KEY;
  const email = process.env.ACLED_EMAIL;

  if (username && password) {
    const token = await getOAuthToken(username, password);
    return {
      mode: 'oauth2',
      baseUrl: NEW_READ_URL,
      headers: { authorization: `Bearer ${token}` },
      authParams: {},
    };
  }
  if (key && email) {
    return {
      mode: 'legacy',
      baseUrl: LEGACY_READ_URL,
      headers: {},
      authParams: { key, email },
    };
  }
  throw new Error(
    'ACLED credentials missing: set ACLED_USERNAME+ACLED_PASSWORD (OAuth2) or ACLED_API_KEY+ACLED_EMAIL (legacy).',
  );
}

/**
 * Fetch every ACLED event with event_date >= sinceDate (YYYY-MM-DD),
 * paging until the last page. Returns raw events; mapping to
 * conflict_events happens in the route so the shape stays visible there.
 *
 * Windowed on event_date (not ingest time): ACLED codes events with an
 * accurate event_date and backfills late-coded events into earlier days,
 * so a trailing window re-fetches and the upsert de-dupes on event_id.
 */
export async function fetchAcledEvents(
  sinceDate: string,
): Promise<{ events: AcledRawEvent[]; mode: string; pages: number }> {
  const ctx = await resolveReadContext();
  const all: AcledRawEvent[] = [];
  let page = 0;

  for (page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      ...ctx.authParams,
      _format: 'json',
      event_date: sinceDate,
      event_date_where: '>=',
      limit: String(PAGE_LIMIT),
      page: String(page),
    });
    const url = `${ctx.baseUrl}?${params.toString()}`;
    const res = await fetch(url, { headers: ctx.headers, cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`ACLED read HTTP ${res.status} (page ${page}): ${(await res.text()).slice(0, 200)}`);
    }
    const j = (await res.json()) as AcledResponse;
    if (j.success === false) {
      throw new Error(`ACLED read error: ${j.message ?? JSON.stringify(j.error)}`);
    }
    const batch = j.data ?? [];
    all.push(...batch);
    if (batch.length < PAGE_LIMIT) break; // last page
  }

  return { events: all, mode: ctx.mode, pages: page };
}
