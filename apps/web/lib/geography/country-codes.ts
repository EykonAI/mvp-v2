// ─── Country-code normalisation across feeds ─────────────────────
//
// eYKON's data feeds encode country INCONSISTENTLY:
//   • conflict_events.country            → FIPS 10-4 (GDELT): Ukraine="UP", Russia="RS"
//   • refineries.country / firms facility obs / mines → ISO2: Ukraine="UA"
//   • power_plants.country               → full names: "Ukraine"
//
// A user or the model naturally types a country NAME ("Ukraine"), which
// then matched nothing on the FIPS/ISO2 feeds — the bug seen when
// query_conflicts(country="Ukraine") and query_thermal_anomalies(
// country="Iran") both returned 0. These resolvers translate whatever
// is passed (name / ISO2 / ISO3 / FIPS) into the encoding a given feed
// uses. Unmapped inputs return null so the caller can fall back to the
// raw value (no regression).
//
// Coverage is the conflict/energy-relevant set plus major economies.
// Extend the table as needed — every row is [name, iso2, iso3, fips].

type Row = { name: string; iso2: string; iso3: string; fips: string; aliases?: string[] };

const ROWS: Row[] = [
  { name: 'Ukraine', iso2: 'UA', iso3: 'UKR', fips: 'UP' },
  { name: 'Russia', iso2: 'RU', iso3: 'RUS', fips: 'RS', aliases: ['russian federation'] },
  { name: 'United States', iso2: 'US', iso3: 'USA', fips: 'US', aliases: ['usa', 'united states of america', 'america'] },
  { name: 'Iran', iso2: 'IR', iso3: 'IRN', fips: 'IR' },
  { name: 'Israel', iso2: 'IL', iso3: 'ISR', fips: 'IS' },
  { name: 'India', iso2: 'IN', iso3: 'IND', fips: 'IN' },
  { name: 'United Kingdom', iso2: 'GB', iso3: 'GBR', fips: 'UK', aliases: ['uk', 'britain', 'great britain'] },
  { name: 'Nigeria', iso2: 'NG', iso3: 'NGA', fips: 'NI' },
  { name: 'Australia', iso2: 'AU', iso3: 'AUS', fips: 'AS' },
  { name: 'Canada', iso2: 'CA', iso3: 'CAN', fips: 'CA' },
  { name: 'Pakistan', iso2: 'PK', iso3: 'PAK', fips: 'PK' },
  { name: 'Jordan', iso2: 'JO', iso3: 'JOR', fips: 'JO' },
  { name: 'China', iso2: 'CN', iso3: 'CHN', fips: 'CH' },
  { name: 'Mexico', iso2: 'MX', iso3: 'MEX', fips: 'MX' },
  { name: 'South Africa', iso2: 'ZA', iso3: 'ZAF', fips: 'SF' },
  { name: 'France', iso2: 'FR', iso3: 'FRA', fips: 'FR' },
  { name: 'Kuwait', iso2: 'KW', iso3: 'KWT', fips: 'KU' },
  { name: 'Iraq', iso2: 'IQ', iso3: 'IRQ', fips: 'IZ' },
  { name: 'Bahrain', iso2: 'BH', iso3: 'BHR', fips: 'BA' },
  { name: 'Saudi Arabia', iso2: 'SA', iso3: 'SAU', fips: 'SA' },
  { name: 'United Arab Emirates', iso2: 'AE', iso3: 'ARE', fips: 'AE', aliases: ['uae', 'emirates'] },
  { name: 'Qatar', iso2: 'QA', iso3: 'QAT', fips: 'QA' },
  { name: 'Oman', iso2: 'OM', iso3: 'OMN', fips: 'MU' },
  { name: 'Syria', iso2: 'SY', iso3: 'SYR', fips: 'SY' },
  { name: 'Yemen', iso2: 'YE', iso3: 'YEM', fips: 'YM' },
  { name: 'Lebanon', iso2: 'LB', iso3: 'LBN', fips: 'LE' },
  { name: 'Turkey', iso2: 'TR', iso3: 'TUR', fips: 'TU', aliases: ['turkiye', 'türkiye'] },
  { name: 'Egypt', iso2: 'EG', iso3: 'EGY', fips: 'EG' },
  { name: 'Germany', iso2: 'DE', iso3: 'DEU', fips: 'GM' },
  { name: 'Spain', iso2: 'ES', iso3: 'ESP', fips: 'SP' },
  { name: 'Italy', iso2: 'IT', iso3: 'ITA', fips: 'IT' },
  { name: 'Poland', iso2: 'PL', iso3: 'POL', fips: 'PL' },
  { name: 'Netherlands', iso2: 'NL', iso3: 'NLD', fips: 'NL' },
  { name: 'Norway', iso2: 'NO', iso3: 'NOR', fips: 'NO' },
  { name: 'Belarus', iso2: 'BY', iso3: 'BLR', fips: 'BO' },
  { name: 'Kazakhstan', iso2: 'KZ', iso3: 'KAZ', fips: 'KZ' },
  { name: 'Azerbaijan', iso2: 'AZ', iso3: 'AZE', fips: 'AJ' },
  { name: 'Armenia', iso2: 'AM', iso3: 'ARM', fips: 'AM' },
  { name: 'Georgia', iso2: 'GE', iso3: 'GEO', fips: 'GG' },
  { name: 'Sudan', iso2: 'SD', iso3: 'SDN', fips: 'SU' },
  { name: 'Ethiopia', iso2: 'ET', iso3: 'ETH', fips: 'ET' },
  { name: 'Somalia', iso2: 'SO', iso3: 'SOM', fips: 'SO' },
  { name: 'Libya', iso2: 'LY', iso3: 'LBY', fips: 'LY' },
  { name: 'Mali', iso2: 'ML', iso3: 'MLI', fips: 'ML' },
  { name: 'Algeria', iso2: 'DZ', iso3: 'DZA', fips: 'AG' },
  { name: 'Angola', iso2: 'AO', iso3: 'AGO', fips: 'AO' },
  { name: 'Afghanistan', iso2: 'AF', iso3: 'AFG', fips: 'AF' },
  { name: 'Myanmar', iso2: 'MM', iso3: 'MMR', fips: 'BM', aliases: ['burma'] },
  { name: 'North Korea', iso2: 'KP', iso3: 'PRK', fips: 'KN', aliases: ['dprk'] },
  { name: 'South Korea', iso2: 'KR', iso3: 'KOR', fips: 'KS', aliases: ['korea'] },
  { name: 'Japan', iso2: 'JP', iso3: 'JPN', fips: 'JA' },
  { name: 'Taiwan', iso2: 'TW', iso3: 'TWN', fips: 'TW' },
  { name: 'Indonesia', iso2: 'ID', iso3: 'IDN', fips: 'ID' },
  { name: 'Malaysia', iso2: 'MY', iso3: 'MYS', fips: 'MY' },
  { name: 'Singapore', iso2: 'SG', iso3: 'SGP', fips: 'SN' },
  { name: 'Vietnam', iso2: 'VN', iso3: 'VNM', fips: 'VM' },
  { name: 'Thailand', iso2: 'TH', iso3: 'THA', fips: 'TH' },
  { name: 'Philippines', iso2: 'PH', iso3: 'PHL', fips: 'RP' },
  { name: 'Venezuela', iso2: 'VE', iso3: 'VEN', fips: 'VE' },
  { name: 'Colombia', iso2: 'CO', iso3: 'COL', fips: 'CO' },
  { name: 'Brazil', iso2: 'BR', iso3: 'BRA', fips: 'BR' },
];

