// ─── Geography keyword index ─────────────────────────────────────
// Static list backing the auto-domain-tags inference in
// lib/intelligence-analyst/persistence.ts. Used in two ways:
//   1. ISO-2 lookup — tool inputs often carry country=`SA`, iso_country=`IR`
//   2. Text extraction — query text mentions like "Saudi Arabia" or "UAE"
//
// Scope: 193 UN member states + frequently-referenced dependencies and
// disputed territories + major maritime chokepoints / regional seas that
// recur in geopolitical-intelligence queries. Not exhaustive — light
// keyword match per brief §4.3 and §7.

export interface RegionEntry {
  name: string;
  iso2?: string;
  iso3?: string;
  aliases?: readonly string[];
}

export const REGIONS: readonly RegionEntry[] = [
  // ── Africa ─────────────────────────────────────────────────────
  { name: 'Algeria', iso2: 'DZ', iso3: 'DZA' },
  { name: 'Angola', iso2: 'AO', iso3: 'AGO' },
  { name: 'Benin', iso2: 'BJ', iso3: 'BEN' },
  { name: 'Botswana', iso2: 'BW', iso3: 'BWA' },
  { name: 'Burkina Faso', iso2: 'BF', iso3: 'BFA' },
  { name: 'Burundi', iso2: 'BI', iso3: 'BDI' },
  { name: 'Cabo Verde', iso2: 'CV', iso3: 'CPV', aliases: ['Cape Verde'] },
  { name: 'Cameroon', iso2: 'CM', iso3: 'CMR' },
  { name: 'Central African Republic', iso2: 'CF', iso3: 'CAF', aliases: ['CAR'] },
  { name: 'Chad', iso2: 'TD', iso3: 'TCD' },
  { name: 'Comoros', iso2: 'KM', iso3: 'COM' },
  { name: 'Democratic Republic of the Congo', iso2: 'CD', iso3: 'COD', aliases: ['DRC', 'DR Congo', 'Congo-Kinshasa'] },
  { name: 'Republic of the Congo', iso2: 'CG', iso3: 'COG', aliases: ['Congo-Brazzaville'] },
  { name: 'Djibouti', iso2: 'DJ', iso3: 'DJI' },
  { name: 'Egypt', iso2: 'EG', iso3: 'EGY' },
  { name: 'Equatorial Guinea', iso2: 'GQ', iso3: 'GNQ' },
  { name: 'Eritrea', iso2: 'ER', iso3: 'ERI' },
  { name: 'Eswatini', iso2: 'SZ', iso3: 'SWZ', aliases: ['Swaziland'] },
  { name: 'Ethiopia', iso2: 'ET', iso3: 'ETH' },
  { name: 'Gabon', iso2: 'GA', iso3: 'GAB' },
  { name: 'Gambia', iso2: 'GM', iso3: 'GMB' },
  { name: 'Ghana', iso2: 'GH', iso3: 'GHA' },
  { name: 'Guinea', iso2: 'GN', iso3: 'GIN' },
  { name: 'Guinea-Bissau', iso2: 'GW', iso3: 'GNB' },
  { name: 'Ivory Coast', iso2: 'CI', iso3: 'CIV', aliases: "Côte d'Ivoire,Cote d'Ivoire".split(',') },
  { name: 'Kenya', iso2: 'KE', iso3: 'KEN' },
  { name: 'Lesotho', iso2: 'LS', iso3: 'LSO' },
  { name: 'Liberia', iso2: 'LR', iso3: 'LBR' },
  { name: 'Libya', iso2: 'LY', iso3: 'LBY' },
  { name: 'Madagascar', iso2: 'MG', iso3: 'MDG' },
  { name: 'Malawi', iso2: 'MW', iso3: 'MWI' },
  { name: 'Mali', iso2: 'ML', iso3: 'MLI' },
  { name: 'Mauritania', iso2: 'MR', iso3: 'MRT' },
  { name: 'Mauritius', iso2: 'MU', iso3: 'MUS' },
  { name: 'Morocco', iso2: 'MA', iso3: 'MAR' },
  { name: 'Mozambique', iso2: 'MZ', iso3: 'MOZ' },
  { name: 'Namibia', iso2: 'NA', iso3: 'NAM' },
  { name: 'Niger', iso2: 'NE', iso3: 'NER' },
  { name: 'Nigeria', iso2: 'NG', iso3: 'NGA' },
  { name: 'Rwanda', iso2: 'RW', iso3: 'RWA' },
  { name: 'São Tomé and Príncipe', iso2: 'ST', iso3: 'STP', aliases: ['Sao Tome and Principe'] },
  { name: 'Senegal', iso2: 'SN', iso3: 'SEN' },
  { name: 'Seychelles', iso2: 'SC', iso3: 'SYC' },
  { name: 'Sierra Leone', iso2: 'SL', iso3: 'SLE' },
  { name: 'Somalia', iso2: 'SO', iso3: 'SOM' },
  { name: 'South Africa', iso2: 'ZA', iso3: 'ZAF' },
  { name: 'South Sudan', iso2: 'SS', iso3: 'SSD' },
  { name: 'Sudan', iso2: 'SD', iso3: 'SDN' },
  { name: 'Tanzania', iso2: 'TZ', iso3: 'TZA' },
  { name: 'Togo', iso2: 'TG', iso3: 'TGO' },
  { name: 'Tunisia', iso2: 'TN', iso3: 'TUN' },
  { name: 'Uganda', iso2: 'UG', iso3: 'UGA' },
  { name: 'Zambia', iso2: 'ZM', iso3: 'ZMB' },
  { name: 'Zimbabwe', iso2: 'ZW', iso3: 'ZWE' },
  { name: 'Western Sahara', iso2: 'EH', iso3: 'ESH' },

  // ── Americas ────────────────────────────────────────────────────
  { name: 'Antigua and Barbuda', iso2: 'AG', iso3: 'ATG' },
  { name: 'Argentina', iso2: 'AR', iso3: 'ARG' },
  { name: 'Bahamas', iso2: 'BS', iso3: 'BHS' },
  { name: 'Barbados', iso2: 'BB', iso3: 'BRB' },
  { name: 'Belize', iso2: 'BZ', iso3: 'BLZ' },
  { name: 'Bolivia', iso2: 'BO', iso3: 'BOL' },
  { name: 'Brazil', iso2: 'BR', iso3: 'BRA' },
  { name: 'Canada', iso2: 'CA', iso3: 'CAN' },
  { name: 'Chile', iso2: 'CL', iso3: 'CHL' },
  { name: 'Colombia', iso2: 'CO', iso3: 'COL' },
  { name: 'Costa Rica', iso2: 'CR', iso3: 'CRI' },
  { name: 'Cuba', iso2: 'CU', iso3: 'CUB' },
  { name: 'Dominica', iso2: 'DM', iso3: 'DMA' },
  { name: 'Dominican Republic', iso2: 'DO', iso3: 'DOM' },
  { name: 'Ecuador', iso2: 'EC', iso3: 'ECU' },
  { name: 'El Salvador', iso2: 'SV', iso3: 'SLV' },
  { name: 'Grenada', iso2: 'GD', iso3: 'GRD' },
  { name: 'Guatemala', iso2: 'GT', iso3: 'GTM' },
  { name: 'Guyana', iso2: 'GY', iso3: 'GUY' },
  { name: 'Haiti', iso2: 'HT', iso3: 'HTI' },
  { name: 'Honduras', iso2: 'HN', iso3: 'HND' },
  { name: 'Jamaica', iso2: 'JM', iso3: 'JAM' },
  { name: 'Mexico', iso2: 'MX', iso3: 'MEX' },
  { name: 'Nicaragua', iso2: 'NI', iso3: 'NIC' },
  { name: 'Panama', iso2: 'PA', iso3: 'PAN' },
  { name: 'Paraguay', iso2: 'PY', iso3: 'PRY' },
  { name: 'Peru', iso2: 'PE', iso3: 'PER' },
  { name: 'Saint Kitts and Nevis', iso2: 'KN', iso3: 'KNA' },
  { name: 'Saint Lucia', iso2: 'LC', iso3: 'LCA' },
  { name: 'Saint Vincent and the Grenadines', iso2: 'VC', iso3: 'VCT' },
  { name: 'Suriname', iso2: 'SR', iso3: 'SUR' },
  { name: 'Trinidad and Tobago', iso2: 'TT', iso3: 'TTO' },
  { name: 'United States', iso2: 'US', iso3: 'USA', aliases: ['USA', 'U.S.', 'U.S.A.', 'America'] },
  { name: 'Uruguay', iso2: 'UY', iso3: 'URY' },
  { name: 'Venezuela', iso2: 'VE', iso3: 'VEN' },

  // ── Asia ────────────────────────────────────────────────────────
  { name: 'Afghanistan', iso2: 'AF', iso3: 'AFG' },
  { name: 'Bahrain', iso2: 'BH', iso3: 'BHR' },
  { name: 'Bangladesh', iso2: 'BD', iso3: 'BGD' },
  { name: 'Bhutan', iso2: 'BT', iso3: 'BTN' },
  { name: 'Brunei', iso2: 'BN', iso3: 'BRN', aliases: ['Brunei Darussalam'] },
  { name: 'Cambodia', iso2: 'KH', iso3: 'KHM' },
  { name: 'China', iso2: 'CN', iso3: 'CHN', aliases: ['PRC'] },
  { name: 'Hong Kong', iso2: 'HK', iso3: 'HKG' },
  { name: 'India', iso2: 'IN', iso3: 'IND' },
  { name: 'Indonesia', iso2: 'ID', iso3: 'IDN' },
  { name: 'Iran', iso2: 'IR', iso3: 'IRN', aliases: ['Iranian'] },
  { name: 'Iraq', iso2: 'IQ', iso3: 'IRQ' },
  { name: 'Israel', iso2: 'IL', iso3: 'ISR' },
  { name: 'Japan', iso2: 'JP', iso3: 'JPN' },
  { name: 'Jordan', iso2: 'JO', iso3: 'JOR' },
  { name: 'Kazakhstan', iso2: 'KZ', iso3: 'KAZ' },
  { name: 'Kuwait', iso2: 'KW', iso3: 'KWT' },
  { name: 'Kyrgyzstan', iso2: 'KG', iso3: 'KGZ' },
  { name: 'Laos', iso2: 'LA', iso3: 'LAO' },
  { name: 'Lebanon', iso2: 'LB', iso3: 'LBN' },
  { name: 'Macau', iso2: 'MO', iso3: 'MAC', aliases: ['Macao'] },
  { name: 'Malaysia', iso2: 'MY', iso3: 'MYS' },
  { name: 'Maldives', iso2: 'MV', iso3: 'MDV' },
  { name: 'Mongolia', iso2: 'MN', iso3: 'MNG' },
  { name: 'Myanmar', iso2: 'MM', iso3: 'MMR', aliases: ['Burma'] },
  { name: 'Nepal', iso2: 'NP', iso3: 'NPL' },
  { name: 'North Korea', iso2: 'KP', iso3: 'PRK', aliases: ['DPRK'] },
  { name: 'Oman', iso2: 'OM', iso3: 'OMN' },
  { name: 'Pakistan', iso2: 'PK', iso3: 'PAK' },
  { name: 'Palestine', iso2: 'PS', iso3: 'PSE', aliases: ['Gaza', 'West Bank', 'Palestinian Territories'] },
  { name: 'Philippines', iso2: 'PH', iso3: 'PHL' },
  { name: 'Qatar', iso2: 'QA', iso3: 'QAT' },
  { name: 'Saudi Arabia', iso2: 'SA', iso3: 'SAU', aliases: ['KSA'] },
  { name: 'Singapore', iso2: 'SG', iso3: 'SGP' },
  { name: 'South Korea', iso2: 'KR', iso3: 'KOR', aliases: ['Republic of Korea', 'ROK'] },
  { name: 'Sri Lanka', iso2: 'LK', iso3: 'LKA' },
  { name: 'Syria', iso2: 'SY', iso3: 'SYR' },
  { name: 'Taiwan', iso2: 'TW', iso3: 'TWN', aliases: ['Republic of China', 'ROC'] },
  { name: 'Tajikistan', iso2: 'TJ', iso3: 'TJK' },
  { name: 'Thailand', iso2: 'TH', iso3: 'THA' },
  { name: 'Timor-Leste', iso2: 'TL', iso3: 'TLS', aliases: ['East Timor'] },
  { name: 'Turkmenistan', iso2: 'TM', iso3: 'TKM' },
  { name: 'United Arab Emirates', iso2: 'AE', iso3: 'ARE', aliases: ['UAE', 'Emirates'] },
  { name: 'Uzbekistan', iso2: 'UZ', iso3: 'UZB' },
  { name: 'Vietnam', iso2: 'VN', iso3: 'VNM', aliases: ['Viet Nam'] },
  { name: 'Yemen', iso2: 'YE', iso3: 'YEM' },

  // ── Europe ──────────────────────────────────────────────────────
  { name: 'Albania', iso2: 'AL', iso3: 'ALB' },
  { name: 'Andorra', iso2: 'AD', iso3: 'AND' },
  { name: 'Armenia', iso2: 'AM', iso3: 'ARM' },
  { name: 'Austria', iso2: 'AT', iso3: 'AUT' },
  { name: 'Azerbaijan', iso2: 'AZ', iso3: 'AZE' },
  { name: 'Belarus', iso2: 'BY', iso3: 'BLR' },
  { name: 'Belgium', iso2: 'BE', iso3: 'BEL' },
  { name: 'Bosnia and Herzegovina', iso2: 'BA', iso3: 'BIH', aliases: ['Bosnia'] },
  { name: 'Bulgaria', iso2: 'BG', iso3: 'BGR' },
  { name: 'Croatia', iso2: 'HR', iso3: 'HRV' },
  { name: 'Cyprus', iso2: 'CY', iso3: 'CYP' },
  { name: 'Czech Republic', iso2: 'CZ', iso3: 'CZE', aliases: ['Czechia'] },
  { name: 'Denmark', iso2: 'DK', iso3: 'DNK' },
  { name: 'Estonia', iso2: 'EE', iso3: 'EST' },
  { name: 'Finland', iso2: 'FI', iso3: 'FIN' },
  { name: 'France', iso2: 'FR', iso3: 'FRA' },
  { name: 'Georgia', iso2: 'GE', iso3: 'GEO' },
  { name: 'Germany', iso2: 'DE', iso3: 'DEU' },
  { name: 'Greece', iso2: 'GR', iso3: 'GRC' },
  { name: 'Hungary', iso2: 'HU', iso3: 'HUN' },
  { name: 'Iceland', iso2: 'IS', iso3: 'ISL' },
  { name: 'Ireland', iso2: 'IE', iso3: 'IRL' },
  { name: 'Italy', iso2: 'IT', iso3: 'ITA' },
  { name: 'Kosovo', iso2: 'XK', iso3: 'XKX' },
  { name: 'Latvia', iso2: 'LV', iso3: 'LVA' },
  { name: 'Liechtenstein', iso2: 'LI', iso3: 'LIE' },
  { name: 'Lithuania', iso2: 'LT', iso3: 'LTU' },
  { name: 'Luxembourg', iso2: 'LU', iso3: 'LUX' },
  { name: 'Malta', iso2: 'MT', iso3: 'MLT' },
  { name: 'Moldova', iso2: 'MD', iso3: 'MDA' },
  { name: 'Monaco', iso2: 'MC', iso3: 'MCO' },
  { name: 'Montenegro', iso2: 'ME', iso3: 'MNE' },
  { name: 'Netherlands', iso2: 'NL', iso3: 'NLD', aliases: ['Holland'] },
  { name: 'North Macedonia', iso2: 'MK', iso3: 'MKD', aliases: ['Macedonia'] },
  { name: 'Norway', iso2: 'NO', iso3: 'NOR' },
  { name: 'Poland', iso2: 'PL', iso3: 'POL' },
  { name: 'Portugal', iso2: 'PT', iso3: 'PRT' },
  { name: 'Romania', iso2: 'RO', iso3: 'ROU' },
  { name: 'Russia', iso2: 'RU', iso3: 'RUS', aliases: ['Russian Federation'] },
  { name: 'San Marino', iso2: 'SM', iso3: 'SMR' },
  { name: 'Serbia', iso2: 'RS', iso3: 'SRB' },
  { name: 'Slovakia', iso2: 'SK', iso3: 'SVK' },
  { name: 'Slovenia', iso2: 'SI', iso3: 'SVN' },
  { name: 'Spain', iso2: 'ES', iso3: 'ESP' },
  { name: 'Sweden', iso2: 'SE', iso3: 'SWE' },
  { name: 'Switzerland', iso2: 'CH', iso3: 'CHE' },
  { name: 'Turkey', iso2: 'TR', iso3: 'TUR', aliases: ['Türkiye', 'Turkiye'] },
  { name: 'Ukraine', iso2: 'UA', iso3: 'UKR' },
  { name: 'United Kingdom', iso2: 'GB', iso3: 'GBR', aliases: ['UK', 'Britain', 'Great Britain', 'England', 'Scotland', 'Wales'] },
  { name: 'Vatican City', iso2: 'VA', iso3: 'VAT', aliases: ['Holy See'] },

  // ── Oceania ─────────────────────────────────────────────────────
  { name: 'Australia', iso2: 'AU', iso3: 'AUS' },
  { name: 'Fiji', iso2: 'FJ', iso3: 'FJI' },
  { name: 'Kiribati', iso2: 'KI', iso3: 'KIR' },
  { name: 'Marshall Islands', iso2: 'MH', iso3: 'MHL' },
  { name: 'Micronesia', iso2: 'FM', iso3: 'FSM' },
  { name: 'Nauru', iso2: 'NR', iso3: 'NRU' },
  { name: 'New Zealand', iso2: 'NZ', iso3: 'NZL' },
  { name: 'Palau', iso2: 'PW', iso3: 'PLW' },
  { name: 'Papua New Guinea', iso2: 'PG', iso3: 'PNG' },
  { name: 'Samoa', iso2: 'WS', iso3: 'WSM' },
  { name: 'Solomon Islands', iso2: 'SB', iso3: 'SLB' },
  { name: 'Tonga', iso2: 'TO', iso3: 'TON' },
  { name: 'Tuvalu', iso2: 'TV', iso3: 'TUV' },
  { name: 'Vanuatu', iso2: 'VU', iso3: 'VUT' },

  // ── Maritime chokepoints & regional seas ──────────────────────
  { name: 'Strait of Hormuz', aliases: ['Hormuz'] },
  { name: 'Strait of Malacca', aliases: ['Malacca Strait', 'Malacca'] },
  { name: 'Suez Canal' },
  { name: 'Bab-el-Mandeb', aliases: ['Bab el Mandeb', 'Bab al-Mandab'] },
  { name: 'Bosporus', aliases: ['Bosphorus'] },
  { name: 'Dardanelles' },
  { name: 'Strait of Gibraltar', aliases: ['Gibraltar Strait'] },
  { name: 'Panama Canal' },
  { name: 'English Channel' },
  { name: 'Taiwan Strait' },
  { name: 'South China Sea' },
  { name: 'East China Sea' },
  { name: 'Sea of Japan' },
  { name: 'Yellow Sea' },
  { name: 'Persian Gulf', aliases: ['Arabian Gulf'] },
  { name: 'Gulf of Oman' },
  { name: 'Red Sea' },
  { name: 'Gulf of Aden' },
  { name: 'Mediterranean Sea', aliases: ['Mediterranean'] },
  { name: 'Black Sea' },
  { name: 'Baltic Sea' },
  { name: 'Caspian Sea' },
  { name: 'Arctic Ocean', aliases: ['Arctic'] },
  { name: 'Northern Sea Route', aliases: ['NSR'] },
  { name: 'Gulf of Mexico' },
  { name: 'Caribbean Sea', aliases: ['Caribbean'] },
];

