'use client';
import WorkspaceNav from './WorkspaceNav';

interface Props {
  accent?: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Shared chrome for every workspace: header (eyebrow, title,
 * subtitle) + body slot + sticky workspace nav. Accent colour
 * drives the left border of the title and the scenario accents.
 */
export default function WorkspaceShell({ accent = 'var(--teal)', eyebrow, title, subtitle, children }: Props) {
  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 132px)' }}>
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{
          borderBottom: '1px solid var(--rule-soft)',
          background: 'var(--bg-navy)',
        }}
      >
        <div className="flex items-center gap-4">
          <span className="inline-block" style={{ width: 3, height: 28, background: accent }} />
          <div className="flex flex-col" style={{ gap: 3 }}>
            <span className="eyebrow">{eyebrow}</span>
            <span
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 18,
                letterSpacing: '0.04em',
                fontWeight: 500,
                color: 'var(--ink)',
              }}
            >
              {title}
            </span>
          </div>
        </div>
        {subtitle && (
          <span
            className="num-lg"
            style={{ fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.04em' }}
          >
            {subtitle}
          </span>
        )}
      </header>

      <div className="flex-1" style={{ minHeight: 0 }}>
        {children}
      </div>

      <WorkspaceNav orientation="horizontal" />
    </div>
  );
}
