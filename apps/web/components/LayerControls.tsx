'use client';
import type { LayerState } from '@/lib/types';

interface LayerControlsProps {
  layers: Record<string, LayerState>;
  onToggle: (name: string) => void;
}

const LAYER_META: Record<string, { label: string; color: string; icon: string }> = {
  aircraft: { label: 'Aircraft', color: 'text-yellow-400', icon: '✈' },
  vessels: { label: 'Vessels', color: 'text-blue-400', icon: '🚢' },
  conflicts: { label: 'Conflicts', color: 'text-red-400', icon: '⚔' },
  infrastructure: { label: 'Infrastructure', color: 'text-green-400', icon: '⚡' },
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
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              state.visible
                ? 'bg-eykon-card/90 border-eykon-border backdrop-blur-sm'
                : 'bg-eykon-dark/60 border-transparent opacity-50'
            }`}
          >
            <span className={meta.color}>{meta.icon}</span>
            <span className={state.visible ? 'text-gray-200' : 'text-gray-500'}>
              {meta.label}
            </span>
            {state.loading && <span className="text-eykon-muted animate-pulse">...</span>}
            {state.error && <span className="text-red-400">!</span>}
            {!state.loading && !state.error && state.count > 0 && (
              <span className="text-eykon-muted ml-auto">{state.count.toLocaleString()}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
