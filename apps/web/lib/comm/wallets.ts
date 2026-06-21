import { createServerSupabase } from '@/lib/supabase-server';

// Wallet linking (COMM E2 plumbing). One wallet per eYKON user — used to
// map on-chain Unlock key ownership back to a user for space access. The
// sign-in-with-ethereum signature verification lands in E2b; this lib is
// only the DB read/write layer. Fail-soft on a missing table (mig 064 not
// yet applied) so live pages never regress.

type SB = ReturnType<typeof createServerSupabase>;

export interface LinkedWallet {
  address: string;
  chain: string;
  verified_at: string | null;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function getLinkedWallet(supabase: SB, userId: string): Promise<LinkedWallet | null> {
  try {
    const { data } = await supabase
      .from('comm_wallets')
      .select('address, chain, verified_at')
      .eq('user_id', userId)
      .maybeSingle();
    return (data as LinkedWallet | null) ?? null;
  } catch {
    return null;
  }
}

export async function upsertWallet(
  supabase: SB,
  userId: string,
  address: string,
  chain = 'base',
  verified = false,
): Promise<boolean> {
  const addr = address.trim();
  if (!ADDRESS_RE.test(addr)) return false;
  const { error } = await supabase.from('comm_wallets').upsert(
    {
      user_id: userId,
      address: addr,
      chain,
      verified_at: verified ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  return !error;
}
