# Proactive Content Layer — runbook

The daily baseline beneath the reactive newsjack spikes. Built from
`FRONTEND/BRIEFS/Newsjacking SOP/2026-07-02_eYKON_Proactive_Content_Layer_Build-Prompt.docx`.
Reuses the newsjack pipeline end to end (runAnalyst, lints, draft→approve→publish
X path, `/admin/newsjack`, Discord alert, attribution). Human-in-the-loop:
nothing publishes without a founder approval.

## Flow (content-daily cron)
1. **Select** — `selectAngle` picks an eligible angle from `content_angles`
   (enabled, off cooldown, ≥2 feeds), avoids the last-used format, weighted-random,
   with a ~1-in-5 surprise toward a rarer format.
2. **Ground + answer** — `runAnalyst` answers the angle's prompt using its live
   tools (that IS the grounding). "insufficient live data" ⇒ skipped.
3. **Draft** — an X thread: the sourced answer → sources → the engageable HOOK +
   a public `/q/[id]` link (utm-tagged). Stored in `newsjack_events`/`newsjack_drafts`
   with `source='proactive'`.
4. **Gate** — voice + coverage lints (reused) + **anti-bait** ending lint. Fail ⇒
   `blocked`.
5. **Alert + approve** — Discord ping → `/admin/newsjack` → founder approves →
   posts to X via the same X API path. Public landing at `/q/[id]`.

## The three pillars
- **Query library** (`content_angles`, migration 069): angles are data, cross-feed
  ≥2 hard rule, per-angle cooldown. Add/kill/edit rows without a deploy. Seeded
  with 14 specific angles.
- **Engageable endings**: analyst produces a `HOOK:` line (open question or
  falsifiable prediction); `endingIsBait` blocks generic CTAs.
- **Format variety**: 6 formats, anti-repeat + surprise budget in `selectAngle`.

## Env (hand to Kef — Railway)
| Var | Purpose | Required |
| --- | --- | --- |
| `NEWSJACK_PROACTIVE_ENABLED` | kill switch (`on`) for the content-daily cron | yes (to run) |
| `CRON_SECRET`, `NEWSJACK_ALERT_WEBHOOK`, `X_API_*`, `NEXT_PUBLIC_SITE_URL` | reused from newsjack | already set |

## Ops
- **Cron**: `POST /api/cron/content-daily` on weekday mornings (e.g. `0 8 * * 1-5`),
  `Authorization: Bearer $CRON_SECRET`.
- **Migration**: `069_content_angles.sql` — apply in the Supabase SQL Editor BEFORE merge.
- **Review**: `/admin/newsjack` (proactive drafts appear alongside newsjack ones).
- **Public landing**: `/q/[id]`.

## Deferred (v1.1)
- Retention scoring writeback (needs X-metrics polling) + auto-weighting.
- Weekly library digest of top/bottom angles.
- Live slot-filling grounding (per-feed) beyond the analyst's own tool use.
- calibration_retro format (needs matured calibration data + a resolved-call source).
