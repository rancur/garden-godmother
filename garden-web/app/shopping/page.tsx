'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getShoppingList, getSeasonShoppingList, getPlants } from '../api';
import { getPlantIcon } from '../plant-icons';

interface ShoppingItem {
  plant_name: string;
  category: string;
  reason: string;
  suggested_quantity: number;
  varieties: string[];
}

interface LowStockItem {
  plant_name: string;
  variety: string;
  remaining: number;
}

interface ShoppingData {
  needed: ShoppingItem[];
  low_stock: LowStockItem[];
  season?: string;
  season_label?: string;
}

export default function ShoppingPage() {
  const [data, setData] = useState<ShoppingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [selectedSeason, setSelectedSeason] = useState<string>('current');
  const [plantNameToId, setPlantNameToId] = useState<Record<string, number>>({});

  useEffect(() => {
    getPlants({}).then((plants: { id: number; name: string }[]) => {
      const map: Record<string, number> = {};
      for (const p of plants) map[p.name.toLowerCase()] = p.id;
      setPlantNameToId(map);
    }).catch(() => {});
  }, []);

  const loadData = async (season: string) => {
    setLoading(true);
    setError(null);
    setCheckedItems(new Set());
    try {
      const result = season === 'current'
        ? await getShoppingList()
        : await getSeasonShoppingList(season);
      setData(result);
    } catch {
      setError('Failed to load shopping list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedSeason);
  }, [selectedSeason]);

  const toggleItem = (key: string) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const categoryBadgeColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'vegetable': return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300';
      case 'herb': return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300';
      case 'flower': return 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300';
      case 'fruit': return 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300';
      default: return 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">Shopping List</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">
            {data?.season_label
              ? `Planning for ${data.season_label}`
              : 'Seeds and supplies you need based on your garden plans'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            className="px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
          >
            <option value="current">Current Needs</option>
            <option value="cool">Cool Season (Oct-Mar)</option>
            <option value="warm">Warm Season (Apr-Jun)</option>
            <option value="monsoon">Monsoon Season (Jul-Sep)</option>
          </select>
          <button
            onClick={handlePrint}
            className="bg-garden-600 hover:bg-garden-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm print:hidden"
          >
            Print List
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">Generating shopping list...</div>
      ) : data && data.needed.length === 0 && data.low_stock.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">{'\u{2705}'}</div>
          <h2 className="text-xl font-bold text-earth-700 dark:text-gray-200 mb-2">You're all stocked up!</h2>
          <p className="text-earth-400 dark:text-gray-500">No seeds needed right now. Check back when planning a new season.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Seeds to Buy */}
          {data && data.needed.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                <span>{'\u{1F6D2}'}</span> Seeds to Buy
                <span className="text-sm font-normal text-earth-400">
                  ({data.needed.filter((_, i) => !checkedItems.has(`needed-${i}`)).length} remaining)
                </span>
              </h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm divide-y divide-earth-100 dark:divide-gray-700">
                {data.needed.map((item, i) => {
                  const key = `needed-${i}`;
                  const checked = checkedItems.has(key);
                  return (
                    <div
                      key={key}
                      onClick={() => toggleItem(key)}
                      className={`flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors ${
                        checked ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex-shrink-0">
                        <div
                          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                            checked
                              ? 'bg-garden-600 border-garden-600'
                              : 'border-earth-300 hover:border-garden-400'
                          }`}
                        >
                          {checked && (
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <span className="text-2xl flex-shrink-0">
                        {getPlantIcon(item.plant_name, item.category)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {plantNameToId[item.plant_name.toLowerCase()] ? (
                            <Link
                              href={`/plants?highlight=${plantNameToId[item.plant_name.toLowerCase()]}`}
                              className={`font-medium text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 hover:underline ${checked ? 'line-through' : ''}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.plant_name}
                            </Link>
                          ) : (
                            <span className={`font-medium text-earth-800 dark:text-gray-100 ${checked ? 'line-through' : ''}`}>
                              {item.plant_name}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${categoryBadgeColor(item.category)}`}>
                            {item.category}
                          </span>
                        </div>
                        <p className="text-sm text-earth-500 mt-0.5">{item.reason}</p>
                        {item.varieties.length > 0 && (
                          <p className="text-xs text-earth-400 mt-0.5">
                            Varieties: {item.varieties.join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0 print:hidden flex flex-col items-end gap-1">
                        <span className="text-sm text-earth-400">
                          Qty: {item.suggested_quantity} pkt
                        </span>
                        {plantNameToId[item.plant_name.toLowerCase()] && (
                          <Link
                            href={`/lifecycle?plant_id=${plantNameToId[item.plant_name.toLowerCase()]}`}
                            className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Plan it
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Low Stock Alerts */}
          {data && data.low_stock.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                <span>{'\u{26A0}\u{FE0F}'}</span> Low Stock Alerts
                <span className="text-sm font-normal text-earth-400">
                  ({data.low_stock.length} items)
                </span>
              </h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-700 shadow-sm divide-y divide-earth-100 dark:divide-gray-700">
                {data.low_stock.map((item, i) => {
                  const key = `low-${i}`;
                  const checked = checkedItems.has(key);
                  return (
                    <div
                      key={key}
                      onClick={() => toggleItem(key)}
                      className={`flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors ${
                        checked ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex-shrink-0">
                        <div
                          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                            checked
                              ? 'bg-garden-600 border-garden-600'
                              : 'border-earth-300 hover:border-garden-400'
                          }`}
                        >
                          {checked && (
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <span className="text-2xl flex-shrink-0">
                        {getPlantIcon(item.plant_name)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={`font-medium text-earth-800 dark:text-gray-100 ${checked ? 'line-through' : ''}`}>
                          {item.plant_name}
                        </span>
                        {item.variety && (
                          <span className="text-sm text-earth-500 dark:text-gray-400 ml-2">({item.variety})</span>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 rounded-full">
                          {item.remaining} seeds left
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
