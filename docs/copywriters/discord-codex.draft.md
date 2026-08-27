# Discord craft codex — DRAFT (becomes lib/copy/channels/discord/codex.ts in PR-2b)

CODEX_VERSION 2026-08-27.0 · owner: discord-copywriter subagent · refresh quarterly, next due 2026-11-27.

| id | rule | verified | enforcement |
|---|---|---|---|
| message-budget | Message ≤ 2,000 chars (webhooks/bots regardless of Nitro). | true as OUR budget; platform figure secondary, 2026-08-27 | hard |
| embed-budget | Title ≤256 · description ≤4,096 · field value ≤1,024 · ≤25 fields · ≤10 embeds · ≤6,000 chars total across embeds. | true as OUR budgets; platform figures secondary | hard |
| validate-before-send | Lengths checked before the payload is built — an over-budget embed errors the whole send, so a genuine overflow fails visibly, never trimmed silently. | true — house rule | hard |
| no-mass-mention | No @everyone, @here, or role mention, ever, from an automated poster. | true — house rule | hard |
| own-server-only | Publish only to a server eYKON owns. | true — house rule | hard |
| write-only | The writer reads the evidence package and nothing else. No channel, reply, thread or member list ever enters a prompt, codex or recent-leads list. | true — the inbound injection boundary, brief §13.4 | hard (structural) |
| one-embed | One embed per message; ten is a limit, not a target. | true — house rule | warn |
| no-tables | No markdown tables — they do not render; use embed fields. | false — platform behaviour, secondary | warn |
| state-the-limit | A field named for what the observation does not establish. | true — house rule | hard |
| name-a-source | Instrument named in the embed, not implied. | true — voice codes | warn |
| native-timestamp | Prefer Discord native timestamp markup for observation times so each reader sees local time. | false — platform feature, secondary | guidance |
| webhook-rate | Webhook posting has per-channel rate limits; a queue-drain must pace, not burst. | false — secondary; irrelevant at SOP cadence, recorded for PR-4 | guidance |
| treat-as-public | Announcement channels can be followed by other servers; write every message as public. | false — secondary | guidance |

Register default (recommended): **dry**, one notch warmer than X. Harm register:
shared, absolute. Anti-tell: shared list, WARN.