const byName = new Map<string, Row>();
const byIso2 = new Map<string, Row>();
const byIso3 = new Map<string, Row>();
const byFips = new Map<string, Row>();
for (const r of ROWS) {
  byName.set(r.name.toLowerCase(), r);
  for (const a of r.aliases ?? []) byName.set(a.toLowerCase(), r);
  byIso2.set(r.iso2, r);
  byIso3.set(r.iso3, r);
  byFips.set(r.fips, r);
}

// Resolve any of {name, ISO2, ISO3, FIPS} to the canonical row.
// For a 2-letter input, ISO2 wins over FIPS (the common case is an ISO
// code); names/ISO3 are unambiguous.
function resolve(input: string): Row | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (byName.has(lower)) return byName.get(lower)!;
  const upper = raw.toUpperCase();
  if (raw.length === 3 && byIso3.has(upper)) return byIso3.get(upper)!;
  if (raw.length === 2) {
    if (byIso2.has(upper)) return byIso2.get(upper)!;
    if (byFips.has(upper)) return byFips.get(upper)!;
  }
  return null;
}

/** → FIPS 10-4 code (conflict_events). null if unmapped. */
export function toFips(input: string): string | null {
  return resolve(input)?.fips ?? null;
}

/** → ISO 3166-1 alpha-2 (refineries / FIRMS facility obs / mines). null if unmapped. */
export function toIso2(input: string): string | null {
  return resolve(input)?.iso2 ?? null;
}

/** → canonical English name (power_plants). null if unmapped. */
export function toCountryName(input: string): string | null {
  return resolve(input)?.name ?? null;
}
