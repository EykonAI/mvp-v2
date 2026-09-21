'use client';
import { useEffect, useMemo } from 'react';
import {
  KNOWN_LIMITS, MAINTENANCE_DISCLOSURE, VERDICTS, HEAT_STATES,
  claimsLine, eliminationShare, funnelSteps, heatStrip, lightStrip,
  num1, num2, outcomeSplit, pct, robustnessNote, sortRows, windowLabel,
  type BoardRow, type TickPayload, type TickResponse,
} from '@/lib/reality-check/board';
import SensorStrip from './SensorStrips';

/**
 * The refinery board (build prompt §3.3). Renders ONE published tick,
 * exactly as reality_check_tick() froze it.
 *
 * Reading order, and why it is this order:
 *   1  the tick band     — which tick, frozen, on what windows and parameters
 *   2  the funnel        — the five terms of §2.2, counted by complex, with
 *                          facility rows in brackets and REFUTED dominant
 *   3  the refutation    — the hero cell; the lead never leads
 *   4  the board         — Site · Location · Thermal · Light · Nights ·
 *                          Capacity · Verdict, verdict loudest
 *   5  the standing copy — §3.4, verbatim, BETWEEN the board and the
 *                          drill-down, because it governs both
 *   6  the drill-down    — a full-width verdict banner, both sensor strips
 *                          with the nights not looked at as hatched gaps
 *   7  the method        — statistic, both windows, threshold, floors,
 *                          complex rule, coverage, known limits, recall not
 *                          measured. There is no methods page: this is where
 *                          a subscriber learns how the check works.
 *   8  the claims line   — n issued · n judged · skill or Calibrating
 */
export default function RefineryBoard({
  data,
  selected,
  onSelect,
  onTick,
}: {
  data: TickResponse | { published: false; error?: string };
  selected: string | null;
  /** `auto` marks a selection the BOARD made, not the reader — see the
      opening effect in Board(). The workspace uses it to stay silent. */
  onSelect: (key: string, auto?: boolean) => void;
  onTick: (tick: string) => void;
}) {
  if (!data || data.published !== true) {
    return <EmptyBoard data={data as { published: false; empty_reason?: string; error?: string; runs_total?: number; runs_complete?: number }} />;
  }
  return <Board t={data} selected={selected} onSelect={onSelect} onTick={onTick} />;
}

/**
 * The honest empty state. True until the first tick publishes: the board
 * says there is no tick, says why, and shows nothing that could be mistaken
 * for a measurement. A placeholder number here would be the exact defect
 * this programme exists to remove.
 */
function EmptyBoard({
  data,
}: {
  data: { published: false; empty_reason?: string; error?: string; runs_total?: number; runs_complete?: number };
}) {
  return (
    <div className="rc-empty">
      <div className="rc-empty-t">No tick has been published yet</div>
      <p className="rc-p">
        {data.empty_reason ??
          data.error ??
          'The refinery tick has not published a board. Nothing is shown here, because a number on an unpublished tick would be an invention.'}
      </p>
      <p className="rc-p">
        The tick is weekly and its cadence is set by the slowest instrument: NASA Black Marble
        publishes about nine days behind, so the published window always ends about nine days back.
        A tick publishes only when the data clock has advanced at least seven nights past the last
        one. Until then this board has nothing to say, and says so.
      </p>
      {(data.runs_total ?? 0) > 0 && (
        <p className="rc-p">
          <strong>{data.runs_total}</strong> tick {data.runs_total === 1 ? 'run' : 'runs'} recorded,{' '}
          <strong>{data.runs_complete}</strong>{' '}
          complete. A complete run that is not published is a defect, not a quiet day — the next
          cron run publishes it, and the run reports the failure if it cannot.
        </p>
      )}
    </div>
  );
}

