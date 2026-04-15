'use client';

// 7-day activity sparklines per domain
const DOMAINS = [
  { name: 'Conflict', color: '#FF4040', data: [12, 18, 15, 22, 31, 28, 19] },
  { name: 'Maritime', color: '#1E82FF', data: [340, 355, 310, 380, 420, 395, 410] },
  { name: 'Air Traffic', color: '#FFD200', data: [1200, 1150, 1300, 1250, 1400, 1350, 1280] },
  { name: 'Energy', color: '#00C864', data: [95, 92, 88, 91, 94, 89, 93] },
];

function Sparkline({ data, color, width = 120, height = 28 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current value dot */}
      {(() => {
        const lastX = width;
        const lastY = height - ((data[data.length - 1] - min) / range) * (height - 4) - 2;
        return <circle cx={lastX} cy={lastY} r="2.5" fill={color} />;
      })()}
    </svg>
  );
}

export default function ActivitySparklines() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const todayIdx = new Date().getDay();

  return (
    <div className="bg-eykon-card border border-eykon-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">7-Day Activity</h2>
        <span className="text-[10px] text-eykon-muted">Watched regions</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {DOMAINS.map(domain => {
          const current = domain.data[domain.data.length - 1];
          const prev = domain.data[domain.data.length - 2];
          const change = ((current - prev) / prev * 100).toFixed(0);
          const isUp = current > prev;

          return (
            <div key={domain.name} className="bg-eykon-dark/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-300">{domain.name}</span>
                <span className={`text-[10px] ${isUp ? 'text-red-400' : 'text-green-400'}`}>
                  {isUp ? '↑' : '↓'} {Math.abs(parseInt(change))}%
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-lg font-semibold text-white">{current.toLocaleString()}</span>
                <Sparkline data={domain.data} color={domain.color} />
              </div>
              <div className="text-[10px] text-eykon-muted mt-1">events this week</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
