# Security policy

eYKON.ai is a geopolitical intelligence platform handling user accounts,
payment events, and analyst-grade content. We take security reports
seriously and prioritise responsible-disclosure submissions over public
issues.

## Reporting a vulnerability

Email **security@eykon.ai** with:

- A clear description of the vulnerability and the affected surface
  (URL, endpoint, parameter, or repo path)
- Steps to reproduce — proof-of-concept payloads, screenshots, or a
  minimal script
- Your assessment of impact (data exposure, account takeover, denial of
  service, etc.)
- Whether you intend to disclose publicly, and on what timeline

If you cannot use email, open a private security advisory on the
[mvp-v2 repo](https://github.com/EykonAI/mvp-v2/security/advisories/new).

**Please do not** open a public issue, post on social media, or share
proof-of-concept payloads in places that index them (Pastebin, public
gists, Stack Overflow) before we have had a chance to remediate.

## Response targets

| Severity | First response | Triage decision | Fix or mitigation |
|---|---|---|---|
| Critical (RCE, auth bypass, data exfil) | within 24 h | within 48 h | within 7 days |
| High (privilege escalation, IDOR, RLS escape) | within 48 h | within 5 days | within 14 days |
| Medium (XSS, CSRF, info disclosure) | within 5 days | within 10 days | within 30 days |
| Low (header miss, fingerprinting, hygiene) | within 10 days | within 21 days | best-effort |

These are targets, not contractual SLAs. Solo-founder ops; we will
acknowledge receipt explicitly so you know the report landed.

## Scope

In scope:

- The web application at `eykon.ai` and `mvp.eykon.ai`
- All API routes under `/api/*` on those origins
- The `EykonAI/mvp-v2` GitHub repository (public)
- Authentication flows (Supabase Auth) and account state
- Payment and webhook handling (NOWPayments crypto checkout, IPN)
- Notification delivery (email, SMS, WhatsApp via Resend / Twilio)
- Referral attribution and incentive flows

Out of scope:

- Social-engineering attacks against eYKON staff or customers
- Physical attacks against eYKON infrastructure
- Denial-of-service findings that require sustained traffic above
  reasonable abuse thresholds
- Issues in third-party services we depend on (Supabase, Cloudflare,
  Railway, Resend, Twilio, NOWPayments, PostHog, Rewardful) — please
  report those to the upstream vendor; if the issue manifests through
  our integration, mention it here as well
- Reports based solely on missing best-practice headers when an
  equivalent control is documented in
  [docs/SECURITY_HARDENING_PLAN.md](docs/SECURITY_HARDENING_PLAN.md)
- Self-XSS, clickjacking against pages with `frame-ancestors 'none'`,
  or vulnerabilities that require a victim to manually paste attacker
  content into the browser console

## Recognition

We do not currently run a paid bug-bounty programme. We are happy to:

- Credit reporters by name (or handle) on a public security
  acknowledgements page after disclosure
- Provide a written reference for security work performed
- Send a thank-you note and, where appropriate, eYKON merchandise

A paid programme will be considered after launch once the disclosure
volume and severity profile is understood.

## Cryptography and key handling

- TLS 1.2 minimum; HSTS (`max-age=31536000; includeSubDomains; preload`)
  enforced via `apps/web/next.config.js`
- Webhook payloads are HMAC-verified before any side effect — see
  `apps/web/lib/payments/signatures.ts` for the NOWPayments verifier
  and `apps/web/app/api/webhooks/resend/` for the Resend Svix path
- Service-role Supabase keys never reach the browser bundle and are
  rotated on a quarterly cadence — see §5 of
  [docs/SECURITY_HARDENING_PLAN.md](docs/SECURITY_HARDENING_PLAN.md)

## Coordinated disclosure

We will work with you on a disclosure timeline. Default: 90 days from
first response, or 30 days after a fix ships, whichever is sooner. We
will not pursue legal action against good-faith researchers who follow
this policy.

---

Last updated: 2026-05-09 · Owner: founder@eykon.ai
