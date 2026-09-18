#!/usr/bin/env python3
"""
refinery-countries.py — offline country + US-state attribution for
public.refineries, emitted as ONE static, idempotent migration
(first shipped as supabase/migrations/158_refinery_country_backfill.sql).

WHY OFFLINE AND STATIC
  iso_country was null on all 634 rows (country on 631) when this was written
  (read 2026-09-18). The OSM tags the ingest read it from are almost never
  set. geo_regions cannot be used: its rows are coarse, overlapping boxes (it
  places MOL Tiszaujvaros in Russia and Maysan in three countries) and its
  UNIQUE(slug) collides with the 15 country boxes notification geofencing
  uses. So the attribution is computed here, once, against a real admin-0 and
  admin-1 boundary set, and shipped as a reviewed UPDATE ... FROM (VALUES ...).

SOURCES — Natural Earth 1:10m cultural vectors, GeoJSON distribution
(public domain). They are NOT committed to the repo; download them yourself
and the script refuses to run unless the SHA-256 matches:

  ne_10m_admin_0_countries.geojson
      13,287,234 bytes
      SHA-256 239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255
  ne_10m_admin_1_states_provinces.geojson
      40,726,851 bytes
      SHA-256 22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5

  admin-0 code: ISO_A2_EH, never ISO_A2 (ISO_A2 is -99 for France and Norway,
  and CN-TW for Taiwan). Features whose ISO_A2_EH is -99 (Somaliland, Northern
  Cyprus, the UN buffer zone, the sovereign base areas, Siachen, Bir Tawil, ...)
  carry no code; a point inside one is reported and left NULL unless it
  is listed in DE_JURE below.
  admin-1: only the 51 features with iso_a2 = 'US' (50 states + DC); the
  two-letter code is `postal` (e.g. TX), cross-checked against iso_3166_2
  (US-TX).

METHOD
  1. Point-in-polygon, pure Python (no shapely/geopandas): even-odd ray casting
     over every ring of each Polygon / MultiPolygon part, so holes are honoured;
     a bounding-box prefilter per part keeps it fast. Coordinates are treated
     as planar lon/lat, which is how Natural Earth defines its polygons.
  2. Nearest-polygon fallback for points outside every polygon (piers,
     reclaimed land, jetties, coastline generalised away at 1:10m): the
     great-circle distance (mean Earth radius 6,371.0088 km) from the point to
     every polygon edge, computed exactly on the sphere as point-to-arc
     distance. The point takes the nearest feature's code only if that
     distance is <= MAX_FALLBACK_KM = 22.224 km (12 nautical miles, the
     territorial-sea limit). Beyond it the row stays NULL and is listed.
     A fallback whose runner-up country is within AMBIGUOUS_MARGIN_KM of the
     winner is also left NULL and listed. A reviewer has to decide those.
  3. English name for refineries.country: firms_monitored_facilities computes
     facility_country = COALESCE(country, iso_country), and power_plants
     carries English names in power_plants.country. Per ISO code, use the
     power_plants spelling where one exists (so a country filter
     matches both facility types). Otherwise use Natural Earth NAME (from the
     HOMEPART = 1 feature when a code spans several features). power_plants
     names are mapped to ISO codes by exact match against the Natural Earth
     name fields, plus PP_ALIASES below for the spellings Natural Earth does
     not carry. A name that matches two codes aborts the run.
  4. us_state for iso_country = 'US' rows only: the same point-in-polygon and
     the same fallback rule, run against the 51 US admin-1 features. Non-US
     rows get NULL. The report lists every US row within
     STATE_LINE_REVIEW_KM (10 km) of another state's polygon for hand-checking,
     and every row within COUNTRY_BORDER_REVIEW_KM of a foreign admin-0
     polygon.

RE-RUN
  1. Export the points from production (SQL Editor, download the result as
     CSV, header row id,lat,lon):
        select id,
               round(ST_Y(geom::geometry)::numeric, 6)::text as lat,
               round(ST_X(geom::geometry)::numeric, 6)::text as lon
          from public.refineries order by id;
  2. Export the power_plants spellings (CSV, header country,n):
        select country, count(*) as n from public.power_plants
         where country is not null group by country order by country;
  3. Run (Python 3.9+, standard library only):
        python3 apps/web/scripts/data/refinery-countries.py \\
          --admin0 /path/ne_10m_admin_0_countries.geojson \\
          --admin1 /path/ne_10m_admin_1_states_provinces.geojson \\
          --points refineries.csv --pp-countries power_plant_countries.csv \\
          [--names refinery_names.csv] \\
          --out-update-sql update.sql --out-report refinery-countries-report.json
     (refinery_names.csv, header id,name, from
        select id, coalesce(refinery_name, '') as name from public.refineries order by id;
      only labels the SQL comments and the report.)
     It prints the summary, the fallback rows, the unresolved rows and the
     border / state-line review lists, and writes the UPDATE ... FROM (VALUES
     ...) statement. The same inputs give a byte-identical statement. Paste it
     into a new migration between the DDL (ADD COLUMN IF NOT EXISTS us_state +
     its CHECKs) and a VERIFY block, following migration 158. The hand-check
     expectations in 158's VERIFY are written by hand on purpose: they must not
     come from this script.
  Rows the OSM ingest inserts after this ran arrive with NULL
  country / iso_country / us_state. The ingest no longer writes those
  columns, so a re-ingest cannot wipe the backfill. Re-run this script and ship
  a new migration to attribute them.
"""

