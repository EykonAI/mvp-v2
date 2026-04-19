'use client';
import type { LayerState } from '@/lib/types';

interface LayerControlsProps {
  layers: Record<string, LayerState>;
  onToggle: (name: string) => void;
}

const LAYER_META: Record<string, { label: string; color: string; icon: string }> = {
  aircraft:       { label: 'Aircraft',       color: 'var(--amber)', icon: '✈' },
  vessels:        { label: 'Vessels',        color: 'var(--teal)',  icon: '⚓' },
  conflicts:      { label: 'Conflicts',      color: 'var(--red)',   icon: '⚔' },
  infrastructure: { label: 'Infrastructure', color: 'var(--green)', icon: '⚡' },
};

export default function LayerControls({ layers, onToggle }: LayerControlsProps) {
  return (
    <div className="absolute top-4 right-4 z-40 flex flex-col gap-1.5">
      {Object.entries(layers).map(([name, state]) => {
        const meta = LAYER_META[name];
        if (!meta) return null;
        return (
          <button
            key={name}
            onClick={() => onToggle(name)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs transition-all"
            style={{
              background: state.visible ? 'rgba(15, 24, 42, 0.9)' : 'rgba(10, 18, 32, 0.6)',
              border: `1px solid ${state.visible ? 'var(--rule)' : 'transparent'}`,
              color: state.visible ? 'var(--ink)' : 'var(--ink-faint)',
              backdropFilter: 'blur(6px)',
              borderRadius: 2,
              fontFamily: 'var(--f-mono)',
              letterSpacing: '0.05em',
              opacity: state.visible ? 1 : 0.6,
            }}
          >
            <span style={{ color: meta.color }}>{meta.icon}</span>
            <span>{meta.label}</span>
            {state.loading && <span style={{ color: 'var(--ink-faint)' }} className="animate-pulse">…</span>}
            {state.error && <span style={{ color: 'var(--red)' }}>!</span>}
            {!state.loading && !state.error && state.count > 0 && (
              <span style={{ color: 'var(--ink-faint)', marginLeft: 'auto' }}>
                {state.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
