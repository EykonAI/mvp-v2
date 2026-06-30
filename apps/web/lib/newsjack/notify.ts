// Founder alert when a draft is ready (Newsjacking SOP layer 4). Posts a
// compact summary + the admin review link to NEWSJACK_ALERT_WEBHOOK
// (Slack- and Discord-compatible — both `text` and `content` keys are sent).
// Fail-soft: a missing webhook or a failed POST never breaks the detect tick.

export async function notifyFounder(summary: {
  domain: string | null;
  region: string | null;
  severity: string | null;
  lead: string;
  adminUrl: string;
}): Promise<void> {
  const url = process.env.NEWSJACK_ALERT_WEBHOOK;
  if (!url) return;
  const text =
    `Newsjack draft ready — ${summary.severity ?? '?'} ${summary.domain ?? ''} near ${summary.region ?? '?'}\n` +
    `${summary.lead}\nReview + approve: ${summary.adminUrl}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    });
  } catch {
    /* fail-soft */
  }
}
