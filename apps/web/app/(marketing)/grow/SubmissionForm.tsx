'use client';

import Script from 'next/script';
import { useState, useRef, type FormEvent } from 'react';

type State =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success' }
  | { phase: 'error'; message: string };

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; theme?: 'dark' | 'light' },
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

const FIELD_HINTS = {
  network_description: '100–1000 chars · who reaches you and how (audience size, professional context, channels)',
  why_eykon: '100–800 chars · what about eYKON resonates and what you would bring to the program',
};

type Props = {
  turnstileSiteKey: string | null;
};

export function SubmissionForm({ turnstileSiteKey }: Props) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const formRef = useRef<HTMLFormElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<string | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  function mountTurnstile() {
    if (!turnstileSiteKey || !turnstileRef.current || !window.turnstile) return;
    if (widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      callback: (token) => {
        tokenRef.current = token;
      },
      theme: 'dark',
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.phase === 'submitting') return;

    const formEl = formRef.current;
    if (!formEl) return;
    const data = new FormData(formEl);
    const payload = {
      full_name: String(data.get('full_name') ?? ''),
      primary_handle: String(data.get('primary_handle') ?? ''),
      professional_context: String(data.get('professional_context') ?? ''),
      network_description: String(data.get('network_description') ?? ''),
      why_eykon: String(data.get('why_eykon') ?? ''),
      preferred_contact_email: String(data.get('preferred_contact_email') ?? ''),
      turnstile_token: tokenRef.current,
    };

    setState({ phase: 'submitting' });
    try {
      const res = await fetch('/api/grow/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const code = body.error ?? `http_${res.status}`;
        setState({ phase: 'error', message: friendlyError(code) });
        return;
      }
      setState({ phase: 'success' });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'network error',
      });
    } finally {
      tokenRef.current = null;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  }

  if (state.phase === 'success') {
    return (
      <div
        style={{
          padding: '24px 28px',
          background: 'rgba(25, 208, 184, 0.08)',
          border: '1px solid rgba(25, 208, 184, 0.4)',
          borderRadius: 4,
          marginTop: 32,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            marginBottom: 8,
          }}
        >
          Submission received
        </div>
        <p style={{ color: 'var(--ink)', fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          Thanks. Every entry is reviewed by hand, usually within a week.
          A confirmation has been sent to your email; if it&apos;s not in
          the inbox, check spam.
        </p>
      </div>
    );
  }

  return (
    <>
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={mountTurnstile}
        />
      )}

      <form ref={formRef} onSubmit={onSubmit} style={{ marginTop: 32 }}>
        <FormField label="Full name" name="full_name" required maxLength={100} />
        <FormField
          label="Primary handle"
          name="primary_handle"
          required
          maxLength={200}
          placeholder="X / Substack / LinkedIn / podcast URL"
        />
        <FormField
          label="Professional context"
          name="professional_context"
          required
          maxLength={200}
          placeholder="Role and organisation"
        />
        <FormField
          label="Network description"
          name="network_description"
          required
          textarea
          minLength={100}
          maxLength={1000}
          rows={5}
          hint={FIELD_HINTS.network_description}
        />
        <FormField
          label="Why eYKON"
          name="why_eykon"
          required
          textarea
          minLength={100}
          maxLength={800}
          rows={4}
          hint={FIELD_HINTS.why_eykon}
        />
        <FormField
          label="Preferred contact email"
          name="preferred_contact_email"
          required
          type="email"
          maxLength={200}
        />

        {turnstileSiteKey && (
          <div ref={turnstileRef} style={{ margin: '20px 0' }} />
        )}

        {state.phase === 'error' && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              background: 'rgba(224, 93, 80, 0.1)',
              border: '1px solid rgba(224, 93, 80, 0.4)',
              color: 'var(--red, #d8654f)',
              borderRadius: 4,
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            {state.message}
          </div>
        )}

        <button
          type="submit"
          disabled={state.phase === 'submitting'}
          style={{
            background: 'var(--teal)',
            color: 'var(--bg-void)',
            border: '1px solid var(--teal-dim)',
            borderRadius: 2,
            padding: '12px 22px',
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontWeight: 600,
            cursor: state.phase === 'submitting' ? 'wait' : 'pointer',
            opacity: state.phase === 'submitting' ? 0.6 : 1,
          }}
        >
          {state.phase === 'submitting' ? 'Submitting…' : 'Submit for consideration'}
        </button>
      </form>
    </>
  );
}

function FormField({
  label,
  name,
  required,
  textarea,
  type,
  placeholder,
  rows,
  minLength,
  maxLength,
  hint,
}: {
  label: string;
  name: string;
  required?: boolean;
  textarea?: boolean;
  type?: string;
  placeholder?: string;
  rows?: number;
  minLength?: number;
  maxLength?: number;
  hint?: string;
}) {
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: 'var(--f-mono)',
    fontSize: 10.5,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--ink-dim)',
    marginBottom: 6,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--bg-raised)',
    border: '1px solid var(--rule)',
    color: 'var(--ink)',
    fontFamily: 'var(--f-body)',
    fontSize: 14,
    borderRadius: 2,
    boxSizing: 'border-box',
  };
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={labelStyle} htmlFor={name}>
        {label}
        {required && <span style={{ color: 'var(--teal)', marginLeft: 4 }}>·</span>}
      </label>
      {textarea ? (
        <textarea
          id={name}
          name={name}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          rows={rows ?? 4}
          placeholder={placeholder}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type ?? 'text'}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
      {hint && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--ink-faint)',
            fontFamily: 'var(--f-body)',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function friendlyError(code: string): string {
  if (code === 'rate_limit_email')
    return 'You already submitted recently. We review every entry; please wait for our reply rather than re-submitting.';
  if (code === 'rate_limit_ip')
    return 'Several submissions from this connection in the last 24 hours. Please try again tomorrow.';
  if (code === 'missing_token' || code.startsWith('verify_'))
    return 'Could not verify the challenge. Please reload and try again.';
  if (code === 'invalid_email') return 'That email address looks malformed.';
  if (code.startsWith('field_length:'))
    return `One field is too short or too long: ${code.slice('field_length:'.length)}.`;
  return `Something went wrong (${code}). Please try again or email support@eykon.ai.`;
}
