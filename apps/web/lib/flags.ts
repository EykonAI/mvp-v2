// Feature flags (env-gated).
//
// COMM ships behind a flag so it can be built and merged on main while
// staying invisible until flipped per cohort (COMM Strategy brief §7).
// These pages are server-rendered, so a server-side env var is enough —
// no NEXT_PUBLIC exposure required.

/**
 * COMM user profile pages (/u/<handle>). Off until COMM_PROFILES_ENABLED
 * is exactly 'true'. Gate every COMM-profile route + its OG card on this
 * so an unflipped deploy renders nothing (and never queries the new
 * columns before migration 055 is applied).
 */
export function commProfilesEnabled(): boolean {
  return process.env.COMM_PROFILES_ENABLED === 'true';
}
