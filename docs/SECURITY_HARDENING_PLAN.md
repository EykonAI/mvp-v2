# eYKON Security Hardening — In-Repo Plan of Record

Pre-launch hardening for eykon.ai. Critical infra, no/low-cost
provider config, and the PR sequence proposed before public launch.

- **Source of truth:** this file. The earlier `.docx` in
  `BACKEND/eYKON Security/` is regenerated from this on each update.
- **Date of record:** 2026-05-09
- **Author/owner:** founder@eykon.ai
- **Status:** in-flight — 3 of 12 §3 dashboard items done; PR-S1
  open; PR-S2 / PR-S3 pending

## 0. What changed since the 2026-05-07 brief

Two operational facts that the original plan got wrong, re-issued here:

- **DNS is at Namecheap, not Cloudflare.** eykon.ai uses Namecheap
  nameservers. Cloudflare is only used for the Turnstile widget
  (script tag, no DNS dependency). DNSSEC, CAA records, and the
  Resend DMARC/SPF/DKIM TXT records all live in **Namecheap → Domain
  List → eykon.ai → Advanced DNS**, not Cloudflare DNS.
- **Cloudflare WAF / Bot Fight / Rate-Limiting deferred to Week 2.**
  These products require traffic to flow through Cloudflare's edge
  proxy, which means Cloudflare must be authoritative DNS. While DNS
  stays at Namecheap, those three items are **not deployable**. The
  decision recorded here is **Path A**: defer the Cloudflare-edge
  layer; rely on **PR-S2's in-app rate limiter** as the sole rate-limit
  layer for launch. A DNS migration to Cloudflare is a Week-2
  candidate (see §6).

The remainder of the original brief stands.

## 1. Threat surface map

Every load-bearing layer in the eYKON stack, the worst case if
compromised, and where this plan addresses it.

