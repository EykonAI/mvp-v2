// COMM D3 — reserved "eYKON Analyst" identity.
//
// The in-room analyst posts its replies as a real user_profiles row so the
// comm_messages.author_id FK is satisfied with no schema change. That row's
// id lives in COMM_ANALYST_PROFILE_ID. The env doubles as the feature flag:
// unset → the room "Ask the Analyst" affordance is hidden and the ask API
// returns 503, so D3 ships safely inert until the founder provisions the
// analyst account and sets the id.

export function getAnalystId(): string | null {
  const id = process.env.COMM_ANALYST_PROFILE_ID?.trim();
  return id && id.length > 0 ? id : null;
}
