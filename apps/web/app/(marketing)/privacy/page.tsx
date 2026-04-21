import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/LegalPageShell';
import { TermlyEmbed } from '@/components/legal/TermlyEmbed';

export const metadata: Metadata = {
  title: 'Privacy Policy — eYKON.ai',
  description:
    'How eYKON.ai collects, stores, and processes personal data for visitors, free-tier users, and paying subscribers.',
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      subtitle="What we collect, why we collect it, how long we keep it, and the controls you have over your data under the GDPR and equivalent regimes."
      currentPath="/privacy"
    >
      <TermlyEmbed
        policyId={process.env.NEXT_PUBLIC_TERMLY_PRIVACY_UUID}
        policyName="Privacy Policy"
      />
    </LegalPageShell>
  );
}