function Board({
  t,
  selected,
  onSelect,
  onTick,
}: {
  t: TickPayload;
  selected: string | null;
  onSelect: (key: string, auto?: boolean) => void;
  onTick: (tick: string) => void;
}) {
  const rows = useMemo(() => sortRows(t.rows ?? []), [t.rows]);
  const steps = funnelSteps(t);
  const split = outcomeSplit(t);
  const elim = eliminationShare(t);
  const note = robustnessNote(t);
  const frozenLine = claimsLine(t.claims.at_publication);
  const liveLine = claimsLine(t.claims.live);
  const active = rows.find((r) => r.cluster_key === selected) ?? rows[0] ?? null;

  // Open on the first row of the sorted board — which, because REFUTED
  // outranks everything, is a refutation. The refusal is the product, so it
  // is what a subscriber should be reading when the page settles, and it is
  // also what puts the drill-down's ?cluster= in the URL so the view they
  // are looking at is the view they can send someone.
  useEffect(() => {
    if (!selected && active) onSelect(active.cluster_key, true);
  }, [selected, active, onSelect]);

  return (
    <>
      {/* 1 · the tick band */}
      <div className="rc-tickbar">
        <span className="rc-tickid">Tick {t.tick}</span>
        <span className={`rc-chip ${t.supersession.current ? 'rc-chip-frozen' : 'rc-chip-super'}`}>
          {t.supersession.current ? 'Frozen' : 'Superseded'}
        </span>
        <span className="rc-fact">
          baseline <b>{windowLabel(t.windows.baseline_start, t.windows.baseline_end)}</b> ·{' '}
          {t.windows.baseline_nights} nights
        </span>
        <span className="rc-fact">
          window <b>{windowLabel(t.windows.window_start, t.windows.window_end)}</b> ·{' '}
          {t.windows.window_nights} nights
        </span>
        <span className="rc-fact">
          <b>{String(t.parameters.statistic)}</b> on {String(t.parameters.light_column)} · threshold{' '}
          <b>{String(t.parameters.light_down_ratio)}</b>
        </span>
        <span className="rc-fact">
          unit <b>complex</b> ({String(t.parameters.complex_linkage_m)} m)
        </span>
        <span className="rc-fact">
          hash <b>{t.integrity.content_hash.slice(0, 12)}</b>{' '}
          {t.integrity.hash_matches ? 'verified on read' : 'DOES NOT MATCH — report this'}
        </span>
      </div>

      {!t.supersession.current && t.supersession.superseded_by && (
        <div className="rc-section">
          <p className="rc-p">
            <strong>This tick has been superseded.</strong> A night arrived late, so the tick was
            recomputed and republished as <strong>{t.supersession.superseded_by.tick}</strong>. This
            one was never edited and stays citable exactly as published — that is the point of
            freezing it.{' '}
            <button type="button" className="rc-linkbtn" onClick={() => onTick(t.supersession.superseded_by!.tick)}>
              Open the current tick
            </button>
          </p>
        </div>
      )}

      {/* 2 · the funnel, counted by complex, rows in brackets */}
      <div className="rc-section">
        <div className="rc-h">The funnel · counted by complex, facility rows in brackets</div>
        <div className="rc-funnel">
          {steps.map((s) => (
            <div key={s.key} className={s.hero ? 'rc-step rc-step-hero' : 'rc-step'}>
              <span className="rc-step-n">{s.complexes}</span>
              <span className="rc-step-rows">({s.rows} facility rows)</span>
              <span className="rc-step-l">{s.label}</span>
              <span className="rc-step-note">{s.note}</span>
            </div>
          ))}
        </div>
        <div className="rc-outcome">
          {split.map((o) => (
            <span key={o.key} className="rc-outcome-item">
              <b>{o.complexes}</b>
              {o.label} ({o.rows} rows)
            </span>
          ))}
        </div>

        {/* 3 · the refutation cell is the hero; the lead is never the headline */}
        <p className="rc-p rc-p-top">
          {elim === null ? (
            <>
              Nothing was thermally dark on this tick, so there was nothing for the second
              instrument to refute. That is a quiet week, not a failure of the method.
            </>
          ) : (
            <>
              A thermal-only feed hands you <strong>{t.funnel.thermally_dark.complexes}</strong>{' '}
              alarms this week.{' '}
              <strong>
                {t.funnel.refuted.complexes} of them are complexes that stopped flaring while
                staying lit
              </strong>{' '}
              — {pct(elim)} eliminated, and the elimination is the product.{' '}
              {t.funnel.lead.complexes === 0
                ? 'No complex reached a dual-confirmed lead this week.'
                : `${t.funnel.lead.complexes} reached a dual-confirmed lead and ${t.funnel.lead.complexes === 1 ? 'is' : 'are'} published as something to investigate, never as an established outage.`}{' '}
              {t.funnel.withheld.complexes > 0 &&
                `${t.funnel.withheld.complexes} thermally dark complex${t.funnel.withheld.complexes === 1 ? '' : 'es'} ${t.funnel.withheld.complexes === 1 ? 'is' : 'are'} withheld: the instruments could not support a verdict either way, and silence is not a verdict.`}
            </>
          )}
        </p>
        <p className="rc-p">
          {t.funnel.observed.complexes - t.funnel.heat_observable.complexes} observed complexes have
          no thermal baseline to fall from and are reported as{' '}
          <strong>heat not observable</strong>, never as heat steady.
        </p>
        {note && <p className="rc-p">{note}</p>}
      </div>

      {/* 4 · the board */}
      <div className="rc-section">
        <div className="rc-h">Board · tick {t.tick}</div>
        <div className="rc-scroll">
          <table className="rc-table">
            <caption className="sr-only">
              Reality Check board for tick {t.tick}: one row per refinery complex, with its
              location, thermal detection rate, median night-time radiance, usable clear nights,
              capacity state and verdict.
            </caption>
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Location</th>
                <th scope="col">Thermal · detection days</th>
                <th scope="col">Median radiance</th>
                <th scope="col">Clear nights base / win</th>
                <th scope="col">Capacity</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row
                  key={r.cluster_key}
                  r={r}
                  selected={active?.cluster_key === r.cluster_key}
                  onSelect={onSelect}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="rc-none">
                    This tick scored no complex. That is a registry problem, not a quiet week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5 · §3.4, verbatim, between the board and the drill-down */}
      <div className="rc-standing">
        <p>
          <b>Planned maintenance is not distinguishable here.</b> {MAINTENANCE_DISCLOSURE}
        </p>
      </div>

      {/* 6 · the drill-down */}
      {active && <Drilldown t={t} r={active} />}

      {/* 7 · the method — there is no methods page */}
      <Method t={t} />

      {/* 8 · the claims line */}
      <div className="rc-section">
        <div className="rc-h">Scored claims · calibration ledger</div>
        <p className="rc-p">
          Every verdict on this board is a forward-testable claim, issued into the calibration
          ledger on the machine track and resolved on a window the claim could not see. Four
          families: heat stays dark, a refuted site stays lit, a lead&apos;s light stays down, and a
          refutation holds over the next two ticks.
        </p>
        {frozenLine ? (
          <p className="rc-p rc-mono">
            As at publication · {frozenLine.issued} issued · {frozenLine.judged} judged ·{' '}
            {frozenLine.label} · {frozenLine.families} families
            {t.claims.issued_on_this_tick !== null &&
              ` · ${t.claims.issued_on_this_tick} issued on this tick`}
          </p>
        ) : (
          <p className="rc-p rc-none">
            No claims line was recorded with this tick. That is a defect in the monitor, not an
            absence of claims.
          </p>
        )}
        {liveLine && (
          <p className="rc-p rc-mono">
            Now · {liveLine.issued} issued · {liveLine.judged} judged · {liveLine.label}
          </p>
        )}
        <p className="rc-p">
          A family is <strong>Calibrating</strong> until it has 90 judged claims, and a family whose
          split-half skill is undefined stays Calibrating rather than being promoted or suspended on
          a number that does not exist. Early probabilities sit near 0.5 because they are shrunk
          toward it — that is the honest start of a record, not a hedge.
        </p>
      </div>
    </>
  );
}

