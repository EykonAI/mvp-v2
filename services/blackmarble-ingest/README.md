# blackmarble-ingest — VIIRS Black Marble (VNP46A2) nightly radiance

eYKON's **third independent physical sensor**: moonlight/atmosphere-corrected
nighttime-lights radiance sampled at every FIRMS-watched facility, nightly.
FIRMS sees heat, AIS sees vessels, Black Marble sees **light** — a facility
whose radiance collapses below its own clear-night baseline for several
confidently-clear nights is a probable power outage, from physics independent
of both FIRMS and the news.

**PR1 scope (this service): ingest only, dark.** No significance, no flags,
no UI. Those come after the data is verified against reality.

## The one rule
`Gap_Filled_DNB_BRDF-Corrected_NTL` is **banned**. It back-fills cloudy nights
from historical radiance — during a real outage under cloud it would report
the facility's remembered brightness. This worker reads the non-gap-filled
`DNB_BRDF-Corrected_NTL` plus its quality flags, and stores NULL (no usable
look) rather than a fabricated number.

## Collection v002 (load-bearing)
VNP46A2 moved from **v001 (`allData/5000`) to v002 (`allData/5200`)**, and v002
**changed the file's internals**:

| | v001 | v002 |
|---|---|---|
| Data Fields group | `HDFEOS/GRIDS/VNP_Grid_DNB/…` | `VIIRS_Grid_DNB_2d/…` |
| `DNB_BRDF-Corrected_NTL` | ushort, fill 65535, scale 0.1 | **float, fill −999.9, scale 1** |

Beware the failure mode: LAADS answers a **dead path with a 303 to the Earthdata
login page**, which is indistinguishable from a rejected token. If you see
"redirected to Earthdata login", check the collection id *before* regenerating
tokens.

## NASA publishes in stages
Probed 2026-07-30: nights A2026200–203 had ~500 tiles (all our regions), while
every night from A2026204 on had only 189 and none of our regions. A short lag
lands entirely in the partially-produced zone and writes nothing — "pending"
forever. Hence `BM_LAG_DAYS=4` + `BM_RESCAN_DAYS=12`; nights already complete
(`tiles_missing=0`) are skipped, so the wide window costs nothing in steady state.

## Setup (Railway)
1. Apply migration `091_blackmarble_radiance.sql` in the Supabase SQL Editor
   **before** deploying.
2. New Railway service from this repo:
   - Root Directory: `services/blackmarble-ingest`
   - Config-as-code path: `services/blackmarble-ingest/railway.toml`
   - **Verify the service shows "Next run in …"** after deploy. A cron with
     no schedule shows "Completed" and never fires again (the §6 lesson).
3. Env vars:
   - `EARTHDATA_TOKEN` — generate at urs.earthdata.nasa.gov (Profile →
     Generate Token). Tokens expire (~60 days) — rotation is on you; an
     expired token fails loud with "bounced to Earthdata login".
   - `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL` — either name works),
     `SUPABASE_SERVICE_ROLE_KEY` — same values as the web service, so
     copying the variables from ais-ingest just works.
   - Optional: `BM_LAG_DAYS` (3), `BM_RESCAN_DAYS` (4), `BM_ROSTER_DAYS` (5).

## Backfill (baselines from day one)
Black Marble's archive goes back to 2012, so unlike FIRMS there is no
dead-air baseline wait. After the first clean scheduled run, backfill
~90 nights in month chunks (one-off manual runs with):

    BM_BACKFILL_START=2026-04-01 BM_BACKFILL_END=2026-04-30 python main.py

## Verify (don't trust a green run)
```sql
-- rows landing, with honest quality spread
select period, count(*) rows,
       count(radiance)                                    hq_readings,
       count(*) filter (where cloud_confidence='confident_clear') clear
from blackmarble_facility_radiance group by 1 order by 1 desc limit 7;

-- sanity: a big refinery should be bright on clear nights
select period, radiance, radiance_3x3, cloud_confidence
from blackmarble_facility_radiance
where facility_name ilike '%bandar abbas%' order by period desc limit 10;
```
A flaring refinery reading tens-to-hundreds of nW·cm⁻²·sr⁻¹ on clear nights,
and NULLs on cloudy ones, is the expected honest shape.

## Design notes
- **Roster = FIRMS-watched facilities** (distinct rows in
  `firms_facility_observations`, trailing window) — both sensors observe the
  same set, so corroboration joins 1:1 and there's no second region config
  to drift.
- **Coverage by construction**: a row exists iff the facility's tile was
  processed that night. Missing NASA granules = the night stays *pending*
  (VNP46A2 lags ~3+ days) and the rescan window picks it up later.
- Tile math: linear lat/lon grid, 10° tiles, 2400×2400 px
  (`h = floor((lon+180)/10)`, `v = floor((90−lat)/10)`).
- Fail loud: any real error (auth, HTTP 5xx, parse) exits non-zero → red run.
