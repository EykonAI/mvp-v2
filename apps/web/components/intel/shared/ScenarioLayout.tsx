'use client';

interface Props {
  left: React.ReactNode;
  centre: React.ReactNode;
  right: React.ReactNode;
  leftWidth?: number;
  rightWidth?: number;
}

/**
 * Three-column scenario layout shared by the Chokepoint, Sanctions,
 * and Cascade workspaces. 1px gutters, raised panels.
 *
 * The columns live in the .intel-3col class rather than inline styles
 * because the layout has to collapse at narrow widths and a media query
 * has no inline form. Callers keep their own desktop proportions by
 * passing leftWidth / rightWidth through as CSS variables.
 */
export default function ScenarioLayout({ left, centre, right, leftWidth = 320, rightWidth = 360 }: Props) {
  return (
    <div
      className="intel-3col"
      style={{
        ['--intel-l' as string]: `${leftWidth}px`,
        ['--intel-r' as string]: `${rightWidth}px`,
        minHeight: 620,
      } as React.CSSProperties}
    >
      <aside style={{ background: 'var(--bg-navy)', padding: 16, overflowY: 'auto' }}>{left}</aside>
      <section style={{ background: 'var(--bg-navy)', padding: 16, minWidth: 0 }}>{centre}</section>
      <aside style={{ background: 'var(--bg-navy)', padding: 16, overflowY: 'auto' }}>{right}</aside>
    </div>
  );
}
