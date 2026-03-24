'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getUpcomingHarvests } from '../../api';
import { getPlantIcon } from '../../plant-icons';

interface UpcomingHarvest {
  id: number;
  plant_id: number;
  bed_id: number | null;
  status: string;
  planted_date: string;
  plant_name: string;
  days_to_harvest: number;
  category: string;
  bed_name: string | null;
  expected_harvest_date: string;
  days_until_harvest: number;
}

function getDaysBadgeColor(days: number): string {
  if (days < 0) return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
  if (days < 7) return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
  if (days < 14) return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300';
  return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
}

function getDaysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today!';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export default function UpcomingHarvestsPage() {
  const [harvests, setHarvests] = useState<UpcomingHarvest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUpcomingHarvests()
      .then((data) => setHarvests(data))
      .catch(() => setError('Failed to load upcoming harvests'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-earth-500 dark:text-gray-400">Loading upcoming harvests...</div>;
  if (error) return <div className="text-center py-12 text-red-600 dark:text-red-400">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-garden-800 dark:text-garden-400">Upcoming Harvests</h1>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">Plants approaching their expected harvest date</p>
        </div>
        <Link
          href="/harvest"
          className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-medium text-sm"
        >
          Harvest Log
        </Link>
      </div>

      {harvests.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-earth-200 dark:border-gray-700 p-8 text-center">
          <p className="text-earth-500 dark:text-gray-400">No active plantings with expected harvest dates found.</p>
          <p className="text-sm text-earth-400 dark:text-gray-500 mt-2">Plants need a planted date and days-to-harvest value to appear here.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-earth-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-earth-200 dark:border-gray-700 text-earth-600 dark:text-gray-400">
                  <th className="text-left p-3 sm:p-4 font-medium">Plant</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Bed</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Status</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Planted</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Expected Harvest</th>
                  <th className="text-right p-3 sm:p-4 font-medium">Time Left</th>
                </tr>
              </thead>
              <tbody>
                {harvests.map((h) => (
                  <tr key={h.id} className="border-b border-earth-100 dark:border-gray-700/50 hover:bg-earth-50 dark:hover:bg-gray-700/50">
                    <td className="p-3 sm:p-4 font-medium text-earth-800 dark:text-gray-200">
                      <span className="mr-1.5">{getPlantIcon(h.plant_name)}</span>
                      {h.plant_name}
                    </td>
                    <td className="p-3 sm:p-4 text-earth-600 dark:text-gray-300">
                      {h.bed_name ? (
                        <Link href={`/planters/${h.bed_id}`} className="hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                          {h.bed_name}
                        </Link>
                      ) : (
                        <span className="text-earth-400 dark:text-gray-500">--</span>
                      )}
                    </td>
                    <td className="p-3 sm:p-4">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-garden-100 text-garden-800 dark:bg-garden-900 dark:text-garden-300 capitalize">
                        {h.status}
                      </span>
                    </td>
                    <td className="p-3 sm:p-4 text-earth-600 dark:text-gray-300">{h.planted_date}</td>
                    <td className="p-3 sm:p-4 text-earth-600 dark:text-gray-300">{h.expected_harvest_date}</td>
                    <td className="p-3 sm:p-4 text-right">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${getDaysBadgeColor(h.days_until_harvest)}`}>
                        {getDaysLabel(h.days_until_harvest)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
