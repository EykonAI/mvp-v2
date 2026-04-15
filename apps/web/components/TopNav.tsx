'use client';

interface TopNavProps {
  mode: 'globe' | 'dashboard';
  onModeChange: (m: 'globe' | 'dashboard') => void;
  chatOpen: boolean;
  onChatToggle: () => void;
}

export default function TopNav({ mode, onModeChange, chatOpen, onChatToggle }: TopNavProps) {
  return (
    <nav className="h-12 bg-eykon-card border-b border-eykon-border flex items-center justify-between px-4 shrink-0 z-50">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {/* Eye icon */}
          <svg width="24" height="16" viewBox="0 0 24 16" fill="none" className="opacity-90">
            <path d="M12 0C5 0 0 8 0 8s5 8 12 8 12-8 12-8S19 0 12 0z" stroke="#1AB2A6" strokeWidth="1.5" fill="none"/>
            <circle cx="12" cy="8" r="3" stroke="#1AB2A6" strokeWidth="1.5" fill="none"/>
            <circle cx="12" cy="8" r="1" fill="#1AB2A6"/>
          </svg>
          <span className="text-white font-semibold text-sm tracking-wider">eYKON</span>
          <span className="text-eykon-teal text-xs font-medium">.ai</span>
        </div>
        <span className="text-eykon-muted text-xs hidden sm:inline">|</span>
        <span className="text-eykon-muted text-xs hidden sm:inline">Geopolitical Intelligence</span>
      </div>

      {/* Mode Switcher */}
      <div className="flex items-center gap-1 bg-eykon-dark rounded-lg p-0.5">
        <button
          onClick={() => onModeChange('globe')}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
            mode === 'globe'
              ? 'bg-eykon-teal/20 text-eykon-teal'
              : 'text-eykon-muted hover:text-white'
          }`}
        >
          Globe
        </button>
        <button
          onClick={() => onModeChange('dashboard')}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
            mode === 'dashboard'
              ? 'bg-eykon-teal/20 text-eykon-teal'
              : 'text-eykon-muted hover:text-white'
          }`}
        >
          Dashboard
        </button>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 pulse-dot" />
          <span className="text-xs text-eykon-muted">LIVE</span>
        </div>
        <button
          onClick={onChatToggle}
          className={`px-2.5 py-1 text-xs rounded-md border transition-all ${
            chatOpen
              ? 'border-eykon-teal/40 text-eykon-teal bg-eykon-teal/10'
              : 'border-eykon-border text-eykon-muted hover:text-white'
          }`}
        >
          AI Chat
        </button>
      </div>
    </nav>
  );
}
