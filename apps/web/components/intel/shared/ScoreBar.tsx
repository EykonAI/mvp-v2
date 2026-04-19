interface Props {
  value: number; // 0..1
  width?: number;
  height?: number;
}

/** Horizontal score bar with three colour bands (teal / amber / red). */
export default function ScoreBar({ value, width = 120, height = 6 }: Props) {
  const clamped = Math.max(0, Math.min(1, value));
  const colour = clamped < 0.5 ? 'var(--teal)' : clamped < 0.75 ? 'var(--amber)' : 'var(--red)';
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        background: 'var(--bg-raised)',
        border: '1px solid var(--rule)',
      }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
    >
      <div
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          background: colour,
          transition: 'width 280ms ease',
        }}
      />
    </div>
  );
}
