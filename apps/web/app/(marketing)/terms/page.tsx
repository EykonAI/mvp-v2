import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/LegalPageShell';
import { TermlyEmbed } from '@/components/legal/TermlyEmbed';

export const metadata: Metadata = {
  title: 'Terms of Service — eYKON.ai',
  description:
    'Terms governing the use of the eYKON.ai geopolitical intelligence platform.',
};

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms of Service"
      subtitle="The agreement between you and eYKON.ai when you use the platform, subscribe to a paid tier, or access any of our data feeds."
      currentPath="/terms"
    >
      <TermlyEmbed
        policyId={process.env.NEXT_PUBLIC_TERMLY_TERMS_UUID}
        policyName="Terms of Service"
      />
    </LegalPageShell>
  );
}
