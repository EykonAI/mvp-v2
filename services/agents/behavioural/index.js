/**
 * eYKON.ai — Behavioural Sub-Agent
 *
 * Owns user_interest_vectors + blind-spot candidate generation.
 * Reads user_events (clicks, dwell, queries, persona changes) and
 * the user's watchlists; writes/updates a 64-dim interest vector
 * and a short list of blind-spot candidates (topics the user has
 * no signal on but that co-occur in similar users' vectors).
 *
 * Runs nightly. Can be wired up as a Railway cron job pointed at
 * this file, or invoked from the Supervisor heartbeat.
 */

'use strict';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  return res.json();
}

// 32 candidate topics the user could show interest in.
const TOPIC_AXES = [
  'maritime', 'aircraft', 'conflict', 'energy', 'imagery',
  'red_sea', 'hormuz', 'black_sea', 'taiwan', 'gulf_guinea',
  'rare_earths', 'lithium', 'cobalt', 'oil', 'gas', 'grain',
  'sanctions', 'shadow_fleet', 'pipelines', 'refineries',
  'ports', 'flags', 'owners', 'imo',
  'arctic', 'central_asia', 'lng', 'copper', 'africa',
  'south_america', 'europe_grid', 'convergence',
];

function dimIndexForEvent(evt) {
  const t = String(evt.target ?? '').toLowerCase();
  for (let i = 0; i < TOPIC_AXES.length; i++) {
    if (t.includes(TOPIC_AXES[i])) return i;
  }
  return null;
}

async function run() {
  console.log(`[${new Date().toISOString()}] Behavioural agent start`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env vars — behavioural agent idle');
    return;
  }

  const users = await supabaseRequest('user_profiles?select=id&limit=500');
  if (!Array.isArray(users)) {
    console.error('Failed to load user_profiles:', users);
    return;
  }

  for (const u of users) {
    try {
      // Pull last 30 days of user_events for this user.
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
      const events = await supabaseRequest(
        `user_events?user_id=eq.${u.id}&created_at=gte.${since}&select=event_type,target,payload,created_at&limit=4000`,
      );
      if (!Array.isArray(events)) continue;

      // Bump the dim for each event, weighted by event type.
      const vec = new Array(64).fill(0);
      for (const e of events) {
        const idx = dimIndexForEvent(e);
        if (idx == null) continue;
        const w = e.event_type === 'pin' ? 4 : e.event_type === 'query' ? 2 : 1;
        vec[idx] += w;
      }

      // Normalise.
      const max = vec.reduce((a, b) => Math.max(a, b), 0) || 1;
      const normalised = vec.map(v => v / max);

      // Blind-spot candidates: topic axes the user has near-zero signal on
      // but which are popular globally (approximated here as a uniform prior).
      const blind = TOPIC_AXES
        .map((label, i) => ({ label, score: 0.6 - normalised[i] }))
        .filter(b => b.score > 0.55)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      await supabaseRequest('user_interest_vectors', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          user_id: u.id,
          vector: normalised,
          pinned_theatres: normalised
            .map((v, i) => ({ v, label: TOPIC_AXES[i] }))
            .filter(x => x.v > 0.4 && x.label && ['red_sea', 'hormuz', 'black_sea', 'taiwan', 'gulf_guinea'].includes(x.label))
            .map(x => x.label),
          blind_spots: blind,
          learned_at: new Date().toISOString(),
        }),
      });

      console.log(`  updated user ${u.id}: blind=${blind.map(b => b.label).join(',')}`);
    } catch (err) {
      console.error('behavioural agent user failure:', err?.message ?? err);
    }
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('behavioural agent fatal:', err);
    process.exit(1);
  });
}

module.exports = { run };
