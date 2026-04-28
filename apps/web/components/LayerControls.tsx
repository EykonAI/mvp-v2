'use client';
import { CATEGORIES, type DataKey } from '@/lib/layer-config';
import type { LayerState } from '@/lib/types';

interface LayerControlsProps {
  dataState: Record<DataKey, LayerState>;
  sublayerVisible: Record<string, boolean>;
  sublayerCounts: Record<string, number>;
  expandedCategory: string | null;
  onToggleSublayer: (key: string) => void;
  onToggleCategory: (key: string) => void;
  onExpandCategory: (key: string | null) => void;
}

export default function LayerControls({
  dataState,
  sublayerVisible,
  sublayerCounts,
  expandedCategory,
  onToggleSublayer,
  onToggleCategory,
  onExpandCategory,
}: LayerControlsProps) {
  return (
    <div
      className="absolute top-4 right-4 z-40 flex flex-col gap-1.5"
      style={{ minWidth: 240, maxWidth: 280 }}
    >
      {CATEGORIES.map(cat => {
        const expanded = expandedCategory === cat.key;
        const live = cat.sublayers.filter(s => s.status === 'live');
        const totalCount = cat.sublayers.reduce(
          (n, s) => n + (sublayerCounts[s.key] ?? 0),
          0,
        );
        const allLiveOn = live.length > 0 && live.every(s => sublayerVisible[s.key]);
        const anyLiveOn = live.some(s => sublayerVisible[s.key]);
        const someOff = anyLiveOn && !allLiveOn;
        const dataKeys = Array.from(
          new Set(live.map(s => s.dataKey).filter(Boolean)),
        ) as DataKey[];
        const loading = dataKeys.some(k => dataState[k]?.loading);
        const error = dataKeys.some(k => dataState[k]?.error);

        return (
          <div key={cat.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: anyLiveOn ? 'rgba(15, 24, 42, 0.9)' : 'rgba(10, 18, 32, 0.6)',
                border: `1px solid ${anyLiveOn ? 'var(--rule)' : 'transparent'}`,
                color: anyLiveOn ? 'var(--ink)' : 'var(--ink-faint)',
                backdropFilter: 'blur(6px)',
                borderRadius: 2,
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                letterSpacing: '0.05em',
                opacity: anyLiveOn ? 1 : 0.6,
              }}
            >
              <button
                onClick={() => onExpandCategory(expanded ? null : cat.key)}
                aria-label={expanded ? 'Collapse category' : 'Expand category'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-dim)',
                  cursor: 'pointer',
                  padding: 0,
                  width: 12,
                  fontSize: 12,
                }}
              >
                {expanded ? '▾' : '▸'}
              </button>
              <button
                onClick={() => onToggleCategory(cat.key)}
                disabled={live.length === 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  letterSpacing: 'inherit',
                  flex: 1,
                  textAlign: 'left',
                  cursor: live.length === 0 ? 'default' : 'pointer',
                  padding: 0,
                }}
              >
                <span style={{ color: cat.color, width: 16, textAlign: 'center' }}>{cat.icon}</span>
                <span style={{ flex: 1 }}>
                  {cat.label}
                  {someOff && (
                    <span style={{ color: 'var(--ink-faint)', marginLeft: 6 }} title="Some sub-layers hidden">·</span>
                  )}
                </span>
                {loading ? (
                  <span style={{ color: 'var(--ink-faint)' }} className="animate-pulse">…</span>
                ) : error ? (
                  <span style={{ color: 'var(--red)' }} title="Fetch error">!</span>
                ) : (
                  <span style={{ color: 'var(--ink-faint)' }}>
                    {totalCount > 0 ? totalCount.toLocaleString() : '–'}
                  </span>
                )}
              </button>
            </div>

            {expanded && cat.sublayers.map(sub => {
              const visible = sublayerVisible[sub.key];
              const count = sublayerCounts[sub.key] ?? 0;
              const planned = sub.status === 'planned';
              return (
                <button
                  key={sub.key}
                  onClick={() => !planned && onToggleSublayer(sub.key)}
                  disabled={planned}
                  title={planned ? sub.comingSoon : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px 4px 32px',
                    background: visible ? 'rgba(15, 24, 42, 0.7)' : 'transparent',
                    border: 'none',
                    color: planned
                      ? 'var(--ink-ghost)'
                      : visible
                      ? 'var(--ink-dim)'
                      : 'var(--ink-faint)',
                    backdropFilter: 'blur(6px)',
                    borderRadius: 2,
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    cursor: planned ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      color: visible && !planned ? cat.color : 'var(--ink-ghost)',
                    }}
                  >
                    {planned ? '·' : visible ? '☑' : '☐'}
                  </span>
                  <span style={{ flex: 1 }}>{sub.label}</span>
                  {planned ? (
                    <span style={{ color: 'var(--ink-ghost)', fontSize: 10 }}>Soon</span>
                  ) : (
                    <span style={{ color: 'var(--ink-faint)' }}>
                      {count > 0 ? count.toLocaleString() : '–'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
