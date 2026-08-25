'use client';

import { useId, useState } from 'react';

/**
 * ChartFigure — gives a hand-built SVG visualisation an accessible name,
 * a description, and an optional data-table alternative.
 *
 * Measured before this existed: 43 <svg> elements across 24 files, of
 * which 0 carried role="img", 0 a <title>, 0 a <desc> and 0 an
 * aria-label. For a product whose proposition is auditable evidence,
 * the evidence announced nothing at all to assistive technology.
 *
 * No component library supplies this. The template's own chart
 * primitive is 351 lines with zero accessibility affordances, so
 * adopting a library would not have closed the gap — this is
 * first-party work by necessity.
 *
 * Deliberately a *wrapper*: it does not touch the SVG it contains, so
 * the 21 bespoke visualisations keep their exact rendering. role="img"
 * makes the subtree presentational, so the chart's internal text nodes
 * stop being announced as loose fragments and the name/description
 * below are announced instead.
 */

export interface ChartTable {
  /** Column headers, left to right. */
  columns: string[];
  /** Row cells, aligned to columns. */
  rows: (string | number)[][];
}

export default function ChartFigure({
  title,
  desc,
  table,
  children,
  className,
  style,
}: {
  /** Short name for the chart, e.g. "Composite posture score by theatre". */
  title: string;
  /** What the chart shows — the trend or finding, not the encoding. */
  desc?: string;
  /** Optional tabular equivalent. Supply it wherever the data is small enough. */
  table?: ChartTable;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const titleId = `${id}-t`;
  const descId = `${id}-d`;
  const [open, setOpen] = useState(false);

  return (
    <figure className={className} style={{ margin: 0, ...style }}>
      <div role="img" aria-labelledby={titleId} aria-describedby={desc ? descId : undefined}>
        {children}
      </div>

      <span id={titleId} className="sr-only">{title}</span>
      {desc && <span id={descId} className="sr-only">{desc}</span>}

      {table && (
        <>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              background: 'none',
              border: '1px solid var(--teal-dim)',
              borderRadius: 3,
              padding: '2px 8px',
              marginTop: 8,
              cursor: 'pointer',
            }}
          >
            {open ? 'Hide data table' : 'Show data table'}
          </button>

          {open && (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginTop: 8,
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
              }}
            >
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  {table.columns.map(c => (
                    <th
                      key={c}
                      scope="col"
                      style={{
                        textAlign: 'left',
                        padding: '4px 6px',
                        borderBottom: '1px solid var(--rule)',
                        color: 'var(--ink-faint)',
                        fontWeight: 500,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontSize: 9.5,
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td
                        key={j}
                        style={{
                          padding: '4px 6px',
                          borderBottom: '1px solid var(--rule-soft)',
                          color: 'var(--ink)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </figure>
  );
}
