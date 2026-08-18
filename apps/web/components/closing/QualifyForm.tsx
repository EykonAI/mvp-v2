'use client';

import Script from 'next/script';
import { useRef, useState, type FormEvent } from 'react';
import { captureBrowser } from '@/lib/analytics/client';
import { campaignPropsFromLocation } from '@/lib/analytics/utm';
import type { Persona } from '@/lib/closing/personas';

/**
 * Step 3 — qualification (brief v1.4 §4.0, content spec §4.5).
 *
 * Six questions plus a name, roughly a minute. Writes to closing_leads
 * via POST /api/closing/lead; the SERVER decides where the visitor goes
 * next (migration 108 / PR G) and this component obeys it — the client
 * copy of the rule below is only an offline fallback.
 *
 * The payment question is asked out loud on purpose. We only take crypto
 * today, and the answer is honoured rather than merely collected — it
 * decides which SECONDARY path is offered next to the founding rate.
 *
 * Every persona sees the offer (founder decision 2026-08-18). Routing
 * someone away from the price because we guessed they would not pay is
 * a sale declined on the visitor's behalf: a journalist may well buy, a
 * curious citizen may convert. The server's destination becomes the
 * alternative door shown beside the rate, never a door slammed in front
 * of it.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; theme?: 'dark' | 'light' },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const MARKETS = [
  ['oil-gas', 'Oil & gas'],
  ['metals', 'Metals'],
  ['grains', 'Grains'],
  ['fx', 'FX'],
  ['crypto', 'Crypto'],
  ['equities', 'Equities'],
  ['not-trading', 'Not trading — research / reporting'],
] as const;

const THEATRES = [
  ['hormuz', 'Hormuz'],
  ['red-sea', 'Red Sea'],
  ['black-sea', 'Black Sea'],
  ['taiwan-strait', 'Taiwan Strait'],
  ['malacca', 'Malacca'],
  ['gulf-of-guinea', 'Gulf of Guinea'],
] as const;

const NEEDS = [
  ['realtime-alerts', 'Real-time alerts'],
  ['daily-brief', 'A daily brief'],
  ['ask-analyst', 'Ask-the-analyst'],
  ['audited-record', 'An audited track record'],
  ['community', 'Community & reputation'],
] as const;

const PAY = [
  ['crypto_today', 'Crypto — today'],
  ['fiat_waiting', 'Fiat — tell me when it opens'],
  ['unsure', 'Not sure yet'],
] as const;

const PUBLISHES = [
  ['no', 'No'],
  ['under_10k', 'Yes, under 10k'],
  ['over_10k', 'Yes, 10k+'],
] as const;

type Phase = 'idle' | 'submitting' | 'done' | 'error';

function Chips({
  options,
  value,
  onToggle,
  max,
  label,
}: {
  options: readonly (readonly [string, string])[];
  value: string[];
  onToggle: (slug: string) => void;
  max: number;
  label: string;
}) {
  return (
    <div className="cs-chips" role={max === 1 ? 'radiogroup' : 'group'} aria-label={label}>
      {options.map(([slug, text]) => {
        const on = value.includes(slug);
        const locked = !on && max > 1 && value.length >= max;
        return (
          <button
            key={slug}
            type="button"
            role={max === 1 ? 'radio' : 'checkbox'}
            aria-checked={on}
            aria-disabled={locked}
            className={on ? 'cs-chip cs-on' : 'cs-chip'}
            onClick={() => !locked && onToggle(slug)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function QualifyForm({
  persona,
  turnstileSiteKey,
  onOfferUnlocked,
}: {
  persona: Persona;
  turnstileSiteKey: string | null;
  /** Called on success with the server's destination — shown as the
   *  persona's alternative path beside the founding rate, not instead. */
  onOfferUnlocked: (destination: string) => void;
}) {
  const [markets, setMarkets] = useState<string[]>([]);
  const [theatres, setTheatres] = useState<string[]>([]);
  const [need, setNeed] = useState<string[]>([]);
  const [pay, setPay] = useState<string[]>([]);
  const [publishes, setPublishes] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  function markStarted() {
    if (started.current) return;
    started.current = true;
    captureBrowser({ event: 'lead_form_started' });
  }

  function mountTurnstile() {
    if (!turnstileSiteKey || !turnstileRef.current || !window.turnstile || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      theme: 'dark',
      callback: (t) => {
        tokenRef.current = t;
      },
    });
  }

  const multi = (set: (v: string[]) => void, cur: string[], max: number) => (slug: string) => {
    markStarted();
    if (cur.includes(slug)) set(cur.filter((s) => s !== slug));
    else if (cur.length < max) set([...cur, slug]);
  };
  const single = (set: (v: string[]) => void) => (slug: string) => {
    markStarted();
    set([slug]);
  };

  /** Offline fallback only. The server's `destination` wins when present. */
  function fallbackDestination(): string {
    if (publishes[0] === 'over_10k') return 'mailto:partners@eykon.ai?subject=Founding%20Partner';
    if (persona.id === 'journalist') return 'mailto:verify@eykon.ai?subject=Press%20verification';
    if (pay[0] === 'fiat_waiting' || pay[0] === 'unsure') return '/auth/signin?next=/app';
    if (persona.id === 'citizen') return '/auth/signin?next=/app';
    if (persona.id === 'risk') return '/pricing?plan=enterprise_founding_annual';
    return '/pricing?plan=pro_founding_annual';
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (need.length === 0) {
      setError('Pick what would make eYKON useful in week 1.');
      setPhase('error');
      return;
    }
    if (pay.length === 0) {
      setError('Tell us how you would pay — we would rather know now.');
      setPhase('error');
      return;
    }
    const data = new FormData(form);
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch('/api/closing/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          name_or_handle: data.get('name_or_handle'),
          persona: persona.id,
          markets,
          theatres,
          need: need[0] ?? null,
          pay: pay[0] ?? null,
          publishes: publishes[0] ?? null,
          wants_daily_brief: data.get('wants_daily_brief') === 'on',
          turnstile_token: tokenRef.current,
          ...campaignPropsFromLocation(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Something went wrong. Please retry.');
        setPhase('error');
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { destination?: string };
      const dest = body.destination || fallbackDestination();
      setPhase('done');

      // Always reveal the offer. The destination decides which alternative
      // path sits beside the founding rate — press verification, a free
      // account, the Founding Partner lane — never whether the visitor is
      // allowed to see the price at all.
      onOfferUnlocked(dest);
    } catch {
      setError('Network error. Please retry.');
      setPhase('error');
    }
  }

  return (
    <>
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          onLoad={mountTurnstile}
        />
      )}
      <form className="cs-form" onSubmit={onSubmit} onFocus={markStarted} noValidate>
        <div className="cs-frow">
          <div className="cs-field">
            <label htmlFor="cs-email">Email *</label>
            <input id="cs-email" name="email" type="email" required placeholder="you@domain.com" className="cs-inp" autoComplete="email" />
          </div>
          <div className="cs-field">
            <label htmlFor="cs-name">Name / handle *</label>
            <input id="cs-name" name="name_or_handle" type="text" required placeholder="@handle or full name" className="cs-inp" maxLength={120} />
          </div>
        </div>

        <div className="cs-field cs-fgroup">
          <label>{persona.marketsLabel} <em>· up to 3</em></label>
          <Chips options={MARKETS} value={markets} onToggle={multi(setMarkets, markets, 3)} max={3} label={persona.marketsLabel} />
        </div>

        <div className="cs-field cs-fgroup">
          <label>Which theatres do you watch? <em>· up to 3</em></label>
          <Chips options={THEATRES} value={theatres} onToggle={multi(setTheatres, theatres, 3)} max={3} label="Theatres" />
          <p className="cs-hint">
            Coverage is densest in these six and thinner outside them. We&apos;d rather say so now.
          </p>
        </div>

        <div className="cs-field cs-fgroup">
          <label>What would make eYKON useful in week 1? *</label>
          <Chips options={NEEDS} value={need} onToggle={single(setNeed)} max={1} label="Week-one need" />
        </div>

        <div className="cs-field cs-fgroup">
          <label>How would you pay, honestly? *</label>
          <Chips options={PAY} value={pay} onToggle={single(setPay)} max={1} label="Payment" />
          <p className="cs-hint">
            We only take crypto right now. Saying so costs us a few sales and saves you a wasted
            month.
          </p>
        </div>

        <div className="cs-field cs-fgroup">
          <label>Do you publish? <em>· newsletter, X, podcast — optional</em></label>
          <Chips options={PUBLISHES} value={publishes} onToggle={single(setPublishes)} max={1} label="Publishing" />
        </div>

        {turnstileSiteKey && <div ref={turnstileRef} style={{ margin: '6px 0 14px' }} />}

        <label className="cs-consent" htmlFor="cs-brief">
          <input id="cs-brief" name="wants_daily_brief" type="checkbox" /> Send me the daily brief
        </label>

        <div style={{ marginTop: 18 }}>
          <button type="submit" className="cs-btn" disabled={phase === 'submitting' || phase === 'done'}>
            {phase === 'done' ? '✓ Received' : phase === 'submitting' ? 'Sending…' : `${persona.cta} →`}
          </button>
        </div>
        {phase === 'error' && error && <div className="cs-formmsg cs-err">{error}</div>}
        <p className="cs-fine">{persona.fine}</p>
      </form>
    </>
  );
}
