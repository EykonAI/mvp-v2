'use client';
import { usePersona } from '@/components/intel/shell/PersonaContext';

/**
 * Persona-tailored quick-action list. Sits in the right rail below the
 * Persona Switcher and the Workspace Feed.
 */
export default function ContextualActions() {
  const { persona } = usePersona();
  const actions = ACTIONS[persona];
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      {actions.map(a => (
        <button
          key={a.label}
          type="button"
          style={{
            textAlign: 'left',
            padding: '8px 10px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule)',
            color: 'var(--ink)',
            fontFamily: 'var(--f-body)',
            fontSize: 11.5,
            borderRadius: 2,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: 'var(--teal)' }}>◆</span>
          <span style={{ flex: 1 }}>{a.label}</span>
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
            }}
          >
            {a.hint}
          </span>
        </button>
      ))}
    </div>
  );
}

const ACTIONS: Record<string, { label: string; hint: string }[]> = {
  analyst: [
    { label: 'Open Posture Shift (Red Sea)',         hint: 'Feature 1' },
    { label: 'Browse Convergence Feed',              hint: 'Feature 21' },
    { label: 'Draft analyst memo',                   hint: 'Claude' },
  ],
  journalist: [
    { label: 'Journalist lead board',                hint: 'Feature 15' },
    { label: 'Shadow Fleet evidence pack',           hint: 'Feature 2' },
    { label: 'Draft tweet + email pitch',            hint: 'Claude' },
  ],
  'day-trader': [
    { label: 'Trade-flow horizon (72h)',             hint: 'Feature 4' },
    { label: 'Run a Hormuz closure scenario',        hint: 'Feature 18' },
    { label: 'Energy stress panel',                  hint: 'Feature 6' },
  ],
  commodities: [
    { label: 'Commodities workspace',                hint: 'F3/F4/F6/F13' },
    { label: 'Minerals supply-risk index',           hint: 'Feature 3' },
    { label: 'Compliance review packet',             hint: 'Claude' },
  ],
  ngo: [
    { label: 'NGO access atlas',                     hint: 'Feature 16' },
    { label: 'Displacement flow predictor',          hint: 'Feature 7' },
    { label: 'Humanitarian corridor brief',          hint: 'Claude' },
  ],
  citizen: [
    { label: 'Today’s Citizen Brief',                hint: 'Feature 14' },
    { label: 'Plain-language region explainer',      hint: 'Claude' },
  ],
  corporate: [
    { label: 'Asset risk surface',                   hint: 'Feature 17' },
    { label: 'Supply-chain exposure',                hint: 'Cross-cut' },
    { label: 'Executive summary memo',               hint: 'Claude' },
  ],
};
