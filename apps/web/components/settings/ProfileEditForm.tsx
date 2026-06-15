'use client';
import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

// Owner edit form for the public COMM profile (settings/profile). Posts
// to /api/profile/update. Pseudonymous by design — display name is
// optional; the handle drives the /u/<handle> URL.

interface LinkRow {
  label: string;
  url: string;
}

export interface ProfileEditInitial {
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  cover_url: string;
  links: { label?: string; url?: string }[];
  profile_visibility: string;
  reputation_opt_in: boolean;
}

const BIO_MAX = 280;

const labelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--f-mono)',
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-dim)',
  marginBottom: 6,
};
const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 4,
  padding: '9px 12px',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 14,
};
const fieldWrap: CSSProperties = { marginBottom: 18 };
const hint: CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 5 };

function errorText(code: unknown): string {
  switch (code) {
    case 'handle_taken':
      return 'That handle is already taken.';
    case 'invalid_handle':
      return 'Handle must be 3–32 letters, numbers or underscores.';
    case 'invalid_bio':
      return `Bio must be ${BIO_MAX} characters or fewer.`;
    case 'invalid_avatar_url':
    case 'invalid_cover_url':
    case 'invalid_links':
      return 'Links must start with http:// or https://.';
    case 'unauthorized':
      return 'Please sign in again.';
    default:
      return 'Could not save — please try again.';
  }
}

export function ProfileEditForm({
  initial,
  publicId,
}: {
  initial: ProfileEditInitial;
  publicId: string;
}) {
  const router = useRouter();
  const [handle, setHandle] = useState(initial.handle);
  const [displayName, setDisplayName] = useState(initial.display_name);
  const [bio, setBio] = useState(initial.bio);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatar_url);
  const [coverUrl, setCoverUrl] = useState(initial.cover_url);
  const [visibility, setVisibility] = useState(initial.profile_visibility || 'public');
  const [repOptIn, setRepOptIn] = useState(initial.reputation_opt_in);
  const [links, setLinks] = useState<LinkRow[]>(() => {
    const rows = (initial.links ?? []).map((l) => ({ label: l.label ?? '', url: l.url ?? '' }));
    while (rows.length < 3) rows.push({ label: '', url: '' });
    return rows.slice(0, 3);
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function setLink(i: number, patch: Partial<LinkRow>) {
    setLinks((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const payload = {
      handle: handle.trim() || null,
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatarUrl.trim() || null,
      cover_url: coverUrl.trim() || null,
      profile_visibility: visibility,
      reputation_opt_in: repOptIn,
      links: links
        .filter((l) => l.url.trim())
        .map((l) => ({ label: l.label.trim() || l.url.trim(), url: l.url.trim() })),
    };
    try {
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) setMsg({ ok: false, text: errorText(json?.error) });
      else {
        setMsg({ ok: true, text: 'Saved.' });
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: 'Network error — please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div style={fieldWrap}>
        <label style={labelStyle} htmlFor="handle">
          Handle
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--f-mono)', fontSize: 14 }}>
            eykon.ai/u/
          </span>
          <input
            id="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={publicId || 'your_handle'}
            style={{ ...inputStyle, flex: 1 }}
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <div style={hint}>3–32 letters, numbers or underscores. Leave blank to keep the default /u/{publicId} link.</div>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle} htmlFor="display_name">
          Display name <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional — a pen name is fine)</span>
        </label>
        <input
          id="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          style={inputStyle}
        />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle} htmlFor="bio">
          Bio
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <div style={hint}>{bio.length}/{BIO_MAX}</div>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ ...fieldWrap, flex: 1 }}>
          <label style={labelStyle} htmlFor="avatar_url">
            Avatar URL
          </label>
          <input id="avatar_url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
        </div>
        <div style={{ ...fieldWrap, flex: 1 }}>
          <label style={labelStyle} htmlFor="cover_url">
            Cover URL
          </label>
          <input id="cover_url" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
        </div>
      </div>

      <div style={fieldWrap}>
        <span style={labelStyle}>Links</span>
        {links.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              value={row.label}
              onChange={(e) => setLink(i, { label: e.target.value })}
              placeholder="Label (e.g. X)"
              maxLength={40}
              style={{ ...inputStyle, flex: '0 0 160px' }}
            />
            <input
              value={row.url}
              onChange={(e) => setLink(i, { url: e.target.value })}
              placeholder="https://…"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ ...fieldWrap, flex: 1 }}>
          <label style={labelStyle} htmlFor="visibility">
            Profile visibility
          </label>
          <select id="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)} style={inputStyle}>
            <option value="public">Public — anyone can view</option>
            <option value="members">Members — signed-in users only</option>
            <option value="private">Private — hidden</option>
          </select>
        </div>
        <label style={{ ...fieldWrap, flex: 1, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={repOptIn} onChange={(e) => setRepOptIn(e.target.checked)} />
          <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>Show my Calibration Passport publicly</span>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            border: '1px solid var(--teal-dim)',
            borderRadius: 3,
            padding: '10px 22px',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {msg && (
          <span style={{ fontSize: 13, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</span>
        )}
      </div>
    </form>
  );
}
