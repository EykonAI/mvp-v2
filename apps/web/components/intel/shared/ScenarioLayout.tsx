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
 * and Cascade workspaces. 1px gutters, raised panels, 1440px min.
 */
export default function ScenarioLayout({ left, centre, right, leftWidth = 320, rightWidth = 360 }: Props) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `${leftWidth}px 1fr ${rightWidth}px`,
        gap: 1,
        background: 'var(--rule-soft)',
        minHeight: 620,
      }}
    >
      <aside style={{ background: 'var(--bg-navy)', padding: 16, overflowY: 'auto' }}>{left}</aside>
      <section style={{ background: 'var(--bg-navy)', padding: 16, minWidth: 0 }}>{centre}</section>
      <aside style={{ background: 'var(--bg-navy)', padding: 16, overflowY: 'auto' }}>{right}</aside>
    </div>
  );
}