import argparse
import csv
import hashlib
import json
import math
import sys
import unicodedata

ADMIN0_SHA256 = "239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255"
ADMIN1_SHA256 = "22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5"

EARTH_RADIUS_KM = 6371.0088
MAX_FALLBACK_KM = 22.224          # 12 nautical miles
AMBIGUOUS_MARGIN_KM = 1.0         # fallback winner vs runner-up (different code)
STATE_LINE_REVIEW_KM = 10.0
COUNTRY_BORDER_REVIEW_KM = 5.0

# Natural Earth features with ISO_A2_EH = -99, keyed by ADMIN, that should
# still take a de jure code if a refinery ever falls inside one. Empty on
# purpose: none of the 634 rows fell in a -99 feature on 2026-09-18, and a
# code for a disputed area is a decision, not a default.
DE_JURE = {}

# power_plants.country spellings that match no Natural Earth name field
# (NAME, NAME_LONG, ADMIN, NAME_EN, NAME_SORT, BRK_NAME, GEOUNIT, SUBUNIT,
# FORMAL_EN, NAME_CIAWF, NAME_ALT), mapped by hand to ISO 3166-1 alpha-2.
# The five French overseas departments get their own ISO codes here, but
# Natural Earth admin-0 folds them into France (ISO_A2_EH = FR). So those
# codes are never produced, and a refinery there is attributed FR / "France".
PP_ALIASES = {
    "Bonaire, Sint Eustatius, and Saba": "BQ",
    "Czech Republic": "CZ",
    "DR Congo": "CD",
    "French Guiana": "GF",
    "Guadeloupe": "GP",
    "Martinique": "MQ",
    "Mayotte": "YT",
    "Micronesia": "FM",
    "Republic of the Congo": "CG",
    "Réunion": "RE",
    "Saint Helena, Ascension, and Tristan da Cunha": "SH",
    "The Gambia": "GM",
    "Türkiye": "TR",
    "Virgin Islands (U.S.)": "VI",
}

NE_NAME_FIELDS = ("NAME", "NAME_LONG", "ADMIN", "NAME_EN", "NAME_SORT", "BRK_NAME",
                  "GEOUNIT", "SUBUNIT", "FORMAL_EN", "NAME_CIAWF", "NAME_ALT")


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def norm_name(s):
    s = unicodedata.normalize("NFKC", s or "").strip().casefold()
    return " ".join(s.split())


# ─── geometry ────────────────────────────────────────────────────────────

class Part:
    """One polygon: an outer ring plus holes, with the outer ring's bbox."""
    __slots__ = ("rings", "minx", "miny", "maxx", "maxy")

    def __init__(self, rings):
        self.rings = [[(float(x), float(y)) for x, y, *_ in ring] for ring in rings]
        xs = [p[0] for p in self.rings[0]]
        ys = [p[1] for p in self.rings[0]]
        self.minx, self.maxx, self.miny, self.maxy = min(xs), max(xs), min(ys), max(ys)


def parts_of(geometry):
    if geometry is None:
        return []
    if geometry["type"] == "Polygon":
        return [Part(geometry["coordinates"])]
    if geometry["type"] == "MultiPolygon":
        return [Part(poly) for poly in geometry["coordinates"]]
    raise ValueError("unsupported geometry type %s" % geometry["type"])


