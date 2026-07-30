"""
eYKON.ai — Black Marble (VIIRS VNP46A2) nightly radiance worker

Samples NASA's moonlight/atmosphere-corrected nighttime-lights product
at every FIRMS-watched facility and writes one row per facility per
night into Supabase `blackmarble_facility_radiance` (migration 091).

Runs as a Railway CRON service (runs to completion, exits) — NOT a
long-running worker. Schedule daily; the trailing rescan window makes
every run idempotent and lets late-published NASA granules backfill.

─── The one rule that must never be broken ─────────────────────────
VNP46A2 ships two radiance bands. `Gap_Filled_DNB_BRDF-Corrected_NTL`
back-fills cloudy nights from HISTORICAL radiance — during a real
outage under cloud it would report the facility's remembered
brightness, fabricating exactly the light whose disappearance this
sensor exists to detect. This worker reads the non-gap-filled
`DNB_BRDF-Corrected_NTL` only, and stores the quality ingredients
(Mandatory_Quality_Flag, cloud confidence, shadow/cirrus/snow) so
every downstream claim is auditable.

─── Honesty invariants (mirror the FIRMS worker) ───────────────────
• A row exists iff the facility's tile was processed that night.
  No row = nobody looked. radiance NULL = looked, no usable retrieval.
• Radiance is not power state; a dark night is not an outage.
  Significance is a later, separate step (deviation from the
  facility's own clear-night baseline).
• Missing NASA granules are PENDING (the product lags days behind),
  not failures. Real failures (auth, HTTP 5xx, parse errors) exit
  non-zero so Railway shows the run red.

Env:
  EARTHDATA_TOKEN            NASA Earthdata Login bearer token (required)
  SUPABASE_URL               https://<project>.supabase.co     (required)
  SUPABASE_SERVICE_ROLE_KEY  service-role key                  (required)
  BM_LAG_DAYS                newest night to attempt = today-LAG   (default 3)
  BM_RESCAN_DAYS             how many nights per run               (default 4)
  BM_ROSTER_DAYS             FIRMS-observation window for roster   (default 5)
  BM_BACKFILL_START/END      YYYY-MM-DD inclusive — overrides the
                             rolling window for a manual backfill run
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone

import h5py
import numpy as np
import requests

# ─── Config ────────────────────────────────────────────────────────
# Defensive hygiene: strip whitespace/newlines from a paste, and an
# accidental "Bearer " prefix (the worker adds that itself).
EARTHDATA_TOKEN = (os.environ.get("EARTHDATA_TOKEN") or "").strip()
if EARTHDATA_TOKEN.lower().startswith("bearer "):
    EARTHDATA_TOKEN = EARTHDATA_TOKEN[7:].strip()
# Accept either name: the Node workers (ais/adsb) use the web app's
# NEXT_PUBLIC_SUPABASE_URL convention, so copying variables from an
# existing Railway service must just work.
SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or ""
).rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

LAG_DAYS = int(os.environ.get("BM_LAG_DAYS", "3"))
RESCAN_DAYS = int(os.environ.get("BM_RESCAN_DAYS", "4"))
ROSTER_DAYS = int(os.environ.get("BM_ROSTER_DAYS", "5"))
BACKFILL_START = os.environ.get("BM_BACKFILL_START")
BACKFILL_END = os.environ.get("BM_BACKFILL_END")

ARCHIVE = "https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5000/VNP46A2"
# Directory listings live behind the v2 content API (the bare archive
# path 303-redirects to Earthdata OAuth; the old `{doy}.json` form is a
# hard 404 — probed 2026-07-30). Same Bearer token authorizes both.
API_DETAILS = "https://ladsweb.modaps.eosdis.nasa.gov/api/v2/content/details/allData/5000/VNP46A2"
H5_GROUP = "HDFEOS/GRIDS/VNP_Grid_DNB/Data Fields"
# Verified against the LAADS VNP46A2 filespec: ushort, fill 65535,
# scale 0.1, units nW·cm⁻²·sr⁻¹.
DS_NTL = "DNB_BRDF-Corrected_NTL"
DS_MQF = "Mandatory_Quality_Flag"      # 0 hq-persistent · 1 hq-ephemeral · 2 poor · 255 none
DS_QF = "QF_Cloud_Mask"                # bit-encoded, see below
DS_SNOW = "Snow_Flag"                  # 0 none · 1 snow/ice · 255 fill
NTL_FILL = 65535
NTL_SCALE = 0.1

# QF_Cloud_Mask bit layout per the NASA Black Marble user guide:
#   bits 6–7  cloud detection confidence: 00 confident clear ·
#             01 probably clear · 10 probably cloudy · 11 confident cloudy
#   bit  8    shadow detected
#   bit  9    cirrus detected
# (bit 10 snow/ice also exists; we take snow from Snow_Flag.)
CLOUD_CONF = {0: "confident_clear", 1: "probably_clear",
              2: "probably_cloudy", 3: "confident_cloudy"}

PX_PER_TILE = 2400          # 10° tile at 15 arc-sec (~500 m)
PX_PER_DEG = 240

BATCH = 500
HTTP_TIMEOUT = 120
RETRIES = 3

errors: list[str] = []


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


# ─── Small HTTP helpers ────────────────────────────────────────────
class AuthError(RuntimeError):
    """The Earthdata token was rejected. Distinct from a transient HTTP
    fault: retrying cannot fix it, and the remedy is a human action."""


def http_get(url: str, headers: dict, stream: bool = False) -> requests.Response:
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, headers=headers, timeout=HTTP_TIMEOUT, stream=stream)
            # A rejected token does not 401 — LAADS 303-redirects to the
            # Earthdata OAuth page, which may itself return HTML 200 or
            # (as seen 2026-07-30) crash with 500. Any landing on
            # urs.earthdata.nasa.gov means the token was not accepted;
            # retrying is pointless, so fail fast with the real remedy.
            if "urs.earthdata.nasa.gov" in r.url:
                raise AuthError(
                    "EARTHDATA_TOKEN rejected by LAADS (redirected to Earthdata login). "
                    "Fix: (1) check the variable holds the raw token on ONE line — no "
                    "'Bearer ' prefix, no quotes, not truncated; (2) log in once at "
                    "ladsweb.modaps.eosdis.nasa.gov to authorise the app for this "
                    "Earthdata account; (3) regenerate the token at urs.earthdata.nasa.gov "
                    "and update the Railway variable."
                )
            if r.status_code in (401, 403):
                raise AuthError(
                    f"EARTHDATA_TOKEN rejected: HTTP {r.status_code} from {url}. "
                    "Regenerate the token at urs.earthdata.nasa.gov and update Railway."
                )
            if r.status_code == 404:
                return r          # caller decides: 404 is often "not published yet"
            r.raise_for_status()
            return r
        except AuthError:
            raise                 # never retry an auth failure
        except Exception as e:            # noqa: BLE001 — collected, not swallowed
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed after {RETRIES} attempts: {last}")


def sb_headers(extra: dict | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    if extra:
        h.update(extra)
    return h


def sb_get_all(path_and_query: str, page: int = 1000) -> list[dict]:
    """Paged read — PostgREST caps unpaged responses, and the facility
    view alone is >13k rows, so paging is correctness, not politeness."""
    out: list[dict] = []
    offset = 0
    while True:
        sep = "&" if "?" in path_and_query else "?"
        url = f"{SUPABASE_URL}/rest/v1/{path_and_query}{sep}limit={page}&offset={offset}"
        r = http_get(url, sb_headers())
        rows = r.json()
        out.extend(rows)
        if len(rows) < page:
            return out
        offset += page


def sb_upsert(table: str, on_conflict: str, rows: list[dict]) -> None:
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}",
            headers=sb_headers({
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            }),
            data=json.dumps(chunk),
            timeout=HTTP_TIMEOUT,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"upsert {table}: HTTP {r.status_code} — {r.text[:300]}")


# ─── Tile / pixel math (linear lat-lon grid) ───────────────────────
def tile_of(lat: float, lon: float) -> str:
    h = int(math.floor((lon + 180.0) / 10.0))
    v = int(math.floor((90.0 - lat) / 10.0))
    return f"h{h:02d}v{v:02d}"


def pixel_of(lat: float, lon: float) -> tuple[int, int]:
    """(row, col) inside the facility's tile."""
    h = int(math.floor((lon + 180.0) / 10.0))
    v = int(math.floor((90.0 - lat) / 10.0))
    lat_max = 90.0 - 10.0 * v
    lon_min = -180.0 + 10.0 * h
    row = int((lat_max - lat) * PX_PER_DEG)
    col = int((lon - lon_min) * PX_PER_DEG)
    return (min(max(row, 0), PX_PER_TILE - 1), min(max(col, 0), PX_PER_TILE - 1))


