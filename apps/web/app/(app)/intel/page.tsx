import DashboardHome from '@/components/intel/dashboard/DashboardHome';
import CitizenDashboard from '@/components/intel/citizen/CitizenDashboard';
import { getCurrentTier, tierMeetsRequirement } from '@/lib/subscription';

export const metadata = {
  title: 'eYKON.ai · Intelligence Dashboard',
};

export default async function IntelDashboardPage() {
  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, 'pro')) {
    return <CitizenDashboard />;
  }
  return <DashboardHome />;
}
