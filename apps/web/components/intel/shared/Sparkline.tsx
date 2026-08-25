interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  min?: number;
  max?: number;
  /**
   * Accessible name. Omit for decorative sparklines (the default, and
   * correct for a repeated row ornament); supply it when the line is the
   * only place a trend is stated, and it becomes role="img".
   */
  label?: string;
  /**
   * Render fluid: the `width` prop becomes the viewBox coordinate space and
   * the element scales to its container. Off by default so the small inline
   * row sparklines keep their exact intrinsic size; on for the large ones,
   * which otherwise refuse to shrink and push their column off-screen.
   */
  responsive?: boolean;
}

export default function Sparkline({
  values,
  width = 88,
  height = 14,
  stroke = 'var(--teal)',
  strokeWidth = 1.25,
  fill,
  min,
  max,
  label,
  responsive = false,
}: Props) {
  const a11y = label
    ? ({ role: 'img' as const, 'aria-label': label })
    : ({ 'aria-hidden': true as const });

  if (!values.length) return <svg width={width} height={height} aria-hidden="true" />;
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const range = hi - lo || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((v - lo) / range) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      {...(responsive
        ? { width: '100%', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' }
        : { width, height })}
      height={height}
      {...a11y}
      style={{ display: 'block', maxWidth: '100%' }}
    >
      {fill && (
        <polygon
          fill={fill}
          stroke="none"
          points={`1,${height - 1} ${pts} ${width - 1},${height - 1}`}
        />
      )}
      <polyline fill="none" stroke={stroke} strokeWidth={strokeWidth} points={pts} />
    </svg>
  );
}
