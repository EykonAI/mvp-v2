import type { Metadata } from 'next';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import {
  loadMonitor, parseFilters, wilson, MIN_QUOTABLE_N, TRACKS, ISSUER_SOURCES,
  type Monitor, type Severity, type Alert, type Bin, type Cohort, type FamilyView, type TrackStats,
} from '@/lib/admin/calibration-monitor';
import { Filters } from './Filters';
import { WatchList } from './WatchList';

// /admin/calibration-monitor — founder-only (build-prompt v1.1).
//
// Is the ledger FUNCTIONING — issuing, resolving, deferring, judging on
// published data — and how SKILLED is it, per track, per family, over a
// period, on a basis. Panel ① is always whole-pipeline; the filters act on
// ② ③ ④ ⑤; ⑥ is unfiltered. Every number carries its window and its n;
// tracks never blend; skill is the relative Brier skill score; voids are
// excluded, never zero. The page renders with any single probe failing —
// the failed card says so and nothing else is affected.
//
// READ-ONLY except the watch list (⑥). No resolution, no void, no register
// write can be made from here.

export const metadata: Metadata = {
  title: 'Calibration monitor — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const CSS = `
.clm{max-width:1380px;margin:0 auto;padding:18px 22px 60px;color:var(--ink);font-size:13px;line-height:1.45}
.clm a{color:var(--teal);text-decoration:none}
.clm .crumb{font-family:var(--f-mono);font-size:11px;color:var(--ink-faint);letter-spacing:.08em}
.clm h1{font-family:var(--f-display);font-weight:600;font-size:22px;letter-spacing:.06em;margin:6px 0 2px}
.clm .sub{color:var(--ink-dim);font-size:12.5px;margin:0 0 14px}
.clm .filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:var(--bg-panel);border:1px solid var(--rule);border-radius:8px;padding:10px 12px;margin-bottom:16px}
.clm .fl{font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;color:var(--ink-faint);margin-right:2px}
.clm .seg{display:inline-flex;border:1px solid var(--rule-strong);border-radius:6px;overflow:hidden}
.clm .seg a{background:transparent;color:var(--ink-dim);font-family:var(--f-mono);font-size:11px;padding:6px 11px;border-right:1px solid var(--rule)}
.clm .seg a:last-child{border-right:0}.clm .seg a.on{background:var(--teal-glow);color:var(--teal)}
.clm select,.clm input[type=date],.clm input[type=text]{background:var(--bg-raised);color:var(--ink);border:1px solid var(--rule-strong);border-radius:6px;font-family:var(--f-mono);font-size:11px;padding:6px 8px}
.clm button{background:var(--bg-raised);color:var(--teal);border:1px solid var(--rule-strong);border-radius:6px;font-family:var(--f-mono);font-size:11px;padding:6px 10px;cursor:pointer}
.clm button:disabled{opacity:.5;cursor:default}
.clm button.lnk{background:none;border:0;padding:0 4px;font-size:10.5px;color:var(--ink-faint)}.clm button.lnk:hover{color:var(--teal)}
.clm .custom{display:inline-flex;gap:6px;align-items:center}
.clm .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.clm .asof{margin-left:auto;font-family:var(--f-mono);font-size:10px;color:var(--ink-faint)}
.clm h2{font-family:var(--f-mono);font-size:11px;letter-spacing:.16em;color:var(--ink-dim);font-weight:500;margin:22px 0 10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.clm h2 .n{color:var(--teal)}
.clm .grid{display:grid;gap:10px}.clm .g4{grid-template-columns:repeat(4,minmax(0,1fr))}.clm .g3{grid-template-columns:repeat(3,minmax(0,1fr))}.clm .g2{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:1100px){.clm .g4{grid-template-columns:repeat(2,1fr)}.clm .g3{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.clm .g4,.clm .g3,.clm .g2{grid-template-columns:1fr}}
.clm .card{background:var(--bg-panel);border:1px solid var(--rule);border-radius:8px;padding:12px 14px;min-width:0}
.clm .card.err{border-color:var(--red)}
.clm .card .k{font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;color:var(--ink-faint);display:flex;justify-content:space-between;align-items:center;gap:8px}
.clm .card .v{font-family:var(--f-display);font-size:24px;font-weight:600;margin:6px 0 2px;letter-spacing:.02em}
.clm .card .v.sm{font-size:15px;line-height:1.5}
.clm .card .s{font-size:11.5px;color:var(--ink-dim)}.clm .card .why{font-size:11.5px;color:var(--ink-dim);margin-top:6px;border-top:1px solid var(--rule-soft);padding-top:6px}
.clm .badge{font-family:var(--f-mono);font-size:9.5px;letter-spacing:.1em;border:1px solid;border-radius:4px;padding:2px 6px;white-space:nowrap}
.clm .ok{color:var(--green);border-color:var(--green)}.clm .warn{color:var(--amber);border-color:var(--amber)}.clm .crit{color:var(--red);border-color:var(--red)}.clm .info{color:var(--violet);border-color:var(--violet)}.clm .muted{color:var(--ink-ghost);border-color:var(--ink-ghost)}
.clm table{width:100%;border-collapse:collapse;font-size:12px}.clm th{font-family:var(--f-mono);font-size:10px;letter-spacing:.1em;color:var(--ink-faint);text-align:left;font-weight:500;padding:8px 8px;border-bottom:1px solid var(--rule)}
.clm td{padding:7px 8px;border-bottom:1px solid var(--rule-soft);vertical-align:top}.clm tr:hover td{background:var(--bg-hover)}
.clm td.num,.clm th.num{text-align:right;font-family:var(--f-mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.clm .neg{color:var(--coral)}.clm .pos{color:var(--green)}.clm .dim{color:var(--ink-faint)}
.clm .tbl{background:var(--bg-panel);border:1px solid var(--rule);border-radius:8px;overflow:auto}
.clm .note{font-size:11.5px;color:var(--ink-dim);background:var(--bg-panel);border-left:2px solid var(--teal-dim);padding:8px 12px;border-radius:0 6px 6px 0;margin:8px 0}
.clm .bars{display:flex;align-items:flex-end;gap:6px;height:140px;padding:8px 4px 0;overflow-x:auto}
.clm .bar{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:34px}
.clm .bar i{display:block;width:100%;background:var(--teal-dim);border-radius:3px 3px 0 0;opacity:.85}
.clm .bar b{font-family:var(--f-mono);font-size:9px;color:var(--ink-faint);font-weight:400;white-space:nowrap}
.clm .bar.flat i{background:var(--ink-ghost)}
.clm .bar.open i{background:repeating-linear-gradient(135deg,var(--rule-strong) 0 4px,transparent 4px 8px);border:1px dashed var(--rule-strong);opacity:1}
.clm .mark{font-family:var(--f-mono);font-size:9.5px;color:var(--amber)}
.clm .legend{display:flex;gap:14px;flex-wrap:wrap;font-family:var(--f-mono);font-size:10px;color:var(--ink-faint);margin-top:8px}
.clm .rel{display:grid;grid-template-columns:repeat(10,1fr);gap:4px;align-items:end;height:110px;padding-top:14px;margin-bottom:26px}
.clm .rel .b{background:var(--teal-dim);border-radius:2px 2px 0 0;position:relative}
.clm .rel .b span{position:absolute;bottom:-26px;left:0;right:0;text-align:center;font-family:var(--f-mono);font-size:9px;color:var(--ink-faint);line-height:1.2}
.clm .rel .b em{position:absolute;top:-14px;left:0;right:0;text-align:center;font-style:normal;font-family:var(--f-mono);font-size:9px;color:var(--ink)}
.clm .rel .b u{position:absolute;left:50%;width:1px;background:var(--ink);text-decoration:none}
.clm .watch{margin:0;padding-left:16px}.clm .watch li{margin:4px 0;font-size:12px}.clm .watch .t{font-family:var(--f-mono);color:var(--ink-faint);font-size:10.5px;margin-right:8px}
.clm .watch li.done{opacity:.6}
.clm .addwatch{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;border-top:1px solid var(--rule-soft);padding-top:10px}
.clm .addwatch input[type=text]{min-width:320px;flex:1}
.clm footer{margin-top:28px;border-top:1px solid var(--rule);padding-top:12px;font-family:var(--f-mono);font-size:10px;color:var(--ink-faint);line-height:1.7}
`;

// ─── formatting ─────────────────────────────────────────────────────────
const nf = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const f3 = (x: number | null | undefined) => (x == null ? '—' : Number(x).toFixed(3));
const sg = (x: number | null | undefined) => (x == null ? '—' : `${x > 0 ? '+' : ''}${Number(x).toFixed(3)}`);
const hm = (iso: string | null | undefined) => (iso ? `${iso.slice(11, 16)} UTC` : '—');
const dt = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—');
const md = (d: string | null | undefined) => (d ? d.slice(5, 10) : '—');
const LABEL: Record<Severity, string> = { ok: 'OK', warn: 'WARN', crit: 'CRIT', info: 'PENDING', muted: '—' };
const RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2, ok: 3, muted: 4 };
const worst = (xs: Severity[]): Severity => xs.reduce<Severity>((a, b) => (RANK[b] < RANK[a] ? b : a), 'muted');

function Badge({ sev, label, title }: { sev: Severity; label?: string; title?: string }) {
  return (
    <span className={`badge ${sev}`} title={title}>
      {label ?? LABEL[sev]}
    </span>
  );
}
function Card({ k, badge, v, small, s, why, err, children }: { k: string; badge?: React.ReactNode; v?: React.ReactNode; small?: boolean; s?: React.ReactNode; why?: React.ReactNode; err?: string | null; children?: React.ReactNode }) {
  return (
    <div className={`card${err ? ' err' : ''}`}>
      <div className="k">
        <span>{k}</span>
        {err ? <Badge sev="crit" label="PROBE FAILED" title={err} /> : badge}
      </div>
      {err ? (
        <div className="s neg">{err}</div>
      ) : (
        <>
          {v !== undefined && <div className={`v${small ? ' sm' : ''}`}>{v}</div>}
          {s && <div className="s">{s}</div>}
          {children}
          {why && <div className="why">{why}</div>}
        </>
      )}
    </div>
  );
}
function alertBadge(alerts: Alert[], prefix: string): React.ReactNode {
  const hits = alerts.filter((a) => a.id === prefix || a.id.startsWith(`${prefix}:`) || a.id.startsWith(`${prefix}-`));
  if (!hits.length) return <Badge sev="muted" />;
  const sev = worst(hits.map((a) => a.severity));
  const top = hits.find((a) => a.severity === sev)!;
  return <Badge sev={sev} title={`${top.id} · ${top.rule} · evaluated ${dt(top.evaluated_at)}`} />;
}

// ─── ① pipeline health — always whole-pipeline ──────────────────────────
function Health({ m }: { m: Monitor }) {
  const h = m.health.data;
  const A = m.alerts;
  const err = m.health.error;
  const sc = h?.scorer ?? null;
  const cron = m.cron.data ?? {};
  const dn = cron['detect-nightlights'], rv = cron['refresh-vessel-cadence'], rb = cron['refresh-blackmarble-plan'];
  const cronLine = (name: string, j?: { schedule: string; active: boolean; runs: { status: string; start: string; secs: number | null }[] }) =>
    j ? `${name} ${j.schedule}${j.active ? '' : ' · INACTIVE'} · last ${j.runs?.[0]?.status ?? '—'} ${j.runs?.[0]?.secs ?? '—'}s` : `${name}: ${m.cron.error ? 'probe failed' : 'not found'}`;
  const boxes = h?.boxes ?? [];
  const darkBoxes = boxes.filter((b) => b.silent_hours === null || b.silent_hours > 24);
  const integ = Object.entries(h?.integrity ?? {});
  const issuedAll = integ.reduce((s, [, t]) => s + t.issued, 0);
  const missingAll = integ.reduce((s, [, t]) => s + t.missing_hash, 0);
  const hashPct = issuedAll ? ((100 * (issuedAll - missingAll)) / issuedAll).toFixed(missingAll ? 2 : 0) : '—';
  const issued24 = h?.issuance_24h ?? [];
  // Caps are per UTC day; the 24 h count is rolling and spans two UTC days, so
  // "today / cap" comes from the plan RPCs (issued_today) and is shown beside
  // the rolling count, never compared to it.
  const todayFor = (source: string): { today: number; cap: number } | null => {
    const fs = m.families.filter((x) => x.source === source && x.plan && x.plan.issued_today != null);
    if (!fs.length) return null;
    return { today: fs.reduce((s, f) => s + (f.plan!.issued_today ?? 0), 0), cap: fs.reduce((s, f) => s + (f.plan!.cap ?? 0), 0) };
  };
  const roster = h?.blackmarble_roster ?? null;
  const nn = h?.blackmarble_newest_night ?? null;
  const lr = h?.blackmarble_last_run ?? null;
  const alerting = A.filter((a) => a.severity === 'crit' || a.severity === 'warn');

  return (
    <>
      <div className="grid g4">
        <Card
          k="SCORER · score-predictions"
          badge={alertBadge(A, 'scorer-stale')}
          err={err}
          v={sc ? hm(sc.ran_at) : '—'}
          s={sc ? `hourly at :07 · last tick ${sc.ran_at.slice(0, 10)} · candidates ${nf(sc.candidates)} · scored ${nf(sc.scored)} · deferred ${nf(sc.deferred)} · void ${nf(sc.voided)} · limit ${sc.limit ?? '—'} (${sc.selection ?? '—'})` : 'no run record yet — the first tick after migration 138 writes one (hourly at :07)'}
          why="A tick that defers everything writes no outcome row — this card reads score_predictions_runs (mig 138), never side-effect rows."
        />
        <Card
          k="DUE QUEUE"
          badge={worst([...A.filter((a) => a.id === 'due-unresolvable' || a.id === 'due-queue').map((a) => a.severity), ...((h?.queue.due ?? 0) > 0 ? ['info' as Severity] : [])]) === 'muted' ? <Badge sev="ok" label="EMPTY" /> : alertBadge(A, 'due')}
          err={err}
          v={nf(h?.queue.due)}
          s={(h?.queue.by_source ?? []).map((q) => `${q.source} ${nf(q.n)}`).join(' · ') || 'nothing due'}
          why={
            (h?.queue.by_source ?? []).length
              ? <>oldest due: {(h?.queue.by_source ?? []).map((q) => `${q.source} ${q.oldest_due.slice(0, 10)}`).join(' · ')}. Deferred claims wait for the instrument to publish their window (#482); a source due more than 30 d has no resolver path and must be voided as unresolvable.</>
              : 'Every claim past its deadline has an outcome row.'
          }
        />
        <Card
          k="DATA CLOCKS"
          badge={alertBadge(A, 'clock-stalled')}
          err={err}
          small
          v={<>FIRMS {h?.clocks.firms ?? '—'}<br />Black Marble {h?.clocks.blackmarble ?? '—'}<br />AIS newest fix {hm(h?.clocks.ais)}</>}
          why={A.find((a) => a.id === 'clock-stalled')?.text ?? '—'}
        />
        <Card
          k="DETECTION JOBS"
          badge={alertBadge(A, 'detect')}
          err={err}
          small
          v={<>newest judged night {h?.detect_runs?.[0]?.night ?? '—'}<br /><span className="dim">{cronLine('detect-nightlights', dn)}</span><br /><span className="dim">{cronLine('refresh-vessel-cadence', rv)}</span><br /><span className="dim">{cronLine('refresh-blackmarble-plan', rb)}</span></>}
          s={`last: ${(h?.detect_runs ?? []).slice(0, 3).map((d) => `${md(d.night)} ${d.events}ev/${d.duration_ms ?? '—'}ms`).join(' · ') || '—'} · FIRMS events newest ${dt(h?.firms_events_newest)}`}
          why={h?.rejudge_needed?.length ? `Re-judge needed: ${h.rejudge_needed.join(', ')} — ingested after they were judged.` : 'Row-iff-judged table (mig 134). Red if the data clock is ahead of the newest judged night after 10:30 UTC; amber if a night was re-ingested after it was judged.'}
        />
      </div>
      <div className="grid g4" style={{ marginTop: 10 }}>
        <Card
          k="ISSUANCE · 24 h vs cap"
          badge={alertBadge(A, 'issuance')}
          err={err}
          v={nf(issued24.reduce((s, i) => s + i.issued, 0))}
          s={issued24.map((i) => { const t = todayFor(i.source); return `${i.source} ${nf(i.issued)} in 24 h${t ? ` · today ${nf(t.today)} / ${nf(t.cap)} cap` : ''}`; }).join(' · ') || 'nothing issued in 24 h'}
          why={
            (h?.issuance_runs ?? []).length
              ? <>last ticks: {(h?.issuance_runs ?? []).map((r) => `${r.source} ${hm(r.ran_at)} — issued ${r.issued}, present ${r.already_present ?? '—'}, declined ${Object.entries(r.declined ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${r.error ? `, ERROR ${r.error}` : ''}`).join(' · ')}</>
              : 'No issuance run records yet — each issuing tick after migration 138 writes one (issuance_runs).'
          }
        />
        <Card
          k="COVERAGE · AIS boxes"
          badge={alertBadge(A, 'box-dark')}
          err={err}
          v={`${boxes.length - darkBoxes.length} / ${boxes.length}`}
          s={darkBoxes.length ? darkBoxes.map((b) => `${b.slug} dark ${b.silent_hours === null ? '(never heard)' : `${(b.silent_hours / 24).toFixed(0)} d`}`).join(' · ') : 'every box heard from within 24 h'}
          why={`Liveness computed ${dt(h?.boxes_computed_at)}. The dead-box gate (mig 110) voids claims in a dark box; the aggregate feed is never shown alone.`}
        />
        <Card
          k="INGEST WORKERS"
          badge={alertBadge(A, 'worker-empty-ok')}
          err={err}
          small
          v={<>Black Marble {lr ? `${dt(lr.ran_at)} · ${lr.tiles_processed}/${lr.tiles_expected} tiles` : '—'}<br />FIRMS {h ? `${h.firms_ingest.ok_6h} ok / ${h.firms_ingest.failed_6h} failed runs · 6 h` : '—'}</>}
          s={nn ? `newest complete night ${nn.night}: ${nf(nn.facilities_written)} facilities${roster ? ` of ${nf(roster)} roster` : ''}` : 'no complete night on record'}
          why="A 404 mid-reprocessing counts as MISSING (#480); completeness = processed == expected AND facilities_written > 0. Amber when a run reports ok with rows processed and nothing written."
        />
        <Card
          k="INTEGRITY"
          badge={alertBadge(A, 'integrity')}
          err={err}
          v={`${hashPct}%`}
          s={`hash-bound at issue ${nf(issuedAll - missingAll)} / ${nf(issuedAll)} rows · commit-reveal (creator calls only) ${integ.filter(([t]) => t === 'creator').map(([, v]) => `${nf(v.sealed)}/${nf(v.issued)}`).join('') || 'no creator calls yet'}`}
          why={integ.map(([t, v]) => `${t} ${nf(v.issued)} = ${nf(v.scored)} scored + ${nf(v.void)} void + ${nf(v.pending)} pending ${v.reconciles ? '✓' : '✗'}`).join(' · ') || '—'}
        />
      </div>
      <div className="grid g2" style={{ marginTop: 10 }}>
        <Card k="FAMILY PLANS · eligibility today" badge={<Badge sev={m.families.some((f) => f.plan?.eligible) ? 'ok' : 'warn'} label={`${m.families.filter((f) => f.plan?.eligible).length} ISSUING`} />}>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead>
                <tr><th>family</th><th>track</th><th className="num">base</th><th className="num">n</th><th>band</th><th className="num">issued / cap</th><th>state</th></tr>
              </thead>
              <tbody>
                {m.families.map((f) => (
                  <tr key={`${f.track}/${f.feature}`}>
                    <td title={f.plan?.source_rpc ?? 'no plan RPC explains this family'}>{f.feature}</td>
                    <td className="dim">{f.track}</td>
                    <td className="num">{f.plan?.base_rate != null ? f3(f.plan.base_rate) : f.plan?.reason && f.feature === 'ais_dark_contact_reappearance' ? 'per box' : '—'}</td>
                    <td className="num">{nf(f.plan?.n)}</td>
                    <td className="dim">{f.plan?.band ?? '—'}</td>
                    <td className="num">{f.plan?.issued_today != null ? `${nf(f.plan.issued_today)} / ${f.plan.cap != null ? nf(f.plan.cap) : '—'}` : '—'}</td>
                    <td>{f.plan ? <Badge sev={f.plan.eligible === false ? 'warn' : f.plan.eligible ? 'ok' : 'info'} label={f.plan.state.toUpperCase()} title={f.plan.reason ?? undefined} /> : <Badge sev="muted" label="NO PLAN" />}</td>
                  </tr>
                ))}
                {m.families.length === 0 && <tr><td colSpan={7} className="dim">{err ? 'health probe failed' : 'no families in the register'}</td></tr>}
              </tbody>
            </table>
          </div>
          {m.darkgapCells.data && (
            <details style={{ marginTop: 8 }}>
              <summary className="dim">
                Dark-contact cells · forecast = (k + α·box) / (n + α), α = {nf(m.darkgapCells.data.alpha)} · leave-one-out on {nf(m.darkgapCells.data.pooled?.n)} completed events:
                Brier {f3(m.darkgapCells.data.pooled?.brier_box)} → {f3(m.darkgapCells.data.pooled?.brier_cell)} · {m.darkgapCells.data.cells.length} cells with n ≥ {nf(m.darkgapCells.data.min_n)}
              </summary>
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table>
                  <thead>
                    <tr><th>box</th><th className="num">n</th><th className="num">base</th><th className="num">Brier box → cell</th><th className="num">skill box → cell</th><th className="num">sharpness</th><th className="num">cells ≥{nf(m.darkgapCells.data.min_n)} / all</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(m.darkgapCells.data.boxes).sort((a, b) => b[1].n - a[1].n).map(([box, b]) => (
                      <tr key={box}>
                        <td>{box}</td>
                        <td className="num">{nf(b.n)}</td>
                        <td className="num">{f3(b.base)}</td>
                        <td className="num">{f3(b.brier_box)} → {f3(b.brier_cell)}</td>
                        <td className={`num ${(b.bss_cell ?? 0) < 0 ? 'neg' : ''}`}>{sg(b.bss_box)} → {sg(b.bss_cell)}</td>
                        <td className="num">{f3(b.sharpness_cell)}</td>
                        <td className="num">{nf(b.cells_min_n)} / {nf(b.cells)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table style={{ marginTop: 6 }}>
                  <thead>
                    <tr><th>box</th><th>cell · flag / speed band / name</th><th className="num">n</th><th className="num">rate</th><th className="num">forecast</th><th className="num">Brier box → cell</th></tr>
                  </thead>
                  <tbody>
                    {m.darkgapCells.data.cells.map((c) => (
                      <tr key={`${c.box_slug}|${c.cell}`}>
                        <td>{c.box_slug}</td>
                        <td>{c.cell}</td>
                        <td className="num">{nf(c.n)}</td>
                        <td className="num">{f3(c.rate)}</td>
                        <td className="num">{f3(c.forecast)}</td>
                        <td className={`num ${c.brier_cell > c.brier_box ? 'neg' : ''}`}>{f3(c.brier_box)} → {f3(c.brier_cell)}</td>
                      </tr>
                    ))}
                    {m.darkgapCells.data.cells.length === 0 && <tr><td colSpan={6} className="dim">no cell has reached n ≥ {nf(m.darkgapCells.data.min_n)} yet</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="why">
                Skill here is against each box&apos;s own base rate, so the box forecast reads 0.000 by construction; the cell column is what conditioning adds inside the box (mig 149).
                Out of time — rates fitted on events opened before 2026-08-29, scored on 08-29 → 09-01 — the cell forecast moved Brier 0.1285 → 0.1197. Speed bands: s0 &lt; 0.5 kn · s1 &lt; 5 · s2 &lt; 12 · s3 ≥ 12; n1 = name known.
              </div>
            </details>
          )}
          {m.darkgapCells.error && <div className="why">dark_contact_cell_report probe failed: {m.darkgapCells.error}</div>}
          {m.chokepointDaily.data && (
            <details style={{ marginTop: 8 }}>
              <summary className="dim">
                Daily chokepoint question · admission instrument (mig 152) · {m.chokepointDaily.data.admissible ? 'ADMISSIBLE' : 'not admissible yet'} · pooled {nf(m.chokepointDaily.data.pooled?.n ?? 0)} evaluable days since {m.chokepointDaily.data.since}
                {m.chokepointDaily.data.pooled?.skill != null && <> · skill {sg(m.chokepointDaily.data.pooled.skill)} (halves {sg(m.chokepointDaily.data.pooled.skill_half_1)} / {sg(m.chokepointDaily.data.pooled.skill_half_2)})</>}
              </summary>
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table>
                  <thead>
                    <tr><th>strait</th><th className="num">covered rows since {m.chokepointDaily.data.since}</th><th className="num">evaluable</th><th className="num">base</th><th className="num">skill · persistence</th><th className="num">skill · running base</th><th className="num">half 1 / half 2</th><th>admitted</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(m.chokepointDaily.data.covered).sort(([a], [b]) => a.localeCompare(b)).map(([slug, c]) => {
                      const st = m.chokepointDaily.data!.straits[slug];
                      return (
                        <tr key={slug}>
                          <td>{slug}</td>
                          <td className="num">{nf(c.rows)} · {c.first} → {c.last}</td>
                          <td className="num">{nf(st?.n ?? 0)}</td>
                          <td className="num">{f3(st?.base)}</td>
                          <td className={`num ${(st?.skill ?? 0) < 0 ? 'neg' : ''}`}>{sg(st?.skill)}</td>
                          <td className="num">{sg(st?.skill_running_base)}</td>
                          <td className="num">{sg(st?.skill_half_1)} / {sg(st?.skill_half_2)}</td>
                          <td>{st ? <Badge sev={st.admitted ? 'ok' : 'muted'} label={st.admitted ? 'YES' : 'NOT YET'} /> : <Badge sev="muted" label="NO DATA" />}</td>
                        </tr>
                      );
                    })}
                    {Object.keys(m.chokepointDaily.data.covered).length === 0 && <tr><td colSpan={8} className="dim">no covered snapshot since {m.chokepointDaily.data.since}</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="why">
                {m.chokepointDaily.data.rule}. Question: {m.chokepointDaily.data.question}. Model: {m.chokepointDaily.data.model}.
                Measured 2026-09-09 on the full history the same forecast read +0.046 pooled but failed the stability test — a trailing-45-day gate anti-selected (−0.03 / −1.07 when ON) because the 08-24 AIS coverage step change lifted every strait&apos;s counts. Only post-step days count here; the watch item in ⑥ flips to SEEN on this rule, and only then is a daily family built.
              </div>
            </details>
          )}
          {m.chokepointDaily.error && <div className="why">chokepoint_daily_walkforward probe failed: {m.chokepointDaily.error}</div>}
          <div className="why">
            {Object.entries(m.plans).filter(([, p]) => p.error).map(([k, p]) => `${k} plan probe failed: ${p.error}`).join(' · ') || 'Base rates and quotas come from the same plan RPCs the issuers use (migs 125–129), so this table and the claims it explains cannot disagree.'}
            {m.plans.blackmarble.data?.computed_at && <> Night-lights record computed {dt(m.plans.blackmarble.data.computed_at)} in {nf(m.plans.blackmarble.data.compute_ms)} ms on data clock {m.plans.blackmarble.data.computed_on ?? '—'} (cache {m.plans.blackmarble.data.cache}{m.plans.blackmarble.data.stale ? ' · STALE' : ''}); quota and clock live.</>}
            {m.plans.blackmarble.data?.cache === 'miss' && <> Night-lights plan computed LIVE — no cache row yet (refresh-blackmarble-plan, mig 142).</>}
          </div>
        </Card>
        <Card k="ALERTS · rules that fire" badge={<Badge sev={alerting.length ? worst(alerting.map((a) => a.severity)) : 'ok'} label={alerting.length ? `${alerting.length} OPEN` : 'ALL CLEAR'} />}>
          <ul className="watch" style={{ marginTop: 8 }}>
            {A.map((a) => (
              <li key={a.id}>
                <Badge sev={a.severity} label={a.severity === 'ok' ? 'CLEAR' : LABEL[a.severity]} title={`${a.id} · ${a.rule} · evaluated ${dt(a.evaluated_at)}${a.since ? ` · firing since ${dt(a.since)}` : ''}`} /> <span className="dim">{a.id}</span> {a.text}
                {a.since && <span className="dim"> · firing since {dt(a.since)} ({((Date.parse(m.generated_at) - Date.parse(a.since)) / 3_600_000).toFixed(1)} h)</span>}
              </li>
            ))}
          </ul>
          <div className="why">
            Rules are code, not prose (lib/admin/calibration-monitor.ts · evaluateAlerts): hover a badge for the rule and its evaluation time.
            {m.alertState.error
              ? <> Transitions unavailable: {m.alertState.error}.</>
              : <> “Firing since” comes from the hourly evaluator (evaluate-ledger-alerts, mig 141), which also posts fired / escalated / cleared to Discord; this page never writes it.{(m.alertState.data ?? []).length === 0 ? ' No open alert recorded yet — the evaluator has not ticked since migration 141.' : ''}</>}
          </div>
        </Card>
      </div>
    </>
  );
}

// ─── ② resolution skill — per track, filtered ───────────────────────────
function TrackCard({ t, w, m }: { t: string; w: TrackStats | null; m: Monitor }) {
  const f = m.filters;
  const pending = m.health.data?.integrity?.[t]?.pending ?? null;
  const ag = m.agreement.find((a) => a.track === t);
  if (!w || w.resolved === 0) {
    return (
      <Card k={`${t.toUpperCase()} · ${f.label} · ${f.basis === 'issued' ? 'issued' : 'resolved'}`} badge={<Badge sev="muted" label="n=0" />} v="—" s="no resolved claims in window"
        why={t === 'creator' ? 'A creator track exists when a creator’s calls resolve; none have.' : f.family !== 'all' ? `Family filter ${f.family} — nothing resolved for it in this window.` : 'Nothing resolved in this window on this basis.'} />
    );
  }
  const n = w.scored, quotable = n >= MIN_QUOTABLE_N;
  return (
    <Card
      k={`${t.toUpperCase()} · ${f.label} · ${f.basis === 'issued' ? 'issuance date' : 'resolution date'}${f.family !== 'all' ? ` · ${f.family}` : ''}`}
      badge={<Badge sev={quotable ? 'ok' : 'warn'} label={`n=${nf(n)}${quotable ? '' : ' · NOT QUOTABLE'}`} />}
      v={<>{f3(w.brier)} <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>Brier</span></>}
      s={<>skill <b className={(w.skill ?? 0) < 0 ? 'neg' : 'pos'}>{sg(w.skill)}</b> vs base {f3(w.base_rate)} · log-loss {f3(w.log_loss)} · sharpness {f3(w.sharpness)} · resolved {nf(w.resolved)} · void {nf(w.void)}{pending != null ? ` · open ${nf(pending)} (all-time)` : ''}</>}
      why={
        f.period === 'all' && f.family === 'all' && ag
          ? <>agreement with calibration_ledger_tracks(): {ag.agree ? '✓ identical at 3 dp' : <span className="neg">✗ Brier {f3(ag.brier_stats)} vs {f3(ag.brier_ledger)} · skill {sg(ag.skill_stats)} vs {sg(ag.skill_ledger)}</span>} (acceptance §12.1)</>
          : !quotable ? `${n} claims cannot carry a skill number; read the Brier only.` : 'Skill is relative to always saying the base rate: negative is worse than the base rate, not “wrong”. Voids excluded.'
      }
    />
  );
}
function TrackCards({ m }: { m: Monitor }) {
  const f = m.filters;
  const tracks = f.track === 'all' ? [...TRACKS] : [f.track];
  if (m.window.error) return <div className="grid g2"><Card k="RESOLUTION SKILL" err={m.window.error} /></div>;
  return <div className="grid g2">{tracks.map((t) => <TrackCard key={t} t={t} w={m.window.data?.tracks?.[t] ?? null} m={m} />)}</div>;
}

// ─── ③ by family × period ───────────────────────────────────────────────
function FamilyMatrix({ m }: { m: Monitor }) {
  const f = m.filters;
  const cols = ['7', '30', '90', 'all'] as const;
  const rows = m.families.filter((r) => f.track === 'all' || r.track === f.track);
  const cell = (r: FamilyView, c: (typeof cols)[number]) => {
    const p = m.matrix[c];
    if (p.error) return <td className="num neg" title={p.error}>probe failed</td>;
    const x = p.data?.families?.find((y) => y.track === r.track && y.feature === r.feature);
    const allX = m.matrix.all.data?.families?.find((y) => y.track === r.track && y.feature === r.feature);
    const clocked = !!r.source && (ISSUER_SOURCES as readonly string[]).includes(r.source);
    if (!x || x.resolved === 0) return <td className="num dim">{r.issued > 0 && (!allX || allX.resolved === 0) ? (c === 'all' ? `${nf(r.issued)} issued · 0 resolved` : clocked ? 'deferred' : 'unresolved') : '—'}</td>;
    if (x.scored < MIN_QUOTABLE_N) return <td className="num dim" title={`resolved ${x.resolved} · void ${x.void}`}>n&lt;10 ({x.scored}) · {f3(x.brier)}</td>;
    return <td className={`num ${(x.skill ?? 0) < 0 ? 'neg' : ''}`} title={`resolved ${x.resolved} · void ${x.void} · base ${f3(x.base_rate)}`}>{nf(x.scored)} · {f3(x.brier)} · {sg(x.skill)}</td>;
  };
  const gate = (r: FamilyView) => {
    const g = m.plans.house.data?.[r.feature];
    if (g) {
      const e = g.recal_evidence?.kappa_30;
      return `recal gate ${g.recal_applied ? 'ON' : 'OFF'} (${sg(e?.skill_now)} → ${sg(e?.skill_recal)} LOO) · prior ${f3(g.prior)}`;
    }
    if (r.plan) return `${r.plan.state}${r.plan.base_rate != null ? ` · base ${f3(r.plan.base_rate)} (n=${nf(r.plan.n)})` : ''}`;
    return '—';
  };
  return (
    <div className="tbl">
      <table>
        <thead>
          <tr><th>family</th><th>track</th>{cols.map((c) => <th key={c} className="num">{c === 'all' ? 'all' : `${c}d`}</th>)}<th>gate / plan</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hi = f.family !== 'all' && f.family === r.feature, dimr = f.family !== 'all' && !hi;
            return (
              <tr key={`${r.track}/${r.feature}`} style={{ background: hi ? 'var(--teal-glow)' : undefined, opacity: dimr ? 0.45 : 1 }}>
                <td><b>{r.feature}</b></td>
                <td className="dim">{r.track}</td>
                {cols.map((c) => <Fragment key={c}>{cell(r, c)}</Fragment>)}
                <td className="dim">{gate(r)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={7} className="dim">no families for this track</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─── ④ cohort trajectory — skill by issuance day ────────────────────────
function CohortPanel({ m }: { m: Monitor }) {
  const f = m.filters;
  const track = f.track === 'all' ? 'machine' : f.track;
  const series: Cohort[] = m.cohorts.data?.tracks?.[track] ?? [];
  const changes = m.cohorts.data?.changes ?? [];
  const skills = series.filter((c) => c.complete && c.open === 0 && c.skill != null).map((c) => c.skill as number);
  const min = Math.min(-0.42, ...skills), max = Math.max(0.05, ...skills);
  const range = max - min || 1;
  const days = series.map((c) => c.day);
  const boxes = m.boxCohorts.data ?? [];
  const boxDays = Array.from(new Set(boxes.map((b) => b.day))).sort().slice(-10);
  const boxNames = Array.from(new Set(boxes.map((b) => b.box))).sort();
  const byKey = new Map(boxes.map((b) => [`${b.box}|${b.day}`, b]));
  return (
    <>
      {m.cohorts.error ? <Card k="COHORTS" err={m.cohorts.error} /> : (
        <div className="card">
          {series.length === 0 ? <div className="dim">no claims issued in the last {m.cohorts.data?.days ?? f.days} days on the {track} track</div> : (
            <div className="bars">
              {series.map((c) => {
                const flat = (c.sharpness ?? 0) < 0.005;
                // solid only when past deadline AND judged (#513): the scorer works 500 claims per tick
                const done = c.complete && c.open === 0;
                const h = !done ? 28 : c.skill == null ? 4 : Math.max(4, Math.round(((c.skill - min) / range) * 110));
                return (
                  <div key={c.day} className={`bar${flat ? ' flat' : ''}${done ? '' : ' open'}`} title={`${c.day} · issued ${c.issued} · scored ${c.n} · open ${c.open} · brier ${f3(c.brier)} · base ${f3(c.base_rate)} · sharpness ${f3(c.sharpness)}${done ? '' : c.complete ? ' · deadlines passed, still judging — not yet comparable' : ' · cohort still open — not comparable'}`}>
                    <span className="mark" style={{ fontSize: 9, color: !done ? 'var(--ink-faint)' : (c.skill ?? 0) > -0.05 ? 'var(--green)' : 'var(--ink-dim)' }}>{done ? sg(c.skill) : `${c.complete ? 'judging' : 'open'} ${nf(c.n)}/${nf(c.issued)}`}</span>
                    <i style={{ height: h }} />
                    <b>{md(c.day)}</b>
                  </div>
                );
              })}
            </div>
          )}
          <div className="legend">
            <span>bars = skill (BSS) by issuance day · {track} · last {m.cohorts.data?.days ?? f.days} d</span>
            <span>grey = flat 0.5 prior (sharpness &lt; 0.005)</span>
            <span>hatched = cohort still open — not comparable</span>
            {changes.filter((ch) => days.length === 0 || (ch.at.slice(0, 10) >= days[0] && ch.at.slice(0, 10) <= days[days.length - 1])).map((ch) => (
              <span key={ch.at} className="mark" title={ch.note}>▲ {ch.pr} {ch.at.slice(5, 16).replace('T', ' ')}</span>
            ))}
          </div>
          <div className="why" style={{ marginTop: 8 }}>
            A cohort is comparable only once every claim in it has passed its deadline: the claims that resolve first are the ones that reappeared first (#401). The all-time headline carries every flat-prior claim forever; this view shows when the forecaster changed.
            {changes.length > 0 && <> Change log: {changes.map((ch) => `${ch.pr} ${ch.at.slice(0, 16).replace('T', ' ')} — ${ch.note}`).join(' · ')}</>}
          </div>
        </div>
      )}
      {track === 'machine' && (
        <div className="tbl" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr><th>box · ais_dark_contact</th>{boxDays.map((d) => <th key={d} className="num">{md(d)}</th>)}</tr>
            </thead>
            <tbody>
              {boxNames.map((b) => (
                <tr key={b}>
                  <td><b>{b}</b></td>
                  {boxDays.map((d) => {
                    const x = byKey.get(`${b}|${d}`);
                    if (!x) return <td key={d} className="num dim">—</td>;
                    const doneBox = x.complete && x.n + (x.void ?? 0) >= x.issued;
                    if (!doneBox) return <td key={d} className="num dim" title={`issued ${x.issued} · scored ${x.n} · void ${x.void}`}>{x.complete ? 'judging' : 'open'} {x.n}/{x.issued}</td>;
                    if (x.n < MIN_QUOTABLE_N) return <td key={d} className="num dim" title={`issued ${x.issued} · void ${x.void} · brier ${f3(x.brier)}`}>n&lt;10 ({x.n})</td>;
                    return <td key={d} className={`num ${(x.skill ?? 0) < 0 ? 'neg' : 'pos'}`} title={`issued ${x.issued} · scored ${x.n} · void ${x.void} · brier ${f3(x.brier)} · base ${f3(x.base_rate)}`}>{sg(x.skill)} ({x.n})</td>;
                  })}
                </tr>
              ))}
              {boxNames.length === 0 && <tr><td className="dim">{m.boxCohorts.error ? `probe failed: ${m.boxCohorts.error}` : 'no box-attributed claims in range'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── ⑤ reliability + house gates ────────────────────────────────────────
function ReliabilityPanel({ m }: { m: Monitor }) {
  const f = m.filters;
  const w = m.window.data;
  let bins: Bin[] | null = null, label = '';
  if (f.family !== 'all') {
    bins = w?.families?.find((x) => x.feature === f.family)?.reliability ?? null;
    label = f.family;
  } else if (f.track !== 'all') {
    bins = w?.tracks?.[f.track]?.reliability ?? null;
    label = f.track;
  } else {
    bins = w?.tracks?.machine?.reliability ?? null;
    label = 'machine (select a track or family to change)';
  }
  const house = m.plans.house.data ?? {};
  const eia = m.plans.eia.data;
  return (
    <div className="grid g2">
      <div className="card">
        <div className="k"><span>RELIABILITY · {label} · {f.label} · {f.basis}</span>{m.window.error ? <Badge sev="crit" label="PROBE FAILED" title={m.window.error} /> : <Badge sev={bins?.some((b) => b.n > 0) ? 'ok' : 'muted'} label={`n=${nf(bins?.reduce((s, b) => s + b.n, 0) ?? 0)}`} />}</div>
        {bins && bins.some((b) => b.n > 0) ? (
          <div className="rel">
            {bins.map((b) => {
              const ci = wilson(b.observed, b.n);
              const h = b.observed == null ? 2 : Math.round(b.observed * 90);
              return (
                <div key={b.bin} className="b" style={{ height: h, opacity: b.n ? 1 : 0.25 }} title={`predicted ${b.predicted} · n ${nf(b.n)} · observed ${b.observed == null ? '—' : b.observed.toFixed(3)}${ci ? ` · Wilson 95% ${ci[0].toFixed(3)}–${ci[1].toFixed(3)}` : ''}`}>
                  <em>{b.observed == null ? '' : b.observed.toFixed(2)}</em>
                  {ci && b.n > 0 && <u style={{ bottom: `${Math.round((ci[0] / Math.max(b.observed ?? 0.01, 0.01)) * 100)}%`, height: `${Math.max(1, Math.round(((ci[1] - ci[0]) / Math.max(b.observed ?? 0.01, 0.01)) * 100))}%` }} />}
                  <span>{b.predicted.toFixed(2)}{b.n ? <><br />{nf(b.n)}</> : null}</span>
                </div>
              );
            })}
          </div>
        ) : <div className="dim" style={{ margin: '12px 0' }}>no scored claims for this selection in the window</div>}
        <div className="legend"><span>bar = observed rate · label = n · whisker = Wilson 95 %</span><span className="dim">a bar far from its bin centre is miscalibration in that bin, kept on the record</span></div>
      </div>
      <Card k="HOUSE GATES · mig 126" badge={m.plans.house.error ? <Badge sev="crit" label="PROBE FAILED" title={m.plans.house.error} /> : <Badge sev="ok" label="SELF-TESTED" />}>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table>
            <thead><tr><th>family</th><th className="num">n</th><th className="num">prior</th><th className="num">now</th><th className="num">with recal</th><th>gate</th></tr></thead>
            <tbody>
              {Object.entries(house).map(([feat, g]) => {
                const e = g.recal_evidence?.kappa_30;
                return (
                  <tr key={feat}>
                    <td>{feat}</td>
                    <td className="num">{nf(g.n)}</td>
                    <td className="num" title={g.prior_basis}>{f3(g.prior)}</td>
                    <td className={`num ${(e?.skill_now ?? 0) < 0 ? 'neg' : 'pos'}`}>{sg(e?.skill_now)}</td>
                    <td className={`num ${(e?.skill_recal ?? 0) < 0 ? 'neg' : 'pos'}`}>{sg(e?.skill_recal)}</td>
                    <td><Badge sev={g.recal_applied ? 'ok' : 'muted'} label={g.recal_applied ? 'ON · helps' : 'OFF · harms'} title={`shift ${g.recal_shift} · LOO κ=30`} /></td>
                  </tr>
                );
              })}
              {Object.keys(house).length === 0 && <tr><td colSpan={6} className="dim">{m.plans.house.error ?? 'no house families'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="why">
          LOO κ=30, recomputed on every read; a gate turns itself on and off on its own evidence.
          {eia && <> EIA live forecaster ({eia.basis ?? 'eia_draw_plan'}): cell {eia.current_cell ?? '—'} → {eia.forecast != null ? f3(eia.forecast) : '—'} on base {f3(eia.base_rate)} (n={nf(eia.n)}); walk-forward n {nf(eia.evidence?.walk_forward_n)}: this model {sg(eia.evidence?.skill_this_model)} vs momentum {sg(eia.evidence?.skill_momentum)} vs base rate {sg(eia.evidence?.skill_base_rate)}{eia.eligible === false ? ' · NOT ELIGIBLE' : ''}.</>}
          {m.plans.eia.error && <> EIA plan probe failed: {m.plans.eia.error}.</>}
        </div>
      </Card>
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────
export default async function CalibrationMonitorPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/calibration-monitor');
  if (!isFounder(user)) redirect('/app');

  const f = parseFilters(searchParams);
  const m = await loadMonitor(f);
  const h = m.health.data;
  const seen: { at: string; text: string }[] = [];
  if (h?.scorer) seen.push({ at: h.scorer.ran_at, text: `Scorer tick: ${h.scorer.candidates} candidates · ${h.scorer.scored} scored · ${h.scorer.deferred} deferred · ${h.scorer.voided} void (score_predictions_runs).` });
  for (const r of h?.issuance_runs ?? []) seen.push({ at: r.ran_at, text: `${r.source} issuing tick: issued ${r.issued}, already present ${r.already_present ?? '—'}, declined ${Object.entries(r.declined ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${r.error ? ` — ERROR ${r.error}` : ''}.` });
  const d0 = h?.detect_runs?.[0];
  if (d0) seen.push({ at: d0.judged_at, text: `Night-lights detection judged ${d0.night}: ${d0.events} events in ${d0.duration_ms ?? '—'} ms (nightlights_detect_runs).` });
  if (h?.blackmarble_last_run) seen.push({ at: h.blackmarble_last_run.ran_at, text: `Black Marble worker: night ${h.blackmarble_last_run.night} · ${h.blackmarble_last_run.tiles_processed}/${h.blackmarble_last_run.tiles_expected} tiles · ${nf(h.blackmarble_last_run.facilities_written)} facilities · ok=${String(h.blackmarble_last_run.ok)} (blackmarble_ingest_runs).` });
  if (h?.boxes_computed_at) seen.push({ at: h.boxes_computed_at, text: `AIS box liveness recomputed: ${(h.boxes ?? []).filter((b) => b.silent_hours !== null && b.silent_hours <= 24).length} of ${(h.boxes ?? []).length} boxes heard within 24 h (ais_box_liveness).` });
  for (const e of m.alertEvents.data ?? []) seen.push({ at: e.at, text: `Alert ${e.transition.toUpperCase()} · ${e.alert_id} (${e.severity}${e.notified ? ', Discord posted' : ''}) — ${e.text} (ledger_alert_events).` });
  seen.sort((a, b) => (a.at < b.at ? 1 : -1));

  const basisLabel = f.basis === 'issued' ? 'issuance date' : 'resolution date';
  return (
    <>
      <style>{CSS}</style>
      <section className="clm">
        <div className="crumb">/admin/calibration-monitor · founder-only (FOUNDER_EMAILS) · read-only except ⑥</div>
        <h1>Calibration Ledger Monitor</h1>
        <p className="sub">Is the ledger <em>functioning</em> — issuing, resolving, deferring, judging on published data — and how <em>skilled</em> is it, per track, per family, over a period. Every number carries its window and its n. Tracks never blend.</p>

        <Filters f={f} families={m.families.map((x) => ({ track: x.track, feature: x.feature }))} generatedAt={m.generated_at} scorerAt={h?.scorer?.ran_at ?? null} />

        <h2><span className="n">①</span> PIPELINE HEALTH — is the ledger functioning <span className="dim">· always whole-pipeline · as of {dt(m.health.as_of)}</span></h2>
        <Health m={m} />

        <h2><span className="n">②</span> RESOLUTION SKILL — per track · {f.label} · {basisLabel}{f.family !== 'all' ? ` · ${f.family}` : ''} <span className="dim">· as of {dt(m.window.as_of)}</span></h2>
        <div className="note">Skill is the <b>relative Brier skill score</b>, 1 − Brier ÷ base·(1−base). Negative = worse than always saying the base rate — not “wrong”. Voids are excluded, never zero. <b>Read n before quoting anything</b>: n &lt; {MIN_QUOTABLE_N} is not quotable.</div>
        <TrackCards m={m} />

        <h2><span className="n">③</span> BY FAMILY × PERIOD — n · Brier · skill <span className="dim">· resolution date · trailing windows to now</span></h2>
        <FamilyMatrix m={m} />
        <div className="legend"><span>cells: n · Brier · skill</span><span className="dim">“n&lt;10” = not quotable (Brier shown)</span><span className="dim">“deferred” = issued, instrument has not published the window yet</span><span className="dim">“unresolved” = past deadline, no resolver has judged it</span></div>

        <h2><span className="n">④</span> COHORT TRAJECTORY — {f.track === 'all' ? 'machine' : f.track} · skill by <b>issuance day</b> · last {m.cohorts.data?.days ?? f.days} d <span className="dim">· as of {dt(m.cohorts.as_of)}</span></h2>
        <CohortPanel m={m} />

        <h2><span className="n">⑤</span> RELIABILITY + HOUSE GATES <span className="dim">· {f.label} · {basisLabel}</span></h2>
        <ReliabilityPanel m={m} />

        <h2><span className="n">⑥</span> SEEN, NOT ASSUMED — watch list <span className="dim">· unfiltered</span></h2>
        {m.watch.error ? <Card k="WATCH LIST" err={m.watch.error} /> : <WatchList items={m.watch.data ?? []} seen={seen} />}

        <footer>
          SOURCES · calibration_monitor_health() · calibration_family_stats(from, to, basis, track, feature) · calibration_cohorts_by_box() · pg_cron_recent_runs() (all mig 138) · calibration_ledger_tracks() (124) · calibration_cohorts() + ledger_change_log (137) · house_family_calibration() (126) · dark_contact_issuance_plan() (125) · firms_recovery_plan() (127) · blackmarble_claim_plan() (128) · eia_draw_plan() (129) · due_unscored_predictions_count() (121) · score_predictions_runs · issuance_runs · nightlights_detect_runs (134) · blackmarble_ingest_runs · firms_ingest_runs · ais_box_liveness (110)<br />
          CONVENTIONS · tracks never blend · voids excluded, never zero · skill = relative BSS · every panel states its window, basis and as-of · absence of a row is not absence of an event · generated {dt(m.generated_at)}
        </footer>
      </section>
    </>
  );
}