// ─── one board row ───────────────────────────────────────────────────────
function Row({
  r,
  selected,
  onSelect,
}: {
  r: BoardRow;
  selected: boolean;
  onSelect: (key: string, auto?: boolean) => void;
}) {
  const v = VERDICTS[r.verdict];
  const loc = r.location;
  const place = loc
    ? [loc.city, loc.us_state, loc.country ?? loc.iso_country].filter(Boolean).join(', ')
    : null;

  const name = r.site_name ?? 'Name withheld below Pro';

  // The activatable thing is a BUTTON in the Site cell, not the <tr>.
  // aria-selected is only allowed on a row inside a grid or treegrid; on a
  // plain role="table" it is invalid ARIA, and a bare tabIndex on a <tr>
  // gives a keyboard user a stop with no role and no name — 295 of them.
  // The row keeps its click as a mouse convenience; selection state moves
  // to a data attribute, which is a styling hook and claims nothing.
  return (
    <tr data-selected={selected ? 'true' : undefined} onClick={() => onSelect(r.cluster_key)}>
      <td>
        <button
          type="button"
          className="rc-rowbtn"
          aria-current={selected || undefined}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(r.cluster_key);
          }}
        >
          <span className="rc-site">{name}</span>
          <span className="sr-only">
            {' '}
            — verdict {v.label}. Open the night-by-night drill-down for this complex.
          </span>
        </button>
        <span className="rc-sub">
          {r.cluster_key}
          {r.member_count > 1 && ` · ${r.member_count} sites, counted once`}
        </span>
      </td>
      <td>
        {place ? (
          <>
            <span>{place}</span>
            {loc?.latitude !== null && loc?.longitude !== null && (
              <span className="rc-sub">
                {num2(loc!.latitude)}, {num2(loc!.longitude)}
              </span>
            )}
            {loc?.multi_country && <span className="rc-sub">members in more than one country</span>}
          </>
        ) : (
          <span className="rc-none">not in the registry</span>
        )}
      </td>
      <td>
        {r.heat.baseline_firms_days === 0 ? (
          <span className="rc-none">no FIRMS day</span>
        ) : (
          <span className="rc-pair">
            {pct(r.heat.baseline_rate)}
            <span className="to">→</span>
            {r.heat.window_firms_days === 0 ? '—' : pct(r.heat.window_rate)}
          </span>
        )}
        <span className="rc-sub">{r.heat_state ? HEAT_STATES[r.heat_state] : 'not stated'}</span>
      </td>
      <td>
        {r.light.baseline_median === null ? (
          <span className="rc-none">not observed</span>
        ) : (
          <span className="rc-pair">
            {num1(r.light.baseline_median)}
            <span className="to">→</span>
            {num1(r.light.window_median)}
          </span>
        )}
        {r.robustness.robust_to_retrieval === false && (
          <span className="rc-flag">not robust to 3×3</span>
        )}
      </td>
      <td className="rc-pair">
        {r.light.baseline_nights} / {r.light.window_nights}
        {r.stability.tested === false && <span className="rc-sub">no stability test</span>}
      </td>
      <td>
        <span className="rc-cap">{r.capacity.label}</span>
        {/* The reason comes from the tick, not from a literal here: once
            CAP-3 establishes a figure, `established` flips and a hardcoded
            "chain not built" would sit under a real number. */}
        {!r.capacity.established && <span className="rc-sub">chain not built</span>}
      </td>
      <td>
        <span className={`rc-v rc-v-${v.tone}`}>{v.label}</span>
      </td>
    </tr>
  );
}

