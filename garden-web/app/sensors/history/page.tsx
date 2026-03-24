'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  getSensorHistoryChart,
  getSensorHistoryDaily,
  getSensorHistory,
  getSensorHistorySummary,
} from '../../api';
import { formatGardenDateTime } from '../../timezone';

interface ChartData {
  labels: string[];
  values: number[];
  sensor_name: string;
  count: number;
}

interface DailyRow {
  day_start: string;
  value_min: number | null;
  value_max: number | null;
  value_avg: number | null;
  sample_count: number;
}

interface ReadingRow {
  sensor_type: string;
  sensor_name: string;
  value: number;
  unit: string | null;
  recorded_at: string;
}

interface SummaryData {
  raw_readings_count: number;
  hourly_aggregates_count: number;
  daily_aggregates_count: number;
  oldest_reading: string | null;
  newest_reading: string | null;
  latest_per_sensor: { sensor_type: string; sensor_name: string; value: number; unit: string | null; recorded_at: string }[];
}

const SENSOR_OPTIONS = [
  { value: 'temperature', label: 'Temperature', unit: 'F', color: '#ea580c' },
  { value: 'humidity', label: 'Humidity', unit: '%', color: '#2563eb' },
  { value: 'uv_index', label: 'UV Index', unit: '', color: '#7c3aed' },
  { value: 'wind_speed', label: 'Wind Speed', unit: 'mph', color: '#0d9488' },
  { value: 'solar_radiation', label: 'Solar Radiation', unit: 'W/m2', color: '#ca8a04' },
  { value: 'rain_today', label: 'Rain Today', unit: 'in', color: '#4f46e5' },
  { value: 'pressure', label: 'Pressure', unit: 'inHg', color: '#6b7280' },
  { value: 'west_planter_soil_moisture', label: 'West Planter Moisture', unit: '%', color: '#16a34a' },
  { value: 'north_planter_soil_moisture', label: 'North Planter Moisture', unit: '%', color: '#059669' },
  { value: 'peach_tree_soil_moisture', label: 'Peach Tree Moisture', unit: '%', color: '#65a30d' },
];

const TIME_RANGES = [
  { value: 24, label: '24h' },
  { value: 48, label: '48h' },
  { value: 168, label: '7d' },
];

const DAILY_RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

