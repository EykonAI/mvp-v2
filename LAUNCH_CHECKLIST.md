# eYKON.ai · Launch-Day Operational Runbook

Time-relative checklist for the public launch (Product Hunt + Show HN + X).
Maps onto the operational checklist in
`Marketing & Sales/Road to Market/eYKON_launch_day_checklist.docx`,
with the code references that ship in this branch.

---

## Scope of this branch

After the v1.1 plan was approved, the implementation pivoted to **crypto-first
on Day 1**. The fiat-payment integration was deferred so the critical path
to a paid product was as short as possible. Use this matrix when reading
external docs (the launch-integration plan docx is still in v1.1 numbering
1–15; this branch ships in 1–4 + A–G).

### Live on Day 1 (this branch)

| Feature                        | Commit    | Notes                                                              |
|--------------------------------|-----------|--------------------------------------------------------------------|
| Route groups + middleware      | `e9a84a1` | (marketing) + (app) + auth split, Supabase session check           |
| Supabase Auth + user_profiles  | `72c4a8e` | Email + Google + GitHub + magic link, billing schema extension     |
| Legal pages (Termly)           | `490dc60` | /terms /privacy /cookies /dpa /refund                              |
| **NOWPayments crypto**         | `385fab5` | Annual-only, +30% discount, atomic founding-seat counter           |
| Tier gating (intel + AI chat)  | `af2a0e7` | Citizen → upgrade prompt; per-tier monthly AI quota                |
| Production landing page        | `9e1a2db` | USD pricing, 3-state billing toggle, fiat → waitlist modal         |
| Resend transactional email     | `a402a59` | Welcome / receipt-crypto / renewal-reminder; cron drains queue     |
| PostHog analytics              | `ba46b2a` | Full funnel + server identify + payment_method discriminator       |
| Rewardful cookie capture       | `aaab4cc` | Attribution-only (no payouts wiring) + /settings ReferralCard      |
| /billing + cancel flow         | `cead9a3` | Subscription summary, purchase history, stop-renewal control       |
| Launch safety + SEO + runbook  | `aa8c1e3` | expire-subs cron, deep /api/health, robots, sitemap, 404, this doc |

### Deferred to Week 2 (NOT in this branch)

| Feature                         | Status                                                                       |
|---------------------------------|------------------------------------------------------------------------------|
| Lemon Squeezy fiat payments     | Landing CTAs route to a waitlist modal (`/api/waitlist`) — NO live fiat      |
| Rewardful commission payouts    | Cookie + signup attribution work; payout reconciliation is manual until then |
| Instatus status page            | Footer link is a static `status.eykon.ai` placeholder                        |
| Crisp live chat                 | Footer surfaces `mailto:support@eykon.ai` only                               |

### Pricing (live)

USD, three tiers, crypto-annual-only at Day 1:

- **Citizen** — Free. Globe (limited view), 1 watchlist, 24h-delayed feeds.
- **Pro** — $29/mo founding · $348/yr founding · **$244/yr crypto founding**.
- **Enterprise** — $99/seat/mo founding · $1,188/seat/yr founding · **$832/seat/yr crypto founding** · 3-seat minimum.

Founding rate locked for life on the first 1,000 paid seats; 400 of those
1,000 are reserved for the fiat waitlist.

---

## T − 24h · Pre-launch

### Database
- [ ] Apply every migration through `011_email_log.sql` to the production
      Supabase project. Verify in SQL editor:
      `SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;`
- [ ] Spot-check that `founding_seats_counter.cap = 1000` and
      `lifetime_seats_counter.cap = 250`. Reset `seats_taken = 0` if any
      QA inserts polluted them.

### Environment variables on Railway
Confirm every variable below is set on the **production** web service:

```
ANTHROPIC_API_KEY                         (required for /api/chat)
NEXT_PUBLIC_SUPABASE_URL                  (required)
NEXT_PUBLIC_SUPABASE_ANON_KEY             (required)
SUPABASE_SERVICE_ROLE_KEY                 (required for webhooks + cron)
POSTGRES_URL                              (db migrate / seed)
NEXT_PUBLIC_APP_URL                       (https://mvp.eykon.ai)

CRON_SECRET                               (cron auth — same value pasted into every Railway trigger)
NEXT_PUBLIC_AUTH_ENABLED=true             ← FLIP TO TRUE for launch

# Crypto payments (live)
NOWPAYMENTS_API_KEY
NOWPAYMENTS_IPN_SECRET
NOWPAYMENTS_BASE_URL=https://api.nowpayments.io/v1

# Fiat payments — NOT used in this branch.
# Lemon Squeezy variables stay here only as placeholders for the Week-2 wire-up.
# LEMON_SQUEEZY_API_KEY=
# LEMON_SQUEEZY_STORE_ID=
# LEMON_SQUEEZY_WEBHOOK_SECRET=

SIGNUPS_PAUSED=false                      ← KILL SWITCH; pauses /api/checkout/* AND /api/waitlist

# Legal (Termly UUIDs)
NEXT_PUBLIC_TERMLY_TERMS_UUID
NEXT_PUBLIC_TERMLY_PRIVACY_UUID
NEXT_PUBLIC_TERMLY_COOKIES_UUID
NEXT_PUBLIC_TERMLY_DPA_UUID
NEXT_PUBLIC_TERMLY_REFUND_UUID

# Email
RESEND_API_KEY
RESEND_FROM_EMAIL=eYKON.ai <no-reply@eykon.ai>
RESEND_WEBHOOK_SECRET
EMAIL_DRY_RUN=false                       ← MUST BE FALSE for live emails

# Analytics + referrals
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
NEXT_PUBLIC_REWARDFUL_API_KEY             (cookie capture only on Day 1)
```