# ─── Roster: the facilities FIRMS actually watched ─────────────────
def load_roster() -> dict[str, list[dict]]:
    """{tile: [facility…]} for every facility FIRMS observed in the
    trailing window. Reusing the FIRMS-watched set means the two
    sensors observe the SAME facilities and corroboration joins 1:1 —
    and there is no second region config to drift out of sync."""
    since = (date.today() - timedelta(days=ROSTER_DAYS)).isoformat()
    watched_rows = sb_get_all(
        f"firms_facility_observations?select=facility_type,facility_id&period=gte.{since}"
    )
    watched = {(r["facility_type"], r["facility_id"]) for r in watched_rows}

    coords = sb_get_all(
        "firms_monitored_facilities?select=facility_type,facility_id,facility_name,facility_country,latitude,longitude"
    )
    by_tile: dict[str, list[dict]] = {}
    for c in coords:
        key = (c["facility_type"], str(c["facility_id"]))
        lat, lon = c.get("latitude"), c.get("longitude")
        if key not in watched or lat is None or lon is None:
            continue
        by_tile.setdefault(tile_of(lat, lon), []).append({
            "facility_type": c["facility_type"],
            "facility_id": str(c["facility_id"]),
            "facility_name": c.get("facility_name"),
            "country": c.get("facility_country"),
            "lat": lat, "lon": lon,
        })
    n = sum(len(v) for v in by_tile.values())
    log(f"roster: {n} FIRMS-watched facilities across {len(by_tile)} tiles")
    return by_tile


