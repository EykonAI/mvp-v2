'use client';
import { useState } from 'react';

interface WatchItem {
  id: string;
  name: string;
  type: 'region' | 'entity' | 'topic';
  active: boolean;
}

const SAMPLE_WATCHLIST: WatchItem[] = [
  { id: '1', name: 'Red Sea / Bab el-Mandeb', type: 'region', active: true },
  { id: '2', name: 'Strait of Hormuz', type: 'region', active: true },
  { id: '3', name: 'Black Sea', type: 'region', active: true },
  { id: '4', name: 'Taiwan Strait', type: 'region', active: false },
  { id: '5', name: 'AIS Dark Events', type: 'topic', active: true },
  { id: '6', name: 'Pipeline Disruptions', type: 'topic', active: true },
];

const TYPE_ICONS: Record<string, string> = {
  region: '📍',
  entity: '🔎',
  topic: '🏷️',
};

export default function WatchlistPanel() {
  const [items, setItems] = useState<WatchItem[]>(SAMPLE_WATCHLIST);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'region' | 'entity' | 'topic'>('region');

  const toggleItem = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, active: !i.active } : i));
  };

  const addItem = () => {
    if (!newName.trim()) return;
    setItems(prev => [...prev, {
      id: Date.now().toString(),
      name: newName.trim(),
      type: newType,
      active: true,
    }]);
    setNewName('');
    setShowAdd(false);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  return (
    <div className="bg-eykon-card border border-eykon-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Watchlist</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs text-eykon-teal hover:text-eykon-teal/80 transition-colors"
        >
          + Add
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mb-3 p-2 bg-eykon-dark rounded-lg space-y-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Region, entity, or topic..."
            className="w-full bg-eykon-panel border border-eykon-border rounded px-2 py-1 text-xs text-white placeholder-eykon-muted focus:outline-none focus:border-eykon-teal/50"
            onKeyDown={e => e.key === 'Enter' && addItem()}
          />
          <div className="flex gap-1">
            {(['region', 'entity', 'topic'] as const).map(t => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`text-[10px] px-2 py-0.5 rounded ${
                  newType === t ? 'bg-eykon-teal/20 text-eykon-teal' : 'text-eykon-muted hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
            <button onClick={addItem} className="ml-auto text-[10px] text-eykon-teal hover:underline">Save</button>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-1">
        {items.map(item => (
          <div
            key={item.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg group transition-all cursor-pointer ${
              item.active ? 'hover:bg-eykon-dark/50' : 'opacity-40 hover:opacity-70'
            }`}
            onClick={() => toggleItem(item.id)}
          >
            <span className="text-xs shrink-0">{TYPE_ICONS[item.type]}</span>
            <span className="text-xs text-gray-300 flex-1 truncate">{item.name}</span>
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.active ? 'bg-eykon-teal' : 'bg-gray-600'}`} />
            <button
              onClick={e => { e.stopPropagation(); removeItem(item.id); }}
              className="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Alert config summary */}
      <div className="mt-4 pt-3 border-t border-eykon-border/50">
        <div className="text-[10px] text-eykon-muted uppercase tracking-wider mb-2">Alert Settings</div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Frequency</span>
            <span className="text-gray-300">Daily digest</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Channels</span>
            <span className="text-gray-300">In-app, Email</span>
          </div>
        </div>
      </div>
    </div>
  );
}
