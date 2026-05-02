'use client';
import { useEffect, useState } from 'react';

// Channel-handle management for the Notification Center. Mounts on
// the /settings page above the Clear-history card. Handles:
//   • Listing the user's existing channels (verified + pending).
//   • Adding a new email or SMS channel — the API issues a 6-digit
//     code and the row stays unverified until the user enters it.
//   • Verifying with a code, resending the code (server-throttled
//     at one per 60 s), and deleting a channel.
//   • WhatsApp creation is disabled here in PR 4 — the opt-in flow
//     lands in PR 10.
//
// The component owns no state outside the channel list and an in-
// progress "verifying" pointer; submission and verification go
// through the server routes under /api/notifications/channels.

interface Channel {
  id: string;
  channel_type: 'email' | 'sms' | 'whatsapp';
  handle: string;
  label: string | null;
  verified_at: string | null;
  active: boolean;
  created_at: string;
}

interface CapStatus {
  period: string;
  tier: string;
  cap: number;
  count: number;
  soft_warn_at: number;
  hard_stop_at: number;
}

type FormState = {
  type: 'email' | 'sms' | 'whatsapp';
  handle: string;
  label: string;
};

const INITIAL_FORM: FormState = { type: 'email', handle: '', label: '' };

export function ChannelsCard() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [capStatus, setCapStatus] = useState<CapStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [creating, setCreating] = useState(false);
  const [pendingVerifyId, setPendingVerifyId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    void refresh();
    void refreshCapStatus();
  }, []);

  async function refreshCapStatus() {
    try {
      const r = await fetch('/api/notifications/cap-status', { cache: 'no-store' });
      if (!r.ok) return;
      const data = (await r.json()) as CapStatus;
      setCapStatus(data);
    } catch {
      // Cap status is informational; failure is non-fatal.
    }
  }

  async function refresh() {
    try {
      const r = await fetch('/api/notifications/channels', { cache: 'no-store' });
      if (!r.ok) {
        if (r.status === 403) setError('Channel management requires Pro or higher.');
        else setError(`Could not load channels (${r.status}).`);
        setChannels([]);
        return;
      }
      const data = await r.json();
      setChannels(data.channels ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
      setChannels([]);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/notifications/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_type: form.type,
          handle: form.handle,
          label: form.label,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.hint ?? data.error ?? `Create failed (${r.status}).`);
        return;
      }
      setForm(INITIAL_FORM);
      setPendingVerifyId(data.channel.id);
      setCode('');
      if (data.sendError) {
        setError(`Channel created but send failed: ${data.sendError}`);
      }
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingVerifyId) return;
    setVerifying(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/notifications/channels/${pendingVerifyId}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        },
      );
      const data = await r.json();
      if (!r.ok) {
        setError(humanizeVerifyError(data.error));
        return;
      }
      setPendingVerifyId(null);
      setCode('');
      await refresh();
    } finally {
      setVerifying(false);
    }
  }

  async function onResend(id: string) {
    setError(null);
    const r = await fetch(`/api/notifications/channels/${id}/resend`, {
      method: 'POST',
    });
    const data = await r.json();
    if (!r.ok) {
      if (data.error === 'rate_limited' && typeof data.retryAfterSeconds === 'number') {
        setError(`Wait ${data.retryAfterSeconds}s before resending.`);
      } else {
        setError(data.sendError ?? data.error ?? 'Resend failed.');
      }
      return;
    }
    setError(null);
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this channel? Any rule using it will silently drop the dispatch.')) {
      return;
    }
    setError(null);
    const r = await fetch(`/api/notifications/channels/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      setError(data.error ?? `Delete failed (${r.status}).`);
      return;
    }
    if (pendingVerifyId === id) {
      setPendingVerifyId(null);
      setCode('');
    }
    await refresh();
  }

  async function onToggleActive(channel: Channel) {
    const r = await fetch(`/api/notifications/channels/${channel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !channel.active }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      setError(data.error ?? `Update failed (${r.status}).`);
      return;
    }
    await refresh();
  }

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          marginBottom: 4,
        }}
      >
        Notification channels
      </div>
      <p style={{ color: 'var(--ink-faint)', fontSize: 12.5, marginBottom: 16 }}>
        Verified handles your alerts can fire to. WhatsApp arrives in a later release.
      </p>

      {capStatus && capStatus.cap > 0 && <CapBar status={capStatus} />}

      {error && (
        <div
          style={{
            background: 'rgba(224, 93, 80, 0.1)',
            border: '1px solid rgba(224, 93, 80, 0.4)',
            color: 'var(--red)',
            padding: '8px 12px',
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      {channels === null ? (
        <p style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>Loading…</p>
      ) : channels.length === 0 ? (
        <p style={{ color: 'var(--ink-faint)', fontSize: 12.5, marginBottom: 16 }}>
          No channels yet. Add one below.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
          {channels.map(c => (
            <li
              key={c.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr auto',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid var(--rule-soft)',
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10.5,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-dim)',
                }}
              >
                {c.channel_type}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.label ? <strong style={{ color: 'var(--ink)' }}>{c.label}</strong> : null}
                  {c.label ? ' · ' : null}
                  <span style={{ color: 'var(--ink-dim)' }}>{c.handle}</span>
                </div>
                <div style={{ marginTop: 2 }}>
                  <StatusPill verifiedAt={c.verified_at} active={c.active} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!c.verified_at && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingVerifyId(c.id);
                        setCode('');
                        setError(null);
                      }}
                      style={btnGhost}
                    >
                      Verify
                    </button>
                    <button type="button" onClick={() => void onResend(c.id)} style={btnGhost}>
                      Resend code
                    </button>
                  </>
                )}
                {c.verified_at && (
                  <button
                    type="button"
                    onClick={() => void onToggleActive(c)}
                    style={btnGhost}
                  >
                    {c.active ? 'Pause' : 'Resume'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onDelete(c.id)}
                  style={{ ...btnGhost, color: 'var(--red)' }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingVerifyId && (
        <form
          onSubmit={onVerify}
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            background: 'var(--bg-void)',
            border: '1px dashed var(--teal-deep)',
            borderRadius: 4,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>
            Enter the 6-digit code we sent.
          </span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={inputStyle}
            placeholder="000000"
          />
          <button type="submit" disabled={verifying || code.length !== 6} style={btnPrimary}>
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingVerifyId(null);
              setCode('');
            }}
            style={btnGhost}
          >
            Cancel
          </button>
        </form>
      )}

      {form.type === 'whatsapp' && <WhatsAppOptInHint />}

      <form
        onSubmit={onCreate}
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr 1fr auto',
          gap: 10,
          alignItems: 'end',
        }}
      >
        <label style={fieldLabel}>
          Type
          <select
            value={form.type}
            onChange={e =>
              setForm({ ...form, type: e.target.value as 'email' | 'sms' | 'whatsapp' })
            }
            style={inputStyle}
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label style={fieldLabel}>
          Handle
          <input
            type={form.type === 'email' ? 'email' : 'tel'}
            value={form.handle}
            onChange={e => setForm({ ...form, handle: e.target.value })}
            placeholder={form.type === 'email' ? 'you@example.com' : '+14155550123'}
            style={inputStyle}
            required
          />
        </label>
        <label style={fieldLabel}>
          Label (optional)
          <input
            value={form.label}
            onChange={e => setForm({ ...form, label: e.target.value })}
            placeholder="Work email"
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={creating || !form.handle} style={btnPrimary}>
          {creating ? 'Sending…' : 'Add channel'}
        </button>
      </form>
    </section>
  );
}

