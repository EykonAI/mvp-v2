'use client';
import { useEffect, useState } from 'react';
import type { S1Payload, S1Site } from '@/lib/imagery/s1-view';

/**
 * Sentinel-1 radar at the six strait windows (Imagery IMG-6, mig 189).
 * Shared by the Shadow Fleet and Chokepoint workspaces.
 *
 * Until a recorded study admits the method this renders the state and
 * nothing else — no figure, no placeholder zero. After admission: per
 * strait, the latest passes with their dates; a VOID pass reads "no look".
 */

function day(iso: string) {
  return iso.slice(0, 10);
}

function PassCell({ p }: { p: S1Site['passes'][number] }) {
  if (p.coverage_state !== 'clear' || p.vessel_equivalents === null) {
    return <li className="s1-pass s1-pass-void">{day(p.acquired_at)} · no look ({p.coverage_state.replace(/_/g, ' ')})</li>;
  }
  const raised = p.ratio_to_baseline !== null && p.ratio_to_baseline >= 1.5;
  return (
    <li className={raised ? 's1-pass s1-pass-raised' : 's1-pass'}>
      {day(p.acquired_at)} · ≈{p.vessel_equivalents} vessel-eq
      {p.ratio_to_baseline !== null ? ` · ${p.ratio_to_baseline}× median` : ' · no baseline yet'}
    </li>
  );
}

export default function S1StraitStrip({ only }: { only?: string[] }) {
  const [data, setData] = useState<S1Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/imagery/s1')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (!cancelled) setData(j as S1Payload); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return <div className="s1-strip s1-strip-muted">Sentinel-1 radar: unavailable (read failed).</div>;
  if (!data) return <div className="s1-strip s1-strip-muted">Sentinel-1 radar: loading…</div>;

  if (data.state !== 'admitted') {
    return (
      <div className="s1-strip s1-strip-muted" title={data.note}>
        Sentinel-1 radar at the straits: <strong>not shown</strong> —{' '}
        {data.state === 'no admission recorded'
          ? 'the measurement study has not been recorded yet.'
          : `the latest study (${day(data.admission?.recorded_at ?? '')}) did not admit the method.`}
      </div>
    );
  }

  const sites = data.sites.filter(s => s.kind === 'chokepoint' && (!only || only.includes(s.slug)));
  return (
    <div className="s1-strip" title={data.note}>
      <div className="s1-strip-head">
        Sentinel-1 radar · straits · admitted {day(data.admission?.recorded_at ?? '')} ({data.admission?.admitted_n} of{' '}
        {data.admission?.evaluated_n} study anchorages)
      </div>
      {sites.length === 0 ? (
        <div className="s1-strip-muted">No pass recorded at the strait windows in the last 30 days.</div>
      ) : (
        <div className="s1-sites">
          {sites.map(s => (
            <div key={s.aoi_id} className="s1-site">
              <div className="s1-site-name">{s.name ?? s.slug}</div>
              <ul className="s1-passes">
                {s.passes.slice(0, 3).map(p => <PassCell key={p.acquired_at} p={p} />)}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="s1-strip-credit">{data.credit} · vessel-eq is an area estimate, not a count</div>
    </div>
  );
}
