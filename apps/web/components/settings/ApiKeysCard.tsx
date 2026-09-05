'use client';

import { useCallback, useEffect, useState } from 'react';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * API keys for the MCP server.
 *
 * The load-bearing constraint on this card: the plaintext key exists
 * for exactly one render. Only sha256(key) is stored (migration 117),
 * so there is no "show it again" — the UI has to make that obvious
 * BEFORE the key scrolls away, not apologise for it afterwards.
 *
 * Revocation is deliberately one click with a confirm, not a typed
 * DELETE like ClearHistoryCard. That card guards an irreversible data
 * wipe; this one cuts off a credential that may be leaking. Friction on
 * the wrong side of that trade is a security cost, not a safety one.
 */

interface KeyRow {
  id: string;
  key_prefix: string;
  label: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface Minted {
  key: string;
  key_prefix: string;
  label: string;
  endpoint: string;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : null;

export function ApiKeysCard() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [maxActive, setMaxActive] = useState<number>(10);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/keys', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load your keys.');
      const data = await res.json();
      setKeys(data.keys ?? []);
      setTier(data.tier ?? null);
      setDailyLimit(typeof data.daily_limit === 'number' ? data.daily_limit : null);
      if (typeof data.max_active_keys === 'number') setMaxActive(data.max_active_keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your keys.');
      // Deliberately NOT setKeys([]). An empty array renders "No keys
      // yet", which asserts a fact we do not have — the load failed, so
      // the number of keys is UNKNOWN. Leaving it null keeps the list
      // absent rather than confidently wrong, which is the same rule
      // the platform applies to a feed that cannot be read.
      setKeys(null);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (busy || label.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setLoadFailed(false);
    try {
      const res = await fetch('/api/mcp/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not create the key.');
      setMinted({
        key: data.key,
        key_prefix: data.key_prefix,
        label: data.label,
        endpoint: data.endpoint,
      });
      setLabel('');
      setCopied(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the key.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, prefix: string) {
    if (busy) return;
    if (
      !window.confirm(
        `Revoke ${prefix}…?\n\nAny client using this key stops working immediately. This cannot be undone — you would need to create a new key.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mcp/keys/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not revoke the key.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the key.');
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.key);
      setCopied(true);
    } catch {
      // Clipboard can be refused (permissions, insecure context). The
      // key is on screen and selectable, so this is not a dead end —
      // say so rather than silently doing nothing.
      setError('Could not copy automatically — select the key and copy it manually.');
    }
  }

  const active = (keys ?? []).filter((k) => !k.revoked_at);
  const revoked = (keys ?? []).filter((k) => k.revoked_at);
  const noAllowance = dailyLimit === 0;

  return (
    <SettingsCard
      title="MCP API Keys"
      description="Connect Claude, Cursor or your own agent to eYKON's live intelligence tools."
      error={error}
    >
      {noAllowance && (
        <div className="mb-4 rounded border border-eykon-rule bg-eykon-bg-void px-3 py-2 text-[12.5px] text-eykon-ink-faint">
          MCP access is included on paid plans. Your current plan
          {tier ? ` (${tier})` : ''} does not include it.{' '}
          <a className="text-eykon-teal underline" href="/pricing?from=mcp_keys">
            See plans
          </a>
        </div>
      )}

      {dailyLimit !== null && dailyLimit > 0 && (
        <p className="mb-4 text-[12.5px] text-eykon-ink-faint">
          Your plan{tier ? ` (${tier})` : ''} allows{' '}
          <strong className="text-eykon-ink">{dailyLimit} tool calls per day</strong>, resetting at
          00:00 UTC.
        </p>
      )}

      {/* The one and only sighting of the secret. */}
      {minted && (
        <div className="mb-5 rounded border border-eykon-teal/50 bg-eykon-teal/10 px-4 py-3">
          <p className="mb-2 text-[12.5px] font-semibold text-eykon-ink">
            Copy this key now — it will never be shown again.
          </p>
          <p className="mb-3 text-[12px] text-eykon-ink-faint">
            eYKON stores only a hash of it. If you lose it, revoke it and create another.
          </p>
          <code className="mb-3 block break-all rounded bg-eykon-bg-void px-3 py-2 font-mono text-[12px] text-eykon-ink">
            {minted.key}
          </code>
          <div className="flex items-center gap-2">
            <Button type="button" variant="eykon" size="eykonSm" onClick={copyKey}>
              {copied ? 'Copied' : 'Copy key'}
            </Button>
            <Button
              type="button"
              variant="eykonGhost"
              size="eykonSm"
              onClick={() => setMinted(null)}
            >
              I&apos;ve saved it
            </Button>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-eykon-ink-faint">
              How to connect
            </summary>
            <code className="mt-2 block break-all rounded bg-eykon-bg-void px-3 py-2 font-mono text-[11.5px] text-eykon-ink-dim">
              claude mcp add --transport http eykon {minted.endpoint} --header
              &quot;Authorization: Bearer {minted.key_prefix}…&quot;
            </code>
          </details>
        </div>
      )}

      {!noAllowance && (
        <div className="mb-5 flex items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="mcp-key-label"
              className="mb-1 block text-[12px] text-eykon-ink-faint"
            >
              Label — so you know which one to revoke later
            </label>
            <Input
              id="mcp-key-label"
              value={label}
              maxLength={80}
              placeholder="Claude Desktop — laptop"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
              disabled={busy || active.length >= maxActive}
            />
          </div>
          <Button
            type="button"
            variant="eykon"
            onClick={create}
            disabled={busy || label.trim().length === 0 || active.length >= maxActive}
          >
            Create key
          </Button>
        </div>
      )}

      {active.length >= maxActive && (
        <p className="mb-4 text-[12.5px] text-eykon-ink-faint">
          You have {maxActive} active keys — revoke one before creating another.
        </p>
      )}

      {loadFailed ? (
        <p className="text-[12.5px] text-eykon-ink-faint">
          Your existing keys could not be loaded, so none are listed. Any key you
          already created is still active.
        </p>
      ) : keys === null ? (
        <p className="text-[12.5px] text-eykon-ink-faint">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-[12.5px] text-eykon-ink-faint">
          No keys yet. Create one to connect an agent.
        </p>
      ) : (
        <ul className="divide-y divide-eykon-rule border-t border-eykon-rule">
          {[...active, ...revoked].map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] text-eykon-ink">{k.label}</span>
                  {k.revoked_at && (
                    <span className="shrink-0 rounded border border-eykon-rule px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-eykon-ink-faint">
                      Revoked
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11.5px] text-eykon-ink-faint">
                  {k.key_prefix}… · created {fmt(k.created_at)}
                  {k.revoked_at
                    ? ` · revoked ${fmt(k.revoked_at)}`
                    : k.last_used_at
                      ? ` · last used ${fmt(k.last_used_at)}`
                      : ' · never used'}
                </div>
              </div>
              {!k.revoked_at && (
                <Button
                  type="button"
                  variant="eykonDanger"
                  size="eykonSm"
                  disabled={busy}
                  onClick={() => revoke(k.id, k.key_prefix)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
