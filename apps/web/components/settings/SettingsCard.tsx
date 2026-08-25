import { cn } from '@/lib/utils';

/**
 * The settings panel shell.
 *
 * Nine settings surfaces each hand-rolled the same card — panel
 * background, 1px rule, 6px radius, 24/28 padding — as an inline style
 * object, along with its own eyebrow title and description. That is
 * roughly six style objects per card repeated nine times, and none of
 * them could carry a hover or focus state, because a pseudo-class has
 * no inline form.
 *
 * This is deliberately first-party rather than a shadcn `Card`: the
 * eyebrow/description pairing and the alert slot are eYKON's own
 * settings idiom, not a generic card.
 */
export function SettingsCard({
  title,
  description,
  error,
  children,
  className,
}: {
  /** Small uppercase eyebrow naming the card. */
  title: string;
  /** One line under the title. Optional. */
  description?: React.ReactNode;
  /** Error text; renders the alert band when present. */
  error?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'mb-6 rounded-md border border-eykon-rule bg-eykon-bg-panel px-7 py-6',
        className
      )}
    >
      <h2 className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-eykon-ink-dim">
        {title}
      </h2>
      {description && (
        <p className="mb-4 text-[12.5px] text-eykon-ink-faint">{description}</p>
      )}
      {error && <SettingsAlert>{error}</SettingsAlert>}
      {children}
    </section>
  );
}

/** Error band, shared so every settings surface reports failure the same way. */
export function SettingsAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-3 rounded border border-eykon-red/40 bg-eykon-red/10 px-3 py-2 text-[12.5px] text-eykon-red"
    >
      {children}
    </div>
  );
}
