'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Filters as F } from '@/lib/admin/calibration-monitor';

// The filter bar (build-prompt §4). Every control is a link or a GET form, so
// a view is a URL that can be pasted back and reproduced; the family <select>
// is the one control that needs a click handler.
export const BASE = '/admin/calibration-monitor';

export function hrefFor(f: F, patch: Partial<{ period: string; basis: string; track: string; family: string; from: string; to: string }>): string {
  const v = { period: f.period, basis: f.basis, track: f.track, family: f.family, from: f.from.slice(0, 10), to: f.to.slice(0, 10), ...patch };
  const q = new URLSearchParams();
  q.set('period', v.period);
  q.set('basis', v.basis);
  q.set('track', v.track);
  if (v.family && v.family !== 'all') q.set('family', v.family);
  if (v.period === 'custom') {
    q.set('from', v.from);
    q.set('to', v.to);
  }
  return `${BASE}?${q.toString()}`;
}

function Seg({ label, options, current, make }: { label: string; options: { v: string; l: string }[]; current: string; make: (v: string) => string }) {
  return (
    <>
      <span className="fl">{label}</span>
      <span className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <Link key={o.v} href={make(o.v)} className={o.v === current ? 'on' : ''} aria-current={o.v === current ? 'page' : undefined}>
            {o.l}
          </Link>
        ))}
      </span>
    </>
  );
}

export function Filters({ f, families, generatedAt, scorerAt }: { f: F; families: { track: string; feature: string }[]; generatedAt: string; scorerAt: string | null }) {
  const router = useRouter();
  const fam = (t: string) => families.filter((x) => x.track === t);
  return (
    <div className="filters">
      <Seg
        label="PERIOD"
        current={f.period}
        options={[{ v: '7', l: '7d' }, { v: '30', l: '30d' }, { v: '90', l: '90d' }, { v: 'all', l: 'all' }, { v: 'custom', l: 'custom' }]}
        make={(v) => hrefFor(f, { period: v })}
      />
      {f.period === 'custom' && (
        <form method="get" action={BASE} className="custom">
          <input type="hidden" name="period" value="custom" />
          <input type="hidden" name="basis" value={f.basis} />
          <input type="hidden" name="track" value={f.track} />
          {f.family !== 'all' && <input type="hidden" name="family" value={f.family} />}
          <label>
            <span className="sr">from</span>
            <input type="date" name="from" defaultValue={f.from.slice(0, 10)} max={f.to.slice(0, 10)} />
          </label>
          <span className="fl">→</span>
          <label>
            <span className="sr">to</span>
            <input type="date" name="to" defaultValue={f.to.slice(0, 10)} />
          </label>
          <button type="submit">Apply</button>
        </form>
      )}
      <Seg
        label="TRACK"
        current={f.track}
        options={[{ v: 'all', l: 'all' }, { v: 'house', l: 'house' }, { v: 'machine', l: 'machine' }, { v: 'creator', l: 'creator' }]}
        make={(v) => hrefFor(f, { track: v, family: 'all' })}
      />
      <span className="fl">FAMILY</span>
      <select aria-label="Family" value={f.family} onChange={(e) => router.push(hrefFor(f, { family: e.target.value }))}>
        <option value="all">all families</option>
        {['house', 'machine', 'creator'].map((t) =>
          fam(t).map((x) => (
            <option key={x.feature} value={x.feature}>
              {t} · {x.feature}
            </option>
          )),
        )}
      </select>
      <Seg
        label="BASIS"
        current={f.basis}
        options={[{ v: 'resolved', l: 'resolution date' }, { v: 'issued', l: 'issuance date' }]}
        make={(v) => hrefFor(f, { basis: v })}
      />
      <span className="asof">
        generated {generatedAt.slice(0, 16).replace('T', ' ')} UTC · scorer tick {scorerAt ? `${scorerAt.slice(11, 16)} UTC` : 'no record yet'}
      </span>
    </div>
  );
}
