'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getHarvests, createHarvest, deleteHarvest, getHarvestSummary, getPlantInstances, getUpcomingHarvests, getExportUrl, undoAction, getCellPositionLabel } from '../api';
import { TypeaheadSelect, TypeaheadOption } from '../typeahead-select';
import { MiniGrid } from '../components/MiniGrid';
import { useModal } from '../confirm-modal';
import { useToast } from '../toast';
import { getPlantIcon } from '../plant-icons';
import { getGardenToday } from '../timezone';
import { PullToRefresh } from '../components/PullToRefresh';

interface PlantInstance {
  id: number;
  plant_name: string;
  display_name: string;
  bed_name?: string;
  container_name?: string;
  cell_x?: number;
  cell_y?: number;
  width_cells?: number;
  height_cells?: number;
  tray_rows?: number;
  tray_cols?: number;
  tray_row?: number;
  tray_col?: number;
  location_type?: string;
  status: string;
  label?: string;
}

interface Harvest {
  id: number;
  planting_id: number;
  instance_id: number | null;
  plant_id: number | null;
  plant_name: string;
  harvest_date: string;
  weight_oz: number | null;
  quantity: number | null;
  quality: string | null;
  notes: string | null;
  created_at: string;
  journal_entry_id: number | null;
  location_display: string | null;
  bed_name: string | null;
}

interface HarvestSummary {
  total_harvests: number;
  total_weight_oz: number;
  by_plant: { plant_name: string; harvest_count: number; total_weight_oz: number }[];
  by_month: { month: string; harvest_count: number; total_weight_oz: number }[];
}

interface UpcomingHarvest {
  id: number;
  plant_id: number;
  bed_id: number | null;
  status: string;
  planted_date: string;
  plant_name: string;
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

export default function HarvestPage() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const [harvests, setHarvests] = useState<Harvest[]>([]);
  const [instances, setInstances] = useState<PlantInstance[]>([]);
  const [summary, setSummary] = useState<HarvestSummary | null>(null);
  const [upcomingHarvests, setUpcomingHarvests] = useState<UpcomingHarvest[]>([]);
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emptyForm = {
    instance_id: 0,
    harvest_date: getGardenToday(),
    weight_oz: '',
    quantity: '',
    quality: '' as string,
    notes: '',
    create_journal_entry: true,
    final_harvest: false,
  };
  const [formData, setFormData] = useState(emptyForm);

