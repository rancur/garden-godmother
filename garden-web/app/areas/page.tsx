'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getAreas, getAreaContents, createArea, updateArea, deleteArea, getZones } from '../api';
import { useModal } from '../confirm-modal';
import { useToast } from '../toast';
import { AREA_COLORS } from '../constants';
import type { Area, Zone } from '../types';

interface AreaSummary extends Area {
  bed_count: number;
  tray_count: number;
  ground_plant_count: number;
}

export default function AreasPage() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({ name: '', color: AREA_COLORS[0], zone_id: '' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [areaList, zoneList]: [Area[], Zone[]] = await Promise.all([getAreas(), getZones()]);
      setZones(zoneList);
      const summaries: AreaSummary[] = await Promise.all(
        areaList.map(async (a) => {
          try {
            const contents = await getAreaContents(a.id);
            return {
              ...a,
              bed_count: contents.beds?.length || 0,
              tray_count: contents.trays?.length || 0,
              ground_plant_count: contents.ground_plants?.length || 0,
            };
          } catch {
            return { ...a, bed_count: 0, tray_count: 0, ground_plant_count: 0 };
          }
        })
      );
      setAreas(summaries);
    } catch {
      setError('Failed to load areas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setSubmitting(true);
    try {
      await createArea({ name: formData.name, color: formData.color, ...(formData.zone_id ? { zone_id: Number(formData.zone_id) } : {}) });
      setFormData({ name: '', color: AREA_COLORS[Math.floor(Math.random() * AREA_COLORS.length)], zone_id: '' });
      setShowForm(false);
      loadData();
      toast('Area created');
    } catch { toast('Failed to create area', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleRename = async (id: number) => {
    if (!editName.trim()) { setEditingId(null); return; }
    try { await updateArea(id, { name: editName }); setEditingId(null); loadData(); toast('Area renamed'); }
    catch { toast('Failed to rename area', 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm({ title: 'Delete Area', message: 'Delete this area? All items will be unassigned.', confirmText: 'Delete', destructive: true })) return;
    try { await deleteArea(id); loadData(); toast('Area deleted'); }
    catch { toast('Failed to delete area', 'error'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">Areas</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">Unified zones across planters, trays, and ground plants</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-garden-600 hover:bg-garden-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
        >
          {showForm ? 'Cancel' : '+ New Area'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">Create New Area</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Area Name</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Front Yard" className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Color</label>
              <div className="flex items-center gap-2">
                {AREA_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setFormData({ ...formData, color: c })}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${formData.color === c ? 'border-earth-800 dark:border-white scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          {zones.length > 0 && (() => {
            const linkedZoneIds = new Set(areas.filter(a => a.zone_id).map(a => a.zone_id));
            const availableZones = zones.filter(z => !linkedZoneIds.has(z.id));
            return availableZones.length > 0 ? (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Link to Map Zone (optional)</label>
                <select value={formData.zone_id} onChange={(e) => setFormData({ ...formData, zone_id: e.target.value })}
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                  <option value="">None</option>
                  {availableZones.map(z => (
                    <option key={z.id} value={z.id}>{z.name}{z.zone_type ? ` (${z.zone_type})` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">Plants placed inside a linked zone on the map will auto-assign to this area.</p>
              </div>
            ) : null;
          })()}
          <button type="submit" disabled={submitting} className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
            {submitting ? 'Creating...' : 'Create Area'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading areas...</div>
      ) : areas.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">{'\u{1F4CD}'}</div>
          <h2 className="text-xl font-bold text-earth-700 dark:text-gray-200 mb-2">No areas yet</h2>
          <p className="text-earth-400 dark:text-gray-500">Create areas to organize your planters, trays, and ground plants by location.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {areas.map(area => {
            const total = area.bed_count + area.tray_count + area.ground_plant_count;
            return (
              <div key={area.id} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-3 h-8 rounded-full shrink-0" style={{ backgroundColor: area.color || '#9ca3af' }} />
                    {editingId === area.id ? (
                      <input autoFocus value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => handleRename(area.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRename(area.id); if (e.key === 'Escape') setEditingId(null); }}
                        className="text-lg font-bold text-earth-800 dark:text-gray-100 bg-transparent border-b-2 border-garden-500 outline-none px-1 flex-1" />
                    ) : (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Link href={`/areas/${area.id}`} className="text-lg font-bold text-earth-800 dark:text-gray-100 hover:text-garden-700 dark:hover:text-garden-400 transition-colors truncate">
                          {area.name}
                        </Link>
                        {area.zone_id && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 shrink-0" title={`Linked to map zone: ${area.zone_name || 'Unknown'}`}>
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                            Mapped
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditingId(area.id); setEditName(area.name); }}
                        className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded" title="Rename">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={() => handleDelete(area.id)}
                        className="text-earth-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-1 rounded" title="Delete">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    {area.bed_count > 0 && (
                      <Link href="/planters" className="px-2 py-1 rounded-full bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 hover:bg-garden-200 dark:hover:bg-garden-900/50 transition-colors">
                        {area.bed_count} planter{area.bed_count !== 1 ? 's' : ''}
                      </Link>
                    )}
                    {area.tray_count > 0 && (
                      <Link href="/trays" className="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors">
                        {area.tray_count} tray{area.tray_count !== 1 ? 's' : ''}
                      </Link>
                    )}
                    {area.ground_plant_count > 0 && (
                      <Link href="/ground-plants" className="px-2 py-1 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors">
                        {area.ground_plant_count} ground plant{area.ground_plant_count !== 1 ? 's' : ''}
                      </Link>
                    )}
                    {total === 0 && (
                      <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Empty</span>
                    )}
                  </div>

                  {area.default_irrigation_zone_name && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" /></svg>
                      <span>{area.default_irrigation_type === 'rachio_hose_timer' ? 'Rachio Hose Timer' : 'Rachio Controller'}: {area.default_irrigation_zone_name}</span>
                    </div>
                  )}

                  {area.notes && <p className="text-xs text-earth-500 dark:text-gray-400 mt-3 line-clamp-2">{area.notes}</p>}
                </div>
                <Link href={`/areas/${area.id}`} className="block px-5 py-3 border-t border-earth-100 dark:border-gray-700 text-sm text-garden-600 dark:text-garden-400 hover:bg-garden-50 dark:hover:bg-gray-700/50 transition-colors rounded-b-xl text-center font-medium">
                  View Area Contents
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
