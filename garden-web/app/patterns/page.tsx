'use client';

import { useEffect, useState } from 'react';
import { getSeasonalPatterns, getAiInsights } from '../api';
import { CardSkeleton } from '../skeleton';

const MONTH_NAMES: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

interface PlantSuccess {
  planted: number;
  harvested: number;
  failed: number;
  success_rate: number;
}

interface PatternData {
  monthly_planting_activity: Record<string, number>;
  plant_success_rates: Record<string, PlantSuccess>;
  top_harvests: Record<string, number>;
  monthly_task_breakdown: Record<string, Record<string, number>>;
  total_plantings: number;
  total_harvests: number;
  total_tasks: number;
  overall_success_rate: number;
}

function rateColor(rate: number) {
  if (rate >= 75) return 'text-green-600 dark:text-green-400';
  if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function rateBg(rate: number) {
  if (rate >= 75) return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
  if (rate >= 50) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
  return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
}

export default function PatternsPage() {
  const [data, setData] = useState<PatternData | null>(null);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  useEffect(() => {
    getSeasonalPatterns()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const handleGenerateInsights = async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const result = await getAiInsights();
      setInsights(result.insights);
    } catch (e: unknown) {
      setInsightsError(e instanceof Error ? e.message : 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Garden Patterns</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Garden Patterns</h1>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-8 text-center">
          <p className="text-earth-500 dark:text-gray-400">Failed to load pattern data.</p>
        </div>
      </div>
    );
  }

  const successEntries = Object.entries(data.plant_success_rates);
  const harvestEntries = Object.entries(data.top_harvests);
  const monthlyActivity = Object.entries(data.monthly_planting_activity);
  const maxMonthly = monthlyActivity.length > 0 ? Math.max(...monthlyActivity.map(([, v]) => v)) : 1;
  const taskMonths = Object.entries(data.monthly_task_breakdown);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Garden Patterns</h1>
        <button
          onClick={handleGenerateInsights}
          disabled={insightsLoading}
          className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {insightsLoading ? 'Generating...' : 'Generate AI Insights'}
        </button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Plantings" value={data.total_plantings} />
        <StatCard label="Total Harvests" value={data.total_harvests} />
        <StatCard label="Completed Tasks" value={data.total_tasks} />
        <StatCard label="Success Rate" value={`${data.overall_success_rate}%`} highlight={data.overall_success_rate >= 50} />
      </div>

      {/* AI Insights */}
      {(insights || insightsError) && (
        <div className={`bg-white dark:bg-gray-800 rounded-xl border p-5 shadow-sm ${
          insightsError
            ? 'border-red-200 dark:border-red-800'
            : 'border-purple-200 dark:border-purple-800'
        }`}>
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-3 flex items-center gap-2">
            <span className="text-xl">&#x1F9E0;</span> AI Insights
          </h2>
          {insightsError ? (
            <p className="text-red-600 dark:text-red-400 text-sm">{insightsError}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-earth-700 dark:text-gray-300 whitespace-pre-wrap">
              {insights}
            </div>
          )}
        </div>
      )}

      {/* Plant Success Rates */}
      {successEntries.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Plant Success Rates</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-earth-500 dark:text-gray-400 border-b border-earth-100 dark:border-gray-700">
                  <th className="pb-2 font-medium">Plant</th>
                  <th className="pb-2 font-medium text-center">Planted</th>
                  <th className="pb-2 font-medium text-center">Succeeded</th>
                  <th className="pb-2 font-medium text-center">Failed</th>
                  <th className="pb-2 font-medium text-right">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {successEntries.map(([name, stats]) => (
                  <tr key={name} className="border-b border-earth-50 dark:border-gray-700/50 last:border-0">
                    <td className="py-2.5 font-medium text-earth-800 dark:text-gray-200">{name}</td>
                    <td className="py-2.5 text-center text-earth-600 dark:text-gray-400">{stats.planted}</td>
                    <td className="py-2.5 text-center text-green-600 dark:text-green-400">{stats.harvested}</td>
                    <td className="py-2.5 text-center text-red-600 dark:text-red-400">{stats.failed}</td>
                    <td className="py-2.5 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${rateBg(stats.success_rate)}`}>
                        {stats.success_rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly Planting Activity */}
      {monthlyActivity.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Monthly Planting Activity</h2>
          <div className="space-y-2">
            {monthlyActivity.map(([month, count]) => (
              <div key={month} className="flex items-center gap-3">
                <span className="w-10 text-sm font-medium text-earth-600 dark:text-gray-400 shrink-0">
                  {MONTH_NAMES[month] || month}
                </span>
                <div className="flex-1 h-6 bg-earth-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-garden-500 dark:bg-garden-600 rounded-full transition-all"
                    style={{ width: `${Math.max((count / maxMonthly) * 100, 4)}%` }}
                  />
                </div>
                <span className="w-8 text-sm text-right font-medium text-earth-700 dark:text-gray-300 shrink-0">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Performers */}
      {harvestEntries.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Top Performers by Harvest Weight</h2>
          <div className="space-y-3">
            {harvestEntries.map(([name, oz], i) => {
              const maxOz = harvestEntries[0]?.[1] || 1;
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-6 text-sm font-bold text-earth-400 dark:text-gray-500 shrink-0 text-right">
                    #{i + 1}
                  </span>
                  <span className="w-32 text-sm font-medium text-earth-800 dark:text-gray-200 truncate shrink-0">
                    {name}
                  </span>
                  <div className="flex-1 h-5 bg-earth-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 dark:bg-amber-600 rounded-full transition-all"
                      style={{ width: `${Math.max((oz / maxOz) * 100, 4)}%` }}
                    />
                  </div>
                  <span className="w-20 text-sm text-right font-medium text-earth-700 dark:text-gray-300 shrink-0">
                    {oz.toFixed(1)} oz
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly Task Breakdown */}
      {taskMonths.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Monthly Task Breakdown</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {taskMonths.map(([month, tasksMap]) => (
              <div key={month} className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3">
                <h3 className="text-sm font-semibold text-earth-700 dark:text-gray-300 mb-2">
                  {MONTH_NAMES[month] || month}
                </h3>
                <div className="space-y-1">
                  {Object.entries(tasksMap)
                    .sort(([, a], [, b]) => b - a)
                    .map(([taskType, count]) => (
                      <div key={taskType} className="flex justify-between text-xs">
                        <span className="text-earth-600 dark:text-gray-400 capitalize">
                          {taskType.replace(/_/g, ' ')}
                        </span>
                        <span className="font-medium text-earth-800 dark:text-gray-200">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {data.total_plantings === 0 && data.total_harvests === 0 && data.total_tasks === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-8 text-center">
          <p className="text-earth-500 dark:text-gray-400 text-lg mb-2">No garden data yet</p>
          <p className="text-earth-400 dark:text-gray-500 text-sm">
            Start adding plantings, logging harvests, and completing tasks to see seasonal patterns emerge here.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
      <div className="text-xs text-earth-500 dark:text-gray-400 font-medium uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? 'text-green-600 dark:text-green-400' : 'text-earth-800 dark:text-gray-100'}`}>
        {value}
      </div>
    </div>
  );
}