function SVGChart({ data, color, width = 700, height = 200 }: { data: ChartData; color: string; width?: number; height?: number }) {
  if (!data.values || data.values.length < 2) {
    return <div className="text-center text-gray-400 py-12">Not enough data points to chart</div>;
  }

  const values = data.values;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 50;
  const padY = 20;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  const points = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * chartW;
    const y = padY + chartH - ((v - min) / range) * chartH;
    return `${x},${y}`;
  }).join(' ');

  // Y-axis labels
  const ySteps = 5;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = min + (range * i) / ySteps;
    return { val: val.toFixed(1), y: padY + chartH - (i / ySteps) * chartH };
  });

  // X-axis labels (show ~6 time labels)
  const xCount = Math.min(6, data.labels.length);
  const xLabels = Array.from({ length: xCount }, (_, i) => {
    const idx = Math.round((i / (xCount - 1)) * (data.labels.length - 1));
    const raw = data.labels[idx];
    let label = raw;
    try {
      const d = new Date(raw);
      label = formatGardenDateTime(d.toISOString(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { /* keep raw */ }
    const x = padX + (idx / (data.labels.length - 1)) * chartW;
    return { label, x };
  });

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height + 30}`} className="w-full max-w-3xl" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={padX} y1={yl.y} x2={width - padX} y2={yl.y} stroke="#e5e7eb" strokeWidth="0.5" />
            <text x={padX - 6} y={yl.y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{yl.val}</text>
          </g>
        ))}
        {/* Data line */}
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {/* X labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={height + 18} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {xl.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export default function SensorHistoryPage() {
  const [sensor, setSensor] = useState('temperature');
  const [hours, setHours] = useState(24);
  const [dailyDays, setDailyDays] = useState(30);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [recentReadings, setRecentReadings] = useState<ReadingRow[]>([]);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const sensorInfo = SENSOR_OPTIONS.find(s => s.value === sensor) || SENSOR_OPTIONS[0];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [chart, daily, recent, summary] = await Promise.all([
        getSensorHistoryChart(sensor, hours).catch(() => null),
        getSensorHistoryDaily(sensor, dailyDays).catch(() => ({ data: [] })),
        getSensorHistory({ sensor_name: sensor, hours: 24 }).catch(() => ({ readings: [] })),
        getSensorHistorySummary().catch(() => null),
      ]);
      setChartData(chart);
      setDailyData(daily?.data || []);
      setRecentReadings(recent?.readings?.slice(0, 50) || []);
      setSummaryData(summary);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [sensor, hours, dailyDays]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-900 dark:text-gray-100">Sensor History</h1>
        <Link href="/sensors" className="text-garden-600 hover:text-garden-800 font-medium text-sm">
          Back to Live Sensors
        </Link>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 p-4 flex flex-wrap gap-4 items-center">
        <div>
          <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Sensor</label>
          <select
            value={sensor}
            onChange={e => setSensor(e.target.value)}
            className="border border-earth-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200"
          >
            {SENSOR_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Chart Range</label>
          <div className="flex gap-1">
            {TIME_RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setHours(r.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  hours === r.value
                    ? 'bg-garden-600 text-white'
                    : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Daily Summary</label>
          <div className="flex gap-1">
            {DAILY_RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setDailyDays(r.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  dailyDays === r.value
                    ? 'bg-garden-600 text-white'
                    : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="text-earth-500 dark:text-gray-400">Loading history...</div>
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100 mb-4">
              {sensorInfo.label} — Last {hours}h
              {chartData && chartData.count > 0 && (
                <span className="text-sm font-normal text-earth-400 ml-2">({chartData.count} readings)</span>
              )}
            </h2>
            {chartData && chartData.values.length > 1 ? (
              <>
                <SVGChart data={chartData} color={sensorInfo.color} />
                <div className="mt-3 flex gap-6 text-sm text-earth-500 dark:text-gray-400">
                  <span>Min: <strong>{Math.min(...chartData.values).toFixed(1)}</strong> {sensorInfo.unit}</span>
                  <span>Max: <strong>{Math.max(...chartData.values).toFixed(1)}</strong> {sensorInfo.unit}</span>
                  <span>Avg: <strong>{(chartData.values.reduce((a, b) => a + b, 0) / chartData.values.length).toFixed(1)}</strong> {sensorInfo.unit}</span>
                </div>
              </>
            ) : (
              <div className="text-center text-earth-400 dark:text-gray-500 py-12">
                No historical data available yet. Data recording starts automatically every 5 minutes.
              </div>
            )}
          </div>

          {/* Daily Summary Table */}
          {dailyData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100 mb-4">
                Daily Summary — {sensorInfo.label}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-earth-200 dark:border-gray-700 text-left text-earth-500 dark:text-gray-400">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3 text-right">Min</th>
                      <th className="py-2 px-3 text-right">Max</th>
                      <th className="py-2 px-3 text-right">Avg</th>
                      <th className="py-2 px-3 text-right">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyData.map(row => (
                      <tr key={row.day_start} className="border-b border-earth-100 dark:border-gray-700/50">
                        <td className="py-2 px-3 text-earth-700 dark:text-gray-300">{row.day_start}</td>
                        <td className="py-2 px-3 text-right text-earth-600 dark:text-gray-400">{row.value_min?.toFixed(1) ?? '--'}</td>
                        <td className="py-2 px-3 text-right text-earth-600 dark:text-gray-400">{row.value_max?.toFixed(1) ?? '--'}</td>
                        <td className="py-2 px-3 text-right font-medium text-earth-800 dark:text-gray-200">{row.value_avg?.toFixed(1) ?? '--'}</td>
                        <td className="py-2 px-3 text-right text-earth-400 dark:text-gray-500">{row.sample_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Readings Table */}
          {recentReadings.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100 mb-4">
                Recent Readings — {sensorInfo.label} (last 24h, max 50)
              </h2>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-gray-800">
                    <tr className="border-b border-earth-200 dark:border-gray-700 text-left text-earth-500 dark:text-gray-400">
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3 text-right">Value</th>
                      <th className="py-2 px-3">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentReadings.map((row, i) => (
                      <tr key={i} className="border-b border-earth-100 dark:border-gray-700/50">
                        <td className="py-1.5 px-3 text-earth-600 dark:text-gray-400 text-xs">
                          {(() => {
                            try { return formatGardenDateTime(row.recorded_at); } catch { return row.recorded_at; }
                          })()}
                        </td>
                        <td className="py-1.5 px-3 text-right font-medium text-earth-800 dark:text-gray-200">{row.value?.toFixed(2)}</td>
                        <td className="py-1.5 px-3 text-earth-400 dark:text-gray-500">{row.unit || sensorInfo.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Storage Summary */}
          {summaryData && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100 mb-4">Data Storage Summary</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div className="text-center p-3 bg-earth-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-2xl font-bold text-earth-800 dark:text-gray-200">{summaryData.raw_readings_count.toLocaleString()}</div>
                  <div className="text-earth-500 dark:text-gray-400 text-xs mt-1">Raw Readings</div>
                </div>
                <div className="text-center p-3 bg-earth-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-2xl font-bold text-earth-800 dark:text-gray-200">{summaryData.hourly_aggregates_count.toLocaleString()}</div>
                  <div className="text-earth-500 dark:text-gray-400 text-xs mt-1">Hourly Aggregates</div>
                </div>
                <div className="text-center p-3 bg-earth-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-2xl font-bold text-earth-800 dark:text-gray-200">{summaryData.daily_aggregates_count.toLocaleString()}</div>
                  <div className="text-earth-500 dark:text-gray-400 text-xs mt-1">Daily Aggregates</div>
                </div>
                <div className="text-center p-3 bg-earth-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-2xl font-bold text-earth-800 dark:text-gray-200">
                    {summaryData.latest_per_sensor?.length || 0}
                  </div>
                  <div className="text-earth-500 dark:text-gray-400 text-xs mt-1">Active Sensors</div>
                </div>
              </div>
              {summaryData.oldest_reading && (
                <div className="mt-3 text-xs text-earth-400 dark:text-gray-500">
                  Data range: {summaryData.oldest_reading} — {summaryData.newest_reading}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