# ─── NASA listing + granule processing ─────────────────────────────
def assert_not_auth_bounce(r: requests.Response, what: str) -> None:
    """A bad/expired token doesn't 401 here — LAADS redirects to the
    Earthdata OAuth page and returns HTML 200. Detect that explicitly
    so the failure reads 'fix the token', not a JSON/HDF5 parse error."""
    ctype = r.headers.get("content-type", "")
    if "urs.earthdata.nasa.gov" in r.url or "text/html" in ctype:
        raise RuntimeError(
            f"{what}: bounced to Earthdata login — EARTHDATA_TOKEN is missing, invalid or expired"
        )


def list_night_files(night: date) -> dict[str, str]:
    """{tile: filename} of VNP46A2 granules NASA has published for a
    night. Empty dict = nothing published yet (pending, not failure)."""
    doy = night.timetuple().tm_yday
    url = f"{API_DETAILS}/{night.year}/{doy:03d}?format=json"
    out: dict[str, str] = {}
    while url:
        r = http_get(url, {"Authorization": f"Bearer {EARTHDATA_TOKEN}",
                           "Accept": "application/json"})
        if r.status_code == 404:
            return out            # night directory not created yet
        assert_not_auth_bounce(r, f"listing {night}")
        payload = r.json()
        entries = payload.get("content", payload) if isinstance(payload, dict) else payload
        for e in entries or []:
            name = e.get("name") if isinstance(e, dict) else str(e)
            if not name or not name.endswith(".h5"):
                continue
            parts = name.split(".")
            if len(parts) >= 3 and parts[0] == "VNP46A2":
                out[parts[2]] = name        # parts[2] = hXXvYY
        # The v2 API pages large directories (a full night is ~450
        # global tiles); follow the cursor when present.
        url = payload.get("nextPageLink") if isinstance(payload, dict) else None
    return out