| Layer | Worst case if compromised | Addressed by |
|---|---|---|
| GitHub repo | Public; attacker pushes malicious code to main and ships to prod via Railway auto-deploy | §3 today (branch protection ✓), §6 PR-S1 |
| Supabase service-role key | God-mode read/write across every table; bypasses RLS | §3 today |
| Railway env vars | All secrets concentrated; one leaked dashboard session = full secret pull | §3 today |
| Founder personal accounts | Single point of failure across GitHub / Supabase / Railway / Cloudflare = full takeover | §3 today (2FA in progress, 6/10) |
| NOWPayments webhook | Money-bearing entry point; spoofed "finished" event grants paid tier without payment | Already solid (HMAC verified). Periodic rotation only |
| Open POST endpoints | `/api/attribution/capture` + `/api/share/create` accept POSTs with no app-level rate limit | §6 PR-S2 |
| Email sender domain | Without DMARC/SPF/DKIM aligned, attackers spoof `from no-reply@eykon.ai` and phish users | §3 today (Namecheap DNS) |
| DNS / TLS | Without DNSSEC + CAA, DNS hijack → MITM; without HSTS preload, first-visit downgrade attacks | §3 today (Namecheap DNSSEC + CAA), §6 PR-S1 (HSTS preload, app-layer) |
| npm dependencies | Compromised transitive package ships malicious code into the bundle | §3 today (Dependabot ✓ + tightening PRs #76, #83, #90) |
| Server logs | Accidental `console.error` of a secret-bearing payload leaks into Railway log retention | §6 PR-S3 |

## 2. Critical infra points — six things to protect first

Ranked by blast radius if compromised.

| # | Severity | Layer | Why it matters |
|---|---|---|---|
| 1 | Critical | GitHub `main` branch | Public repo. PR review gate now in place via branch protection (PR #65 smoke). 2FA on the account is the remaining single-point-of-failure |
| 2 | Critical | Supabase service-role key | Bypasses every RLS policy. Used by every server-side route. Leak = full DB exfil |
| 3 | High | Founder personal accounts | GitHub, Supabase, Railway, Cloudflare, NOWPayments, Resend, etc. One compromised account → platform takeover |
| 4 | High | Railway env vars | All secrets concentrated on one dashboard. Railway login compromise = pull every secret in one click |
| 5 | Medium | Email DNS records | DMARC + SPF + DKIM at the Namecheap DNS level (records output by the Resend wizard, pasted in Namecheap Advanced DNS) |
| 6 | Medium | DNS itself | DNSSEC + CAA at Namecheap (Domain List → eykon.ai → Advanced DNS). Prevents rogue cert issuance and DNS hijacks |

## 3. Today — one-click free wins

Status as of 2026-05-09. No code changes, no deploy, no cost.

| # | Action | Where | ETA | Status |
|---|---|---|---|---|
| 1 | Branch protection on `main` (PR + 1 review + status checks) | GitHub → Settings → Branches | 5 min | ✓ done — verified by PR #65 smoke |
| 2 | Dependabot alerts + security updates | GitHub → Security → Dependabot | 2 min | ✓ done — `.github/dependabot.yml` + tightening PRs #76, #83, #90 |
| 3 | Secret scanning + push protection | GitHub → Security → Code security | 2 min | ✓ done (account + org/repo) |
| 4 | 2FA on every admin account | Each provider | 20 min | **in progress · 6/10** — done: GitHub, Railway, Supabase, Twilio, NOWPayments, Resend. Remaining: Cloudflare, Anthropic, PostHog, Rewardful (in priority order) |
| 5 | DNSSEC on eykon.ai | **Namecheap** → Domain List → eykon.ai → Advanced DNS → DNSSEC toggle | 2 min | pending |
| 6 | CAA records (`0 issue "letsencrypt.org"` + `0 issuewild "letsencrypt.org"`) | **Namecheap** Advanced DNS → Add Record → CAA | 5 min | pending |
| 7 | HSTS preload (1 year, includeSubDomains, preload) | Ships in **PR-S1** as app-layer header (no Cloudflare UI step needed) | PR-S1 | in-flight |
| 8 | DMARC + SPF + DKIM for eykon.ai (Resend wizard output) | **Namecheap** Advanced DNS → paste TXT/CNAME records from Resend wizard | 15 min | pending |
| 9 | ~~Cloudflare WAF managed rules + Bot Fight Mode~~ | n/a — requires Cloudflare DNS proxy | — | **deferred to Week 2 (Path A)** |
| 10 | ~~Cloudflare rate-limiting on `/api/attribution/capture` + `/api/share/*`~~ | n/a — requires Cloudflare DNS proxy | — | **superseded by PR-S2 (in-app rate limit)** |
| 11 | Supabase PITR (point-in-time recovery) | Supabase → Database → Backups | 2 min | pending |
| 12 | Supabase Auth — tighten rate limits + leak-protected passwords | Supabase → Authentication → Policies | 5 min | pending |
| 13 | Rotate any secret pasted into chats/docs (CRON_SECRET, RESEND_API_KEY, NOWPAYMENTS_IPN_SECRET, SUPABASE_SERVICE_ROLE_KEY) | Each provider | 20 min | pending |

Total remaining dashboard work: **~60 minutes** (items 4–8, 11–13;
items 9–10 are zero work because deferred).

### 2FA priority order (item #4)

1. **Cloudflare** ← do this first (highest blast radius of the
   remaining four; protects the Turnstile site key and any future DNS
   migration). `dash.cloudflare.com/profile/authentication`
2. Anthropic Console — API key access. Settings → Profile → 2FA
3. PostHog — analytics, no money or PII control plane
4. Rewardful — currently quiet; only matters once Component B engine ships

### Side notes worth acting on while in those dashboards

- **Backup authenticator app on Supabase.** Their banner suggests
  "configure two authenticator apps across different devices." 30
  seconds — open the 2FA app you're not currently using and scan the
  QR code under "Add new app". Without this or recovery codes, a lost
  primary phone = locked out.
- **Recovery codes everywhere.** Each provider gives ~10 backup codes
  on 2FA setup. Save them in Proton Pass (or wherever you keep
  secrets). Already done for: GitHub, Railway, Twilio. Remaining:
  Supabase, NOWPayments, Resend, and the four still-pending providers.

## 4. Pre-launch — small code changes

Three PRs, all targeting `main`, no migration, no new env vars beyond
the optional `CSP_REPORT_URI`.

### PR-S1 · Security headers + SECURITY.md + this plan · **in-flight**

| Field | Value |
|---|---|
| Files | `apps/web/next.config.js` · `SECURITY.md` (new at repo root) · `docs/SECURITY_HARDENING_PLAN.md` (this file, new) |
| Migration | None |
| Env vars | None required. Optional: `CSP_REPORT_URI` for CSP violation reports |
| Risk | Low. CSP ships in **Report-Only** for the first week. Other headers are non-breaking |
| What it adds | Strict CSP (Report-Only) with `connect-src` for Supabase, PostHog, Rewardful, Turnstile; HSTS `max-age=31536000` `includeSubDomains` `preload`; X-Frame-Options DENY; X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy denying camera/microphone/geolocation/payment by default |
| Test plan | Browser DevTools → Network → response headers verified on `/`, `/app`, `/pricing`. CSP violations land in `CSP_REPORT_URI` (if set) and are reviewed before flipping to enforce |

### PR-S2 · Rate limit open POST endpoints · pending

| Field | Value |
|---|---|
| Files | `apps/web/lib/rate-limit.ts` (new) · `apps/web/app/api/attribution/capture/route.ts` · `apps/web/app/api/share/create/route.ts` |
| Migration | None — uses existing `attribution_events.ip_hash` + `created_at` for IP counts; Postgres-side query for user counts |
| Limits | `attribution capture`: 60/min per IP (silent drop above limit, matching spec §1.3 silent semantics). `share create`: 30/hour per authenticated user (returns 429 with `Retry-After`) |
| Risk | Low. Limiter logic is additive; if buggy it returns "no limit" and the existing flow behaves normally |
| Note | Now load-bearing as the **sole rate-limit layer** until Path B (Cloudflare DNS migration) ships |
| Test plan | `curl` loop hammering `/api/attribution/capture` from one IP — 61st request silently no-ops. Same for `/api/share/create` at 31st request — returns 429 |

### PR-S3 · Logging audit + safe-logger · pending

| Field | Value |
|---|---|
| Files | `apps/web/lib/log.ts` (new) · targeted edits to API routes that currently log payloads |
| Migration | None |
| Env vars | None |
| Risk | Low. `safeError` is a pure wrapper around `console.error` with key-allowlist scrubbing. Existing call sites are mechanical replacements |
| What it adds | `safeError(message, ctx)` drops keys matching known secret patterns (case-insensitive: `secret`, `key`, `token`, `password`, `signature`, `api_key`, `authorization`, `x-*-sig`, `raw_body`). Sweep finds the ~10 `console.error` calls in API routes that pass payload objects; each gets a one-line edit |
| Test plan | Throw a fake error containing `{ secret: 'foo' }` via the analyst route — Railway log shows the message but not the value |

### CSP enforcement flip — follow-up PR

After 7 days of clean reports at `CSP_REPORT_URI` (no legitimate
scripts blocked), flip the header key in `apps/web/next.config.js`:

```diff
- { key: 'Content-Security-Policy-Report-Only', value: csp },
+ { key: 'Content-Security-Policy', value: csp },
```

One-line PR. Submit eykon.ai to <https://hstspreload.org> in the same
window once the HSTS header has been live for at least 24 h.

## 5. Week-1 follow-ups — operational hygiene

Not blocking launch. Build the routine in the first week.

| # | Practice | Tool (free tier) | Why |
|---|---|---|---|
| 1 | Backup-restore drill | Supabase PITR + manual restore to staging | Verify the restore works before you need it for real |
| 2 | Uptime monitoring | BetterStack / UptimeRobot free | Get paged when `/api/health` returns non-200 for ≥2 min |
| 3 | Error monitoring | Sentry Developer (free) | Aggregate JS + server errors with traces, instead of grepping Railway logs |
| 4 | Status page | Instatus / BetterStack | Public communication channel during incidents |
| 5 | Incident response runbook | Repo doc (extends `LAUNCH_CHECKLIST.md` § Incident response) | Codify `SIGNUPS_PAUSED` + `EMAIL_DRY_RUN` escape hatches |
| 6 | Quarterly secret-rotation calendar | Calendar reminder | Rotate `CRON_SECRET`, `NOWPAYMENTS_IPN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` every 90 days |
| 7 | CodeQL scanning | GitHub Advanced Security (free for public repos) | Static analysis on every PR. Catches common vuln classes (SQLi, XSS, hardcoded secrets) automatically |
| 8 | **Cloudflare DNS migration evaluation** | Cloudflare DNS (free) | Decide whether to migrate eykon.ai authoritative DNS from Namecheap to Cloudflare. Unlocks WAF + Bot Fight + edge rate-limiting + Cloudflare HSTS UI. Trade-off: one-time propagation risk |

## 6. Per-provider checklist

Items in **bold** are critical; recommended items in regular weight.

### Namecheap (DNS host) — newly relevant

- **2FA on the Namecheap account.** Account → Manage Profile → Security
- **DNSSEC enabled** for eykon.ai (Domain List → Manage → Advanced DNS → DNSSEC toggle). `.ai` TLD supports DNSSEC
- **CAA records published** at Advanced DNS:
  - `CAA 0 issue "letsencrypt.org"`
  - `CAA 0 issuewild "letsencrypt.org"`
- **DMARC TXT** at host `_dmarc`: `v=DMARC1; p=none; rua=mailto:dmarc-reports@eykon.ai; pct=100;` (escalate to `p=quarantine` after 14 days clean reports, then `p=reject` after another 14 days)
- **SPF TXT** at host `@` (Resend wizard output): `v=spf1 include:_spf.resend.com ~all`
- **DKIM CNAME(s)** at the host(s) Resend specifies in its dashboard wizard
- Domain transfer lock + registrar lock both ON
- Auto-renew ON with valid card

### GitHub (EykonAI/mvp-v2)

- **Branch protection on `main`** ✓ (require PR + review, status checks, dismiss stale approvals, no force push, no deletion)
- **Dependabot alerts + security updates** ✓
- **Secret scanning + push protection** ✓
- **2FA enforced** ✓ (passkey + authenticator app)
- `SECURITY.md` ✓ — present at repo root (this PR)
- CodeQL — Settings → Code security → Code scanning → Set up. Free for public repos. Pending
- Limited collaborators with least-privilege roles (audit Settings → Collaborators)

### Supabase (eYKON project, Pro tier)

- **2FA on the dashboard** ✓ (authenticator). Add a second authenticator app for recovery
- **PITR enabled** — Project Settings → Database → Point-in-time recovery (pending)
- **Auth rate limits tightened; leak-protected passwords ON** — Authentication → Settings (pending)
- Minimum password length 10+ (default 6 is too low)
- OAuth providers restricted to expected redirect URLs only
- RLS verified on every table (already done; spot-check after each migration)
- Service-role key only present in Railway prod env, nowhere else
- IP allowlist for direct Postgres connections (home IP + Railway egress)
- Take + restore a backup once before launch — 15-minute drill

### Railway

- **2FA on the dashboard** ✓ (authenticator + Proton Pass passkey)
- Production environment is the ONLY one with real secrets
- Audit log reviewed for unexpected sessions
- Deploy webhooks restricted to GitHub events from `main` only
- Search recent logs for `sk_`, `API_KEY=`, founder email — none should appear in plaintext

### Cloudflare (Turnstile site only — DNS at Namecheap)

- **2FA on the dashboard** — pending; this is the next 2FA item to do
- Turnstile site key + secret key correctly scoped (site key public-OK, secret server-side only)
- ~~DNSSEC, CAA, WAF, Bot Fight, Rate-Limiting~~ — n/a unless DNS migrates here (Path B, Week 2)

### Resend

- **2FA on the dashboard** ✓ (authenticator)
- **DMARC + SPF + DKIM all green for eykon.ai** — verify in Resend Domains tab once the Namecheap TXT/CNAME records propagate (pending)
- `RESEND_WEBHOOK_SECRET` set + verified — see `apps/web/app/api/webhooks/resend/`
- API key sending-only (not full-access)
- Sending domain restricted to `eykon.ai` (no test subdomains in prod)

### NOWPayments

- **2FA on the dashboard** ✓ (authenticator)
- IPN URL restricted to `https://eykon.ai/api/webhooks/nowpayments`
- HMAC verification confirmed — `apps/web/lib/payments/signatures.ts`
- Idempotency table covering replays — already in place
- Withdrawal address whitelist (lock to a single wallet)

### Anthropic

- **2FA on the console** — pending
- API key scoped to a single workspace
- Spend cap configured

### PostHog

- **2FA on the dashboard** — pending
- EU instance for GDPR (`eu.i.posthog.com`) ✓
- `NEXT_PUBLIC_POSTHOG_KEY` is the project-write-only key — read-only key NOT exposed

### Rewardful

- **2FA on the dashboard** — pending
- API secret separate from the public tracking key
- Restrict API secret to server-side use only (`REWARDFUL_API_SECRET`, never `NEXT_PUBLIC_*`)

### Twilio

- **2FA on the console** ✓
- API keys scoped per-service
- Spend cap configured to prevent runaway costs from a notification-storm bug

## 7. Code-level audit · pre-PR-S2 + PR-S3 sweep

Specific files to sweep before opening PR-S2 and PR-S3.

- `apps/web/app/api/attribution/capture/route.ts` — confirm no app-level rate limit today (PR-S2 adds one)
- `apps/web/app/api/share/create/route.ts` — confirm RLS is the only check today; PR-S2 adds per-user rate limit
- `apps/web/app/api/grow/submissions/route.ts` — already has per-IP + per-email + Turnstile (PR #60). Cross-reference for the rate-limit pattern
- Every `console.error` / `console.log` in `apps/web/app/api/*` — sweep for payload-shaped second arguments. Replace with `safeError()` (PR-S3)
- `apps/web/middleware.ts` — verify `eykon_ref` cookie attributes (`samesite=lax`, `secure` in prod, `httpOnly:false` intentionally for client read)
- `apps/web/app/api/webhooks/nowpayments/route.ts` — sanity-check raw-body read happens before any framework JSON parsing (it does today)
- `package.json` + `package-lock.json` — `npm audit`; confirm lockfile is committed
- Search for `dangerouslySetInnerHTML` — should be zero matches in `apps/web` except the intentional Rewardful queue bootstrap. Audit any other match for user-supplied input
- Confirm none of these are `NEXT_PUBLIC_*`: `REWARDFUL_API_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `TURNSTILE_SECRET_KEY`, `CRON_SECRET`
- Confirm every API route that uses `createServerSupabase()` has an explicit ownership check OR a clear server-only access path
- Confirm CRON routes reject any request without `Authorization: Bearer $CRON_SECRET`

## 8. Out of scope

Items often suggested by generic security audits that do not move the
needle for eYKON's threat model right now.

- **Pen-test before launch.** Useful but expensive. Defer until a paying customer requires it. The free tier of every recommendation here closes 80% of what a pen-test would find
- **WAF / SOC / SIEM enterprise tools.** The Cloudflare-edge baseline is the planned mitigation; while DNS stays at Namecheap, in-app rate limit (PR-S2) is the layer. No SOC team to feed a SIEM
- **Code obfuscation.** Repo is public anyway. Real boundary is RLS + signed webhooks + HMAC, all public-by-design and still secure
- **Custom JWT or rolling-your-own auth.** Supabase Auth handles this. Custom auth is the #1 source of self-inflicted CVEs in early-stage SaaS
- **Application-layer encryption beyond what Supabase provides.** Postgres data is already encrypted at rest. Envelope encryption per-row is appropriate for HIPAA / financial-class data, not the eYKON workload
- **SOC 2 / ISO 27001 audit.** Six-figure spend. Do it when an enterprise customer asks (you'll know — they ask)
- **Bug bounty programme.** Worth it once you have a few hundred paying users. Pre-launch the noise-to-signal is bad

## 9. Action plan — what happens next

1. **Today (founder, ~60 min dashboards).** Items 4 (remaining 4 providers), 5–6 (Namecheap DNSSEC + CAA), 8 (Resend wizard → Namecheap DMARC/SPF/DKIM), 11–12 (Supabase PITR + Auth tightening), 13 (secret rotation)
2. **PR-S1 (in-flight).** Security headers + `SECURITY.md` + this plan. Merging unblocks the CSP-Report-Only observation window
3. **PR-S2.** In-app rate limit on `/api/attribution/capture` + `/api/share/create`. Sole rate-limit layer until Path B
4. **PR-S3.** Logging audit + `safeError()` wrapper
5. **+7 days.** Review CSP report endpoint. Flip `Content-Security-Policy-Report-Only` → `Content-Security-Policy` if clean. Submit eykon.ai to <https://hstspreload.org>
6. **Week 1.** Operational hygiene from §5: backup-restore drill, uptime monitoring, error monitoring, status page, runbook, rotation calendar, CodeQL
7. **Week 2 (optional).** Evaluate Cloudflare DNS migration (Path B). Trade-off: one-time propagation risk vs. WAF + Bot Fight + edge rate-limiting + Cloudflare HSTS UI

---

Plan generated 2026-05-07; revised 2026-05-09 with Namecheap DNS
correction and Path A WAF deferral. Grounded against current main
(HEAD `a6db6d7`), migrations 001–027, and the PR sequence approved
by the founder on 2026-05-09.
