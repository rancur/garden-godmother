'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getIrrigationUsage } from '../../api';

interface UsageEntry {
  zoneId?: string;
  zone_id?: string;
  zone_name?: string;
  gallons?: number;
  totalGallons?: number;
  duration?: number;
  totalDuration?: number;
  date?: string;
  [key: string]: unknown;
}

interface UsageResponse {
  usage: UsageEntry[] | Record<string, unknown>;
  days?: number;
  zone_names?: Record<string, string>;
  error?: string;
}

interface ZoneSummary {
  zone_name: string;
  total_gallons: number;
  total_minutes: number;
  run_count: number;
  avg_gallons_per_run: number;
  avg_minutes_per_run: number;
}

interface DailySummary {
  date: string;
  gallons: number;
  minutes: number;
}

function parseUsageData(data: UsageResponse): { zones: ZoneSummary[]; daily: DailySummary[]; totalGallons: number; totalMinutes: number } {
  const usageRaw = data.usage;
  const zoneNames = data.zone_names || {};
  const zoneMap: Record<string, { gallons: number; minutes: number; runs: number }> = {};
  const dailyMap: Record<string, { gallons: number; minutes: number }> = {};
  let totalGallons = 0;
  let totalMinutes = 0;

  const entries = Array.isArray(usageRaw) ? usageRaw : [];

  for (const entry of entries) {
    const zoneId = (entry.zoneId || entry.zone_id || 'unknown') as string;
    const zoneName = (entry.zone_name || zoneNames[zoneId] || zoneId) as string;
    const gallons = Number(entry.gallons || entry.totalGallons || 0);
    const durationSec = Number(entry.duration || entry.totalDuration || 0);
    const minutes = durationSec > 300 ? durationSec / 60 : durationSec; // heuristic: if > 300 assume seconds
    const dateStr = (entry.date || '').toString().slice(0, 10);

    if (!zoneMap[zoneName]) {
      zoneMap[zoneName] = { gallons: 0, minutes: 0, runs: 0 };
    }
    zoneMap[zoneName].gallons += gallons;
    zoneMap[zoneName].minutes += minutes;
    zoneMap[zoneName].runs += 1;
    totalGallons += gallons;
    totalMinutes += minutes;

    if (dateStr) {
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { gallons: 0, minutes: 0 };
      }
      dailyMap[dateStr].gallons += gallons;
      dailyMap[dateStr].minutes += minutes;
    }
  }

  const zones: ZoneSummary[] = Object.entries(zoneMap)
    .map(([name, d]) => ({
      zone_name: name,
      total_gallons: Math.round(d.gallons * 10) / 10,
      total_minutes: Math.round(d.minutes * 10) / 10,
      run_count: d.runs,
      avg_gallons_per_run: d.runs > 0 ? Math.round((d.gallons / d.runs) * 10) / 10 : 0,
      avg_minutes_per_run: d.runs > 0 ? Math.round((d.minutes / d.runs) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.total_gallons - a.total_gallons);

  const daily: DailySummary[] = Object.entries(dailyMap)
    .map(([date, d]) => ({
      date,
      gallons: Math.round(d.gallons * 10) / 10,
      minutes: Math.round(d.minutes * 10) / 10,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { zones, daily, totalGallons: Math.round(totalGallons * 10) / 10, totalMinutes: Math.round(totalMinutes * 10) / 10 };
}

function BarChart({ data, maxValue }: { data: { label: string; value: number }[]; maxValue: number }) {
  if (!data.length) return null;
  return (
    <div className="space-y-1">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2 text-sm">
          <span className="w-24 text-right text-gray-600 dark:text-gray-400 truncate" title={d.label}>{d.label}</span>
          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
            <div
              className="bg-blue-500 dark:bg-blue-400 h-5 rounded-full transition-all duration-300"
              style={{ width: `${maxValue > 0 ? (d.value / maxValue) * 100 : 0}%` }}
            />
          </div>
          <span className="w-20 text-right text-gray-700 dark:text-gray-300 font-mono text-xs">{d.value} gal</span>
        </div>
      ))}
    </div>
  );
}

export default function WaterUsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getIrrigationUsage(days)
      .then((res: UsageResponse) => {
        setData(res);
        if (res.error) setError(res.error);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  const parsed = data ? parseUsageData(data) : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Water Usage</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Rachio irrigation water consumption
          </p>
        </div>
        <Link href="/sensors" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Back to Sensors
        </Link>
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {[7, 14, 30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              days === d
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading usage data...</div>
      )}

      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {parsed && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Gallons</div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{parsed.totalGallons.toLocaleString()}</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Minutes</div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{parsed.totalMinutes.toLocaleString()}</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Zones Active</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{parsed.zones.length}</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Avg / Day</div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                {days > 0 ? Math.round((parsed.totalGallons / days) * 10) / 10 : 0} gal
              </div>
            </div>
          </div>

          {/* Per-zone breakdown */}
          {parsed.zones.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Per-Zone Breakdown</h2>
              <BarChart
                data={parsed.zones.map((z) => ({ label: z.zone_name, value: z.total_gallons }))}
                maxValue={Math.max(...parsed.zones.map((z) => z.total_gallons), 1)}
              />
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="pb-2 font-medium">Zone</th>
                      <th className="pb-2 font-medium text-right">Gallons</th>
                      <th className="pb-2 font-medium text-right">Minutes</th>
                      <th className="pb-2 font-medium text-right">Runs</th>
                      <th className="pb-2 font-medium text-right">Avg gal/run</th>
                      <th className="pb-2 font-medium text-right">Avg min/run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.zones.map((z) => (
                      <tr key={z.zone_name} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="py-2 text-gray-900 dark:text-gray-100 font-medium">{z.zone_name}</td>
                        <td className="py-2 text-right text-blue-600 dark:text-blue-400 font-mono">{z.total_gallons}</td>
                        <td className="py-2 text-right text-green-600 dark:text-green-400 font-mono">{z.total_minutes}</td>
                        <td className="py-2 text-right text-gray-700 dark:text-gray-300 font-mono">{z.run_count}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400 font-mono">{z.avg_gallons_per_run}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400 font-mono">{z.avg_minutes_per_run}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily trend */}
          {parsed.daily.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Daily Usage Trend</h2>
              <BarChart
                data={parsed.daily.map((d) => ({ label: d.date.slice(5), value: d.gallons }))}
                maxValue={Math.max(...parsed.daily.map((d) => d.gallons), 1)}
              />
            </div>
          )}

          {parsed.zones.length === 0 && !error && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              No water usage data for the last {days} days. Usage will appear here once Rachio reports irrigation runs.
            </div>
          )}
        </>
      )}
    </div>
  );
}