function WhatsAppOptInHint() {
  return (
    <div
      style={{
        background: 'rgba(25, 208, 184, 0.06)',
        border: '1px solid var(--teal-deep)',
        borderRadius: 4,
        padding: '10px 14px',
        marginBottom: 12,
        fontSize: 12.5,
        color: 'var(--ink-dim)',
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginBottom: 6,
        }}
      >
        WhatsApp opt-in required
      </div>
      Twilio enforces opt-in before any WhatsApp message can be delivered. <strong style={{ color: 'var(--ink)' }}>
        Before clicking &ldquo;Add channel&rdquo;</strong>, open WhatsApp on the phone you&#x2019;re
      registering and follow the opt-in prompt your administrator shared (in the Twilio sandbox this
      is a one-time &ldquo;join &lt;code&gt;&rdquo; message). If the verification message doesn&#x2019;t arrive, complete
      the opt-in and click <strong style={{ color: 'var(--ink)' }}>Resend code</strong>.
    </div>
  );
}

function CapBar({ status }: { status: CapStatus }) {
  const pct = Math.min(150, Math.round((status.count / Math.max(1, status.cap)) * 100));
  // Soft-warn band: 80–149 %. Hard stop: ≥150 %. Below 80 % is the
  // "nominal" band — teal fill, no callout.
  const band: 'nominal' | 'warn' | 'hard' =
    pct >= 150 ? 'hard' : pct >= 80 ? 'warn' : 'nominal';
  const fillColor =
    band === 'hard' ? 'var(--red)' : band === 'warn' ? 'var(--amber)' : 'var(--teal)';
  return (
    <div
      style={{
        background: 'var(--bg-void)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        padding: '10px 12px',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          marginBottom: 6,
        }}
      >
        <span>SMS · WhatsApp · {status.period}</span>
        <span style={{ color: band === 'nominal' ? 'var(--ink)' : fillColor }}>
          {status.count} / {status.cap}
          {band === 'hard' && ' · HARD STOP'}
          {band === 'warn' && ' · APPROACHING CAP'}
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          height: 6,
          background: 'var(--rule-soft)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(100, pct)}%`,
            height: '100%',
            background: fillColor,
            transition: 'width 200ms',
          }}
        />
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--ink-faint)',
          marginTop: 6,
          lineHeight: 1.5,
        }}
      >
        Soft-warn at {status.soft_warn_at} · hard-stop at {status.hard_stop_at}. Email is
        never capped.
      </div>
    </div>
  );
}

