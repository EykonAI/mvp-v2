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
  // idempotency reads — let configureSpaceLock resume a partial deploy without repeating done steps
  { type: 'function', name: 'referrerFees', stateMutability: 'view', inputs: [{ name: '_referrer', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'isLockManager', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

// True only when every server-side Unlock env is present.
export function unlockConfigured(): boolean {
  return !!(process.env.BASE_RPC_URL && process.env.UNLOCK_DEPLOYER_PRIVATE_KEY && process.env.UNLOCK_PLATFORM_WALLET);
}

// The deployer is a SINGLE hot wallet with one nonce sequence. Concurrent
// deploys (a double-clicked "Enable subscriptions", a client retry, a re-fire)
// race that nonce and the node rejects the loser as "replacement transaction
// underpriced". Chain every on-chain op through one promise so they run
// strictly one-at-a-time in this process. (Cross-instance hardening = a
// lock_status DB guard in the enable route — see PR notes.)
let deployQueue: Promise<unknown> = Promise.resolve();
function serializeDeploy<T>(fn: () => Promise<T>): Promise<T> {
  const run = deployQueue.then(fn, fn);
  deployQueue = run.then(() => undefined, () => undefined);
  return run;
}

// Step 1 — deploy the per-space lock (ONE tx) and return its address. Kept
// separate from configuration so the caller can persist the address
// immediately; a later config failure then RESUMES via configureSpaceLock
// instead of orphaning a lock and redeploying on the next attempt.
export async function createSpaceLock(opts: {
  priceUsdc: number;
  cadence: 'monthly' | 'annual';
  name: string;
}): Promise<Address> {
  return serializeDeploy(async () => {
    const wallet = deployer();
    const client = pub();
    const version = await client.readContract({ address: UNLOCK_FACTORY, abi: FACTORY_ABI, functionName: 'publicLockLatestVersion' });

    const initData = encodeFunctionData({
      abi: LOCK_INIT_ABI,
      functionName: 'initialize',
      args: [
        wallet.account.address, // deployer is the initial manager (so it can configure, then renounces)
        BigInt(SECONDS[opts.cadence]),
        USDC_BASE,
        parseUnits(String(opts.priceUsdc), 6),
        MAX_KEYS,
        opts.name.slice(0, 64),
      ],
    });

    const deployHash = await wallet.writeContract({ address: UNLOCK_FACTORY, abi: FACTORY_ABI, functionName: 'createUpgradeableLockAtVersion', args: [initData, version] });
    const receipt = await client.waitForTransactionReceipt({ hash: deployHash });

    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics });
        if (ev.eventName === 'NewLock') {
          return (ev.args as unknown as { newLockAddress: Address }).newLockAddress;
        }
      } catch {
        /* not the NewLock event */
      }
    }
    throw new Error('lock address not found in deploy receipt');
  });
}

// Step 2 — IDEMPOTENT config: platform referrer fee → creator becomes a
// manager → deployer renounces (non-custodial). Each step reads on-chain
// state first and SKIPS what is already done, so calling this again after a
// partial failure safely completes the lock. Must run while the deployer is
// still a manager (it is, until the final renounce).
export async function configureSpaceLock(lock: Address, creator: Address): Promise<void> {
  return serializeDeploy(async () => {
    const wallet = deployer();
    const client = pub();
    const deployerAddr = wallet.account.address;
    const platform = platformWallet();

    // 1) platform referrer fee — only if not already set to the target bps
    const fee = await client
      .readContract({ address: lock, abi: LOCK_ABI, functionName: 'referrerFees', args: [platform] })
      .catch(() => BigInt(0));
    if (fee !== feeBps()) {
      const canManage = await client.readContract({ address: lock, abi: LOCK_ABI, functionName: 'isLockManager', args: [deployerAddr] });
      if (!canManage) throw new Error('referrer fee unset but deployer already renounced — manual fix required');
      await client.waitForTransactionReceipt({
        hash: await wallet.writeContract({ address: lock, abi: LOCK_ABI, functionName: 'setReferrerFee', args: [platform, feeBps()] }),
      });
    }

    // 2) creator becomes a manager (controls + withdraws their revenue) — once
    const creatorManages = await client.readContract({ address: lock, abi: LOCK_ABI, functionName: 'isLockManager', args: [creator] });
    if (!creatorManages) {
      await client.waitForTransactionReceipt({
        hash: await wallet.writeContract({ address: lock, abi: LOCK_ABI, functionName: 'addLockManager', args: [creator] }),
      });
    }

    // 3) deployer renounces LAST — only if still a manager (idempotent)
    const deployerManages = await client.readContract({ address: lock, abi: LOCK_ABI, functionName: 'isLockManager', args: [deployerAddr] });
    if (deployerManages) {
      await client.waitForTransactionReceipt({
        hash: await wallet.writeContract({ address: lock, abi: LOCK_ABI, functionName: 'renounceLockManager', args: [] }),
      });
    }
  });
}

// On-chain access check (detection mode 5b): does `user` hold a valid key?
export async function hasValidKey(lock: Address, user: Address): Promise<boolean> {
  try {
    return await pub().readContract({ address: lock, abi: LOCK_ABI, functionName: 'getHasValidKey', args: [user] });
  } catch {
    return false;
  }
}
