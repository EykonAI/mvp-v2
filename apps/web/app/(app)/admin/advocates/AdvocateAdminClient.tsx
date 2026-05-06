'use client';

import { useState, useTransition } from 'react';
import { nextStatesFor } from '@/lib/admin/advocate-transitions';
import type { AdvocateState } from '@/lib/auth/session';

export type CandidateRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  public_id: string;
  attributed_signups: number;
};

export type AdvocateRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  public_id: string;
  advocate_state: AdvocateState;
  advocate_invited_at: string | null;
  advocate_onboarded_at: string | null;
  advocate_terminated_at: string | null;
  rewardful_affiliate_id: string | null;
};

type Props = {
  advocates: AdvocateRow[];
  initialCandidates: CandidateRow[];
};

const STATE_LABEL: Record<AdvocateState, string> = {
  none: 'None',
  invited: 'Invited',
  active: 'Active',
  paused: 'Paused',
  terminated: 'Terminated',
};

const TRANSITION_LABEL: Record<AdvocateState, string> = {
  none: 'Decline',
  invited: 'Invite',
  active: 'Mark active',
  paused: 'Pause',
  terminated: 'Terminate',
};

export function AdvocateAdminClient({ advocates, initialCandidates }: Props) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [advocateRows, setAdvocateRows] = useState(advocates);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function transition(userId: string, to: AdvocateState) {
    setError(null);
    const res = await fetch('/api/admin/advocates/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, to }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    // Refetch the candidate list (some rows may have moved out of it)
    // and re-render advocates by walking the client-side state.
    startTransition(async () => {
      const r = await fetch('/api/admin/advocate-candidates');
      if (r.ok) {
        const body = (await r.json()) as { candidates: CandidateRow[] };
        setCandidates(body.candidates);
      }
      // Re-derive advocate rows by mutating local state. We don't
      // re-hit Supabase from the client — the page is a static render
      // hydrated with server data; mutation reflects optimistically.
      setAdvocateRows((prev) => {
        const moved = prev.find((p) => p.id === userId);
        if (moved) {
          return prev
            .filter((p) => p.id !== userId)
            .concat([{ ...moved, advocate_state: to }]);
        }
        // Coming up from candidates → invited.
        const candidate = candidates.find((c) => c.id === userId);
        if (!candidate) return prev;
        return prev.concat([
          {
            id: candidate.id,
            email: candidate.email,
            display_name: candidate.display_name,
            public_id: candidate.public_id,
            advocate_state: to,
            advocate_invited_at: to === 'invited' ? new Date().toISOString() : null,
            advocate_onboarded_at: to === 'active' ? new Date().toISOString() : null,
            advocate_terminated_at: to === 'terminated' ? new Date().toISOString() : null,
            rewardful_affiliate_id: null,
          },
        ]);
      });
    });
  }

  const grouped: Record<AdvocateState, AdvocateRow[]> = {
    none: [],
    invited: [],
    active: [],
    paused: [],
    terminated: [],
  };
  for (const row of advocateRows) grouped[row.advocate_state].push(row);

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 1100, margin: '0 auto' }}>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 24,
          color: 'var(--ink)',
          margin: '0 0 4px',
        }}
      >
        Advocate program · admin
      </h1>
      <p
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'var(--ink-dim)',
          margin: '0 0 24px',
        }}
      >
        Hand-curated. Invitations send the partnership document; the activation
        email carries the Rewardful payout-setup link.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'rgba(224, 93, 80, 0.1)',
            border: '1px solid rgba(224, 93, 80, 0.4)',
            color: 'var(--red, #d8654f)',
            borderRadius: 4,
            fontSize: 13,
            marginBottom: 18,
          }}
        >
          {error}
        </div>
      )}

      <Section title={`Candidates · ≥5 attributed signups in last 90 d (${candidates.length})`}>
        {candidates.length === 0 ? (
          <Empty label="No candidates above the 5-signup threshold yet." />
        ) : (
          <Table>
            <Header columns={['Name', 'Email', 'public_id', 'Signups (90d)', 'Action']} />
            {candidates.map((c) => (
              <Row key={c.id}>
                <Cell>{c.display_name ?? '—'}</Cell>
                <Cell mono>{c.email ?? '—'}</Cell>
                <Cell mono>{c.public_id}</Cell>
                <Cell mono align="right">
                  {c.attributed_signups}
                </Cell>
                <Cell>
                  <ActionButton
                    onClick={() => transition(c.id, 'invited')}
                    disabled={pending}
                  >
                    {TRANSITION_LABEL.invited}
                  </ActionButton>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      {(['invited', 'active', 'paused', 'terminated'] as const).map((state) => (
        <Section
          key={state}
          title={`${STATE_LABEL[state]} (${grouped[state].length})`}
        >
          {grouped[state].length === 0 ? (
            <Empty label={`No advocates in ${STATE_LABEL[state].toLowerCase()} state.`} />
          ) : (
            <Table>
              <Header
                columns={['Name', 'Email', 'public_id', 'Onboarded', 'Rewardful', 'Actions']}
              />
              {grouped[state].map((row) => (
                <Row key={row.id}>
                  <Cell>{row.display_name ?? '—'}</Cell>
                  <Cell mono>{row.email ?? '—'}</Cell>
                  <Cell mono>{row.public_id}</Cell>
                  <Cell mono>
                    {state === 'invited'
                      ? formatDay(row.advocate_invited_at)
                      : state === 'terminated'
                        ? formatDay(row.advocate_terminated_at)
                        : formatDay(row.advocate_onboarded_at)}
                  </Cell>
                  <Cell mono>{row.rewardful_affiliate_id ?? '—'}</Cell>
                  <Cell>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {nextStatesFor(state).map((next) => (
                        <ActionButton
                          key={next}
                          onClick={() => transition(row.id, next)}
                          disabled={pending}
                        >
                          {TRANSITION_LABEL[next]}
                        </ActionButton>
                      ))}
                    </div>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Section>
      ))}
    </div>
  );
}

// ─── Layout primitives (kept inline; admin is a one-off surface) ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          margin: '0 0 10px',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Header({ columns }: { columns: string[] }) {
  return (
    <tr>
      {columns.map((c) => (
        <th
          key={c}
          style={{
            textAlign: 'left',
            padding: '10px 14px',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            borderBottom: '1px solid var(--rule)',
            background: 'var(--bg-raised)',
          }}
        >
          {c}
        </th>
      ))}
    </tr>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>{children}</tr>;
}

function Cell({
  children,
  mono,
  align,
}: {
  children: React.ReactNode;
  mono?: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <td
      style={{
        padding: '10px 14px',
        fontFamily: mono ? 'var(--f-mono)' : 'var(--f-body)',
        fontSize: 12.5,
        color: 'var(--ink)',
        textAlign: align ?? 'left',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '4px 10px',
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        borderRadius: 2,
      }}
    >
      {children}
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px dashed var(--rule)',
        borderRadius: 4,
        padding: '14px 16px',
        fontFamily: 'var(--f-body)',
        fontSize: 12.5,
        color: 'var(--ink-faint)',
      }}
    >
      {label}
    </div>
  );
}

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}
