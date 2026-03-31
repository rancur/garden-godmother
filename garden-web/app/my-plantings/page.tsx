'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { getMyPlantings, getCellPositionLabel } from '../api';
import { getPlantIcon } from '../plant-icons';
import { MiniGrid } from '../components/MiniGrid';
import { plantingStatusColors as statusColors } from '../constants';
import { formatGardenDate } from '../timezone';
import { Skeleton, CardSkeleton } from '../skeleton';
import { PullToRefresh } from '../components/PullToRefresh';

interface Planting {
  id: number;
  plant_id: number;
  status: string;
  planted_date: string | null;
  plant_name: string;
  category: string;
  emoji: string | null;
  container_name: string | null;
  container_type: 'planter' | 'ground' | 'tray';
  container_id: number;
  variety_name: string | null;
  cell_x: number | null;
  cell_y: number | null;
  cell_label?: string;
  width_cells?: number;
  height_cells?: number;
  instance_label?: string;
  link: string;
  instance_id?: number | null;
}

const containerTypeBadge: Record<string, string> = {
  planter: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  ground: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  tray: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

const containerTypeLabel: Record<string, string> = {
  planter: 'Planter',
  ground: 'Ground',
  tray: 'Tray',
};

export default function MyPlantingsPage() {
  const [plantings, setPlantings] = useState<Planting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showHistorical, setShowHistorical] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getMyPlantings(undefined, showHistorical);
      setPlantings(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load plantings. Is the API running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [showHistorical]);

  const filtered = useMemo(() => {
    let result = plantings;
    if (statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (typeFilter !== 'all') {
      result = result.filter((p) => p.container_type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.plant_name.toLowerCase().includes(q) ||
          (p.variety_name && p.variety_name.toLowerCase().includes(q)) ||
          (p.container_name && p.container_name.toLowerCase().includes(q))
      );
    }
    return result;
  }, [plantings, statusFilter, typeFilter, search]);

  // Compute stats
  const stats = useMemo(() => {
    const byType = { planter: 0, ground: 0, tray: 0 };
    const byStatus: Record<string, number> = {};
    for (const p of plantings) {
      byType[p.container_type] = (byType[p.container_type] || 0) + 1;
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    }
    return { total: plantings.length, byType, byStatus };
  }, [plantings]);

  // Gather unique statuses for filter
  const statuses = useMemo(() => {
    const s = new Set(plantings.map((p) => p.status));
    return Array.from(s).sort();
  }, [plantings]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={loadData}>
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">
          My Plantings
        </h1>
        <p className="text-earth-500 dark:text-gray-400 mt-1">
          {stats.total} active planting{stats.total !== 1 ? 's' : ''} across all containers
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-earth-500 dark:text-gray-400 text-sm font-medium">Total</div>
          <div className="text-2xl font-bold text-earth-800 dark:text-gray-100 mt-1">{stats.total}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-green-600 dark:text-green-400 text-sm font-medium">In Planters</div>
          <div className="text-2xl font-bold text-earth-800 dark:text-gray-100 mt-1">{stats.byType.planter}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-amber-600 dark:text-amber-400 text-sm font-medium">In Ground</div>
          <div className="text-2xl font-bold text-earth-800 dark:text-gray-100 mt-1">{stats.byType.ground}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-purple-600 dark:text-purple-400 text-sm font-medium">In Trays</div>
          <div className="text-2xl font-bold text-earth-800 dark:text-gray-100 mt-1">{stats.byType.tray}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plants..."
          className="flex-1 px-4 py-2 rounded-lg border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-earth-800 dark:text-gray-100 placeholder-earth-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-garden-500 focus:border-transparent"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-earth-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent"
        >
          <option value="all">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2 rounded-lg border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-earth-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent"
        >
          <option value="all">All Types</option>
          <option value="planter">Planters</option>
          <option value="ground">Ground</option>
          <option value="tray">Trays</option>
        </select>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showHistorical}
            onChange={(e) => setShowHistorical(e.target.checked)}
            className="w-4 h-4 rounded border-earth-300 dark:border-gray-600 text-garden-600 focus:ring-garden-500"
          />
          <span className="text-sm text-earth-600 dark:text-gray-300 whitespace-nowrap">Show history</span>
        </label>
      </div>

      {/* Results count */}
      {(statusFilter !== 'all' || typeFilter !== 'all' || search.trim() || showHistorical) && (
        <p className="text-sm text-earth-400 dark:text-gray-500">
          Showing {filtered.length} of {stats.total} plantings{showHistorical ? ' (including completed/removed)' : ''}
        </p>
      )}

      {/* Plantings list */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-8 text-center">
          <p className="text-earth-400 dark:text-gray-500">
            {stats.total === 0 ? 'No active plantings yet.' : 'No plantings match your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const icon = p.emoji || getPlantIcon(p.plant_name, p.category);
            return (
              <Link
                key={`${p.container_type}-${p.id}`}
                href={p.link}
                className="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 px-4 py-3 shadow-sm hover:shadow-md hover:border-garden-300 dark:hover:border-garden-600 transition-all"
              >
                {/* Plant icon */}
                <span className="text-2xl shrink-0">{icon}</span>

                {/* Plant info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-earth-800 dark:text-gray-100 truncate">
                      {p.instance_label || p.plant_name}
                    </span>
                    {p.variety_name && (
                      <span className="text-sm text-earth-400 dark:text-gray-500 truncate">
                        {p.variety_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {p.container_name && (
                      <span className="text-xs text-earth-500 dark:text-gray-400 flex items-center gap-1.5">
                        {p.cell_x != null && p.cell_y != null && p.width_cells && p.height_cells && (
                          <MiniGrid width={p.width_cells} height={p.height_cells} highlightX={p.cell_x} highlightY={p.cell_y} size={22} />
                        )}
                        {p.container_name}
                        {p.cell_x != null && p.cell_y != null && p.width_cells && p.height_cells && (
                          <span className="text-earth-400 dark:text-gray-500">
                            {getCellPositionLabel(p.cell_x, p.cell_y, p.width_cells, p.height_cells)}
                          </span>
                        )}
                      </span>
                    )}
                    {p.planted_date && (
                      <span className="text-xs text-earth-400 dark:text-gray-500">
                        Planted {formatGardenDate(p.planted_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-medium ${
                      containerTypeBadge[p.container_type] || ''
                    }`}
                  >
                    {containerTypeLabel[p.container_type] || p.container_type}
                  </span>
                  <span
                    className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-medium ${
                      statusColors[p.status] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}