def ring_contains(ring, x, y):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def part_contains(part, x, y):
    if x < part.minx or x > part.maxx or y < part.miny or y > part.maxy:
        return False
    # Even-odd across the outer ring and its holes: a point in a hole toggles
    # back to outside.
    inside = False
    for ring in part.rings:
        if ring_contains(ring, x, y):
            inside = not inside
    return inside


def unit_vec(lon, lat):
    lo, la = math.radians(lon), math.radians(lat)
    c = math.cos(la)
    return (c * math.cos(lo), c * math.sin(lo), math.sin(la))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vnorm(a):
    return math.sqrt(dot(a, a))


def angle_between(a, b):
    return math.atan2(vnorm(cross(a, b)), dot(a, b))


def arc_distance_km(p, a, b):
    """Great-circle distance from unit vector p to the minor arc a-b."""
    n = cross(a, b)
    nn = vnorm(n)
    if nn < 1e-15:
        return angle_between(p, a) * EARTH_RADIUS_KM
    n = (n[0] / nn, n[1] / nn, n[2] / nn)
    s = dot(p, n)
    proj = (p[0] - s * n[0], p[1] - s * n[1], p[2] - s * n[2])
    # proj lies on the arc when it sits between a and b in the arc's sense.
    if dot(cross(a, proj), n) >= 0 and dot(cross(proj, b), n) >= 0:
        return abs(math.asin(max(-1.0, min(1.0, s)))) * EARTH_RADIUS_KM
    return min(angle_between(p, a), angle_between(p, b)) * EARTH_RADIUS_KM


def part_distance_km(part, lon, lat, max_km):
    """Distance from (lon, lat) to the nearest edge of part, or inf beyond max_km."""
    dlat = max_km / 111.0 + 0.01
    dlon = max_km / (111.0 * max(math.cos(math.radians(lat)), 0.05)) + 0.01
    if (lon + dlon < part.minx or lon - dlon > part.maxx or
            lat + dlat < part.miny or lat - dlat > part.maxy):
        return math.inf
    lo_x, hi_x, lo_y, hi_y = lon - dlon, lon + dlon, lat - dlat, lat + dlat
    p = unit_vec(lon, lat)
    best = math.inf
    for ring in part.rings:
        for k in range(len(ring) - 1):
            x1, y1 = ring[k]
            x2, y2 = ring[k + 1]
            if (x1 < lo_x and x2 < lo_x) or (x1 > hi_x and x2 > hi_x) or \
               (y1 < lo_y and y2 < lo_y) or (y1 > hi_y and y2 > hi_y):
                continue
            d = arc_distance_km(p, unit_vec(x1, y1), unit_vec(x2, y2))
            if d < best:
                best = d
    return best if best <= max_km else math.inf


class Layer:
    """A list of (code, label, parts) features with PIP + nearest lookups."""

    def __init__(self, features):
        self.features = features  # list of dicts: code, label, parts

    def containing(self, lon, lat):
        return [f for f in self.features if any(part_contains(p, lon, lat) for p in f["parts"])]

    def nearest_by_code(self, lon, lat, max_km, exclude_code=None):
        """{code: distance_km} for every coded feature within max_km."""
        out = {}
        for f in self.features:
            if f["code"] is None or f["code"] == exclude_code:
                continue
            d = min((part_distance_km(p, lon, lat, max_km) for p in f["parts"]), default=math.inf)
            if d <= max_km and d < out.get(f["code"], math.inf):
                out[f["code"]] = d
        return out


