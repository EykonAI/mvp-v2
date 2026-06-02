# Per-Channel Marketing Attribution (PAMS)

Canonical reference for marketing **and** engineering. The tags below are
the single source of truth; the same list lives in code at
[`apps/web/lib/attribution/channels.ts`](../apps/web/lib/attribution/channels.ts)
(`CHANNELS`). A tag **not** in this list is ignored — no cookie, no
touch, no attribution — so always use a canonical tag.

> **`?ref=` is NOT a channel parameter.** It is owned by the referral
> program (`u_<10 hex>` public ids). Channels use **UTM** (`utm_source`)
> with an optional short **`?ch=`** alias. The two never mix.

## Canonical channel tags

| `utm_source` | `utm_medium` | Use for |
|---|---|---|
| `x` | `social` | Twitter / X posts |
| `linkedin` | `social` | LinkedIn posts & DMs |
| `newsletter` | `email` | Owned newsletter |
| `producthunt` | `referral` | Product Hunt launch |
| `reddit` | `community` | Subreddit posts |
| `hackernews` | `community` | HN / Show HN |
| `youtube` | `social` | Video |
| `discord` | `community` | Discord |
| `telegram` | `social` | Telegram |
| `direct` / `organic` | — | Fallbacks: no tag / untagged |

Forgiving aliases auto-map to canonical (`twitter→x`, `hn→hackernews`,
`ph`/`product_hunt`/`product-hunt→producthunt`, `yt→youtube`), but
prefer the canonical value in published links.

Use **one `utm_campaign` per launch**, e.g. `cday-launch-2026q3`.

## Tagged link format

```
https://mvp.eykon.ai/?utm_source=linkedin&utm_medium=social&utm_campaign=cday-launch
https://mvp.eykon.ai/?utm_source=x&utm_medium=social&utm_campaign=cday-launch
https://mvp.eykon.ai/?utm_source=newsletter&utm_medium=email&utm_campaign=cday-launch
https://mvp.eykon.ai/?utm_source=producthunt&utm_medium=referral&utm_campaign=cday-launch
```

Short hand-shareable alias (resolves to the same channel):

```
https://mvp.eykon.ai/?ch=linkedin
```

Build links in code with the helper:

```ts
import { withChannel } from '@/lib/attribution/channels';
withChannel('https://mvp.eykon.ai/', 'linkedin', {
  medium: 'social',
  campaign: 'cday-launch',
});
```

## How it flows (mirrors the referral chain)

1. **Tagged visit** → middleware reads `utm_source`/`?ch`, validates it,
   and sets a **90-day first-touch** `eykon_channel` cookie
   (`sameSite=lax`). First-touch wins — never overwritten.
2. **Anonymous touch** (full-funnel) → `<ChannelCapture>` POSTs the touch
   to `/api/attribution/channel`, writing one `channel_touchpoints` row
   (silent 204, IP rate-limited).
3. **Signup** → the signup page forwards the cookie as
   `raw_user_meta_data.eykon_channel`; `handle_new_user` parks it on
   `user_profiles.acquisition_channel_pending`.
4. **First paid conversion** → `handle_first_paid_conversion` finalises
   `acquisition_channel_pending → acquisition_channel` (first-touch wins),
   so revenue is attributable to the channel.
5. **OAuth signups** → `/auth/callback` resolves the cookie post-auth
   (OAuth bypasses the signup metadata path).

## Reporting

Two views (migration 048), queried via the service role:

```sql
-- top of funnel: touches per channel
SELECT * FROM channel_touchpoint_summary;

-- bottom of funnel: signups → paid conversions per channel
SELECT * FROM channel_attribution_summary;
```

## Schema

- `channel_touchpoints` (migration 046) — the inbound touch stream;
  service-role-only RLS; `ip_hash` (SHA-256), never a raw IP.
- `user_profiles.acquisition_channel_pending` → `acquisition_channel`
  (046) — the pending→resolved first-touch winner.
- Triggers `handle_new_user` / `handle_first_paid_conversion` (047).

## Privacy

First-party cookie, `sameSite=lax`. No raw IP is ever stored (`ip_hash`
only). Only the **host** of the referrer is kept, never the full URL. No
PII in query strings. The `eykon_channel` cookie matches the existing
referral cookie's posture and window (decision D6 — disclosed in the
privacy/DPA pages).