function StatusPill({ verifiedAt, active }: { verifiedAt: string | null; active: boolean }) {
  if (!verifiedAt) {
    return (
      <span style={pill('var(--amber)', 'rgba(212, 162, 76, 0.12)')}>Pending verification</span>
    );
  }
  if (!active) {
    return <span style={pill('var(--ink-dim)', 'rgba(152, 163, 181, 0.1)')}>Paused</span>;
  }
  return <span style={pill('var(--teal)', 'rgba(25, 208, 184, 0.12)')}>Verified</span>;
}

function pill(color: string, bg: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    background: bg,
    color,
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  };
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 3,
  padding: '6px 10px',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 13,
  outline: 'none',
};

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-faint)',
};

const btnPrimary: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '8px 14px',
  background: 'var(--teal)',
  color: 'var(--bg-void)',
  border: '1px solid var(--teal)',
  borderRadius: 2,
  cursor: 'pointer',
  fontWeight: 500,
};

const btnGhost: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '4px 10px',
  background: 'transparent',
  color: 'var(--ink-dim)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 2,
  cursor: 'pointer',
};

function humanizeVerifyError(code: string | undefined): string {
  switch (code) {
    case 'invalid_code_format':
      return 'Codes are 6 digits.';
    case 'code_mismatch':
      return 'That code does not match. Try again or resend.';
    case 'code_expired':
      return 'Code expired. Tap "Resend code" to get a new one.';
    case 'no_pending_code':
      return 'No code is pending. Resend to issue a new one.';
    case 'already_verified':
      return 'This channel is already verified.';
    case 'not_found':
      return 'Channel no longer exists.';
    default:
      return 'Verification failed.';
  }
}
