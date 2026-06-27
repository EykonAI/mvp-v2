import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  encodeFunctionData,
  decodeEventLog,
  getAddress,
  type Address,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Unlock Protocol on Base (COMM E2). Non-custodial paid-space memberships:
// each space = a PublicLock priced in USDC. The creator becomes the sole
// lock manager (controls withdrawal — so funds are theirs, non-custodial);
// the platform takes a referrer fee on each purchase. The hot deployer
// wallet (Railway) pays gas + orchestrates setup, then RENOUNCES its
// manager role so it never controls funds.
//
// VERIFY-AT-RUNTIME (founder, on Base): the factory/USDC addresses, the
// PublicLock function set, and that a deployed lock ends up with creator =
// sole manager + the 15% referrer fee. Gated behind COMM_SPACES_CHECKOUT.

const UNLOCK_FACTORY: Address = '0xd0b14797b9D08493392865647384974470202A78'; // Unlock on Base
const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // native USDC on Base (6 dp)
const SECONDS = { monthly: 30 * 24 * 3600, annual: 365 * 24 * 3600 } as const;
const MAX_KEYS = BigInt(1_000_000); // effectively unlimited subscribers per space

function feeBps(): bigint {
  return BigInt(process.env.UNLOCK_PLATFORM_FEE_BPS ?? '1500');
}
function platformWallet(): Address {
  return getAddress(process.env.UNLOCK_PLATFORM_WALLET as string);
}
function rpc(): string {
  const url = process.env.BASE_RPC_URL;
  if (!url) throw new Error('BASE_RPC_URL not set');
  return url;
}
function pub() {
  return createPublicClient({ chain: base, transport: http(rpc()) });
}
function deployer() {
  const raw = (process.env.UNLOCK_DEPLOYER_PRIVATE_KEY ?? '').trim();
  if (!raw) throw new Error('UNLOCK_DEPLOYER_PRIVATE_KEY not set');
  const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
  return createWalletClient({ account: privateKeyToAccount(pk), chain: base, transport: http(rpc()) });
}

const FACTORY_ABI = [
  { type: 'function', name: 'publicLockLatestVersion', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  {
    type: 'function',
    name: 'createUpgradeableLockAtVersion',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'data', type: 'bytes' },
      { name: 'lockVersion', type: 'uint16' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'event',
    name: 'NewLock',
    inputs: [
      { name: 'lockOwner', type: 'address', indexed: true },
      { name: 'newLockAddress', type: 'address', indexed: true },
    ],
  },
] as const;

const LOCK_INIT_ABI = [
  {
    type: 'function',
    name: 'initialize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_lockCreator', type: 'address' },
      { name: '_expirationDuration', type: 'uint256' },
      { name: '_tokenAddress', type: 'address' },
      { name: '_keyPrice', type: 'uint256' },
      { name: '_maxNumberOfKeys', type: 'uint256' },
      { name: '_lockName', type: 'string' },
    ],
    outputs: [],
  },
] as const;

const LOCK_ABI = [
  { type: 'function', name: 'setReferrerFee', stateMutability: 'nonpayable', inputs: [{ name: '_referrer', type: 'address' }, { name: '_feeBasisPoint', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'addLockManager', stateMutability: 'nonpayable', inputs: [{ name: 'account', type: 'address' }], outputs: [] },
  { type: 'function', name: 'renounceLockManager', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'getHasValidKey', stateMutability: 'view', inputs: [{ name: '_user', type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

// True only when every server-side Unlock env is present.
export function unlockConfigured(): boolean {
  return !!(process.env.BASE_RPC_URL && process.env.UNLOCK_DEPLOYER_PRIVATE_KEY && process.env.UNLOCK_PLATFORM_WALLET);
}

// Deploy a per-space lock and hand the creator sole control. Returns the
// lock address. Four txns (cheap on Base): deploy → referrer fee →
// add creator as manager → deployer renounces (non-custodial).
export async function deploySpaceLock(opts: {
  creator: Address;
  priceUsdc: number;
  cadence: 'monthly' | 'annual';
  name: string;
}): Promise<Address> {
  const wallet = deployer();
  const client = pub();
  const version = await client.readContract({ address: UNLOCK_FACTORY, abi: FACTORY_ABI, functionName: 'publicLockLatestVersion' });

  const initData = encodeFunctionData({
    abi: LOCK_INIT_ABI,
    functionName: 'initialize',
    args: [
      wallet.account.address, // deployer is the initial manager (so it can set the fee)
      BigInt(SECONDS[opts.cadence]),
      USDC_BASE,
      parseUnits(String(opts.priceUsdc), 6),
      MAX_KEYS,
      opts.name.slice(0, 64),
    ],
  });

  const deployHash = await wallet.writeContract({ address: UNLOCK_FACTORY, abi: FACTORY_ABI, functionName: 'createUpgradeableLockAtVersion', args: [initData, version] });
  const receipt = await client.waitForTransactionReceipt({ hash: deployHash });

  let lock: Address | null = null;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === 'NewLock') {
        lock = (ev.args as unknown as { newLockAddress: Address }).newLockAddress;
        break;
      }
    } catch {
      /* not the NewLock event */
    }
  }
  if (!lock) throw new Error('lock address not found in deploy receipt');

  // platform 15% referrer fee (deployer is still a manager here)
  await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: lock, abi: LOCK_ABI, functionName: 'setReferrerFee', args: [platformWallet(), feeBps()] }),
  });
  // creator becomes a manager (controls + withdraws their revenue)
  await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: lock, abi: LOCK_ABI, functionName: 'addLockManager', args: [opts.creator] }),
  });
  // deployer renounces — from here it can never touch the lock or funds
  await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: lock, abi: LOCK_ABI, functionName: 'renounceLockManager', args: [] }),
  });

  return lock;
}

// On-chain access check (detection mode 5b): does `user` hold a valid key?
export async function hasValidKey(lock: Address, user: Address): Promise<boolean> {
  try {
    return await pub().readContract({ address: lock, abi: LOCK_ABI, functionName: 'getHasValidKey', args: [user] });
  } catch {
    return false;
  }
}
