import type { SupabaseClient } from '@supabase/supabase-js';
import { freeSlotsRemaining } from '@/lib/comm/creatorPro';

// Founding Partner programme (mig 076, build-prompt 2026-07-05).
// 20 founder-vetted partners, ever. Grants are admin-issued only —
// there is no self-serve path. Partner status bridges the paid-Space
// gate and bundles Creator Pro (from the SHARED free-50 pool); it
// never touches the Reputation Note display.

export const FOUNDING_PARTNER_CAP = 20;
export const CURRENT_TERMS_VERSION = 'v1-2026-07';
export const NOTE_DEADLINE_MONTHS = 6;
export const WARN_AT_MONTHS = 4;
export const EXTENSION_MONTHS = 3;

export type PartnerStatus = 'active' | 'warned' | 'gated' | 'graduated';

export type FoundingPartner = {
  user_id: string;
  granted_at: string;
  note_deadline: string;
  extended_once: boolean;
  status: PartnerStatus;
  terms_version: string;
  vetting_note: string | null;
};

export async function getFoundingPartner(
  admin: SupabaseClient,
  userId: string,
): Promise<FoundingPartner | null> {
  const { data } = await admin
    .from('founding_partners')
    .select('user_id, granted_at, note_deadline, extended_once, status, terms_version, vetting_note')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as FoundingPartner) ?? null;
}

// Bridges canCreateSpace: active and warned partners may open paid
// Spaces; gated partners may NOT open additional ones; graduated
// partners pass the normal calibrated gate on their own merit.
export function partnerBridgesGate(p: FoundingPartner | null): boolean {
  return !!p && (p.status === 'active' || p.status === 'warned');
}

export async function partnerCount(admin: SupabaseClient): Promise<number> {
  const { count } = await admin
    .from('founding_partners')
    .select('user_id', { count: 'exact', head: true });
  return count ?? 0;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// The full grant: partner row + bundled Creator Pro from the shared
// free-50 pool, refusing LOUDLY if either cap is exhausted. Idempotent
// on the partner row (already-partner returns ok) and on the Creator
// Pro grant (existing grant of any source is left untouched).
export async function grantFoundingPartner(
  admin: SupabaseClient,
  userId: string,
  opts: { vettingNote?: string; termsVersion?: string },
): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const existing = await getFoundingPartner(admin, userId);
  if (existing) return { ok: true, already: true };

  const [taken, proSlots] = await Promise.all([partnerCount(admin), freeSlotsRemaining(admin)]);
  if (taken >= FOUNDING_PARTNER_CAP) {
    return { ok: false, error: `Founding Partner cap reached (${FOUNDING_PARTNER_CAP}) — the number is a public promise.` };
  }
  if (proSlots <= 0) {
    return { ok: false, error: 'No Creator Pro free-50 slots left to bundle — resolve before granting.' };
  }

  const now = new Date();
  const { error: fpErr } = await admin.from('founding_partners').insert({
    user_id: userId,
    granted_at: now.toISOString(),
    note_deadline: addMonths(now, NOTE_DEADLINE_MONTHS).toISOString(),
    terms_version: opts.termsVersion ?? CURRENT_TERMS_VERSION,
    vetting_note: opts.vettingNote ?? null,
  });
  if (fpErr) return { ok: false, error: `partner insert: ${fpErr.message}` };

  // Bundle Creator Pro from the shared pool. ignoreDuplicates keeps an
  // existing grant (free50 or paid) untouched.
  const { error: cpErr } = await admin
    .from('creator_pro_grants')
    .upsert(
      { user_id: userId, source: 'free50', lifetime_free: true },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
  if (cpErr) return { ok: false, error: `creator-pro bundle: ${cpErr.message}` };

  await admin.from('notification_queue').insert({
    user_id: userId,
    channel: 'email',
    title: 'Welcome, eYKON Founding Partner',
    body:
      'Your Founding Partner status is live: open your paid Space today, Creator Pro is yours free for life, and your Reputation Note is due within 6 months — the First Ten templates make that achievable in weeks. Terms: ' +
      (opts.termsVersion ?? CURRENT_TERMS_VERSION),
    payload: { template: 'founding_partner_granted', terms_version: opts.termsVersion ?? CURRENT_TERMS_VERSION },
  });

  return { ok: true, already: false };
}

// Shown-Note graduation check per the locked deadline definition:
// ≥10 resolved (the shown row exists) AND brier_skill ≥ 0. The
// rank_percentile term is deliberately absent.
export async function hasShownNote(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from('user_reputation')
    .select('brier_skill')
    .eq('author_id', userId)
    .eq('feature', '_all')
    .eq('shown', true)
    .maybeSingle();
  if (!data) return false;
  const skill = Number((data as { brier_skill: number | null }).brier_skill ?? -1);
  return skill >= 0;
}

// Creators whose spaces must be hidden from Discover / refused new
// subscribers: gated partners only.
export async function gatedPartnerIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin
    .from('founding_partners')
    .select('user_id')
    .eq('status', 'gated');
  return new Set(((data as { user_id: string }[] | null) ?? []).map(r => r.user_id));
}