### Cron triggers on Railway
Add these scheduled triggers on the web service. Each must include the
`Authorization: Bearer <CRON_SECRET>` header.

| Path                                          | Schedule              | Source        | Purpose                                            |
|-----------------------------------------------|-----------------------|---------------|----------------------------------------------------|
| `/api/cron/ingest-gdelt`                      | every 15 min          | pre-existing  | Conflict feed ingestion                            |
| `/api/cron/compute-baselines`                 | once daily 02:00 UTC  | pre-existing  | Intelligence Center baselines                      |
| `/api/cron/compute-convergences`              | every 30 min          | pre-existing  | Intelligence Center convergence detection          |
| `/api/cron/compute-posture-scores`            | every 30 min          | pre-existing  | Intelligence Center posture scoring                |
| `/api/cron/compute-regime-shifts`             | every 6 h             | pre-existing  | Intelligence Center regime-shift detection         |
| `/api/cron/compute-shadow-fleet-scores`       | every 6 h             | pre-existing  | Intelligence Center shadow-fleet scoring           |
| `/api/cron/score-predictions`                 | once daily 04:00 UTC  | pre-existing  | Calibration ledger maintenance                     |
| `/api/cron/drain-notifications`               | every 1 min           | this branch   | Drains notification_queue → Resend                 |
| `/api/cron/crypto-renewal-reminder`           | once daily 09:00 UTC  | this branch   | 30/7/1-day reminders before annual lapse           |
| `/api/cron/expire-subscriptions`              | once daily 03:00 UTC  | this branch   | Demote lapsed crypto subs (status=expired, citizen)|

The `pre-existing` rows shipped with the Phase-9 Intelligence Center work and
must already be configured on Railway — verify they are still present after
the merge to `main`.

### External integrations
- [ ] **NOWPayments** dashboard → IPN URL: `https://mvp.eykon.ai/api/webhooks/nowpayments`,
      success: `https://mvp.eykon.ai/app?payment=crypto_success`,
      cancel: `https://mvp.eykon.ai/pricing?payment=cancelled`.
- [ ] **Resend** webhooks → `https://mvp.eykon.ai/api/webhooks/resend`,
      events: sent / delivered / opened / clicked / bounced / complained.
- [ ] **Supabase Auth** → Authentication → URL Configuration:
      add both `http://localhost:3000/auth/callback` and
      `https://mvp.eykon.ai/auth/callback` to the redirect allowlist.
      Enable Email + Google + GitHub + Magic Link providers.
- [ ] **Termly** → publish all five policies; UUIDs pasted into env vars.
- [ ] **PostHog** → confirm event ingestion with a test page view.
- [ ] **Rewardful** → first campaign created; create one test affiliate.
      Reminder: payouts are reconciled MANUALLY until the Week-2 webhook
      wire-up — keep an eye on Rewardful dashboard during launch week.

### Code hygiene
- [ ] `git status` clean on `claude/sweet-tu-e68127`; latest pushed.
- [ ] `npm run typecheck` clean.
- [ ] `npm run build` green; verify `/`, `/billing`, `/settings`,
      `/robots.txt`, `/sitemap.xml`, every `/auth/*`, every `/intel/*`,
      and every `/api/*` route appears in the route table.
- [ ] PR opened against `main`; merge approval lined up.

### Smoke tests (sandbox)
- [ ] Email signup → verify email → land on `/app`.
- [ ] Visit `/`, scroll to pricing, toggle "Annual + Crypto −30%", click
      "Claim Founding Rate (crypto) →" on Pro. Lands at
      `/auth/signup?plan=pro_founding_annual`. Sign up → email confirm →
      `/app?plan=pro_founding_annual`.
- [ ] In NOWPayments **sandbox**, confirm an invoice creation through
      `/api/checkout/nowpayments` and that the IPN fires
      `complete_crypto_purchase`. Confirm `user_profiles.tier = 'pro'`,
      `founding_rate_locked = true`, `email_log` shows ReceiptCrypto.
- [ ] On the same `/` page, click "Join fiat waitlist →" on Pro Monthly,
      submit the modal. Row lands in `fiat_waitlist`; `email_log` shows
      a `waitlist_confirmation` send.