// ─── the drill-down ──────────────────────────────────────────────────────
function Drilldown({ t, r }: { t: TickPayload; r: BoardRow }) {
  const v = VERDICTS[r.verdict];
  const dd = t.drilldown && t.drilldown.cluster_key === r.cluster_key ? t.drilldown : null;
  const nights = dd?.nights ?? [];
  const light = lightStrip(nights);
  const heat = heatStrip(nights);

  return (
    <>
      {/* a full-width verdict banner on every drill-down */}
      <div className={`rc-banner rc-vb-${v.tone}`}>
        <div className="rc-banner-t">{v.banner}</div>
        <div className="rc-banner-g">{v.gloss}</div>
        <div className="rc-banner-g rc-mono">
          {r.site_name ?? r.cluster_key}
          {r.member_names && r.member_names.length > 1 && ` · ${r.member_names.join(' · ')}`}
        </div>
      </div>

      <div className="rc-dd">
        <div>
          {nights.length === 0 ? (
            <p className="rc-p">
              {dd?.withheld
                ? dd.reason
                : 'Select a row to load its night-by-night strips. The strips come from the same tick as the verdict — they are not recomputed.'}
            </p>
          ) : (
            <>
              <div className="rc-strip">
                <div className="rc-strip-t">Night-time radiance · usable clear nights carrying a retrieval</div>
                <SensorStrip
                  title={`Night-time radiance for ${r.site_name ?? r.cluster_key}`}
                  desc={`Median radiance per night over the baseline ${windowLabel(t.windows.baseline_start, t.windows.baseline_end)} and the window ${windowLabel(t.windows.window_start, t.windows.window_end)}.`}
                  bars={light}
                  windowFrom={t.windows.window_start}
                  tone="light"
                  unit="Median radiance"
                />
                <div className="rc-strip-ax">
                  <span>{t.windows.baseline_start.slice(5)}</span>
                  <span>window from {t.windows.window_start.slice(5)}</span>
                  <span>{t.windows.window_end.slice(5)}</span>
                </div>
              </div>

              <div className="rc-strip">
                <div className="rc-strip-t">Thermal · members with a FIRMS detection that day</div>
                <SensorStrip
                  title={`Thermal detections for ${r.site_name ?? r.cluster_key}`}
                  desc="Members with at least one FIRMS detection per usable day. A day with no detection is a short bar; a day the census could not use is a gap."
                  bars={heat}
                  windowFrom={t.windows.window_start}
                  tone="heat"
                  unit="Members detecting"
                />
              </div>

              {/* One hue per instrument, phase carried by weight. The
                  strips encode two different measurements, so a legend that
                  named a colour once had to be wrong on one of them. */}
              <div className="rc-strip-legend">
                <span className="rc-key">
                  <span className="rc-swatch rc-swatch-lightbase" aria-hidden="true" />
                  <span className="rc-swatch rc-swatch-light" aria-hidden="true" />
                  radiance · baseline / window
                </span>
                <span className="rc-key">
                  <span className="rc-swatch rc-swatch-heatbase" aria-hidden="true" />
                  <span className="rc-swatch rc-swatch-heat" aria-hidden="true" />
                  thermal detections · baseline / window
                </span>
                <span className="rc-key">
                  <span className="rc-swatch rc-swatch-gap" aria-hidden="true" />
                  not looked at — a gap, never a zero
                </span>
              </div>

              <p className="rc-p rc-p-top">
                Cloud flags are exposed rather than collapsed: a night can be cloudy
                (<span className="rc-mono">NOT_CLEAR</span>), cloud-clear but carrying no radiance
                retrieval (<span className="rc-mono">CLEAR_NO_RETRIEVAL</span>, roughly 2,500
                refinery-nights are like this), outside the census&apos;s usable set
                (<span className="rc-mono">NIGHT_NOT_USABLE</span>) or simply never written
                (<span className="rc-mono">NOT_INGESTED</span>). Only the first kind of night —
                clear and carrying a retrieval — is used by the statistic.
              </p>
            </>
          )}
        </div>

        <div>
          <div className="rc-h">What the two measurements say</div>
          <dl className="rc-kv">
            <dt>Baseline median → window median</dt>
            <dd>
              {num1(r.light.baseline_median)} → {num1(r.light.window_median)}
            </dd>
            <dt>Ratio against the {String(t.parameters.light_down_ratio)} threshold</dt>
            <dd>{num2(r.light.ratio)}</dd>
            <dt>Baseline range</dt>
            <dd>
              {num1(r.light.baseline_min)} – {num1(r.light.baseline_max)}
            </dd>
            <dt>Window range</dt>
            <dd>
              {num1(r.light.window_min)} – {num1(r.light.window_max)}
            </dd>
            <dt>Distributions overlap</dt>
            <dd>{r.light.distributions_overlap === null ? '—' : r.light.distributions_overlap ? 'yes' : 'no'}</dd>
            <dt>Usable clear nights, base / window</dt>
            <dd>
              {r.light.baseline_nights} / {r.light.window_nights}
            </dd>
            <dt>Thermal detection days, base / window</dt>
            <dd>
              {r.heat.baseline_heat_days}/{r.heat.baseline_firms_days} →{' '}
              {r.heat.window_heat_days}/{r.heat.window_firms_days}
            </dd>
            <dt>Stability test (KS on the baseline halves)</dt>
            <dd>
              {r.stability.tested === null
                ? 'not run'
                : r.stability.tested
                  ? `D ${num2(r.stability.d)} · p ${num2(r.stability.p)}`
                  : 'below 12 baseline nights — not run'}
            </dd>
            <dt>Robustness ({t.robustness.column})</dt>
            <dd>
              {r.robustness.verdict
                ? `${VERDICTS[r.robustness.verdict].label} · ${num2(r.robustness.ratio)}`
                : 'not computed'}
            </dd>
            <dt>Capacity</dt>
            <dd>{r.capacity.label}</dd>
          </dl>

          {r.light.distributions_overlap && !VERDICTS[r.verdict].withheld && (
            <p className="rc-p rc-p-top">
              The two distributions overlap: the window&apos;s brightest night sits at or above the
              baseline median, and the baseline&apos;s darkest sits at or below the window median.
              Overlapping ranges make a row a lead, never an established outage.
            </p>
          )}
          {r.robustness.robust_to_retrieval === false && (
            <p className="rc-p rc-p-top">
              <strong>Not robust to the retrieval.</strong> This verdict changes under the stricter{' '}
              {t.robustness.column} retrieval (px_hq_3x3 ≥ {t.robustness.min_px_hq}):{' '}
              {VERDICTS[r.verdict].label} on the primary statistic,{' '}
              {r.robustness.verdict ? VERDICTS[r.robustness.verdict].label : '—'} on the check. Both
              are published. A verdict that holds on one retrieval and not the other is a lead, not
              a conclusion.
            </p>
          )}
          <p className="rc-p rc-p-top">
            <strong>{r.capacity.label}.</strong> {r.capacity.reason}
          </p>
        </div>
      </div>
    </>
  );
}

