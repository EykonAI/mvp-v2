import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { PredictionsAdminClient, type AdminPredictionRow } from './PredictionsAdminClient';

// /admin/predictions — founder-only queue for the social-card drumbeat.
//
// Lists the 50 most-recently-resolved predictions. Per-row actions copy
// the card image URL and an X-thread template to the clipboard so the
// founder can paste straight into a draft.
//
// Gate: lib/admin/access.ts — FOUNDER_EMAILS env. Without that env set,
// every request redirects to /app.

export const metadata = { title: 'Admin · Predictions — eYKON.ai' };
export const dynamic = 'force-dynamic';

interface JoinedRow {
  observed_value: number | string | null;
  observed_at: string;
  brier: number | string | null;
  resolution_source_url: string | null;
  predictions_register:
    | RegisterRow
    | RegisterRow[];
}

interface RegisterRow {
  id: string;
  public_id: string;
  statement: string;
  source: string;
  hash: string;
  issued_at: string;
  resolves_at: string;
  target_observable: string;
  predicted_distribution: { mean?: number | string } | null;
}

export default async function PredictionsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/predictions');
  if (!isFounder(user)) redirect('/app');

  const supabase = createServerSupabase();
  const { data: rows } = await supabase
    .from('prediction_outcomes')
    .select(
      'observed_value, observed_at, brier, resolution_source_url, predictions_register!inner(id, public_id, statement, source, hash, issued_at, resolves_at, target_observable, predicted_distribution)',
    )
    .order('observed_at', { ascending: false })
    .limit(50);

  const adminRows: AdminPredictionRow[] = ((rows ?? []) as unknown as JoinedRow[])
    .map(toAdminRow)
    .filter((r): r is AdminPredictionRow => r !== null);

  return <PredictionsAdminClient rows={adminRows} />;
}

function toAdminRow(r: JoinedRow): AdminPredictionRow | null {
  const pr = Array.isArray(r.predictions_register)
    ? r.predictions_register[0]
    : r.predictions_register;
  if (!pr) return null;
  const observed = Number(r.observed_value);
  const brier = Number(r.brier);
  const predicted = Number(pr.predicted_distribution?.mean);
  if (!Number.isFinite(observed) || !Number.isFinite(brier)) return null;
  return {
    id: pr.id,
    public_id: pr.public_id,
    statement: pr.statement,
    source: pr.source,
    hash: pr.hash,
    target_observable: pr.target_observable,
    predicted_mean: Number.isFinite(predicted) ? predicted : 0,
    observed_value: observed,
    observed_at: r.observed_at,
    brier,
    resolution_source_url: r.resolution_source_url ?? null,
    issued_at: pr.issued_at,
    resolves_at: pr.resolves_at,
  };
}
