/**
 * OFAC SDN.CSV parser.
 *
 * Treasury publishes the Specially Designated Nationals list as a
 * flat 12-column CSV at https://www.treasury.gov/ofac/downloads/sdn.csv.
 * Columns (in order):
 *
 *   ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign,
 *   Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks
 *
 * Quirks worth knowing:
 *  • "-0-" is the OFAC sentinel for null.
 *  • Fields containing commas are wrapped in double quotes.
 *  • Embedded double quotes are escaped as "".
 *  • Multi-program rows separate program tokens with ", " inside the
 *    quoted Program field (e.g. "SDGT, IRAN").
 *  • In practice records are single-line — embedded newlines inside
 *    Remarks are not produced by Treasury today, so a line-by-line
 *    parse is safe. Malformed lines are dropped (not fatal).
 */

export interface SdnRow {
  ent_num: number;
  sdn_name: string;
  sdn_type: string | null;
  programs: string[];
  title: string | null;
  remarks: string | null;
}

const NULL_SENTINEL = '-0-';

function parseCsvFields(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let value = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
    } else {
      let value = '';
      while (i < line.length && line[i] !== ',') {
        value += line[i];
        i++;
      }
      fields.push(value);
    }
    if (i < line.length && line[i] === ',') {
      i++;
      continue;
    }
    break;
  }
  return fields;
}

function nullOrTrim(v: string | undefined): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed === NULL_SENTINEL) return null;
  return trimmed;
}

function parsePrograms(v: string | undefined): string[] {
  const cleaned = nullOrTrim(v);
  if (!cleaned) return [];
  return cleaned
    .split(/\s*[,;]\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function parseSdnCsv(csv: string): SdnRow[] {
  const out: SdnRow[] = [];
  const lines = csv.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseCsvFields(line);
    if (fields.length < 12) continue;
    const entNum = parseInt(fields[0], 10);
    if (!Number.isFinite(entNum)) continue;
    const sdnName = nullOrTrim(fields[1]);
    if (!sdnName) continue;
    out.push({
      ent_num: entNum,
      sdn_name: sdnName,
      sdn_type: nullOrTrim(fields[2]),
      programs: parsePrograms(fields[3]),
      title: nullOrTrim(fields[4]),
      remarks: nullOrTrim(fields[11]),
    });
  }
  return out;
}