def resolve(layer, lon, lat, max_km, margin_km):
    """-> dict(code, method, dist_km, runner_up, note)."""
    hits = layer.containing(lon, lat)
    coded = sorted({f["code"] for f in hits if f["code"] is not None})
    uncoded = [f["label"] for f in hits if f["code"] is None]
    if len(coded) == 1 and not uncoded:
        return {"code": coded[0], "method": "pip", "dist_km": 0.0, "runner_up": None, "note": None}
    if len(coded) > 1:
        return {"code": None, "method": "overlap", "dist_km": None, "runner_up": None,
                "note": "inside several coded polygons: %s" % ",".join(coded)}
    if uncoded:
        label = uncoded[0]
        if label in DE_JURE:
            return {"code": DE_JURE[label], "method": "pip_de_jure", "dist_km": 0.0,
                    "runner_up": None, "note": "inside %s (no ISO_A2_EH), de jure" % label}
        return {"code": None, "method": "pip_uncoded", "dist_km": None, "runner_up": None,
                "note": "inside %s, which carries no ISO code" % label}
    near = sorted(layer.nearest_by_code(lon, lat, max_km).items(), key=lambda kv: kv[1])
    if not near:
        return {"code": None, "method": "beyond_max", "dist_km": None, "runner_up": None,
                "note": "outside every polygon and > %.3f km from any" % max_km}
    code, dist = near[0]
    runner = near[1] if len(near) > 1 else None
    if runner is not None and runner[1] - dist < margin_km:
        return {"code": None, "method": "ambiguous", "dist_km": round(dist, 3),
                "runner_up": [runner[0], round(runner[1], 3)],
                "note": "nearest %s at %.3f km, runner-up %s at %.3f km" % (code, dist, runner[0], runner[1])}
    return {"code": code, "method": "nearest", "dist_km": round(dist, 3),
            "runner_up": [runner[0], round(runner[1], 3)] if runner else None, "note": None}


# ─── inputs ──────────────────────────────────────────────────────────────

def load_admin0(path):
    data = json.load(open(path, encoding="utf-8"))
    feats, ne_name = [], {}
    for ft in data["features"]:
        p = ft["properties"]
        code = p.get("ISO_A2_EH")
        code = None if code in (None, "", "-99") else code
        feats.append({"code": code, "label": p["ADMIN"], "parts": parts_of(ft["geometry"]), "props": p})
        if code is not None and (code not in ne_name or p.get("HOMEPART") == 1):
            ne_name[code] = p["NAME"]
    return Layer(feats), ne_name, feats


def load_admin1_us(path):
    data = json.load(open(path, encoding="utf-8"))
    feats = []
    for ft in data["features"]:
        p = ft["properties"]
        if p.get("iso_a2") != "US":
            continue
        postal, iso2 = p.get("postal"), p.get("iso_3166_2")
        if iso2 != "US-%s" % postal or len(postal or "") != 2 or not postal.isupper():
            sys.exit("admin-1 US feature %r: postal %r does not match iso_3166_2 %r" % (p.get("name"), postal, iso2))
        feats.append({"code": postal, "label": p["name"], "parts": parts_of(ft["geometry"]), "props": p})
    if len(feats) != 51:
        sys.exit("expected 51 US admin-1 features (50 states + DC), found %d" % len(feats))
    return Layer(feats)


