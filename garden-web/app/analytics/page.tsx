'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getWaterUsageAnalytics, getYieldComparison, getHistorySummary } from '../api';
import { CardSkeleton } from '../skeleton';
import { getPlantIcon } from '../plant-icons';
import { formatGardenDate } from '../timezone';

// ──────────── Water Analytics Types ────────────

interface ZoneUsage {
  zone_name: string;
  gallons: number;
  cost: number;
  planters: string[];
  ground_plants: string[];
}

interface DailyUsage {
  date: string;
  gallons: number;
}

interface WeeklyUsage {
  week_start: string;
  gallons: number;
}

interface WaterData {
  days: number;
  total_gallons: number;
  total_cost_estimate: number;
  previous_period_gallons: number;
  previous_period_cost_estimate: number;
  by_zone: ZoneUsage[];
  daily: DailyUsage[];
  weekly: WeeklyUsage[];
}

// ──────────── Yield Analytics Types ────────────

interface PlantYield {
  plant_id: number;
  plant_name: string;
  category: string;
  total_weight_oz: number;
  planting_count: number;
  avg_per_plant_oz: number;
}

interface BedYield {
  bed_id: number;
  bed_name: string;
  total_weight_oz: number;
  planting_count: number;
  sq_ft: number;
  oz_per_sqft: number;
}

interface VarietyYield {
  variety_id: number;
  variety_name: string;
  plant_name: string;
  total_weight_oz: number;
  planting_count: number;
  avg_per_plant_oz: number;
}

interface MethodData {
  method: string;
  planting_count: number;
  harvested_count: number;
  failed_count: number;
  total_weight_oz: number;
  success_rate: number;
}

interface SeasonYield {
  year: number;
  season: string;
  planting_count: number;
  total_weight_oz: number;
  harvested_count: number;
  failed_count: number;
  success_rate: number;
}

interface YieldData {
  by_plant: PlantYield[];
  by_bed: BedYield[];
  by_variety: VarietyYield[];
  by_method: MethodData[];
  by_season: SeasonYield[];
  top_performers: PlantYield[];
  worst_performers: PlantYield[];
}

const seasonLabel: Record<string, string> = {
  cool: 'Cool',
  warm: 'Warm',
  monsoon: 'Monsoon',
};

const methodLabel: Record<string, string> = {
  direct_sow: 'Direct Sow',
  seed_start_transplant: 'Seed Start + Transplant',
  unknown: 'Other / Unknown',
};

function formatDate(d: string) {
  return formatGardenDate(d + 'T00:00:00', { month: 'short', day: 'numeric' });
}

function formatWeek(d: string) {
  return `Week of ${formatGardenDate(d + 'T00:00:00', { month: 'short', day: 'numeric' })}`;
}

export default function AnalyticsPage() {
  const [section, setSection] = useState<'yield' | 'water'>('yield');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Analytics</h1>
        <div className="flex gap-1 bg-earth-100 dark:bg-gray-700 rounded-lg p-0.5">
          <button
            onClick={() => setSection('yield')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors font-medium ${section === 'yield' ? 'bg-white dark:bg-gray-600 text-earth-800 dark:text-gray-100 shadow-sm' : 'text-earth-500 dark:text-gray-400'}`}
          >
            Yield
          </button>
          <button
            onClick={() => setSection('water')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors font-medium ${section === 'water' ? 'bg-white dark:bg-gray-600 text-earth-800 dark:text-gray-100 shadow-sm' : 'text-earth-500 dark:text-gray-400'}`}
          >
            Water
          </button>
        </div>
      </div>

      {section === 'yield' ? <YieldSection /> : <WaterSection />}
    </div>
  );
}

// ──────────────────────────────────────────────
// YIELD SECTION
// ──────────────────────────────────────────────

