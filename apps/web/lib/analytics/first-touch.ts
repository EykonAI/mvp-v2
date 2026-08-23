'use client';

import { campaignPropsFromLocation } from './utm';

/**
 * Durable first-touch attribution, carried from the landing page to checkout.
 *
 * WHY THIS FILE EXISTS — the trap it removes
 * ------------------------------------------
 * campaignPropsFromLocation() reads the CURRENT URL. That is correct on the
 * landing page and wrong at checkout, because checkout does not run there:
 * a visitor lands on /start?utm_source=reddit, walks the funnel, and the
 * invoice is requested from /pricing?checkout=... by CheckoutLauncher.
 *
 * Reading the location at that moment yields utm_* = null and, worse,
 * landing_path = '/pricing' — for every sale, from every channel, forever.
 * The "came via /start" column would read 0%, the reddit campaign would look
 * dead, and nothing about the page would appear broken. A wrong answer that
 * renders cleanly is more expensive than no answer, so the value is captured
 * once at the landing page and carried.
 *
 * SEMANTICS — first touch, matching the $set_once person properties in
 * utm.ts. The first campaign that found a visitor keeps the credit even if
 * they return direct three days later and pay then. Never overwritten; a
 * later campaign hit is ignored on purpose.
 *
 * SCOPE — localStorage, one small JSON record, no identifiers of any kind:
 * campaign params the visitor arrived with, the external referrer origin,
 * and the path. Nothing here identifies a person.
 */

const KEY = 'eykon_first_touch_v1';
const MAX_AGE_DAYS = 90;

export type FirstTouch = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  referrer: string | null;
  landing_path: string | null;
  at: string;
};

/**
 * Record the current view as first touch, if nothing is recorded yet.
 * Called from the campaign page-view components (/start, /c, /q).
 *
 * A view with no campaign signal at all — no utm_*, no external referrer —
 * still records its landing_path: "converted from /start, channel unknown"
 * is a true and useful statement, and leaving it blank would silently
 * under-count the page we are about to spend money driving traffic to.
 */
export function rememberFirstTouch(fallback?: {
  source: string;
  medium: string | null;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readFirstTouch();
    if (existing) return; // first touch wins — never overwrite

    const c = campaignPropsFromLocation();
    // The query string wins WHEN IT SURVIVES — it carries campaign and
    // content that a single path segment cannot. The path channel is the
    // floor: it only fills in what a privacy browser stripped on the way
    // here. See lib/closing/channels.ts for the measurement behind this.
    const record: FirstTouch = {
      utm_source: c.utm_source ?? fallback?.source ?? null,
      utm_medium: c.utm_medium ?? fallback?.medium ?? null,
      utm_campaign: c.utm_campaign,
      utm_content: c.utm_content,
      referrer: c.referrer,
      landing_path: c.landing_path || window.location.pathname || null,
      at: new Date().toISOString(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Private mode, quota, disabled storage — attribution is best-effort and
    // must never break the page it is measuring.
  }
}

/**
 * Read the stored first touch, or null. Records older than MAX_AGE_DAYS are
 * treated as absent: crediting a 6-month-old Reddit visit for today's sale
 * is not attribution, it is decoration.
 */
export function readFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirstTouch> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.at !== 'string') return null;

    const ageMs = Date.now() - new Date(parsed.at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > MAX_AGE_DAYS * 86_400_000) {
      window.localStorage.removeItem(KEY);
      return null;
    }

    const s = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null;

    return {
      utm_source: s(parsed.utm_source),
      utm_medium: s(parsed.utm_medium),
      utm_campaign: s(parsed.utm_campaign),
      utm_content: s(parsed.utm_content),
      referrer: s(parsed.referrer),
      landing_path: s(parsed.landing_path),
      at: parsed.at,
    };
  } catch {
    return null;
  }
}
