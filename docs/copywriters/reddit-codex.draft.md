# Reddit craft codex — DRAFT (becomes lib/copy/channels/reddit/codex.ts in PR-2a)

CODEX_VERSION 2026-08-27.0 · owner: reddit-copywriter subagent · refresh quarterly, next due 2026-11-27.
Rule of the register: `verified: true` may drive a HARD gate; `verified: false` may only warn. CI enforces it.

| id | rule | verified | enforcement |
|---|---|---|---|
| self-post-only | Never a link post. The URL lives inside the body of a text post. | true — house decision 2026-08-27; removal-rate rationale is secondary and separately unverified | hard |
| title-hard-limit | Title ≤ 300 characters. | true — platform limit, trivially checkable | hard |
| title-band | Aim 60–80 chars, front-load the specific noun; mobile truncates. | false — secondary, 2026-08-27 | warn |
| no-url-in-title | No URL in the title. | true — follows from self-post-only | hard |
| body-carries-the-method | ≥150 words of genuine commentary: what the instrument saw, window, baseline. | true as OUR rule; the 150 figure is secondary | hard |
| disclose-affiliation | Affiliation stated in the body, plain words, above the link. Its own schema field so a lint can prove it survived. | true — house rule | hard |
| state-the-limit | A paragraph on what the observation does not establish. Its own field. | true — brief §14.8 | hard |
| one-subreddit-per-artifact | One artifact targets one community; a second community gets a different write. | true — house rule | hard |
| allowlist-only | The target subreddit comes from the checked-in allowlist; the draft names the rule it wrote against. Unknown target = craft-lint failure. | true — house rule | hard |
| flair | Where the allowlist entry records a required flair, the artifact carries a flair field naming it. | true — house rule; per-sub requirements live in the allowlist | hard when the entry requires one |
| name-a-source | At least one instrument by name; "our data" is not a source. | true — voice codes | warn |
| no-repeat-title | Do not open the way recent posts opened. | true — SOP cadence | warn |
| ninety-ten | ≤1 in 10 of the account's contributions is our own material. Constrains the ACCOUNT and cadence, not the copy — lives in the runbook. | false — secondary + Reddit's published spirit | guidance |
| account-gates | Karma/age thresholds are per-sub AutoMod, usually unpublished. | false — observed bands, 2026-08-27 | guidance |

Register default (recommended): **dry**. Harm register: shared module, unchanged,
absolute; punctuation tests on URL-stripped prose. Anti-tell rules (§11.1): shared
list, WARN. Cadence note: the binding constraint is founder comment volume, not
draft volume.