- [ ] `curl https://mvp.eykon.ai/api/health` → HTTP 200,
      both `dependencies.supabase.ok` and `dependencies.anthropic.ok` true.
- [ ] `curl -A "Googlebot" https://mvp.eykon.ai/` returns rendered HTML
      with the hero copy in the response body (SEO).
- [ ] `curl https://mvp.eykon.ai/robots.txt` returns the allow/disallow rules.
- [ ] `curl https://mvp.eykon.ai/sitemap.xml` returns the marketing+legal URLs.
- [ ] Visit `/intel/chokepoint` as an authenticated Citizen user → see the
      UpgradePrompt; as Pro → see the workspace.

---

## T − 6h · Final pre-launch

- [ ] Sleep checkpoint. Last edits at 2 AM create launch-day bugs.
- [ ] `SIGNUPS_PAUSED=false`, `NEXT_PUBLIC_AUTH_ENABLED=true`,
      `EMAIL_DRY_RUN=false` — last triple-check.
- [ ] Status page subscribed: post a "scheduled maintenance complete"
      note on `status.eykon.ai` so subscribers know we're live (manual
      placeholder until Instatus wire-up in Week 2).

---

## T − 0 · Launch hour (00:01 UTC for PH)

- [ ] Confirm Product Hunt listing live. First-comment posted within
      5 min — that drives the algorithmic visibility.
- [ ] X/Twitter launch thread published.
- [ ] OSINT DM batch sent (15 accounts).
- [ ] `curl https://mvp.eykon.ai/api/health?shallow=1` every 5 min for
      the first hour as a smoke check.

---

## T + 6h · Midday momentum (09:00 UTC, EU+US overlap)

- [ ] Show HN post live.
- [ ] Reddit drop in r/geopolitics OR r/OSINT (one only — not both).
- [ ] PostHog: check signup → checkout funnel. If drop-off at pricing
      page → copy issue. If at payment → tech issue. Fix the worst step.
- [ ] First receipts email check: confirm at least one ReceiptCrypto
      reached an external inbox (Gmail / ProtonMail / Outlook).

---

## Incident response

### Crypto payment webhook is broken
1. Set `SIGNUPS_PAUSED=true` on Railway (no redeploy needed). This
   pauses BOTH `/api/checkout/nowpayments` AND `/api/waitlist`.
2. Existing users keep access; new checkouts return 503.
3. Check `webhook_events` table — pending rows are evidence.
4. Fix code or NOWPayments dashboard config.
5. Replay any failed IPN by re-sending from the NOWPayments dashboard;
   idempotency on `(provider, event_id)` ensures safe replays.
6. Set `SIGNUPS_PAUSED=false`.

### Founding seats overshoot
The seat-claim path uses `UPDATE founding_seats_counter SET seats_taken =
seats_taken + 1 WHERE seats_taken < cap RETURNING seats_taken`, which is
row-locked by Postgres. Race-safe by construction. If you see
`founding_seats_counter.seats_taken > cap`:
1. Check whether someone manually UPDATE'd the cap.
2. The honoured set is whatever rows have
   `user_profiles.founding_rate_locked = true`.
3. Honour every locked seat; reset `seats_taken` to match the count.

### Email deliverability tanks
1. Check Resend dashboard for bounce / complaint rate.
2. If complaint rate > 0.1%, pause `/api/cron/drain-notifications`
   (delete the Railway trigger, restore later).
3. Investigate the affected templates.
4. Set `EMAIL_DRY_RUN=true` if you need a hard cutoff.

### Total rollback
If everything is on fire and you need to take signups offline without
killing the running service:
```
SIGNUPS_PAUSED=true        ← stops /api/checkout/* + /api/waitlist
EMAIL_DRY_RUN=true         ← stops outbound email
```
The globe + Intelligence Center remain reachable for existing paid users.

---

## Day + 1

- [ ] Pull retro metrics: PostHog signups + checkout_succeeded counts,
      Supabase `purchases` rows, MRR, top-feature `module_opened` events.
- [ ] Process referral commissions MANUALLY (Rewardful payout webhook
      is Week-2 scope; for now reconcile from the Rewardful dashboard).
- [ ] Schedule first 5 paying-customer interviews — 30 min each, in the
      next 7 days. This data is worth more than 1k visitors.

---

## Week 2 follow-on

When the launch dust settles, the deferred integrations come online:

1. **Lemon Squeezy fiat** — wire `/api/checkout/start` and
   `/api/webhooks/lemon-squeezy`; flip the landing's monthly + annual
   tiers from "Join fiat waitlist" to live checkout. Email the top
   400 waitlist entries with their payment-authorization links.
2. **Rewardful payout webhook** — reconcile the Day-1 manual records
   automatically; turn on commission payouts via Stripe Connect / PayPal /
   USDC.
3. **Crisp live chat** — replace the `mailto:support@eykon.ai` footer
   link with the Crisp widget.
4. **Instatus status page** — replace the `status.eykon.ai` placeholder
   with a real Instatus-hosted page.
