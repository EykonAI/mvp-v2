'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ASSETS, ASSET_LABELS, ASSET_STATES, parseAsset,
  type Asset, type TickResponse,
} from '@/lib/reality-check/board';
import RefineryBoard from './RefineryBoard';
import GateChecklist, { type GatesResponse } from './GateChecklist';

/**
 * Reality Check — the 10th INTEL workspace (build prompt §3.3, decision 6).
 *
 * One workspace, one name, three asset classes behind an in-page switcher,
 * with the switcher's state in the URL so a view is shareable (?asset=,
 * ?tick=, ?cluster=). The same three entries are mirrored as a sub-menu
 * under this workspace in the vertical INTEL rail (WorkspaceNav.tsx) — new
 * UI there rather than a reworked shell, because the shell has no sub-menu
 * mechanism.
 *
 * An asset that has not cleared admission renders its gate checklist and the
 * evidence, never data. Refineries is the only class with a detector; Power
 * is refuted at site level and blocked at cluster level on two open
 * controls; Maritime has one physical instrument and a dead derivation.
 *
 * Everything the refinery board shows comes from ONE accessor
 * (reality_check_tick, migration 171) through /api/intel/reality-check.
 * There is no classifier in this tree: no threshold is applied to a
 * measurement anywhere in the client (§5.3).
 */
export default function RealityCheckWorkspace() {
  return (
    <Suspense fallback={<div className="rc-empty rc-p">Loading the Reality Check workspace…</div>}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const router = useRouter();
  const pathname = usePathname() ?? '/intel/reality-check';
  const params = useSearchParams();

  const asset = parseAsset(params.get('asset'));
  const tick = params.get('tick');
  const cluster = params.get('cluster');

  const [data, setData] = useState<TickResponse | { published: false; error: string } | null>(null);
  const [gates, setGates] = useState<GatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** URL is the state. Replace, never push: the board is not a history trail. */
  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null) q.delete(k);
        else q.set(k, v);
      }
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const url =
      asset === 'refineries'
        ? `/api/intel/reality-check?${new URLSearchParams({
            ...(tick ? { tick } : {}),
            ...(cluster ? { cluster } : {}),
          }).toString()}`
        : '/api/intel/reality-check/gates';
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (r.status === 403) {
          setError(
            body?.detail ??
              'The Reality Check board is a Pro surface. The founding rate at /start includes it for life.',
          );
          return;
        }
        if (asset === 'refineries') setData(body as TickResponse);
        else setGates(body as GatesResponse);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [asset, tick, cluster]);

  const state = useMemo(() => ASSET_STATES[asset], [asset]);

  return (
    <div className="rc-wrap">
      <div className="rc-section">
        <div className="rc-h">Asset class</div>
        <div className="rc-assets" role="group" aria-label="Reality Check asset class">
          {ASSETS.map((a) => (
            <button
              key={a}
              type="button"
              className="rc-asset"
              aria-pressed={a === asset}
              onClick={() => setParams({ asset: a, cluster: null })}
            >
              <span>{ASSET_LABELS[a]}</span>
              <span className="rc-asset-state">{ASSET_STATES[a].state}</span>
            </button>
          ))}
        </div>
        <p className="rc-p rc-p-top">
          Every watched site is scored against <strong>its own</strong> baseline on two physically
          distinct measurements — thermal heat and night-time light — compared on medians, on
          confident-clear nights that carry a retrieval. Sites within about 5 km are one complex and
          counted once. The output is a shortlist, and the refusals are the point.
        </p>
      </div>

      {error && (
        <div className="rc-empty">
          <div className="rc-empty-t">This board is not available on your plan</div>
          <p className="rc-p">{error}</p>
        </div>
      )}

      {!error && loading && (
        <div className="rc-empty">
          <p className="rc-p">Reading the {ASSET_LABELS[asset].toLowerCase()} tick…</p>
        </div>
      )}

      {!error && !loading && asset === 'refineries' && data && (
        <RefineryBoard
          data={data}
          selected={cluster}
          onSelect={(key) => setParams({ cluster: key })}
          onTick={(t) => setParams({ tick: t, cluster: null })}
        />
      )}

      {!error && !loading && asset !== 'refineries' && gates && (
        <GateChecklist asset={asset} gates={gates} state={state.state} />
      )}
    </div>
  );
}

export type { Asset };