def sample_tile(night: date, tile: str, filename: str,
                facilities: list[dict]) -> list[dict]:
    """Download one granule, sample every facility in it, return rows."""
    doy = night.timetuple().tm_yday
    url = f"{ARCHIVE}/{night.year}/{doy:03d}/{filename}"
    r = http_get(url, {"Authorization": f"Bearer {EARTHDATA_TOKEN}"}, stream=True)
    if r.status_code == 404:
        return []
    assert_not_auth_bounce(r, f"granule {filename}")

    rows: list[dict] = []
    with tempfile.NamedTemporaryFile(suffix=".h5") as tmp:
        for chunk in r.iter_content(1 << 20):
            tmp.write(chunk)
        tmp.flush()
        with h5py.File(tmp.name, "r") as f:
            g = f[H5_GROUP]
            ntl = g[DS_NTL]        # NOT the gap-filled band — see module docstring
            mqf = g[DS_MQF]
            qf = g[DS_QF]
            snow = g[DS_SNOW]

            for fac in facilities:
                row_i, col_i = pixel_of(fac["lat"], fac["lon"])

                raw = int(ntl[row_i, col_i])
                q = int(mqf[row_i, col_i])
                qbits = int(qf[row_i, col_i])
                sn = int(snow[row_i, col_i])

                hq = q in (0, 1) and raw != NTL_FILL
                radiance = round(raw * NTL_SCALE, 2) if hq else None

                # 3×3 window (~1.5 km): mean over high-quality pixels
                # only, so one bad pixel or an off-by-one coordinate
                # doesn't decide the reading.
                r0, r1 = max(row_i - 1, 0), min(row_i + 2, PX_PER_TILE)
                c0, c1 = max(col_i - 1, 0), min(col_i + 2, PX_PER_TILE)
                w_ntl = ntl[r0:r1, c0:c1].astype(np.int64)
                w_mqf = mqf[r0:r1, c0:c1]
                mask = ((w_mqf == 0) | (w_mqf == 1)) & (w_ntl != NTL_FILL)
                px_hq = int(mask.sum())
                rad3 = round(float(w_ntl[mask].mean()) * NTL_SCALE, 2) if px_hq else None

                rows.append({
                    "facility_type": fac["facility_type"],
                    "facility_id": fac["facility_id"],
                    "facility_name": fac["facility_name"],
                    "country": fac["country"],
                    "period": night.isoformat(),
                    "radiance": radiance,
                    "radiance_3x3": rad3,
                    "px_hq_3x3": px_hq,
                    "mandatory_quality": q,
                    "cloud_confidence": CLOUD_CONF.get((qbits >> 6) & 0b11),
                    "shadow": bool((qbits >> 8) & 1),
                    "cirrus": bool((qbits >> 9) & 1),
                    "snow": sn == 1,
                    "tile": tile,
                    "computed_at": datetime.now(timezone.utc).isoformat(),
                })
    return rows


# ─── Per-night driver ──────────────────────────────────────────────
def process_night(night: date, roster: dict[str, list[dict]]) -> None:
    published = list_night_files(night)
    expected = list(roster.keys())
    have = [t for t in expected if t in published]
    missing = len(expected) - len(have)

    if not have:
        log(f"{night}: 0/{len(expected)} tiles published — pending (NASA latency), skipping")
        sb_upsert("blackmarble_ingest_runs", "night", [{
            "night": night.isoformat(),
            "tiles_expected": len(expected), "tiles_processed": 0,
            "tiles_missing": missing, "facilities_written": 0,
            "ok": True, "error": None,
            "ran_at": datetime.now(timezone.utc).isoformat(),
        }])
        return

    written = 0
    processed = 0
    night_errors: list[str] = []
    for t in have:
        try:
            rows = sample_tile(night, t, published[t], roster[t])
            if rows:
                sb_upsert("blackmarble_facility_radiance",
                          "facility_type,facility_id,period", rows)
            written += len(rows)
            processed += 1
            log(f"{night} {t}: {len(rows)} facilities sampled")
        except Exception as e:            # noqa: BLE001
            msg = f"{night} {t}: {e}"
            night_errors.append(msg)
            errors.append(msg)
            log(f"ERROR {msg}")

    sb_upsert("blackmarble_ingest_runs", "night", [{
        "night": night.isoformat(),
        "tiles_expected": len(expected), "tiles_processed": processed,
        "tiles_missing": missing, "facilities_written": written,
        "ok": len(night_errors) == 0,
        "error": "; ".join(night_errors)[:500] or None,
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }])


def main() -> int:
    for name, val in [("EARTHDATA_TOKEN", EARTHDATA_TOKEN),
                      ("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)", SUPABASE_URL),
                      ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)]:
        if not val:
            log(f"FATAL: {name} missing")
            return 1

    if BACKFILL_START and BACKFILL_END:
        start = date.fromisoformat(BACKFILL_START)
        end = date.fromisoformat(BACKFILL_END)
        nights = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        log(f"BACKFILL mode: {start} → {end} ({len(nights)} nights)")
    else:
        newest = date.today() - timedelta(days=LAG_DAYS)
        nights = [newest - timedelta(days=i) for i in range(RESCAN_DAYS)]
        log(f"rolling window: {nights[-1]} → {nights[0]} (lag {LAG_DAYS}d, rescan {RESCAN_DAYS})")

    roster = load_roster()
    if not roster:
        log("FATAL: empty roster — no FIRMS-watched facilities found (is FIRMS ingest healthy?)")
        return 1

    for night in nights:
        try:
            process_night(night, roster)
        except AuthError as e:
            # One clear line, not a traceback repeated per night. Nothing
            # downstream can succeed until a human fixes the token.
            log(f"FATAL: {e}")
            return 1

    if errors:
        log(f"DONE with {len(errors)} error(s) — failing loud so Railway shows red")
        return 1
    log("DONE clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