// ─── Lookups ────────────────────────────────────────────────────

const BY_ISO2: Map<string, RegionEntry> = new Map(
  REGIONS.filter(r => r.iso2).map(r => [r.iso2!.toUpperCase(), r]),
);

const BY_ISO3: Map<string, RegionEntry> = new Map(
  REGIONS.filter(r => r.iso3).map(r => [r.iso3!.toUpperCase(), r]),
);

export function findRegionByIso2(code: string): RegionEntry | undefined {
  return BY_ISO2.get(code.toUpperCase());
}

export function findRegionByIso3(code: string): RegionEntry | undefined {
  return BY_ISO3.get(code.toUpperCase());
}

// Pre-compiled keyword index for text extraction. Matches whole words
// only to avoid false positives ("Iran" inside "Iranian" still matches —
// but "Mali" inside "malicious" does not).
const KEYWORD_INDEX: ReadonlyArray<{ pattern: RegExp; canonical: string }> = (() => {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entries: { pattern: RegExp; canonical: string }[] = [];
  for (const r of REGIONS) {
    const tokens = [r.name, ...(r.aliases ?? [])];
    for (const t of tokens) {
      // \b doesn't handle accented chars on all engines, but Node's V8
      // uses Unicode-friendly word boundaries with the `u` flag.
      entries.push({ pattern: new RegExp(`\\b${escape(t)}\\b`, 'iu'), canonical: r.name });
    }
  }
  return entries;
})();

export function extractRegionsFromText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const { pattern, canonical } of KEYWORD_INDEX) {
    if (pattern.test(text)) found.add(canonical);
  }
  return Array.from(found);
}
