'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getSeasonReview } from '../../../../api';

interface Metric {
  value: string;
  grade: string;
  label: string;
}

interface ReviewData {
  year: number;
  season: string;
  overall_grade: string;
  overall_summary: string;
  metrics: Record<string, Metric>;
  stats: {
    total_plantings: number;
    harvested: number;
    failed: number;
    active: number;
    total_yield_oz: number;
    success_rate: number;
    unique_plants: number;
  };
  what_worked: string[];
  what_to_improve: string[];
  recommendations: string[];
  top_performers: { plant_name: string; total_oz: number }[];
  saved_summary: any | null;
}

const seasonLabel: Record<string, string> = {
  cool: 'Cool Season',
  warm: 'Warm Season',
  monsoon: 'Monsoon Season',
};

const gradeColor: Record<string, string> = {
  A: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700',
  B: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  C: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
  D: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700',
  F: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700',
  'N/A': 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600',
};

export default function SeasonReviewPage() {
  const params = useParams();
  const year = Number(params.year);
  const season = String(params.season);

  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!year || !season) return;
    getSeasonReview(year, season)
      .then(setData)
      .finally(() => setLoading(false));
  }, [year, season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-lg text-earth-500 dark:text-gray-400">Generating season review...</div>
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-12 text-earth-500 dark:text-gray-400">Failed to load season review.</div>;
  }

  const metricOrder = ['success_rate', 'yield', 'diversity', 'failure_rate'];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/analytics" className="text-garden-600 dark:text-garden-400 hover:underline text-sm">&larr; Analytics</Link>
        <span className="text-earth-300 dark:text-gray-600">|</span>
        <Link href={`/history/season/${year}/${season}`} className="text-garden-600 dark:text-garden-400 hover:underline text-sm">Season History</Link>
      </div>

      {/* Header with Grade */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 flex items-center gap-6">
        <div className={`w-20 h-20 rounded-2xl border-2 flex items-center justify-center text-4xl font-bold shrink-0 ${gradeColor[data.overall_grade] || gradeColor['N/A']}`}>
          {data.overall_grade}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">
            {year} {seasonLabel[season] || season} Review
          </h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">{data.overall_summary}</p>
        </div>
      </div>

      {/* Report Card Metrics */}
      {Object.keys(data.metrics).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Report Card</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {metricOrder.filter(k => data.metrics[k]).map(key => {
              const m = data.metrics[key];
              return (
                <div key={key} className="text-center">
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl border-2 text-xl font-bold mb-2 ${gradeColor[m.grade] || gradeColor['N/A']}`}>
                    {m.grade}
                  </div>
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100">{m.value}</div>
                  <div className="text-xs text-earth-400 dark:text-gray-500">{m.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatMini label="Plantings" value={data.stats.total_plantings} />
        <StatMini label="Harvested" value={data.stats.harvested} color="text-green-600 dark:text-green-400" />
        <StatMini label="Failed" value={data.stats.failed} color={data.stats.failed > 0 ? 'text-red-500 dark:text-red-400' : undefined} />
        <StatMini label="Still Active" value={data.stats.active} color="text-blue-500 dark:text-blue-400" />
      </div>

      {/* What Worked */}
      {data.what_worked.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-green-800 dark:text-green-200 mb-3">What Worked</h2>
          <ul className="space-y-2">
            {data.what_worked.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-green-700 dark:text-green-300">
                <span className="mt-0.5 shrink-0">{'\u2705'}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What to Improve */}
      {data.what_to_improve.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-3">What to Try Differently</h2>
          <ul className="space-y-2">
            {data.what_to_improve.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                <span className="mt-0.5 shrink-0">{'\u26A0\uFE0F'}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {data.recommendations.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-blue-800 dark:text-blue-200 mb-3">Recommended Changes for Next Season</h2>
          <ul className="space-y-2">
            {data.recommendations.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-300">
                <span className="mt-0.5 shrink-0">{'\u{1F4A1}'}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top Performers */}
      {data.top_performers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-3">Top Performers</h2>
          <div className="space-y-2">
            {data.top_performers.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-green-50 dark:bg-green-900/20">
                <span className="font-medium text-earth-700 dark:text-gray-200">{i + 1}. {p.plant_name}</span>
                <span className="text-sm text-green-600 dark:text-green-400">{(p.total_oz / 16).toFixed(1)} lbs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved Summary from DB */}
      {data.saved_summary && (data.saved_summary.lessons_learned || data.saved_summary.weather_summary || data.saved_summary.notes) && (
        <div className="bg-earth-50 dark:bg-gray-700/30 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100">Saved Notes</h2>
          {data.saved_summary.lessons_learned && (
            <div>
              <div className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Lessons Learned</div>
              <div className="text-sm text-earth-700 dark:text-gray-300">{data.saved_summary.lessons_learned}</div>
            </div>
          )}
          {data.saved_summary.weather_summary && (
            <div>
              <div className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Weather</div>
              <div className="text-sm text-earth-700 dark:text-gray-300">{data.saved_summary.weather_summary}</div>
            </div>
          )}
          {data.saved_summary.notes && (
            <div>
              <div className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Notes</div>
              <div className="text-sm text-earth-700 dark:text-gray-300">{data.saved_summary.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatMini({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-earth-200 dark:border-gray-700 p-3 text-center">
      <div className={`text-xl font-bold ${color || 'text-earth-800 dark:text-gray-100'}`}>{value}</div>
      <div className="text-xs text-earth-400 dark:text-gray-500">{label}</div>
    </div>
  );
}
