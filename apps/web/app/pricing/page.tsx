import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getCryptoVariant, getPassProduct } from '@/lib/pricing';
import { CheckoutLauncher } from './CheckoutLauncher';

export const dynamic = 'force-dynamic';

/**
 * /pricing acts as a router between the landing pricing section and the
 * NOWPayments hosted checkout. Three cases:
 *
 *   - no (or unknown) ?plan= → bounce to the landing's #pricing anchor, which
 *     is the canonical pricing display.
 *   - valid ?plan= + signed-out → send to signup with the plan preserved; the
 *     email-confirm callback + /app detection loop the user back here.
 *   - valid ?plan= + signed-in → render CheckoutLauncher, which POSTs to
 *     /api/checkout/nowpayments and redirects to the hosted invoice URL.
 *
 * The NOWPayments cancel URL points at /pricing?payment=cancelled; with no
 * plan param that also falls through to the landing pricing section.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: { plan?: string | string[] };
}) {
  const raw = searchParams?.plan;
  const plan = Array.isArray(raw) ? raw[0] : raw;

  if (!plan) redirect('/#pricing');

  // Subscriptions AND one-off passes/packs (mig 075) both route through
  // here — the checkout API branches on the id.
  const variant = getCryptoVariant(plan);
  const pass = variant ? null : getPassProduct(plan);
  if (!variant && !pass) redirect('/#pricing');

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth/signup?plan=${encodeURIComponent(plan)}`);
  }

  const id = variant?.id ?? pass!.id;
  const label = variant?.label ?? pass!.label;
  return <CheckoutLauncher variantId={id} variantLabel={label} />;
}
