'use client';

import { useEffect, useState } from 'react';
import { getCoopSummary } from '../api';

interface CoopSummary {
  active_peers: number;
  recent_alerts: number;
  harvest_offers: number;
  seed_swaps: number;
  my_active_offers: number;
}

export default function CoopSummaryWidget() {
  const [summary, setSummary] = useState<CoopSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCoopSummary().then((data) => {
      setSummary(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 tracking-wide uppercase">
          Community
        </h3>
        <a
          href="/coop"
          className="text-xs text-green-600 dark:text-green-400 hover:underline font-medium"
        >
          View Community →
        </a>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
          ))}
        </div>
      ) : summary === null ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Could not load community data.</p>
      ) : summary.active_peers === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">No peers connected yet.</p>
          <a
            href="/settings"
            className="text-xs text-green-600 dark:text-green-400 hover:underline font-medium"
          >
            Connect peers in Settings →
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <a
            href="/settings"
            className="flex flex-col items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {summary.active_peers}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Peers</span>
          </a>

          <a
            href="/pests"
            className="flex flex-col items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <span
              className={`text-xl font-bold ${
                summary.recent_alerts > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-800 dark:text-gray-100'
              }`}
            >
              {summary.recent_alerts}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Alerts</span>
          </a>

          <a
            href="/harvest"
            className="flex flex-col items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {summary.harvest_offers}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 text-center leading-tight">
              Surplus Available
            </span>
          </a>

          <a
            href="/seeds"
            className="flex flex-col items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {summary.seed_swaps}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Seed Swaps</span>
          </a>
        </div>
      )}
    </div>
  );
}
