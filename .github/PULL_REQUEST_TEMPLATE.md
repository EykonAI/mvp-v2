## Summary

<!-- What changes and why. Measured before built: state the figure, its n and where it was read. -->

## Diff at a glance

<!-- One line per file. -->

## Test plan

<!-- What was run and what was seen. After-apply / after-merge checks stay unticked until seen. -->

## Method gate — tick what applies, strike what does not

- [ ] **Family or forecaster change?** Base rate (n) measured before building · hold-out figure (leave-one-out for exchangeable events, WALK-FORWARD for series) · stability check (split halves or out-of-time) · selection rule stated · change-log row (`ledger_change_log`) in the migration.
- [ ] **Migration?** Applied by the founder BEFORE merge · whole file, no TEMP tables/session state, every statement idempotent · STEP 1 read-only expectations + VERIFY rows · every new function `REVOKE FROM PUBLIC, anon, authenticated` + `GRANT TO service_role` · new source literal? the `predictions_register` CHECK must admit it · raw GitHub link to the migration in the PR body.
- [ ] **Page loops:** every `.range()` has an ORDER BY on a stable key and a dedupe by key.
- [ ] `npm run build` green · never stack on another PR · a11y on main is checked after merge.
