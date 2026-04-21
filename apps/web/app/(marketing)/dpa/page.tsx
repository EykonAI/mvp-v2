import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/LegalPageShell';
import { TermlyEmbed } from '@/components/legal/TermlyEmbed';

export const metadata: Metadata = {
  title: 'Data Processing Addendum — eYKON.ai',
  description:
    'GDPR-compliant Data Processing Addendum for eYKON.ai Desk and Enterprise tiers.',
};

export default function DPAPage() {
  return (
    <LegalPageShell
      title="Data Processing Addendum"
      subtitle="For Desk and Enterprise customers subject to GDPR, CCPA, or equivalent data-protection regimes. Signed-copy requests via support@eykon.ai."
      currentPath="/dpa"
    >
      <TermlyEmbed
        policyId={process.env.NEXT_PUBLIC_TERMLY_DPA_UUID}
        policyName="Data Processing Addendum"
      />
    </LegalPageShell>
  );
}
