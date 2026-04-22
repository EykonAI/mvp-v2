# eYKON.ai · Launch-Day Operational Runbook

Time-relative checklist for the public launch (Product Hunt + Show HN + X).
Maps onto the operational checklist in
`Marketing & Sales/Road to Market/eYKON_launch_day_checklist.docx`,
with the code references that ship in this branch.

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

# Payments
NOWPAYMENTS_API_KEY
NOWPAYMENTS_IPN_SECRET
NOWPAYMENTS_BASE_URL=https://api.nowpayments.io/v1

SIGNUPS_PAUSED=false                      ← KILL SWITCH; flip to true to stop /api/checkout/* + /api/waitlist

# Legal
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
NEXT_PUBLIC_REWARDFUL_API_KEY
```

### Cron triggers on Railway
Add these scheduled triggers on the web service. Each must include the
`Authorization: Bearer <CRON_SECRET>` header.

| Path                                          | Schedule        | Purpose                                       |
|-----------------------------------------------|-----------------|-----------------------------------------------|
| `/api/cron/ingest-gdelt`                      | every 15 min    | Conflict feed (existing)                      |
| `/api/cron/drain-notifications`               | every 1 min     | Send queued emails via Resend                 |
| `/api/cron/crypto-renewal-reminder`           | once daily 09:00 UTC | 30/7/1-day reminders before annual lapse |
| `/api/cron/expire-subscriptions`              | once daily 03:00 UTC | Demote lapsed crypto subs to Citizen     |
| `/api/cron/score-predictions`                 | per Phase-9 plan | Intelligence Center maintenance              |
| `/api/cron/compute-*`                         | per Phase-9 plan | Intelligence Center maintenance              |

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

### Code hygiene
- [ ] `git status` clean on `claude/sweet-tu-e68127`; latest pushed.
- [ ] `npm run typecheck` clean.
- [ ] `npm run build` green; verify `/`, `/pricing` (anchor), `/launch`,
      and `/sitemap.xml` all appear in the route table.
- [ ] PR opened against `main`; merge approval lined up.

### Smoke tests (sandbox)
- [ ] Email signup → verify email → land on `/app`.
- [ ] Visit `/pricing`, click "Pay with crypto" on Pro Founding Annual.
      Check NOWPayments sandbox invoice creates and the IPN fires
      `complete_crypto_purchase`. Confirm `user_profiles.tier = 'pro'`,
      `founding_rate_locked = true`, `email_log` shows ReceiptCrypto.
- [ ] `curl https://mvp.eykon.ai/api/health` → `status: "ok"`,
      both `dependencies.supabase.ok` and `dependencies.anthropic.ok` true.
- [ ] `curl -A "Googlebot" https://mvp.eykon.ai/` returns rendered HTML
      with the hero copy in the response body (SEO).
- [ ] `curl https://mvp.eykon.ai/robots.txt` returns the allow/disallow rules.
- [ ] `curl https://mvp.eykon.ai/sitemap.xml` returns the marketing+legal URLs.
- [ ] Submit the waitlist modal on `/` → row lands in `fiat_waitlist`,
      Resend logs a `waitlist_confirmation` send to `email_log`.

---

## T − 6h · Final pre-launch

- [ ] Sleep checkpoint. Last edits at 2 AM create launch-day bugs.
- [ ] `SIGNUPS_PAUSED=false`, `NEXT_PUBLIC_AUTH_ENABLED=true`,
      `EMAIL_DRY_RUN=false` — last triple-check.
- [ ] Status page subscribed: post a "scheduled maintenance complete"
      note on `status.eykon.ai` so subscribers know we're live.
- [ ] `/launch` page gate: ensure `LAUNCH_GATE=false` is set so the page
      is reachable.

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

### Payment webhook is broken
1. Set `SIGNUPS_PAUSED=true` on Railway (no redeploy needed).
2. Existing users keep access; new checkouts return 503.
3. Check `webhook_events` table — pending rows are evidence.
4. Fix code or NOWPayments dashboard config.
5. Replay any failed IPN by re-sending from the NOWPayments dashboard;
   idempotency on `(provider, event_id)` ensures safe replays.
6. Set `SIGNUPS_PAUSED=false`.

### Founding seats overshoot
The `claim_founding_seat()` function uses `UPDATE ... WHERE seats_taken < cap`
which is row-locked by Postgres. Race-safe by construction. If you see
`founding_seats_counter.seats_taken > cap`:
1. Check whether someone manually UPDATE'd the cap.
2. The honoured set is whatever rows have `user_profiles.founding_rate_locked = true`.
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
- [ ] Process referral commissions (manual for first 20 events per plan).
- [ ] Schedule first 5 paying-customer interviews — 30 min each, in the
      next 7 days. This data is worth more than 1k visitors.
