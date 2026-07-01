# Newsjacking Engine — runbook (v1)

Automated detect → package → draft → approve → publish → measure pipeline for
turning a live, eYKON-detected event into a sourced, on-brand intelligence post.
Built from `FRONTEND/BRIEFS/Newsjacking SOP/2026-06-30_eYKON_Newsjacking_SOP_Build-Prompt.docx`.
Human-in-the-loop: nothing publishes without a founder approval in `/admin/newsjack`.

## Flow
1. **Detect** — `newsjack-detect` cron reads two sources, deduped on `source_ref`:
   `anomaly_flags` (last 6h, severity `medium|high`) and `convergence_events`
   (last 48h, `joint_p_value < 0.05` — richer, multi-domain, uses the synthesis).
2. **Package** — `runAnalyst` produces ONE dense, sourced sentence (or replies
   `insufficient live data`, which blocks the post). Builds the globe live-view URL.
3. **Draft** — renders three channel drafts (X thread + LinkedIn + Substack) and
   runs the voice + coverage + value-test gates. Pass → `drafted`; fail → `blocked`.
4. **Approve** — the founder reviews in `/admin/newsjack`. The **X** draft
   auto-publishes on approve; **LinkedIn/Substack** are copy-to-post.
5. **Publish** — on approve of the X draft: native X API v2 (if `X_API_*` set) →
   else `NEWSJACK_PUBLISH_WEBHOOK` → else manual. Non-X channels: copy + post.
6. **Measure** — `newsjack-digest` (weekly cron) reports detected/drafted/blocked/
   published + newsjack-attributed visits & signups from PAMS, to the digest webhook.

## Guardrails (enforced in code)
- **Freshness** — anomalies >6h / convergences >48h are ignored.
- **Coverage honesty** — `coverage.ts` marks Hormuz / Persian Gulf / Bab-el-Mandeb /
  Panama as not-live; a draft naming one alongside a live claim is blocked.
  Malacca / Suez / Bosphorus are live.
- **Voice** — no emojis, no exclamation marks, no buzzwords (`voiceLint`) — applied
  to all three channels.
- **Cite-or-admit** — `insufficient live data` ⇒ value-test fails ⇒ blocked.
- **Kill switch** — `NEWSJACK_ENABLED` must be `on`; otherwise the detect cron no-ops.

## Env (hand to Kef — Railway)
| Var | Purpose | Required |
| --- | --- | --- |
| `NEWSJACK_ENABLED` | global kill switch (`on`/`true`/`1`) | yes (to run) |
| `CRON_SECRET` | existing cron bearer | yes (already set) |
| `NEXT_PUBLIC_SITE_URL` | base for live-view links (defaults to https://eykon.ai) | optional |
| `NEWSJACK_ALERT_WEBHOOK` | Slack/Discord URL for "draft ready" alerts | recommended |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | native X API v2 posting (OAuth 1.0a, app→own account) | optional (else webhook/manual) |
| `NEWSJACK_PUBLISH_WEBHOOK` | automation URL that posts the thread to X (fallback if no X keys) | optional |
| `NEWSJACK_DIGEST_WEBHOOK` | where the weekly digest goes (falls back to alert webhook) | optional |
| `NEWSJACK_ANOMALY_SOURCE` | opt in single anomalies as a source (`on`); OFF by default because anomalies have no public landing page | optional |
| `FOUNDER_EMAILS` | existing founder allowlist for `/admin/newsjack` | yes (already set) |

## Landing pages (where a post's link sends the reader)
- **Convergence events → `/c/[id]`** — a PUBLIC, no-login page (map, p-value, synthesis, contributing detectors + a signup CTA). This is the default/only source, so every post links here. "Give before you ask."
- Anomaly events → the (gated) globe `/app` — which is why anomalies are OFF by default (see `NEWSJACK_ANOMALY_SOURCE`). Re-enable only once anomalies get their own public artifact.

## Ops
- **Crons**: `POST /api/cron/newsjack-detect` hourly; `POST /api/cron/newsjack-digest`
  weekly (Railway triggers, `Authorization: Bearer $CRON_SECRET`).
- **Migration**: `068_newsjack.sql` — apply in the Supabase SQL Editor BEFORE merge.
  (v1 adds no migration; convergence source + variants reuse the same tables.)
- **X API test**: the OAuth 1.0a poster is build-verified only. Confirm one real
  post to the eYKON account before relying on auto-publish.
- **Review**: `/admin/newsjack` (founder-only).
- **Retract/correct**: if a published post is wrong, delete it on X, set
  `NEWSJACK_ENABLED=off`, fix the input, then re-enable.

## Deferred (v1.1+)
- LinkedIn / Substack *auto-posting* (APIs are restrictive; today they are copy-to-post).
- Per-event grouping in the admin queue (currently one card per channel draft).
- Thread splitting when the analyst line exceeds one post (currently clipped).
