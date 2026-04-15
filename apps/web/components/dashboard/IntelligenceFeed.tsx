'use client';
import { useState, useEffect } from 'react';

interface Report {
  id: string;
  domain: string;
  severity: string;
  title: string;
  summary: string;
  narrative: string;
  sources: string[];
  created_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-red-500 bg-red-500/10',
  high: 'border-orange-500 bg-orange-500/10',
  medium: 'border-yellow-500 bg-yellow-500/10',
  low: 'border-eykon-border bg-eykon-card',
};

const SEVERITY_BADGES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-300',
  high: 'bg-orange-500/20 text-orange-300',
  medium: 'bg-yellow-500/20 text-yellow-300',
  low: 'bg-gray-500/20 text-gray-400',
};

const DOMAIN_ICONS: Record<string, string> = {
  maritime: '🚢',
  air_traffic: '✈️',
  conflict_security: '⚔️',
  energy_infrastructure: '⚡',
  satellite_imagery: '🛰️',
  briefing: '📋',
};

// Sample reports for demo when Supabase isn't connected
const SAMPLE_REPORTS: Report[] = [
  {
    id: '1', domain: 'maritime', severity: 'high',
    title: 'AIS Gap Detected — VLCC Tanker Near Strait of Hormuz',
    summary: 'A Very Large Crude Carrier (MMSI: 636092773) went dark for 3.5 hours within 40km of the Strait of Hormuz. Vessel last reported speed of 2.1 kts (unusually slow for transit).',
    narrative: 'AIS gap detected for VLCC tanker. Cross-referencing with ACLED data shows 2 maritime security incidents in the region within the past 72 hours.',
    sources: ['AIS Hub', 'ACLED'], created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    id: '2', domain: 'conflict_security', severity: 'critical',
    title: 'Escalation Alert — Red Sea / Gulf of Aden',
    summary: '14 new conflict events recorded in the Red Sea corridor in the past 48 hours, including 3 maritime-targeted attacks. Fatalities: 7. Shipping rerouting observed.',
    narrative: 'ACLED reports a significant uptick in Houthi-attributed maritime attacks targeting commercial vessels transiting Bab el-Mandeb.',
    sources: ['ACLED', 'AIS Hub'], created_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
  },
  {
    id: '3', domain: 'air_traffic', severity: 'medium',
    title: 'Unusual Military Aircraft Activity — Black Sea',
    summary: 'Elevated military transponder activity detected over the western Black Sea. 12 aircraft with military squawk codes tracked in the past 6 hours.',
    narrative: 'ADS-B data shows increased NATO surveillance flights along the Romanian and Bulgarian coastline.',
    sources: ['ADS-B Exchange', 'OpenSky'], created_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
  },
  {
    id: '4', domain: 'energy_infrastructure', severity: 'low',
    title: 'ENTSO-E: German Wind Generation Drop',
    summary: 'German wind power generation dropped 40% in the past 12 hours due to weather patterns. Gas-fired generation has increased proportionally.',
    narrative: 'Cross-border electricity flows from France and Denmark have increased to compensate.',
    sources: ['ENTSO-E', 'Open-Meteo'], created_at: new Date(Date.now() - 12 * 3600_000).toISOString(),
  },
];

export default function IntelligenceFeed() {
  const [reports, setReports] = useState<Report[]>(SAMPLE_REPORTS);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="bg-eykon-card border border-eykon-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">Intelligence Feed</h2>
        <span className="text-[10px] text-eykon-muted">{reports.length} reports</span>
      </div>

      <div className="space-y-3">
        {reports.map(report => (
          <div
            key={report.id}
            className={`border-l-2 rounded-r-lg p-3 cursor-pointer transition-all hover:brightness-110 ${SEVERITY_COLORS[report.severity]}`}
            onClick={() => setExpanded(expanded === report.id ? null : report.id)}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base shrink-0">{DOMAIN_ICONS[report.domain] || '📊'}</span>
                <h3 className="text-sm font-medium text-white truncate">{report.title}</h3>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${SEVERITY_BADGES[report.severity]}`}>
                {report.severity.toUpperCase()}
              </span>
            </div>

            {/* Summary */}
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{report.summary}</p>

            {/* Expanded narrative */}
            {expanded === report.id && (
              <div className="mt-3 pt-3 border-t border-eykon-border/50">
                <p className="text-xs text-gray-300 leading-relaxed">{report.narrative}</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex gap-1">
                    {report.sources.map(s => (
                      <span key={s} className="text-[10px] bg-eykon-dark px-1.5 py-0.5 rounded text-eykon-muted">{s}</span>
                    ))}
                  </div>
                  <button className="text-[10px] text-eykon-teal hover:underline">View on Map →</button>
                </div>
              </div>
            )}

            {/* Timestamp */}
            <div className="text-[10px] text-eykon-muted mt-2">
              {formatTimeAgo(report.created_at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
