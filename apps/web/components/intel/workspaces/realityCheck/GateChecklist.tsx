'use client';
import { ASSET_LABELS, type Asset } from '@/lib/reality-check/board';

/**
 * The admission checklist for an asset class that has NOT cleared admission
 * (build prompt §3.3, §4.1, §4.2).
 *
 * Nothing on these tabs is data, a verdict, a lead or a score. Every row is
 * either read from production on this request (`live`) or a judgement with
 * the date it was made (`dated`) — which is the rule the prototype broke by
 * hard-coding "0 of 84 tiles" and "completeness 59.6x", both stale within a
 * week (§3.6). A checklist that cannot go stale is a checklist that is not
 * being measured.
 */

export interface GatesRow {
  check: string;
  status: 'ok' | 'warn' | 'fail' | 'pending';
  statusLabel: string;
  kind: 'live' | 'dated';
  detail: string;
  source: string;
}
export interface GatesResponse {
  as_of: string;
  note: string;
  power: GatesRow[];
  maritime: GatesRow[];
  error?: string;
}

const INTRO: Record<Exclude<Asset, 'refineries'>, { headline: string; body: string[] }> = {
  power: {
    headline: 'Not published. The cluster-level rule does not ship until it passes its controls.',
    body: [
      'Site-level power is refuted and closed. 1,001 sites returned zero dual-confirmed candidates, while solar and wind farms — which cannot have a combustion outage — tripped the light-down rule at 13.66% against 1.10% for combustion, and never-built sites tripped heat-down at 3.7% against 2.5% for operating plants. Both controls exceeded the signal.',
      'Power asks a different question: did a grid area go dark, not did one plant stop. A coal stack is undetected by thermal on most nights, so single-plant heat carries almost no information. The unit of the redesign is a cluster of operating combustion sites within 50 km — and two blockers are still open below.',
      'What a dark cluster is not: megawatts offline, a generation proxy, grid stress, fuel burn or smelter load.',
    ],
  },
  maritime: {
    headline: 'Blocked. The port-call record measures its own cron, not port traffic.',
    body: [
      'No per-port baseline is meaningful until the derivation is repaired. Before it stopped, the series was the cron’s cadence rather than port activity: days alternating between a few hundred and many thousands of calls, with whole days missing.',
      'Maritime also has only one physical instrument. A second observable derived from the same AIS feed is not independent corroboration, so this class may publish refutations and coverage statements — "a disruption was reported at port X and traffic is unchanged" — and may never publish a dual-confirmed lead in the refinery sense.',
    ],
  },
};

export default function GateChecklist({
  asset,
  gates,
  state,
}: {
  asset: Asset;
  gates: GatesResponse;
  state: string;
}) {
  if (asset === 'refineries') return null;
  const key = asset as Exclude<Asset, 'refineries'>;
  const rows = key === 'power' ? gates.power : gates.maritime;
  const intro = INTRO[key];

  return (
    <>
      <div className="rc-section">
        <span className="rc-chip">{state}</span>
        <p className="rc-p rc-p-top">
          <strong>{intro.headline}</strong> Nothing on this tab is a claim.
        </p>
        {intro.body.map((b) => (
          <p key={b.slice(0, 28)} className="rc-p">
            {b}
          </p>
        ))}
      </div>

      <div className="rc-section">
        <div className="rc-h">Admission checklist · {ASSET_LABELS[asset]}</div>
        <div className="rc-scroll">
          <table className="rc-gate">
            <caption className="sr-only">
              Admission checklist for {ASSET_LABELS[asset]}: each check, its status, and the
              evidence, with the source of each row.
            </caption>
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Status</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.check}>
                  <th scope="row">{r.check}</th>
                  <td>
                    <span className={`rc-st rc-st-${r.status}`}>{r.statusLabel}</span>
                  </td>
                  <td>
                    {r.detail}
                    <span className="rc-src">
                      {r.kind === 'live' ? 'Live' : 'Dated'} · {r.source}
                    </span>
                  </td>
                </tr>
              ))}
              {(!rows || rows.length === 0) && (
                <tr>
                  <td colSpan={3} className="rc-none">
                    The checklist could not be read. An unreadable check is not a passing check.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="rc-p rc-p-top">
          {gates.note} Read {new Date(gates.as_of).toISOString().replace('T', ' ').slice(0, 16)} UTC.
        </p>
      </div>
    </>
  );
}
