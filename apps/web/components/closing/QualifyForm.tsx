'use client';

import Script from 'next/script';
import { useRef, useState, type FormEvent } from 'react';
import { captureBrowser } from '@/lib/analytics/client';
import { campaignPropsFromLocation } from '@/lib/analytics/utm';

/**
 * Screen 5 — qualification (brief v1.3 §4.5). Six fields, ~40 seconds.
 * Self-hosted: the lead lands in closing_leads where the digest, bounty
 * and attribution logic can reach it (POST /api/closing/lead, PR C).
 * Turnstile pattern lifted from /grow's SubmissionForm.
 *
 * This is the screen the whole page exists to reach — a bounce after a
 * successful submit still leaves an asset. On success the page scrolls to
 * the offer: the form is the gate, and clearing it is a small reward.
 *
 * lead_form_started fires on first interaction (intent vs completion —
 * the gap is the form's fault, not the traffic's). lead_captured fires
 * SERVER-side in the API; the client never double-fires it.
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

const PERSONAS = [
  ['day-trader', 'Day-trader'],
  ['osint-analyst', 'OSINT analyst'],
  ['commodities-desk', 'Commodities desk'],
  ['journalist', 'Journalist'],
  ['corporate-risk', 'Corporate risk'],
  ['researcher-ngo', 'Researcher / NGO'],
  ['other', 'Other'],
] as const;

const THEATRES = [
  ['hormuz-red-sea', 'Hormuz / Red Sea'],
  ['russian-refineries', 'Russian refineries'],
  ['sanctions-shadow-fleet', 'Sanctions & shadow fleet'],
  ['power-grid', 'Power & grid'],
  ['critical-minerals', 'Critical minerals'],
  ['taiwan-scs', 'Taiwan / SCS'],
] as const;

type Phase = 'idle' | 'submitting' | 'done' | 'error';

export function QualifyForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [persona, setPersona] = useState<string | null>(null);
  const [theatres, setTheatres] = useState<string[]>([]);
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

  function toggleTheatre(slug: string) {
    markStarted();
    setTheatres((cur) => (cur.includes(slug) ? cur.filter((t) => t !== slug) : [...cur, slug]));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (!persona) {
      setError('Pick what describes you.');
      setPhase('error');
      return;
    }
    if (theatres.length === 0) {
      setError('Pick at least one thing you would point eYKON at.');
      setPhase('error');
      return;
    }
    const data = new FormData(form);
    const campaign = campaignPropsFromLocation();
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch('/api/closing/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          name_or_handle: data.get('name_or_handle'),
          persona,
          theatres,
          current_tools: data.get('current_tools') || null,
          wants_daily_brief: data.get('wants_daily_brief') === 'on',
          turnstile_token: tokenRef.current,
          ...campaign,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Something went wrong. Please retry.');
        setPhase('error');
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        return;
      }
      setPhase('done');
      // The form is the gate; clearing it is a small reward — take the
      // reader straight to the offer.
      document.getElementById('offer')?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      setError('Network error. Please retry.');
      setPhase('error');
    }
  }

  return (
    <section className="cs-section" id="qualify">
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          onLoad={mountTurnstile}
        />
      )}
      <div className="cs-kicker">·· 6 fields · ~40 seconds ··</div>
      <h2 className="cs-h2">
        Tell us what you watch.
        <br />
        We&apos;ll tell you if we&apos;re useful.
      </h2>
      <p className="cs-sub">
        Your details go to us and nowhere else. Pick your beat and we&apos;ll be honest
        about whether the live sensors cover it yet.
      </p>

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

        <div className="cs-field" style={{ marginBottom: 15 }}>
          <label>What describes you? *</label>
          <div className="cs-chips">
            {PERSONAS.map(([slug, label]) => (
              <button
                key={slug}
                type="button"
                className={persona === slug ? 'cs-chip cs-on' : 'cs-chip'}
                onClick={() => {
                  markStarted();
                  setPersona(slug);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="cs-field" style={{ marginBottom: 15 }}>
          <label>What would you point it at first? *</label>
          <div className="cs-chips">
            {THEATRES.map(([slug, label]) => (
              <button
                key={slug}
                type="button"
                className={theatres.includes(slug) ? 'cs-chip cs-on' : 'cs-chip'}
                onClick={() => toggleTheatre(slug)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="cs-frow">
          <div className="cs-field">
            <label htmlFor="cs-tools">What do you use today?</label>
            <input id="cs-tools" name="current_tools" type="text" placeholder="Bloomberg · Kpler · free OSINT · nothing" className="cs-inp" maxLength={200} />
          </div>
          <div className="cs-field" style={{ alignSelf: 'end' }}>
            <label className="cs-consent" htmlFor="cs-brief" style={{ textTransform: 'none', letterSpacing: 0 }}>
              <input id="cs-brief" name="wants_daily_brief" type="checkbox" /> Send me the daily brief
            </label>
          </div>
        </div>

        {turnstileSiteKey && <div ref={turnstileRef} style={{ margin: '6px 0 14px' }} />}

        <button type="submit" className="cs-btn" disabled={phase === 'submitting' || phase === 'done'}>
          {phase === 'done' ? '✓ Received — the offer is below' : phase === 'submitting' ? 'Sending…' : 'Get the founding offer →'}
        </button>
        {phase === 'error' && error && <div className="cs-formmsg cs-err">{error}</div>}
        {phase === 'done' && (
          <div className="cs-formmsg cs-good">
            ✓ You&apos;re in the pipeline. The founding offer is right below.
          </div>
        )}
      </form>
    </section>
  );
}