function YieldSection() {
  const [data, setData] = useState<YieldData | null>(null);
  const [seasons, setSeasons] = useState<{ year: number; season: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'leaderboard' | 'beds' | 'varieties' | 'methods' | 'seasons'>('leaderboard');

  useEffect(() => {
    Promise.all([getYieldComparison(), getHistorySummary()])
      .then(([yieldData, summaryData]) => {
        setData(yieldData);
        setSeasons(summaryData.seasons || []);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CardSkeleton /><CardSkeleton /><CardSkeleton />
      </div>
    );
  }

  if (!data) {
    return <EmptyState message="Failed to load yield analytics data." />;
  }

  const maxPlantOz = data.by_plant.length > 0 ? Math.max(...data.by_plant.map(p => p.total_weight_oz)) : 1;
  const maxBedOzSqft = data.by_bed.length > 0 ? Math.max(...data.by_bed.map(b => b.oz_per_sqft)) : 1;
  const maxVarietyOz = data.by_variety.length > 0 ? Math.max(...data.by_variety.map(v => v.total_weight_oz)) : 1;

  const tabs = [
    { id: 'leaderboard' as const, label: 'Top Producers' },
    { id: 'beds' as const, label: 'Yield / Planter' },
    { id: 'varieties' as const, label: 'Varieties' },
    { id: 'methods' as const, label: 'Methods' },
    { id: 'seasons' as const, label: 'Seasons' },
  ];

  return (
    <div className="space-y-6">
      {seasons.length > 0 && (
        <div className="flex justify-end">
          <Link
            href={`/analytics/review/${seasons[0].year}/${seasons[0].season}`}
            className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-medium text-sm"
          >
            Latest Season Review
          </Link>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-garden-600 text-white'
                : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Top Producers */}
      {tab === 'leaderboard' && (
        <div className="space-y-6">
          {data.top_performers.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Top Producers (avg yield per plant)</h2>
              <div className="space-y-3">
                {data.top_performers.map((p, i) => (
                  <div key={p.plant_id} className="flex items-center gap-3">
                    <span className="text-lg font-bold text-earth-400 dark:text-gray-500 w-6 text-right">{i + 1}</span>
                    <span className="text-2xl">{getPlantIcon(p.plant_name, p.category)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <Link href={`/history/plant/${p.plant_id}`} className="font-medium text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 truncate">
                          {p.plant_name}
                        </Link>
                        <span className="text-sm font-medium text-garden-600 dark:text-garden-400 ml-2 whitespace-nowrap">
                          {(p.avg_per_plant_oz / 16).toFixed(1)} lbs/plant
                        </span>
                      </div>
                      <div className="h-2.5 bg-earth-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-garden-500 dark:bg-garden-600 rounded-full transition-all"
                          style={{ width: `${maxPlantOz > 0 ? (p.total_weight_oz / maxPlantOz) * 100 : 0}%` }}
                        />
                      </div>
                      <div className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                        {(p.total_weight_oz / 16).toFixed(1)} lbs total from {p.planting_count} planting{p.planting_count !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.worst_performers.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Lowest Yield (2+ plantings)</h2>
              <div className="space-y-3">
                {data.worst_performers.map((p) => (
                  <div key={p.plant_id} className="flex items-center gap-3">
                    <span className="text-2xl">{getPlantIcon(p.plant_name, p.category)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <Link href={`/history/plant/${p.plant_id}`} className="font-medium text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 truncate">
                          {p.plant_name}
                        </Link>
                        <span className="text-sm text-red-500 dark:text-red-400 ml-2 whitespace-nowrap">
                          {(p.avg_per_plant_oz / 16).toFixed(2)} lbs/plant
                        </span>
                      </div>
                      <div className="text-xs text-earth-400 dark:text-gray-500">
                        {(p.total_weight_oz / 16).toFixed(1)} lbs total from {p.planting_count} plantings
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.by_plant.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">All Plants by Total Yield</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-earth-500 dark:text-gray-400 border-b border-earth-200 dark:border-gray-700">
                      <th className="pb-2 pr-3">Plant</th>
                      <th className="pb-2 pr-3 text-right">Total (lbs)</th>
                      <th className="pb-2 pr-3 text-right">Plantings</th>
                      <th className="pb-2 pr-3 text-right">Avg/Plant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_plant.map(p => (
                      <tr key={p.plant_id} className="border-b border-earth-100 dark:border-gray-700/50">
                        <td className="py-2 pr-3">
                          <Link href={`/history/plant/${p.plant_id}`} className="text-garden-600 dark:text-garden-400 hover:underline">
                            {getPlantIcon(p.plant_name, p.category)} {p.plant_name}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-right font-medium text-earth-700 dark:text-gray-300">{(p.total_weight_oz / 16).toFixed(1)}</td>
                        <td className="py-2 pr-3 text-right text-earth-500 dark:text-gray-400">{p.planting_count}</td>
                        <td className="py-2 pr-3 text-right text-earth-500 dark:text-gray-400">{(p.avg_per_plant_oz / 16).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.by_plant.length === 0 && (
            <EmptyState message="No yield data yet. Log harvests to see plant performance comparisons." />
          )}
        </div>
      )}

      {/* Yield per Planter */}
      {tab === 'beds' && (
        <div className="space-y-6">
          {data.by_bed.length > 0 ? (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Yield per Square Foot</h2>
                <div className="space-y-3">
                  {[...data.by_bed].sort((a, b) => b.oz_per_sqft - a.oz_per_sqft).map(b => (
                    <div key={b.bed_id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <Link href={`/planters/${b.bed_id}`} className="font-medium text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 truncate">
                            {b.bed_name}
                          </Link>
                          <span className="text-sm font-medium text-garden-600 dark:text-garden-400 ml-2 whitespace-nowrap">
                            {(b.oz_per_sqft / 16).toFixed(2)} lbs/sqft
                          </span>
                        </div>
                        <div className="h-2.5 bg-earth-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all"
                            style={{ width: `${maxBedOzSqft > 0 ? (b.oz_per_sqft / maxBedOzSqft) * 100 : 0}%` }}
                          />
                        </div>
                        <div className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                          {(b.total_weight_oz / 16).toFixed(1)} lbs total | {b.sq_ft} sqft | {b.planting_count} plantings
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <EmptyState message="No planter yield data yet. Log harvests linked to plantings in your planters." />
          )}
        </div>
      )}

      {/* Variety Comparison */}
      {tab === 'varieties' && (
        <div className="space-y-6">
          {data.by_variety.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Variety Comparison</h2>
              <div className="space-y-3">
                {data.by_variety.map(v => (
                  <div key={v.variety_id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="truncate">
                          <span className="font-medium text-earth-800 dark:text-gray-100">{v.variety_name}</span>
                          <span className="text-xs text-earth-400 dark:text-gray-500 ml-2">({v.plant_name})</span>
                        </div>
                        <span className="text-sm font-medium text-garden-600 dark:text-garden-400 ml-2 whitespace-nowrap">
                          {(v.total_weight_oz / 16).toFixed(1)} lbs
                        </span>
                      </div>
                      <div className="h-2.5 bg-earth-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 dark:bg-purple-600 rounded-full transition-all"
                          style={{ width: `${maxVarietyOz > 0 ? (v.total_weight_oz / maxVarietyOz) * 100 : 0}%` }}
                        />
                      </div>
                      <div className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                        {v.planting_count} planting{v.planting_count !== 1 ? 's' : ''} | {(v.avg_per_plant_oz / 16).toFixed(2)} lbs avg/plant
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState message="No variety data yet. Assign varieties to plantings and log harvests to compare." />
          )}
        </div>
      )}

      {/* Method Comparison */}
      {tab === 'methods' && (
        <div className="space-y-6">
          {data.by_method.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Seed vs Transplant Success</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.by_method.filter(m => m.method !== 'unknown').map(m => (
                  <div key={m.method} className="p-4 rounded-lg bg-earth-50 dark:bg-gray-700/50 border border-earth-200 dark:border-gray-600">
                    <div className="text-sm font-medium text-earth-500 dark:text-gray-400 mb-1">
                      {methodLabel[m.method] || m.method}
                    </div>
                    <div className="text-2xl font-bold text-earth-800 dark:text-gray-100">{m.success_rate}%</div>
                    <div className="text-xs text-earth-400 dark:text-gray-500 mb-2">success rate</div>
                    <div className="h-2 bg-earth-200 dark:bg-gray-600 rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full ${m.success_rate >= 60 ? 'bg-green-500' : m.success_rate >= 30 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${m.success_rate}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div>
                        <div className="font-medium text-earth-700 dark:text-gray-300">{m.planting_count}</div>
                        <div className="text-earth-400 dark:text-gray-500">planted</div>
                      </div>
                      <div>
                        <div className="font-medium text-green-600 dark:text-green-400">{m.harvested_count}</div>
                        <div className="text-earth-400 dark:text-gray-500">harvested</div>
                      </div>
                      <div>
                        <div className="font-medium text-red-500 dark:text-red-400">{m.failed_count}</div>
                        <div className="text-earth-400 dark:text-gray-500">failed</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-earth-400 dark:text-gray-500 text-center">
                      {(m.total_weight_oz / 16).toFixed(1)} lbs total yield
                    </div>
                  </div>
                ))}
              </div>
              {data.by_method.some(m => m.method === 'unknown' && m.planting_count > 0) && (
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-3">
                  {data.by_method.find(m => m.method === 'unknown')?.planting_count || 0} plantings without a tracked method (use Lifecycle Planner for tracking).
                </p>
              )}
            </div>
          ) : (
            <EmptyState message="No method data yet. Use the Lifecycle Planner to track seed vs transplant methods." />
          )}
        </div>
      )}

      {/* Season Comparison */}
      {tab === 'seasons' && (
        <div className="space-y-6">
          {data.by_season.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Season Comparison</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-earth-500 dark:text-gray-400 border-b border-earth-200 dark:border-gray-700">
                      <th className="pb-2 pr-3">Season</th>
                      <th className="pb-2 pr-3 text-right">Plantings</th>
                      <th className="pb-2 pr-3 text-right">Harvested</th>
                      <th className="pb-2 pr-3 text-right">Failed</th>
                      <th className="pb-2 pr-3 text-right">Success</th>
                      <th className="pb-2 pr-3 text-right">Yield (lbs)</th>
                      <th className="pb-2 pr-3 text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_season.map(s => (
                      <tr key={`${s.year}-${s.season}`} className="border-b border-earth-100 dark:border-gray-700/50">
                        <td className="py-2 pr-3 font-medium text-earth-800 dark:text-gray-100">
                          {s.year} {seasonLabel[s.season] || s.season}
                        </td>
                        <td className="py-2 pr-3 text-right text-earth-500 dark:text-gray-400">{s.planting_count}</td>
                        <td className="py-2 pr-3 text-right text-green-600 dark:text-green-400">{s.harvested_count}</td>
                        <td className="py-2 pr-3 text-right text-red-500 dark:text-red-400">{s.failed_count}</td>
                        <td className="py-2 pr-3 text-right">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            s.success_rate >= 70 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
                            s.success_rate >= 40 ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' :
                            'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                          }`}>
                            {s.success_rate}%
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-medium text-earth-700 dark:text-gray-300">{(s.total_weight_oz / 16).toFixed(1)}</td>
                        <td className="py-2 pr-3 text-right">
                          <Link
                            href={`/analytics/review/${s.year}/${s.season}`}
                            className="text-garden-600 dark:text-garden-400 hover:underline text-xs font-medium"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState message="No season data yet. Add season and year to your plantings to enable season tracking." />
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// WATER SECTION (preserved from original)
// ──────────────────────────────────────────────

function WaterSection() {
  const [data, setData] = useState<WaterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');

  const load = useCallback(() => {
    setLoading(true);
    getWaterUsageAnalytics(days)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const maxBarValue = data
    ? viewMode === 'daily'
      ? Math.max(...(data.daily.map(d => d.gallons)), 1)
      : Math.max(...(data.weekly.map(w => w.gallons)), 1)
    : 1;

  const pctChange = data && data.previous_period_gallons > 0
    ? ((data.total_gallons - data.previous_period_gallons) / data.previous_period_gallons) * 100
    : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="px-3 py-1.5 text-sm border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : !data ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-8 text-center text-earth-500 dark:text-gray-400">
          Unable to load water usage data. Check that the API is running and irrigation events are being recorded.
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5">
              <div className="text-sm text-earth-500 dark:text-gray-400">Total Water Used</div>
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {data.total_gallons.toLocaleString()} <span className="text-base font-normal">gal</span>
              </div>
              {pctChange !== null && (
                <div className={`text-sm mt-1 ${pctChange > 0 ? 'text-red-500' : pctChange < 0 ? 'text-green-500' : 'text-earth-400'}`}>
                  {pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}% vs previous {days} days
                </div>
              )}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5">
              <div className="text-sm text-earth-500 dark:text-gray-400">Estimated Cost</div>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">
                ${data.total_cost_estimate.toFixed(2)}
              </div>
              <div className="text-sm text-earth-400 dark:text-gray-500 mt-1">
                @ $0.004/gal (Phoenix rate)
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5">
              <div className="text-sm text-earth-500 dark:text-gray-400">Previous Period</div>
              <div className="text-3xl font-bold text-earth-600 dark:text-gray-300 mt-1">
                {data.previous_period_gallons.toLocaleString()} <span className="text-base font-normal">gal</span>
              </div>
              <div className="text-sm text-earth-400 dark:text-gray-500 mt-1">
                ${data.previous_period_cost_estimate.toFixed(2)} estimated
              </div>
            </div>
          </div>

          {/* Usage Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-earth-700 dark:text-gray-200">Usage Over Time</h2>
              <div className="flex gap-1 bg-earth-100 dark:bg-gray-700 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('daily')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'daily' ? 'bg-white dark:bg-gray-600 text-earth-800 dark:text-gray-100 shadow-sm' : 'text-earth-500 dark:text-gray-400'}`}
                >
                  Daily
                </button>
                <button
                  onClick={() => setViewMode('weekly')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'weekly' ? 'bg-white dark:bg-gray-600 text-earth-800 dark:text-gray-100 shadow-sm' : 'text-earth-500 dark:text-gray-400'}`}
                >
                  Weekly
                </button>
              </div>
            </div>

            {viewMode === 'daily' && data.daily.length > 0 ? (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {data.daily.map((d) => (
                  <div key={d.date} className="flex items-center gap-3 text-sm">
                    <span className="w-16 text-earth-500 dark:text-gray-400 text-xs shrink-0">{formatDate(d.date)}</span>
                    <div className="flex-1 bg-earth-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
                      <div
                        className="bg-blue-500 dark:bg-blue-400 h-full rounded-full transition-all"
                        style={{ width: `${Math.max((d.gallons / maxBarValue) * 100, 1)}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-earth-600 dark:text-gray-300 text-xs shrink-0">{d.gallons} gal</span>
                  </div>
                ))}
              </div>
            ) : viewMode === 'weekly' && data.weekly.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {data.weekly.map((w) => (
                  <div key={w.week_start} className="flex items-center gap-3 text-sm">
                    <span className="w-28 text-earth-500 dark:text-gray-400 text-xs shrink-0">{formatWeek(w.week_start)}</span>
                    <div className="flex-1 bg-earth-100 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
                      <div
                        className="bg-blue-500 dark:bg-blue-400 h-full rounded-full transition-all"
                        style={{ width: `${Math.max((w.gallons / maxBarValue) * 100, 1)}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-earth-600 dark:text-gray-300 text-xs shrink-0">{w.gallons} gal</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-earth-400 dark:text-gray-500">
                No water usage data for this period. Irrigation events will appear here once Rachio runs are recorded.
              </div>
            )}
          </div>

          {/* Per-Zone Breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-earth-700 dark:text-gray-200 mb-4">Usage by Zone</h2>
            {data.by_zone.length > 0 ? (
              <div className="space-y-3">
                {data.by_zone.map((z) => (
                  <div key={z.zone_name} className="border border-earth-100 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-earth-700 dark:text-gray-200">{z.zone_name}</span>
                      <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">{z.gallons} gal / ${z.cost.toFixed(2)}</span>
                    </div>
                    {(z.planters.length > 0 || z.ground_plants.length > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {z.planters.map((p) => (
                          <span key={p} className="inline-block px-2 py-0.5 rounded-full bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 text-xs">
                            {p}
                          </span>
                        ))}
                        {z.ground_plants.map((gp) => (
                          <span key={gp} className="inline-block px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs">
                            {gp}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-earth-400 dark:text-gray-500">
                No zone data available. Assign irrigation zones to your planters and ground plants.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-8 text-center">
      <div className="text-3xl mb-3">{'\u{1F4CA}'}</div>
      <p className="text-earth-500 dark:text-gray-400">{message}</p>
    </div>
  );
}
