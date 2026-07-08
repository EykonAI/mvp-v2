// IMF SDMX 2.1 client — PCPS (Primary Commodity Price System), direct
// from the IMF's post-migration data portal. Keyless and current.
//
// Why this exists (P2b follow-up, 2026-07-08): the original monthly
// price layer used the DBnomics IMF mirror, which silently froze at
// 2025-06 when the IMF decommissioned its old CompactData API. The new
// portal serves PCPS directly. FRED was evaluated as an alternative but
// only mirrors 5 of our 8 slugs (no cobalt/lithium/REE).
//
// Series key format (PCPS dataflow 9.0.0, verified live 2026-07-08):
//   /data/PCPS/G001.<INDICATOR>.USD.M
// where G001 = world, USD = benchmark price in US dollars, M = monthly.
// Observations come back as SDMX structure-specific XML with
// TIME_PERIOD="YYYY-MM" ("YYYY-M05" style) + OBS_VALUE attributes — a
// narrow regex parse keeps us dependency-free.

const IMF_SDMX_BASE = 'https://api.imf.org/external/sdmx/2.1';

export interface ImfObservation {
  period: string; // YYYY-MM-DD (first of month)
  value: number;
}

export async function fetchImfPcpsMonthlyUsd(
  indicator: string,
  opts?: { startYear?: number },
): Promise<ImfObservation[]> {
  const startYear = opts?.startYear ?? new Date().getUTCFullYear() - 3;
  const url = `${IMF_SDMX_BASE}/data/PCPS/G001.${indicator}.USD.M?startPeriod=${startYear}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/xml' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`IMF PCPS ${indicator}: HTTP ${res.status}`);
  }
  const xml = await res.text();

  const out: ImfObservation[] = [];
  const re = /TIME_PERIOD="(\d{4})-M(\d{2})"[^>]*OBS_VALUE="([0-9.eE+-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const value = Number(m[3]);
    if (Number.isFinite(value)) {
      out.push({ period: `${m[1]}-${m[2]}-01`, value });
    }
  }
  out.sort((a, b) => a.period.localeCompare(b.period));
  return out;
}
