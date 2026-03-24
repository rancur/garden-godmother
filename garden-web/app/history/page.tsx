'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getHistorySummary, getRecentNotes, getLessons } from '../api';
import { getPlantIcon } from '../plant-icons';
import { noteTypeIcons } from '../constants';
import { formatGardenDate } from '../timezone';

interface HistorySummary {
  total_seasons_tracked: number;
  seasons: { year: number; season: string }[];
  total_plants_grown: number;
  status_counts: Record<string, number>;
  total_harvest_weight_oz: number;
  best_by_yield: { id: number; name: string; category: string; total_oz: number; plantings: number }[];
  most_reliable: { id: number; name: string; category: string; total: number; harvested: number; success_rate: number }[];
  plants_to_avoid: { id: number; name: string; category: string; total: number; failed: number; failure_rate: number }[];
  busiest_month: number | null;
  season_summaries: any[];
}

interface RecentNote {
  id: number;
  planting_id: number;
  plant_id: number;
  plant_name: string;
  plant_category: string;
  bed_name: string | null;
  note_type: string;
  content: string;
  severity: string;
  recorded_at: string;
}

interface LessonsData {
  season_lessons: { year: number; season: string; lessons: string }[];
  planting_lessons: RecentNote[];
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const seasonLabel: Record<string, string> = {
  cool: 'Cool Season',
  warm: 'Warm Season',
  monsoon: 'Monsoon',
};

const seasonColor: Record<string, string> = {
  cool: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  warm: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700',
  monsoon: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700',
};

const noteTypeIcon = noteTypeIcons;

export default function HistoryPage() {
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [notes, setNotes] = useState<RecentNote[]>([]);
  const [lessons, setLessons] = useState<LessonsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getHistorySummary(),
      getRecentNotes(20),
      getLessons(),
    ]).then(([s, n, l]) => {
      setSummary(s);
      setNotes(Array.isArray(n) ? n : []);
      setLessons(l);
    }).catch(() => {
      setSummary(null);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-lg text-earth-500 dark:text-gray-400">Loading garden history...</div>
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-12 text-earth-500 dark:text-gray-400">Failed to load history data.</div>;
  }

  const totalPlantings = Object.values(summary.status_counts).reduce((a, b) => a + b, 0);
  const lbs = (summary.total_harvest_weight_oz / 16).toFixed(1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">Garden History</h1>
        <p className="text-earth-500 dark:text-gray-400 mt-1">Learning from past seasons to grow better</p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Seasons Tracked" value={summary.total_seasons_tracked} />
        <StatCard label="Plants Grown" value={summary.total_plants_grown} />
        <StatCard label="Total Plantings" value={totalPlantings} />
        <StatCard label="Total Harvest" value={`${lbs} lbs`} />
      </div>

      {/* Status Breakdown */}
      {totalPlantings > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-3">Planting Outcomes</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(summary.status_counts).map(([status, count]) => (
              <span key={status} className="px-3 py-1.5 rounded-full text-sm font-medium bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300">
                {status}: {count}
              </span>
            ))}
          </div>
          {summary.busiest_month && (
            <p className="mt-3 text-sm text-earth-500 dark:text-gray-400">
              Busiest planting month: <span className="font-medium text-earth-700 dark:text-gray-200">{monthNames[summary.busiest_month - 1]}</span>
            </p>
          )}
        </div>
      )}

      {/* Top Performers */}
      {summary.best_by_yield.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Top Performers (by Yield)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.best_by_yield.map((p, i) => (
              <Link
                key={p.id}
                href={`/history/plant/${p.id}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 hover:border-green-400 dark:hover:border-green-600 transition-colors"
              >
                <span className="text-2xl">{getPlantIcon(p.name, p.category)}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-earth-800 dark:text-gray-100 truncate">{i + 1}. {p.name}</div>
                  <div className="text-sm text-earth-500 dark:text-gray-400">
                    {(p.total_oz / 16).toFixed(1)} lbs from {p.plantings} planting{p.plantings !== 1 ? 's' : ''}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Most Reliable */}
      {summary.most_reliable.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Most Reliable</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.most_reliable.map((p) => (
              <Link
                key={p.id}
                href={`/history/plant/${p.id}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors"
              >
                <span className="text-2xl">{getPlantIcon(p.name, p.category)}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-earth-800 dark:text-gray-100 truncate">{p.name}</div>
                  <div className="text-sm text-earth-500 dark:text-gray-400">
                    {p.success_rate}% success ({p.harvested}/{p.total})
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Plants to Avoid */}
      {summary.plants_to_avoid.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Plants to Reconsider</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.plants_to_avoid.map((p) => (
              <Link
                key={p.id}
                href={`/history/plant/${p.id}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 hover:border-red-400 dark:hover:border-red-600 transition-colors"
              >
                <span className="text-2xl">{getPlantIcon(p.name, p.category)}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-earth-800 dark:text-gray-100 truncate">{p.name}</div>
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {p.failure_rate}% failure rate ({p.failed}/{p.total})
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Season Timeline */}
      {summary.seasons.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Season Timeline</h2>
          <div className="flex flex-wrap gap-2">
            {summary.seasons.map((s, i) => (
              <Link
                key={i}
                href={`/history/season/${s.year}/${s.season}`}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors hover:opacity-80 ${seasonColor[s.season] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
              >
                {s.year} {seasonLabel[s.season] || s.season}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Lessons Learned Feed */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Lessons Learned</h2>

        {lessons && lessons.season_lessons.length > 0 && (
          <div className="mb-4 space-y-2">
            {lessons.season_lessons.map((l, i) => (
              <div key={i} className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                  {l.year} {seasonLabel[l.season] || l.season}
                </div>
                <div className="text-sm text-earth-700 dark:text-gray-300">{l.lessons}</div>
              </div>
            ))}
          </div>
        )}

        {lessons && lessons.planting_lessons.length > 0 && (
          <div className="space-y-2">
            {lessons.planting_lessons.slice(0, 10).map((n) => (
              <div key={n.id} className="flex items-start gap-2 p-3 rounded-lg bg-earth-50 dark:bg-gray-700/50">
                <span className="text-lg flex-shrink-0">{noteTypeIcon[n.note_type] || '\u{1F4DD}'}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-earth-700 dark:text-gray-200">
                    <Link href={`/plants?highlight=${n.plant_id}`} className="hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                      {n.plant_name}
                    </Link>
                    {n.bed_name ? <> in <span className="text-earth-500 dark:text-gray-400">{n.bed_name}</span></> : ''}
                  </div>
                  <div className="text-sm text-earth-600 dark:text-gray-400">{n.content}</div>
                  <div className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                    {formatGardenDate(n.recorded_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(!lessons || (lessons.season_lessons.length === 0 && lessons.planting_lessons.length === 0)) && (
          <p className="text-sm text-earth-400 dark:text-gray-500">No lessons recorded yet. Add notes to your plantings to build knowledge!</p>
        )}
      </div>

      {/* Recent Notes */}
      {notes.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Recent Notes</h2>
          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="flex items-start gap-2 p-3 rounded-lg bg-earth-50 dark:bg-gray-700/50">
                <span className="text-lg flex-shrink-0">{noteTypeIcon[n.note_type] || '\u{1F4DD}'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/plants?highlight=${n.plant_id}`} className="text-sm font-medium text-earth-700 dark:text-gray-200 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                      {n.plant_name}
                    </Link>
                    {n.bed_name && <span className="text-xs text-earth-400 dark:text-gray-500">in {n.bed_name}</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      n.severity === 'critical' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' :
                      n.severity === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' :
                      'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                    }`}>
                      {n.note_type.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-sm text-earth-600 dark:text-gray-400 mt-0.5">{n.content}</div>
                  <div className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                    {formatGardenDate(n.recorded_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalPlantings === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">{'\u{1F331}'}</div>
          <h3 className="text-lg font-medium text-earth-700 dark:text-gray-300">No history yet</h3>
          <p className="text-earth-500 dark:text-gray-400 mt-1">Start planting in your planters to build garden knowledge over time.</p>
          <Link href="/planters" className="inline-block mt-4 px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors">
            Go to Planters
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 text-center">
      <div className="text-2xl font-bold text-garden-700 dark:text-garden-400">{value}</div>
      <div className="text-sm text-earth-500 dark:text-gray-400 mt-1">{label}</div>
    </div>
  );
}
