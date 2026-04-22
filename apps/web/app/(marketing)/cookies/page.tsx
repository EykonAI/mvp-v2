import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/LegalPageShell';
import { TermlyEmbed } from '@/components/legal/TermlyEmbed';

export const metadata: Metadata = {
  title: 'Cookie Policy — eYKON.ai',
  description:
    'The cookies and similar storage technologies eYKON.ai uses, their purpose, and how you can opt out.',
};

export default function CookiesPage() {
  return (
    <LegalPageShell
      title="Cookie Policy"
      subtitle="Analytics, referral attribution, and session cookies — what each one does and how to opt out. Marketing scripts (PostHog, Rewardful) never load before you accept."
      currentPath="/cookies"
    >
      <TermlyEmbed
        policyId={process.env.NEXT_PUBLIC_TERMLY_COOKIES_UUID}
        policyName="Cookie Policy"
      />
    </LegalPageShell>
  );
}
