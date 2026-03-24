'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getPlantHistory, getPlantTips, getPhotoUrl } from '../../../api';
import { getPlantIcon } from '../../../plant-icons';
import { historyStatusColors as statusColors, noteTypeIcons as noteTypeIcon } from '../../../constants';
import { formatGardenDate } from '../../../timezone';

interface PlantHistoryData {
  plant: any;
  plantings: any[];
  ground_plants?: any[];
  stats: {
    total_plantings: number;
    harvested: number;
    failed: number;
    active_ground?: number;
    success_rate: number;
    total_yield_oz: number;
    avg_days_to_harvest: number | null;
    best_bed: string | null;
  };
}

interface TipsData {
  plant: string;
  total_plantings: number;
  tips: string[];
  message?: string;
}

export default function PlantHistoryPage() {
  const params = useParams();
  const plantId = Number(params.id);

  const [history, setHistory] = useState<PlantHistoryData | null>(null);
  const [tips, setTips] = useState<TipsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!plantId) return;
    Promise.all([
      getPlantHistory(plantId),
      getPlantTips(plantId),
    ]).then(([h, t]) => {
      setHistory(h);
      setTips(t);
    }).finally(() => setLoading(false));
  }, [plantId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-lg text-earth-500 dark:text-gray-400">Loading plant history...</div>
      </div>
    );
  }

  if (!history) {
    return <div className="text-center py-12 text-earth-500">Plant not found.</div>;
  }

  const { plant, plantings, stats } = history;
  const lbs = (stats.total_yield_oz / 16).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/history" className="text-garden-600 dark:text-garden-400 hover:underline text-sm">&larr; History</Link>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-4xl">{getPlantIcon(plant.name, plant.category)}</span>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">{plant.name}</h1>
          <p className="text-earth-500 dark:text-gray-400">{plant.category} &middot; {plant.subcategory || ''}</p>
        </div>
      </div>

      {/* Key Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <StatCard label="Total Plantings" value={stats.total_plantings} />
        <StatCard label="In Ground" value={stats.active_ground || 0} color={(stats.active_ground || 0) > 0 ? 'text-amber-600 dark:text-amber-400' : undefined} />
        <StatCard label="Success Rate" value={stats.total_plantings > 0 ? `${stats.success_rate}%` : '--'} color={stats.success_rate >= 70 ? 'text-green-600 dark:text-green-400' : stats.success_rate >= 40 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'} />
        <StatCard label="Total Yield" value={stats.total_yield_oz > 0 ? `${lbs} lbs` : '--'} />
        <StatCard label="Avg Days to Harvest" value={stats.avg_days_to_harvest ? `${stats.avg_days_to_harvest}` : '--'} />
      </div>

      {stats.best_bed && stats.best_bed !== 'Unknown' && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
          <span className="text-sm font-medium text-green-700 dark:text-green-300">Best planter: {stats.best_bed}</span>
        </div>
      )}

      {/* Tips / What We Learned */}
      {tips && tips.tips.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-3">What We Learned</h2>
          <ul className="space-y-2">
            {tips.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5 flex-shrink-0">{'\u{1F4A1}'}</span>
                <span className="text-sm text-earth-700 dark:text-gray-300">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tips && tips.message && tips.tips.length === 0 && (
        <div className="bg-earth-50 dark:bg-gray-700/50 rounded-xl p-4 text-sm text-earth-500 dark:text-gray-400">
          {tips.message}
        </div>
      )}

      {/* Planting History Timeline */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-100 mb-4">Planting History</h2>

        {plantings.length === 0 && (!history?.ground_plants || history.ground_plants.length === 0) ? (
          <p className="text-sm text-earth-400 dark:text-gray-500">No planting history recorded yet.</p>
        ) : (<>
          <div className="space-y-4">
            {plantings.map((p: any) => (
              <div key={p.id} className="border border-earth-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[p.status] || 'bg-gray-100 text-gray-700'}`}>
                      {p.status}
                    </span>
                    {p.bed_name && p.bed_id && (
                      <Link href={`/planters/${p.bed_id}`} className="text-sm text-earth-500 dark:text-gray-400 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                        in {p.bed_name}
                      </Link>
                    )}
                    {p.bed_name && !p.bed_id && (
                      <span className="text-sm text-earth-500 dark:text-gray-400">in {p.bed_name}</span>
                    )}
                    {p.season && p.year && (
                      <Link
                        href={`/history/season/${p.year}/${p.season}`}
                        className="text-xs text-garden-600 dark:text-garden-400 hover:underline"
                      >
                        {p.year} {p.season}
                      </Link>
                    )}
                  </div>
                  <div className="text-sm text-earth-500 dark:text-gray-400">
                    {p.planted_date ? formatGardenDate(p.planted_date) : 'No date'}
                    {p.total_harvest_oz > 0 && (
                      <span className="ml-2 text-green-600 dark:text-green-400 font-medium">
                        {(p.total_harvest_oz / 16).toFixed(1)} lbs
                      </span>
                    )}
                  </div>
                </div>

                {/* Harvests */}
                {p.harvests && p.harvests.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.harvests.map((h: any) => (
                      <span key={h.id} className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-2 py-1 rounded">
                        {h.harvest_date}: {h.weight_oz ? `${h.weight_oz}oz` : ''} {h.quality || ''}
                      </span>
                    ))}
                  </div>
                )}

                {/* Photos */}
                {p.photos && p.photos.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {p.photos.slice(0, 4).map((photo: any) => (
                      <img
                        key={photo.id}
                        src={getPhotoUrl(photo.id)}
                        alt={photo.caption || 'Planting photo'}
                        className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                      />
                    ))}
                    {p.photos.length > 4 && (
                      <span className="flex items-center text-xs text-earth-400 dark:text-gray-500">+{p.photos.length - 4} more</span>
                    )}
                  </div>
                )}

                {/* Notes */}
                {p.notes && p.notes.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {p.notes.map((n: any) => (
                      <div key={n.id} className="flex items-start gap-1.5 text-sm">
                        <span className="flex-shrink-0">{noteTypeIcon[n.note_type] || '\u{1F4DD}'}</span>
                        <span className="text-earth-600 dark:text-gray-400">{n.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

        {/* Ground Plants */}
        {history?.ground_plants && history.ground_plants.length > 0 && (
          <div className="mt-6">
            <h3 className="text-md font-semibold text-earth-700 dark:text-gray-200 mb-3">In-Ground Plantings</h3>
            <div className="space-y-3">
              {history.ground_plants.map((gp: any) => (
                <div key={gp.id} className="border border-amber-200 dark:border-amber-800 rounded-lg p-4 bg-amber-50/50 dark:bg-amber-900/10">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[gp.status] || 'bg-gray-100 text-gray-700'}`}>
                        {gp.status}
                      </span>
                      <span className="text-sm text-earth-600 dark:text-gray-300 font-medium">
                        {gp.name || 'Ground plant'}
                      </span>
                      {gp.area_name && (
                        <span className="text-sm text-earth-500 dark:text-gray-400">in {gp.area_name}</span>
                      )}
                    </div>
                    <div className="text-sm text-earth-500 dark:text-gray-400">
                      {gp.planted_date ? formatGardenDate(gp.planted_date) : 'No date'}
                    </div>
                  </div>
                  {gp.notes && (
                    <p className="mt-1 text-sm text-earth-500 dark:text-gray-400">{gp.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        </>)}
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
