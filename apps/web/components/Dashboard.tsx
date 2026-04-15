'use client';
import { useState, useEffect } from 'react';
import IntelligenceFeed from './dashboard/IntelligenceFeed';
import WatchlistPanel from './dashboard/WatchlistPanel';
import BriefingCard from './dashboard/BriefingCard';
import ActivitySparklines from './dashboard/ActivitySparklines';
import SuggestedQueries from './dashboard/SuggestedQueries';

export default function Dashboard() {
  return (
    <div className="h-full overflow-y-auto bg-eykon-dark p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Intelligence Dashboard</h1>
          <p className="text-sm text-eykon-muted mt-1">Personalised situational awareness — powered by Claude</p>
        </div>

        {/* Top Row: Sparklines + Briefing */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2">
            <ActivitySparklines />
          </div>
          <div>
            <BriefingCard />
          </div>
        </div>

        {/* Main Row: Feed + Watchlist */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Watchlist (sidebar) */}
          <div className="lg:col-span-1">
            <WatchlistPanel />
          </div>

          {/* Intelligence Feed (main area) */}
          <div className="lg:col-span-2">
            <IntelligenceFeed />
          </div>

          {/* Suggestions + Quick Actions */}
          <div className="lg:col-span-1">
            <SuggestedQueries />
          </div>
        </div>
      </div>
    </div>
  );
}
