# Newsjacking Engine — runbook (MVP)

Automated detect → package → draft → approve → publish → measure pipeline for
turning a live, eYKON-detected event into a sourced, on-brand intelligence post.
Built from `FRONTEND/Newsjacking SOP/2026-06-30_eYKON_Newsjacking_SOP_Build-Prompt.docx`.
Human-in-the-loop: nothing publishes without a founder approval in `/admin/newsjack`.

## Flow
1. **Detect** — `newsjack-detect` cron reads `anomaly_flags` from the last 6h,
   severity `medium|high`, not already seen (deduped on `source_ref`).
2. **Package** — `runAnalyst` produces ONE dense, sourced sentence (or replies
   `insufficient live data`, which blocks the post). Builds the globe live-view URL.
3. **Draft** — renders the X thread (`template.ts`), runs the voice + coverage +
   value-test gates (`lints.ts`). Pass → `drafted`; fail → `blocked` with reasons.
4. **Approve** — the founder reviews in `/admin/newsjack` and approves/rejects.
5. **Publish** — on approve, the thread is POSTed to `NEWSJACK_PUBLISH_WEBHOOK`
   (wire it to X via Make/Zapier/n8n) or held for manual posting.
6. **Measure** — every live-view link carries `utm_source=x&utm_campaign=newsjack`,
   captured by the existing PAMS channel attribution.

## Guardrails (enforced in code)
- **Freshness** — flags older than 6h are ignored (newsjacking is about now).
- **Coverage honesty** — `coverage.ts` marks Hormuz / Persian Gulf / Bab-el-Mandeb /
  Panama as not-live; a draft that names one alongside a live claim is blocked.
  Malacca / Suez / Bosphorus are live.
- **Voice** — no emojis, no exclamation marks, no buzzwords (`voiceLint`).
- **Cite-or-admit** — `insufficient live data` ⇒ value-test fails ⇒ blocked.
- **Kill switch** — `NEWSJACK_ENABLED` must be `on`; otherwise the cron no-ops.

## Env (hand to Kef — Railway)
| Var | Purpose | Required |
| --- | --- | --- |
| `NEWSJACK_ENABLED` | global kill switch (`on`/`true`/`1`) | yes (to run) |
| `CRON_SECRET` | existing cron bearer | yes (already set) |
| `NEXT_PUBLIC_SITE_URL` | base for live-view links (defaults to https://eykon.ai) | optional |
| `NEWSJACK_ALERT_WEBHOOK` | Slack/Discord URL for "draft ready" alerts | recommended |
| `NEWSJACK_PUBLISH_WEBHOOK` | automation URL that posts the thread to X | optional (else manual) |
| `FOUNDER_EMAILS` | existing founder allowlist for `/admin/newsjack` | yes (already set) |

## Ops
- **Cron**: schedule `POST /api/cron/newsjack-detect` hourly (Railway trigger),
  `Authorization: Bearer $CRON_SECRET`.
- **Migration**: apply `068_newsjack.sql` in the Supabase SQL Editor BEFORE merge.
- **Review**: `/admin/newsjack` (founder-only).
- **Retract/correct**: if a published post is wrong, delete it on X, set
  `NEWSJACK_ENABLED=off`, and fix the input before re-enabling.

## Deferred (v1+, not in this MVP)
- Native X API v2 posting (this MVP uses a webhook or manual).
- LinkedIn / Substack variants.
- Convergence-event source (richer than single anomalies; live but thin today).
- A measurement digest cron.
