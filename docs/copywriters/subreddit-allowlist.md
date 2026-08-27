# Subreddit allowlist — ZERO approved

The Reddit composer may not invent a destination. It picks from this list and names
the rule it wrote against; a draft naming a community not on the list fails its
craft lint. **An empty approved set is a valid state**: the Reddit agent then drafts
nothing, which is the correct failure.

Schema per entry: slug · status (approved / comment-only / excluded / PROPOSED) ·
rules-read-on (date the founder personally read the rules) · self-promo policy ·
AI-content policy · flair required · notes.

| slug | status | rules read | notes |
|---|---|---|---|
| r/OSINT | PROPOSED | — | Method-first culture fits the body-carries-the-method rule. Founder must read: self-promo policy, AI policy, flair. |
| r/geopolitics | PROPOSED | — | Large; strict sourcing standards; likely comment-only at best. |
| r/CredibleDefense | PROPOSED | — | High bar, exactly our register; verify whether original analysis posts are allowed at all. |
| r/energy | PROPOSED | — | Fits the commodities/outage beat; policy unread. |

Rules: (1) A PROPOSED entry is not a destination — the samples in this PR use
r/OSINT illustratively and say so. (2) Where a community forbids AI-generated
content, the entry becomes comment-only or excluded and the founder writes by hand —
never disguise (§11.1). (3) An entry whose rules were last read more than a quarter
ago goes stale and is downgraded, not quietly kept.
