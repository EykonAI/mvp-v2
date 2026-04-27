/**
 * Canonical app URL — single source of truth for every place we render
 * an absolute URL (OG tags, sitemap/robots, transactional emails, server-
 * issued redirects).
 *
 * Reads `NEXT_PUBLIC_APP_URL`; falls back to the canonical apex when the
 * env var is missing so production never renders broken/empty links.
 *
 * Trailing slash is stripped so callers can do `${APP_URL}/path` safely.
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://eykon.ai').replace(/\/$/, '');