// ─── the method, on the board ────────────────────────────────────────────
function Method({ t }: { t: TickPayload }) {
  const p = t.parameters;
  const bm = new Set(t.coverage.bm_nights_used ?? []);
  const firms = new Set(t.coverage.firms_days_used ?? []);
  const cal: string[] = [];
  const start = new Date(`${t.windows.baseline_start}T00:00:00Z`).getTime();
  for (let i = 0; i < t.coverage.calendar_nights; i += 1) {
    cal.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }

  return (
    <div className="rc-section">
      <div className="rc-h">The method · this is where the check is explained, and there is no methods page</div>
      <dl className="rc-params">
        <div className="rc-param">
          <dt>Statistic</dt>
          <dd>
            {String(p.statistic)} of per-night medians, on {String(p.light_column)}
          </dd>
        </div>
        <div className="rc-param">
          <dt>Baseline window</dt>
          <dd>
            {t.windows.baseline_start} → {t.windows.baseline_end}
          </dd>
        </div>
        <div className="rc-param">
          <dt>Comparison window</dt>
          <dd>
            {t.windows.window_start} → {t.windows.window_end}
          </dd>
        </div>
        <div className="rc-param">
          <dt>Light-down threshold</dt>
          <dd>below {String(p.light_down_ratio)} × the baseline median</dd>
        </div>
        <div className="rc-param">
          <dt>Heat-down threshold</dt>
          <dd>below {String(p.heat_down_ratio)} × the baseline detection rate</dd>
        </div>
        <div className="rc-param">
          <dt>Heat-observable floor</dt>
          <dd>baseline heat rate above {String(p.heat_observable_floor)}</dd>
        </div>
        <div className="rc-param">
          <dt>Night floors</dt>
          <dd>
            {String(p.min_baseline_nights)} baseline · {String(p.min_window_nights)} window
          </dd>
        </div>
        <div className="rc-param">
          <dt>Clear-night rule</dt>
          <dd>{String(p.clear_night_rule)} and a retrieval present</dd>
        </div>
        <div className="rc-param">
          <dt>Census usable ratio</dt>
          <dd>{String(p.census_usable_ratio)} of that night&apos;s roster</dd>
        </div>
        <div className="rc-param">
          <dt>Stability test</dt>
          <dd>
            KS at α {String(p.ks_alpha)}, from {String(p.ks_min_baseline_nights)} baseline nights
          </dd>
        </div>
        <div className="rc-param">
          <dt>Complex rule</dt>
          <dd>
            single linkage at {String(p.complex_linkage_m)} m, re-matched within{' '}
            {String(p.complex_rematch_m)} m
          </dd>
        </div>
        <div className="rc-param">
          <dt>Robustness check</dt>
          <dd>
            {t.robustness.column}, px_hq_3x3 ≥ {t.robustness.min_px_hq}
          </dd>
        </div>
        <div className="rc-param">
          <dt>Recall</dt>
          <dd>not measured</dd>
        </div>
        <div className="rc-param">
          <dt>Classifier</dt>
          <dd>{String(p.classifier_version ?? 'unrecorded')}</dd>
        </div>
      </dl>

      <p className="rc-p rc-p-top">
        {t.windows.rule} Every parameter above is stored on the tick and rendered from it, never
        from a constant in the page: a threshold that could change without a new tick would not be
        auditable.
      </p>

      <div className="rc-h rc-p-top">Coverage · the nights this tick could use</div>
      <div className="rc-cov" role="img" aria-label={`Coverage strip: ${bm.size} of ${t.coverage.calendar_nights} calendar nights were usable for night-lights and ${firms.size} for thermal.`}>
        {cal.map((d) => (
          <span
            key={d}
            className={`rc-covcell${bm.has(d) ? ' rc-cov-bm' : ''}${firms.has(d) ? ' rc-cov-fr' : ''}`}
            title={`${d}: ${bm.has(d) ? 'night-lights usable' : 'night-lights not usable'}, ${firms.has(d) ? 'thermal usable' : 'thermal not usable'}`}
          />
        ))}
      </div>
      <p className="rc-p">
        <span className="rc-mono">{bm.size}</span> of {t.coverage.calendar_nights} calendar nights
        were usable for night-lights and <span className="rc-mono">{firms.size}</span> for thermal.{' '}
        {t.coverage.note}
      </p>

      <div className="rc-h rc-p-top">Known limits</div>
      <ul className="rc-limits">
        {KNOWN_LIMITS.map((l) => (
          <li key={l.slice(0, 24)}>{l}</li>
        ))}
      </ul>

      <p className="rc-p">
        Published {new Date(t.published_at).toISOString().replace('T', ' ').slice(0, 16)} UTC ·
        content hash <span className="rc-mono">{t.integrity.content_hash}</span> ·{' '}
        {t.integrity.hash_matches
          ? 'recomputed on this read and identical'
          : 'RECOMPUTED AND DIFFERENT — this tick is not intact, please report it'}
        . A published tick is frozen in the database: its rows refuse updates, deletes and
        truncation for every role, and a late-arriving night produces a new superseding tick rather
        than an edit.
      </p>

      {/* What the hash does and does not cover, so "verified on read" is not
          read as more than it is. Both strings come from the accessor. */}
      {(t.integrity.covers || t.integrity.not_covered) && (
        <p className="rc-p">
          <strong>The hash covers</strong> {t.integrity.covers} <strong>It does not cover</strong>{' '}
          {t.integrity.not_covered}
        </p>
      )}

      {t.archive.length > 1 && (
        <>
          <div className="rc-h rc-p-top">Tick archive</div>
          <ul className="rc-limits">
            {t.archive.map((a) => (
              <li key={a.tick} className="rc-mono">
                {a.tick} · {a.window_start} → {a.window_end} · {a.refuted} refuted · {a.lead} lead
                {a.current ? ' · current' : ' · superseded'}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
