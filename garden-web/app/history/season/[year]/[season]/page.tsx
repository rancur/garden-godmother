'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getSeasonHistory } from '../../../../api';
import { getPlantIcon } from '../../../../plant-icons';
import { historyStatusColors as statusColors, noteTypeIcons as noteTypeIcon } from '../../../../constants';
import { formatGardenDate } from '../../../../timezone';

interface SeasonData {
  year: number;
  season: string;
  plantings: any[];
  stats: {
    total_plantings: number;
    total_harvested: number;
    total_failed: number;
    total_yield_oz: number;
  };
  top_performers: { plant_name: string; total_oz: number }[];
  failures: any[];
  summary: any | null;
}

const seasonLabel: Record<string, string> = {
  cool: 'Cool Season',
  warm: 'Warm Season',
  monsoon: 'Monsoon Season',
};

export default function SeasonHistoryPage() {
  const params = useParams();
  const year = Number(params.year);
  const season = String(params.season);

  const [data, setData] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!year || !season) return;
    getSeasonHistory(year, season)
      .then(setData)
      .finally(() => setLoading(false));
  }, [year, season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-lg text-earth-500 dark:text-gray-400">Loading season report...</div>
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-12 text-earth-500">Season data not found.</div>;
  }

  const { stats, top_performers, failures, summary } = data;
  const lbs = (stats.total_yield_oz / 16).toFixed(1);
  const successRate = stats.total_plantings > 0 ? Math.round((stats.total_harvested / stats.total_plantings) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/history" className="text-garden-600 dark:text-garden-400 hover:underline text-sm">&larr; History</Link>
        </div>
        <Link
          href={`/analytics/review/${year}/${season}`}
          className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-medium text-sm"
        >
          Full Season Review
        </Link>
      </div>

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">
          {year} {seasonLabel[season] || season}
        </h1>
        <p className="text-earth-500 dark:text-gray-400 mt-1">Season Report Card</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Plantings" value={stats.total_plantings} />
        <StatCard label="Harvested" value={stats.total_harvested} color="text-green-600 dark:text-green-400" />
        <StatCard label="Failed" value={stats.total_failed} color={stats.total_failed > 0 ? 'text-red-600 dark:text-red-400' : undefined} />
        <StatCard label="Total Yield" value={stats.total_yield_oz > 0 ? `${lbs} lbs` : '--'} />
      </div>

      {stats.total_plantings > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold text-earth-800 dark:text-gray-100">{successRate}%</div>
            <div className="flex-1">
              <div className="text-sm text-earth-500 dark:text-gray-400">Success Rate</div>
              <div className="mt-1 h-3 bg-earth-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${successRate >= 70 ? 'bg-green-500' : successRate >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${successRate}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Season Summary (if exists) */}
      {summary && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200">Season Summary</h2>
          {summary.lessons_learned && (
            <div>
              <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">Lessons Learned</div>
              <div className="text-sm text-earth-700 dark:text-gray-300">{summary.lessons_learned}</div>
            </div>
          )}
          {summary.weather_summary && (
            <div>
              <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">Weather</div>
              <div className="text-sm text-earth-700 dark:text-gray-300">{summary.weather_summary}</div>
            </div>
          )}
          {summary.notes && (
            <div>
              <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">Notes</div>
              <div className="text-sm text-earth-700 dark:text-gray-300">{summary.notes}</div>
            </div>
          )}
        </div>
      )}

      {/* Top Performers */}
      {top_performers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-3">Top Performers</h2>
          <div className="space-y-2">
            {top_performers.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-green-50 dark:bg-green-900/20">
                <span className="font-medium text-earth-700 dark:text-gray-200">{i + 1}. {p.plant_name}</span>
                <span className="text-sm text-green-600 dark:text-green-400">{(p.total_oz / 16).toFixed(1)} lbs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failures */}
      {failures.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-3">Failures</h2>
          <div className="space-y-2">
            {failures.map((f: any) => (
              <div key={f.id} className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2">
                  <Link href={`/plants?highlight=${f.plant_id || ''}`} className="font-medium text-earth-700 dark:text-gray-200 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                    {f.plant_name}
                  </Link>
                  {f.bed_name && f.bed_id && <Link href={`/planters/${f.bed_id}`} className="text-xs text-earth-400 dark:text-gray-500 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">in {f.bed_name}</Link>}
                  {f.bed_name && !f.bed_id && <span className="text-xs text-earth-400 dark:text-gray-500">in {f.bed_name}</span>}
                </div>
                {f.notes && f.notes.length > 0 && (
                  <div className="mt-1">
                    {f.notes.map((n: any) => (
                      <div key={n.id} className="text-sm text-red-700 dark:text-red-300 flex items-start gap-1">
                        <span>{noteTypeIcon[n.note_type] || ''}</span>
                        <span>{n.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Plantings */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">All Plantings</h2>
        {data.plantings.length === 0 ? (
          <p className="text-sm text-earth-400 dark:text-gray-500">No plantings this season.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-earth-500 dark:text-gray-400 border-b border-earth-200 dark:border-gray-700">
                  <th className="pb-2 pr-3">Plant</th>
                  <th className="pb-2 pr-3">Planter</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Planted</th>
                  <th className="pb-2 pr-3 text-right">Yield</th>
                </tr>
              </thead>
              <tbody>
                {data.plantings.map((p: any) => (
                  <tr key={p.id} className="border-b border-earth-100 dark:border-gray-700/50">
                    <td className="py-2 pr-3">
                      <Link href={`/plants?highlight=${p.plant_id}`} className="text-garden-600 dark:text-garden-400 hover:underline">
                        {getPlantIcon(p.plant_name, p.plant_category)} {p.plant_name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-earth-500 dark:text-gray-400">
                      {p.bed_name && p.bed_id ? (
                        <Link href={`/planters/${p.bed_id}`} className="hover:text-garden-600 dark:hover:text-garden-400 hover:underline">{p.bed_name}</Link>
                      ) : (p.bed_name || '--')}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[p.status] || ''}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-earth-500 dark:text-gray-400">
                      {p.planted_date ? formatGardenDate(p.planted_date) : '--'}
                    </td>
                    <td className="py-2 pr-3 text-right text-earth-600 dark:text-gray-300">
                      {p.total_harvest_oz > 0 ? `${(p.total_harvest_oz / 16).toFixed(1)} lbs` : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 text-center">
      <div className={`text-2xl font-bold ${color || 'text-garden-700 dark:text-garden-400'}`}>{value}</div>
      <div className="text-sm text-earth-500 dark:text-gray-400 mt-1">{label}</div>
    </div>
  );
}