  const loadData = () => {
    Promise.all([getHarvests(), getHarvestSummary(), getPlantInstances(), getUpcomingHarvests()])
      .then(([harvestData, summaryData, instanceData, upcomingData]) => {
        setHarvests(harvestData);
        setSummary(summaryData);
        setInstances(instanceData);
        setUpcomingHarvests(upcomingData);
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.instance_id) return;
    setSubmitting(true);
    try {
      await createHarvest({
        instance_id: formData.instance_id,
        harvest_date: formData.harvest_date,
        weight_oz: formData.weight_oz ? parseFloat(formData.weight_oz) : undefined,
        quantity: formData.quantity ? parseInt(formData.quantity) : undefined,
        quality: formData.quality || undefined,
        notes: formData.notes || undefined,
        create_journal_entry: formData.create_journal_entry || undefined,
        final_harvest: formData.final_harvest || undefined,
      });
      setFormData(emptyForm);
      setShowForm(false);
      setLoading(true);
      loadData();
    } catch {
      setError('Failed to log harvest');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteHarvest = async (id: number) => {
    if (!await showConfirm({ title: 'Delete Harvest', message: 'Are you sure you want to delete this harvest entry?', confirmText: 'Delete', destructive: true })) return;
    try {
      const res = await deleteHarvest(id);
      setLoading(true);
      loadData();
      toast('Harvest deleted', 'success', {
        action: { label: 'Undo', onClick: async () => { try { await undoAction(res.undo_id); loadData(); } catch { toast('Undo failed', 'error'); } } },
      });
    } catch {
      setError('Failed to delete harvest');
    }
  };

  const maxMonthWeight = summary?.by_month.length
    ? Math.max(...summary.by_month.map(m => m.total_weight_oz))
    : 0;

  if (loading) return <div className="text-center py-12 text-earth-500 dark:text-gray-400">Loading harvests...</div>;
  if (error) return <div className="text-center py-12 text-red-600 dark:text-red-400">{error}</div>;

  return (
    <PullToRefresh onRefresh={async () => { loadData(); }}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold text-garden-800 dark:text-garden-400">Harvest Tracker</h1>
        <div className="flex items-center gap-2">
          <a
            href={getExportUrl('harvests')}
            download
            className="px-3 py-2 bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 rounded-lg hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
          >
            Export CSV
          </a>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-medium"
          >
            {showForm ? 'Cancel' : '+ Log Harvest'}
          </button>
        </div>
      </div>

      {/* Log Harvest Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 sm:p-6 space-y-4 border border-earth-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-200">Log a Harvest</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Plant *</label>
              <TypeaheadSelect
                options={instances.map((inst): TypeaheadOption => {
                  const displayName = inst.label || inst.display_name || inst.plant_name;
                  let loc: string | null = null;
                  if (inst.container_name) {
                    // Determine grid dimensions and cell position
                    const gridW = inst.width_cells || inst.tray_cols;
                    const gridH = inst.height_cells || inst.tray_rows;
                    const cx = inst.cell_x ?? inst.tray_col;
                    const cy = inst.cell_y ?? inst.tray_row;
                    if (cx != null && cy != null && gridW && gridH) {
                      const posLabel = getCellPositionLabel(cx, cy, gridW, gridH);
                      loc = posLabel ? `${inst.container_name}, ${posLabel}` : inst.container_name;
                    } else {
                      loc = inst.container_name;
                    }
                  }
                  return {
                    value: inst.id.toString(),
                    label: `${displayName}${loc ? ` \u2014 ${loc}` : ''} - ${inst.status}`,
                    icon: getPlantIcon(inst.plant_name),
                  };
                })}
                value={formData.instance_id ? formData.instance_id.toString() : ''}
                onChange={(val) => setFormData({ ...formData, instance_id: val ? Number(val) : 0 })}
                placeholder="Search plants..."
                renderOption={(option) => {
                  const inst = instances.find(i => i.id.toString() === option.value);
                  const gridW = inst?.width_cells || inst?.tray_cols;
                  const gridH = inst?.height_cells || inst?.tray_rows;
                  const cx = inst?.cell_x ?? inst?.tray_col;
                  const cy = inst?.cell_y ?? inst?.tray_row;
                  return (
                    <span className="flex items-center gap-2">
                      {inst && gridW && gridH && cx != null && cy != null ? (
                        <MiniGrid width={gridW} height={gridH} highlightX={cx} highlightY={cy} />
                      ) : null}
                      {option.icon && <span>{option.icon}</span>}
                      <span>{option.label}</span>
                    </span>
                  );
                }}
                renderSelected={(option) => {
                  const inst = instances.find(i => i.id.toString() === option.value);
                  const gridW = inst?.width_cells || inst?.tray_cols;
                  const gridH = inst?.height_cells || inst?.tray_rows;
                  const cx = inst?.cell_x ?? inst?.tray_col;
                  const cy = inst?.cell_y ?? inst?.tray_row;
                  return (
                    <span className="flex items-center gap-2 text-sm text-earth-800 dark:text-gray-100">
                      {inst && gridW && gridH && cx != null && cy != null ? (
                        <MiniGrid width={gridW} height={gridH} highlightX={cx} highlightY={cy} />
                      ) : null}
                      {option.icon && <span>{option.icon}</span>}
                      <span>{option.label}</span>
                    </span>
                  );
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Harvest Date *</label>
              <input
                type="date"
                value={formData.harvest_date}
                onChange={e => setFormData({ ...formData, harvest_date: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Weight (oz)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.weight_oz}
                onChange={e => setFormData({ ...formData, weight_oz: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                placeholder="e.g. 12.5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Quantity</label>
              <input
                type="number"
                min="0"
                value={formData.quantity}
                onChange={e => setFormData({ ...formData, quantity: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                placeholder="e.g. 5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Quality</label>
              <select
                value={formData.quality}
                onChange={e => setFormData({ ...formData, quality: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
              >
                <option value="">--</option>
                <option value="excellent">Excellent</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                placeholder="Optional notes"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="create_journal_entry"
                checked={formData.create_journal_entry}
                onChange={e => setFormData({ ...formData, create_journal_entry: e.target.checked })}
                className="w-4 h-4 text-garden-600 border-earth-300 dark:border-gray-600 rounded focus:ring-garden-500"
              />
              <label htmlFor="create_journal_entry" className="text-sm text-earth-700 dark:text-gray-300">
                Add journal entry
              </label>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.final_harvest}
                onChange={(e) => setFormData({ ...formData, final_harvest: e.target.checked })}
                className="w-4 h-4 rounded border-earth-300 dark:border-gray-600 text-garden-600 focus:ring-garden-500"
              />
              <span className="text-sm text-earth-600 dark:text-gray-300">Final harvest — mark plant as fully harvested</span>
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting || !formData.instance_id}
            className="px-6 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 disabled:opacity-50 transition-colors font-medium"
          >
            {submitting ? 'Saving...' : 'Save Harvest'}
          </button>
        </form>
      )}

      {/* Upcoming Harvests - collapsible section */}
      {upcomingHarvests.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-amber-200 dark:border-amber-800/50 overflow-hidden">
          <button
            onClick={() => setUpcomingExpanded(!upcomingExpanded)}
            className="w-full flex items-center justify-between p-4 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{'\u{1F33E}'}</span>
              <h2 className="text-base font-semibold text-earth-800 dark:text-gray-200">
                Upcoming Harvests ({upcomingHarvests.length})
              </h2>
            </div>
            <svg
              className={`w-5 h-5 text-earth-400 dark:text-gray-500 transition-transform ${upcomingExpanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {upcomingExpanded && (
            <div className="border-t border-amber-200 dark:border-amber-800/50">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-earth-200 dark:border-gray-700 text-earth-600 dark:text-gray-400">
                      <th className="text-left p-3 font-medium">Plant</th>
                      <th className="text-left p-3 font-medium">Bed</th>
                      <th className="text-left p-3 font-medium">Expected Date</th>
                      <th className="text-right p-3 font-medium">Time Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingHarvests.map((uh) => (
                      <tr key={uh.id} className="border-b border-earth-100 dark:border-gray-700/50 hover:bg-amber-50/50 dark:hover:bg-amber-900/5">
                        <td className="p-3 font-medium text-earth-800 dark:text-gray-200">
                          <span className="mr-1.5">{getPlantIcon(uh.plant_name)}</span>
                          {uh.plant_name}
                        </td>
                        <td className="p-3 text-earth-600 dark:text-gray-300">
                          {uh.bed_name ? (
                            <Link href={`/planters/${uh.bed_id}`} className="hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                              {uh.bed_name}
                            </Link>
                          ) : (
                            <span className="text-earth-400 dark:text-gray-500">--</span>
                          )}
                        </td>
                        <td className="p-3 text-earth-600 dark:text-gray-300">{uh.expected_harvest_date}</td>
                        <td className="p-3 text-right">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${getDaysBadgeColor(uh.days_until_harvest)}`}>
                            {getDaysLabel(uh.days_until_harvest)}
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
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border border-earth-200 dark:border-gray-700">
            <div className="text-sm text-earth-500 dark:text-gray-400">Total Harvested</div>
            <div className="text-2xl font-bold text-garden-700 dark:text-garden-400">
              {(summary.total_weight_oz / 16).toFixed(1)} lbs
            </div>
            <div className="text-xs text-earth-400 dark:text-gray-500">{summary.total_weight_oz.toFixed(1)} oz</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border border-earth-200 dark:border-gray-700">
            <div className="text-sm text-earth-500 dark:text-gray-400">Total Harvests</div>
            <div className="text-2xl font-bold text-garden-700 dark:text-garden-400">{summary.total_harvests}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border border-earth-200 dark:border-gray-700">
            <div className="text-sm text-earth-500 dark:text-gray-400">Top Producer</div>
            <div className="text-2xl font-bold text-garden-700 dark:text-garden-400">
              {summary.by_plant.length > 0 ? summary.by_plant[0].plant_name : '--'}
            </div>
            {summary.by_plant.length > 0 && (
              <div className="text-xs text-earth-400 dark:text-gray-500">
                {(summary.by_plant[0].total_weight_oz / 16).toFixed(1)} lbs
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monthly Harvest Chart */}
      {summary && summary.by_month.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 sm:p-6 border border-earth-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-200 mb-4">Monthly Harvest (oz)</h2>
          <div className="flex items-end gap-2 h-40">
            {summary.by_month.map(m => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs text-earth-500 dark:text-gray-400 font-medium">
                  {m.total_weight_oz.toFixed(0)}
                </div>
                <div
                  className="w-full bg-garden-500 dark:bg-garden-600 rounded-t"
                  style={{ height: `${maxMonthWeight > 0 ? (m.total_weight_oz / maxMonthWeight) * 100 : 0}%`, minHeight: m.total_weight_oz > 0 ? '4px' : '0' }}
                />
                <div className="text-xs text-earth-500 dark:text-gray-400 truncate w-full text-center">
                  {m.month.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Harvest History Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-earth-200 dark:border-gray-700 overflow-hidden">
        <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-200 p-4 sm:p-6 pb-0">Harvest History</h2>
        {harvests.length === 0 ? (
          <p className="p-4 sm:p-6 text-earth-500 dark:text-gray-400">No harvests logged yet. Click &quot;+ Log Harvest&quot; to start tracking.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-earth-200 dark:border-gray-700 text-earth-600 dark:text-gray-400">
                  <th className="text-left p-3 sm:p-4 font-medium">Date</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Plant</th>
                  <th className="text-right p-3 sm:p-4 font-medium">Weight (oz)</th>
                  <th className="text-right p-3 sm:p-4 font-medium">Qty</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Quality</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Notes</th>
                  <th className="text-center p-3 sm:p-4 font-medium">Journal</th>
                  <th className="text-right p-3 sm:p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {harvests.map(h => (
                  <tr key={h.id} className="border-b border-earth-100 dark:border-gray-700/50 hover:bg-earth-50 dark:hover:bg-gray-700/50">
                    <td className="p-3 sm:p-4 text-earth-700 dark:text-gray-300">{h.harvest_date}</td>
                    <td className="p-3 sm:p-4 font-medium text-earth-800 dark:text-gray-200">
                      {h.instance_id ? (
                        <Link href={`/plant/${h.instance_id}`} className="hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                          {h.plant_name}
                          {h.location_display && (
                            <span className="text-earth-500 dark:text-gray-400 font-normal text-xs ml-1">({h.location_display})</span>
                          )}
                        </Link>
                      ) : (
                        <>
                          {h.plant_name}
                          {h.location_display && (
                            <span className="text-earth-500 dark:text-gray-400 font-normal text-xs ml-1">({h.location_display})</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="p-3 sm:p-4 text-right text-earth-700 dark:text-gray-300">{h.weight_oz ?? '--'}</td>
                    <td className="p-3 sm:p-4 text-right text-earth-700 dark:text-gray-300">{h.quantity ?? '--'}</td>
                    <td className="p-3 sm:p-4">
                      {h.quality && (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          h.quality === 'excellent' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' :
                          h.quality === 'good' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' :
                          h.quality === 'fair' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' :
                          'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                        }`}>
                          {h.quality}
                        </span>
                      )}
                    </td>
                    <td className="p-3 sm:p-4 text-earth-500 dark:text-gray-400 max-w-[200px] truncate">{h.notes || ''}</td>
                    <td className="p-3 sm:p-4 text-center">
                      {h.journal_entry_id ? (
                        <Link href="/journal" className="text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 text-xs font-medium hover:underline">
                          Journal
                        </Link>
                      ) : null}
                    </td>
                    <td className="p-3 sm:p-4 text-right">
                      <button
                        onClick={() => handleDeleteHarvest(h.id)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </PullToRefresh>
  );
}