def load_points(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append({"id": r["id"], "lat": float(r["lat"]), "lon": float(r["lon"])})
    ids = [r["id"] for r in rows]
    if len(set(ids)) != len(ids):
        sys.exit("duplicate ids in points file")
    return rows


def load_pp_countries(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return [r["country"] for r in csv.DictReader(fh) if (r.get("country") or "").strip()]


def pp_name_by_iso(pp_names, admin0_feats):
    index = {}
    for f in admin0_feats:
        if f["code"] is None:
            continue
        for field in NE_NAME_FIELDS:
            v = f["props"].get(field)
            if v:
                index.setdefault(norm_name(v), set()).add(f["code"])
    by_iso, unmatched = {}, []
    for name in pp_names:
        if name in PP_ALIASES:
            codes = {PP_ALIASES[name]}
        else:
            codes = index.get(norm_name(name), set())
        if len(codes) > 1:
            sys.exit("power_plants name %r matches several codes %s; add it to PP_ALIASES" % (name, sorted(codes)))
        if not codes:
            unmatched.append(name)
            continue
        code = codes.pop()
        if code in by_iso and by_iso[code] != name:
            sys.exit("ISO %s has two power_plants spellings: %r and %r" % (code, by_iso[code], name))
        by_iso[code] = name
    if unmatched:
        sys.exit("power_plants names matching no Natural Earth name field: %s; add them to PP_ALIASES" % unmatched)
    return by_iso


# ─── SQL ─────────────────────────────────────────────────────────────────

def sql_lit(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--admin0", required=True)
    ap.add_argument("--admin1", required=True)
    ap.add_argument("--points", required=True, help="CSV id,lat,lon exported from public.refineries")
    ap.add_argument("--pp-countries", required=True, help="CSV country,n exported from public.power_plants")
    ap.add_argument("--names", help="optional CSV id,name (refinery_name) used only for SQL comments and the report")
    ap.add_argument("--out-update-sql", required=True, help="where to write the UPDATE ... FROM (VALUES ...) statement")
    ap.add_argument("--out-report", required=True)
    args = ap.parse_args()

    for path, want in ((args.admin0, ADMIN0_SHA256), (args.admin1, ADMIN1_SHA256)):
        got = sha256_of(path)
        if got != want:
            sys.exit("SHA-256 mismatch for %s: got %s, pinned %s" % (path, got, want))

    admin0, ne_name, admin0_feats = load_admin0(args.admin0)
    states = load_admin1_us(args.admin1)
    points = load_points(args.points)
    pp_by_iso = pp_name_by_iso(load_pp_countries(args.pp_countries), admin0_feats)
    names = {}
    if args.names:
        with open(args.names, newline="", encoding="utf-8") as fh:
            names = {r["id"]: r["name"] for r in csv.DictReader(fh)}

    results = []
    for pt in points:
        lon, lat = pt["lon"], pt["lat"]
        c = resolve(admin0, lon, lat, MAX_FALLBACK_KM, AMBIGUOUS_MARGIN_KM)
        iso = c["code"]
        row = {"id": pt["id"], "name": names.get(pt["id"]), "lat": lat, "lon": lon,
               "iso_country": iso, "country_method": c["method"], "country_dist_km": c["dist_km"],
               "country_runner_up": c["runner_up"], "country_note": c["note"],
               "country": None, "name_source": None, "us_state": None, "state_method": None,
               "state_dist_km": None, "state_note": None, "foreign_border_km": None,
               "other_state_km": None}
        if iso is not None:
            if iso in pp_by_iso:
                row["country"], row["name_source"] = pp_by_iso[iso], "power_plants"
            else:
                row["country"], row["name_source"] = ne_name[iso], "natural_earth"
            fb = admin0.nearest_by_code(lon, lat, COUNTRY_BORDER_REVIEW_KM, exclude_code=iso)
            if fb:
                k = min(fb, key=fb.get)
                row["foreign_border_km"] = [k, round(fb[k], 3)]
        if iso == "US":
            s = resolve(states, lon, lat, MAX_FALLBACK_KM, AMBIGUOUS_MARGIN_KM)
            row["us_state"], row["state_method"] = s["code"], s["method"]
            row["state_dist_km"], row["state_note"] = s["dist_km"], s["note"]
            ob = states.nearest_by_code(lon, lat, STATE_LINE_REVIEW_KM, exclude_code=s["code"])
            if ob:
                k = min(ob, key=ob.get)
                row["other_state_km"] = [k, round(ob[k], 3)]
        results.append(row)

    # consistency: us_state non-null <=> iso_country = 'US' (except listed unresolved US rows)
    for r in results:
        if r["us_state"] is not None and r["iso_country"] != "US":
            sys.exit("inconsistent row %s" % r["id"])

    resolved = [r for r in results if r["iso_country"]]
    unresolved = [r for r in results if not r["iso_country"]]
    us = [r for r in results if r["iso_country"] == "US"]
    us_unresolved = [r for r in us if not r["us_state"]]
    used_names = {}
    for r in resolved:
        used_names.setdefault(r["iso_country"], (r["country"], r["name_source"]))
    overrides = {iso: (nm, ne_name[iso]) for iso, (nm, src) in used_names.items()
                 if src == "power_plants" and nm != ne_name[iso]}

    summary = {
        "rows": len(results), "iso_resolved": len(resolved), "iso_unresolved": len(unresolved),
        "by_method": {m: sum(1 for r in results if r["country_method"] == m)
                      for m in sorted({r["country_method"] for r in results})},
        "distinct_iso": len({r["iso_country"] for r in resolved}),
        "name_from_power_plants": sum(1 for r in resolved if r["name_source"] == "power_plants"),
        "name_from_natural_earth": sum(1 for r in resolved if r["name_source"] == "natural_earth"),
        "us_rows": len(us), "us_state_resolved": len(us) - len(us_unresolved),
        "us_state_by_method": {m: sum(1 for r in us if r["state_method"] == m)
                               for m in sorted({r["state_method"] for r in us})},
        "distinct_us_state": len({r["us_state"] for r in us if r["us_state"]}),
        "max_fallback_km": MAX_FALLBACK_KM,
        "name_overrides_power_plants_vs_ne": {k: {"power_plants": v[0], "natural_earth_NAME": v[1]}
                                              for k, v in sorted(overrides.items())},
        "natural_earth_names_used": {k: v[0] for k, v in sorted(used_names.items()) if v[1] == "natural_earth"},
    }
    json.dump({"summary": summary, "rows": results}, open(args.out_report, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    # ── migration body ──
    lines = [
        "-- Generated by apps/web/scripts/data/refinery-countries.py — do not hand-edit.",
        "-- %d rows · %d distinct iso_country · %d US rows with us_state · fallback limit %.3f km,"
        " largest used %.3f km (country) / %.3f km (state)"
        % (len(resolved), summary["distinct_iso"], summary["us_state_resolved"], MAX_FALLBACK_KM,
           max([r["country_dist_km"] or 0 for r in resolved] or [0]),
           max([r["state_dist_km"] or 0 for r in us if r["us_state"]] or [0])),
        "UPDATE public.refineries AS r"]
    lines.append("   SET iso_country = v.iso_country,")
    lines.append("       country     = v.country,")
    lines.append("       us_state    = v.us_state")
    lines.append("  FROM (VALUES")
    ordered = sorted(resolved, key=lambda r: (r["iso_country"], r["us_state"] or "", r["id"]))
    for i, r in enumerate(ordered):
        cast = "::text" if i == 0 else ""
        vals = "(%s%s, %s%s, %s%s, %s%s)" % (sql_lit(r["id"]), cast, sql_lit(r["iso_country"]), cast,
                                             sql_lit(r["country"]), cast, sql_lit(r["us_state"]), cast)
        sep = "," if i < len(ordered) - 1 else " "
        how = "pip" if r["country_method"] == "pip" else "%s %.1f km" % (r["country_method"], r["country_dist_km"] or 0)
        if r["us_state"] and r["state_method"] != "pip":
            how += "; state %s %.1f km" % (r["state_method"], r["state_dist_km"] or 0)
        label = (r["name"] or "(unnamed)").replace("\n", " ")
        lines.append("    %s%s  -- %s · %s" % (vals, sep, label, how))
    lines.extend([
        "  ) AS v(id, iso_country, country, us_state)",
        " WHERE r.id = v.id",
        "   AND (r.iso_country IS DISTINCT FROM v.iso_country",
        "     OR r.country     IS DISTINCT FROM v.country",
        "     OR r.us_state    IS DISTINCT FROM v.us_state);",
    ])
    with open(args.out_update_sql, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    # ── console report ──
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    print("\nFALLBACK (nearest polygon) rows:")
    for r in results:
        if r["country_method"] != "pip":
            print("  %-22s %-45s %10.6f %11.6f  %-3s %s %s %s" % (
                r["id"], (r["name"] or "")[:45], r["lat"], r["lon"], r["iso_country"] or "--",
                r["country_method"], r["country_dist_km"], r["country_runner_up"] or ""))
    print("\nUNRESOLVED iso_country:")
    for r in unresolved:
        print("  %s  %s  (%s, %s)  %s" % (r["id"], r["name"], r["lat"], r["lon"], r["country_note"]))
    print("\nUS rows with no us_state:")
    for r in us_unresolved:
        print("  %s  %s  (%s, %s)  %s" % (r["id"], r["name"], r["lat"], r["lon"], r["state_note"]))
    print("\nUS rows within %.0f km of another state's polygon:" % STATE_LINE_REVIEW_KM)
    for r in us:
        if r["other_state_km"]:
            print("  %-22s %-45s %10.6f %11.6f  %s (%s)  other: %s %.3f km" % (
                r["id"], (r["name"] or "")[:45], r["lat"], r["lon"], r["us_state"], r["state_method"],
                r["other_state_km"][0], r["other_state_km"][1]))
    print("\nRows within %.0f km of a foreign admin-0 polygon:" % COUNTRY_BORDER_REVIEW_KM)
    for r in resolved:
        if r["foreign_border_km"]:
            print("  %-22s %-45s %10.6f %11.6f  %s  foreign: %s %.3f km" % (
                r["id"], (r["name"] or "")[:45], r["lat"], r["lon"], r["iso_country"],
                r["foreign_border_km"][0], r["foreign_border_km"][1]))


if __name__ == "__main__":
    main()
