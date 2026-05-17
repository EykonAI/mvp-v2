import type { Resolver } from './types';

/**
 * OFAC SDN resolver.
 *
 * target_observable conventions:
 *   • `ofac:ent:<ent_num>`            — exact entity match by number
 *   • `ofac:name:<case-insensitive substring>` — name pattern match
 *
 * Resolves to 1.0 if at least one matching SDN designation has
 * first_seen_at in [issued_at, resolves_at] — i.e. Treasury added it
 * during the prediction window. Resolves to 0.0 once resolves_at has
 * passed and no match landed.
 *
 * The cron runs hourly and only picks up rows past resolves_at, so the
 * 0.0 outcome triggers automatically the first time the resolver runs
 * after the deadline.
 */
export const resolveOfac: Resolver = async (row, supabase) => {
  const parsed = parseTargetObservable(row.target_observable);
  if (!parsed) return null;

  let q = supabase
    .from('ofac_designations')
    .select('ent_num, sdn_name, first_seen_at')
    .gte('first_seen_at', row.issued_at)
    .lte('first_seen_at', row.resolves_at)
    .limit(1);

  if (parsed.kind === 'ent') {
    q = q.eq('ent_num', parsed.ent_num);
  } else {
    q = q.ilike('sdn_name', `%${parsed.pattern}%`);
  }

  const { data, error } = await q.maybeSingle();
  if (error) return null;

  if (data) {
    return {
      observed: 1,
      source_url: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${data.ent_num}`,
    };
  }

  // No match in window — the deadline has passed (cron only picks up
  // rows where resolves_at <= NOW), so this is a confirmed negative.
  return {
    observed: 0,
    source_url: 'https://sanctionssearch.ofac.treas.gov/',
  };
};

type ParsedTarget =
  | { kind: 'ent'; ent_num: number }
  | { kind: 'name'; pattern: string };

function parseTargetObservable(t: string): ParsedTarget | null {
  if (!t.startsWith('ofac:')) return null;
  const rest = t.slice('ofac:'.length);
  if (rest.startsWith('ent:')) {
    const ent = parseInt(rest.slice('ent:'.length), 10);
    return Number.isFinite(ent) ? { kind: 'ent', ent_num: ent } : null;
  }
  if (rest.startsWith('name:')) {
    const pattern = rest.slice('name:'.length).trim();
    return pattern.length > 0 ? { kind: 'name', pattern } : null;
  }
  return null;
}
