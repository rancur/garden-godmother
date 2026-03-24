'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAreaContents, updateArea, deleteArea, getIrrigationZones } from '../../api';
import { getPlantIcon } from '../../plant-icons';
import { useModal } from '../../confirm-modal';
import { useToast } from '../../toast';
import { AREA_COLORS, plantingStatusColors as statusColors } from '../../constants';
import type { Area } from '../../types';

interface IrrigationZone {
  id: string;
  name: string;
  zone_number: number;
  enabled: boolean;
}

interface IrrigationValve {
  id: string;
  name: string;
  device_name: string;
  enabled: boolean;
}

interface Bed {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  bed_type?: string;
  active_plantings: number;
}

interface Tray {
  id: number;
  name: string;
  rows: number;
  cols: number;
  cell_size: string;
}

interface GroundPlant {
  id: number;
  name: string | null;
  plant_name: string;
  plant_category: string;
  status: string;
  planted_date: string | null;
  zone_name: string | null;
  irrigation_zone_name: string | null;
  effective_irrigation_zone_name: string | null;
  irrigation_inherited: boolean;
}

export default function AreaDetailPage() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const params = useParams();
  const router = useRouter();
  const areaId = Number(params.id);

  const [area, setArea] = useState<Area | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [trays, setTrays] = useState<Tray[]>([]);
  const [groundPlants, setGroundPlants] = useState<GroundPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [irrigationZones, setIrrigationZones] = useState<IrrigationZone[]>([]);
  const [irrigationValves, setIrrigationValves] = useState<IrrigationValve[]>([]);
  const [irrigationType, setIrrigationType] = useState<string>('manual');
  const [irrigationZoneName, setIrrigationZoneName] = useState('');
  const [savingIrrigation, setSavingIrrigation] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [data, zonesData] = await Promise.all([getAreaContents(areaId), getIrrigationZones().catch(() => ({ zones: [] }))]);
      setArea(data.area);
      setBeds(data.beds || []);
      setTrays(data.trays || []);
      setGroundPlants(data.ground_plants || []);
      const zonesList = zonesData?.zones || [];
      if (Array.isArray(zonesList)) setIrrigationZones(zonesList);
      setIrrigationValves(zonesData?.valves || []);
      setIrrigationType(data.area?.default_irrigation_type || 'manual');
      setIrrigationZoneName(data.area?.default_irrigation_zone_name || '');
    } catch {
      setError('Failed to load area');
    } finally {
      setLoading(false);
    }
  }, [areaId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    if (!editName.trim()) { setEditing(false); return; }
    try {
      const updates: Record<string, string> = {};
      if (editName !== area?.name) updates.name = editName;
      if (editColor !== area?.color) updates.color = editColor;
      if (Object.keys(updates).length > 0) {
        await updateArea(areaId, updates);
        loadData();
      }
      setEditing(false);
      toast('Area updated');
    } catch { toast('Failed to update area', 'error'); }
  };

  const handleDelete = async () => {
    if (!await showConfirm({ title: 'Delete Area', message: 'Delete this area? All items will be unassigned.', confirmText: 'Delete', destructive: true })) return;
    try {
      await deleteArea(areaId);
      toast('Area deleted');
      router.push('/areas');
    } catch { toast('Failed to delete area', 'error'); }
  };

  const handleSaveIrrigation = async () => {
    setSavingIrrigation(true);
    try {
      await updateArea(areaId, {
        default_irrigation_type: irrigationType,
        default_irrigation_zone_name: irrigationZoneName || '',
      });
      loadData();
      toast('Irrigation settings saved');
    } catch { toast('Failed to update irrigation settings', 'error'); }
    finally { setSavingIrrigation(false); }
  };

  if (loading) return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading area...</div>;
  if (!area) return <div className="text-center py-12 text-red-500">Area not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/areas" className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div className="w-2 h-10 rounded-full" style={{ backgroundColor: area.color || '#9ca3af' }} />
          {editing ? (
            <div className="space-y-2">
              <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
                className="text-2xl font-bold text-earth-800 dark:text-gray-100 bg-transparent border-b-2 border-garden-500 outline-none" />
              <div className="flex items-center gap-2">
                {AREA_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setEditColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${editColor === c ? 'border-earth-800 dark:border-white scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} className="text-sm bg-garden-600 text-white px-3 py-1 rounded-lg">Save</button>
                <button onClick={() => setEditing(false)} className="text-sm text-earth-500 dark:text-gray-400 px-3 py-1">Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">{area.name}</h1>
              <p className="text-earth-500 dark:text-gray-400 mt-1">
                {beds.length} planter{beds.length !== 1 ? 's' : ''} · {trays.length} tray{trays.length !== 1 ? 's' : ''} · {groundPlants.length} ground plant{groundPlants.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditing(true); setEditName(area.name); setEditColor(area.color || '#9ca3af'); }}
              className="bg-earth-100 hover:bg-earth-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-earth-700 dark:text-gray-200 px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm">
              Edit
            </button>
            <button onClick={handleDelete}
              className="bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm">
              Delete
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {area.notes && (
        <div className="bg-earth-50 dark:bg-gray-800 rounded-lg p-4 text-earth-600 dark:text-gray-300 text-sm">{area.notes}</div>
      )}

      {/* Irrigation Settings */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" /></svg>
          Default Irrigation
        </h2>
        <p className="text-sm text-earth-500 dark:text-gray-400 mb-3">
          Ground plants in this area will inherit this irrigation setting unless they have their own override.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Watering Method</label>
            <select
              value={irrigationType}
              onChange={(e) => { setIrrigationType(e.target.value); setIrrigationZoneName(''); }}
              className="px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
            >
              <option value="rachio_controller">Rachio Controller</option>
              <option value="rachio_hose_timer">Rachio Hose Timer</option>
              <option value="manual">Manual</option>
              <option value="drip">Drip System</option>
              <option value="sprinkler">Sprinkler</option>
              <option value="bubbler">Bubbler</option>
              <option value="none">None</option>
            </select>
          </div>

          {irrigationType === 'rachio_controller' && (
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Controller Zone</label>
              {irrigationZones.length > 0 ? (
                <select
                  value={irrigationZoneName}
                  onChange={(e) => setIrrigationZoneName(e.target.value)}
                  className="px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
                >
                  <option value="">Select a zone...</option>
                  {irrigationZones.map(z => (
                    <option key={z.id} value={z.name}>Zone {z.zone_number}: {z.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={irrigationZoneName}
                  onChange={(e) => setIrrigationZoneName(e.target.value)}
                  placeholder="e.g., Front Yard Zone 1"
                  className="px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
                />
              )}
            </div>
          )}

          {irrigationType === 'rachio_hose_timer' && (
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Hose Timer Valve</label>
              {irrigationValves.length > 0 ? (
                <select
                  value={irrigationZoneName}
                  onChange={(e) => setIrrigationZoneName(e.target.value)}
                  className="px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
                >
                  <option value="">Select a valve...</option>
                  {irrigationValves.map(v => (
                    <option key={v.id} value={v.name}>{v.device_name}: {v.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={irrigationZoneName}
                  onChange={(e) => setIrrigationZoneName(e.target.value)}
                  placeholder="e.g., Hose Timer 1"
                  className="px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
                />
              )}
            </div>
          )}

          <button
            onClick={handleSaveIrrigation}
            disabled={savingIrrigation || (irrigationType === (area.default_irrigation_type || 'manual') && irrigationZoneName === (area.default_irrigation_zone_name || ''))}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {savingIrrigation ? 'Saving...' : 'Save'}
          </button>
        </div>
        {area.default_irrigation_zone_name && (
          <div className="mt-3 text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
            <span>Current: {area.default_irrigation_type === 'rachio_hose_timer' ? 'Rachio Hose Timer' : 'Rachio Controller'} &quot;{area.default_irrigation_zone_name}&quot;</span>
          </div>
        )}
      </section>

      {/* Planters */}
      {beds.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100 mb-3 flex items-center gap-2">
            <span>{'\u{1FAB4}'}</span> Planters
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {beds.map(bed => (
              <Link key={bed.id} href={`/planters/${bed.id}`}
                className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md hover:border-garden-300 dark:hover:border-garden-600 transition-all">
                <h3 className="font-bold text-earth-800 dark:text-gray-100">{bed.name}</h3>
                <div className="mt-2 flex items-center gap-3 text-sm text-earth-500 dark:text-gray-400">
                  {bed.bed_type && bed.bed_type !== 'grid' && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{bed.bed_type}</span>
                  )}
                  <span>{bed.width_cells}x{bed.height_cells}</span>
                  <span className="text-garden-600 font-bold ml-auto">{bed.active_plantings || 0} plantings</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Trays */}
      {trays.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100 mb-3 flex items-center gap-2">
            <span>{'\u{1F33F}'}</span> Trays
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {trays.map(tray => (
              <Link key={tray.id} href={`/trays/${tray.id}`}
                className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md hover:border-garden-300 dark:hover:border-garden-600 transition-all">
                <h3 className="font-bold text-earth-800 dark:text-gray-100">{tray.name}</h3>
                <div className="mt-2 text-sm text-earth-500 dark:text-gray-400">
                  {tray.rows}x{tray.cols} cells · {tray.cell_size}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Ground Plants */}
      {groundPlants.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100 mb-3 flex items-center gap-2">
            <span>{'\u{1F333}'}</span> Ground Plants
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groundPlants.map(gp => (
              <div key={gp.id} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{getPlantIcon(gp.plant_name, gp.plant_category)}</span>
                  <div className="min-w-0">
                    <h3 className="font-bold text-earth-800 dark:text-gray-100 truncate">{gp.name || gp.plant_name}</h3>
                    {gp.name && gp.name !== gp.plant_name && (
                      <p className="text-xs text-earth-400 dark:text-gray-500">{gp.plant_name}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${statusColors[gp.status] || 'bg-gray-100 text-gray-600'}`}>
                    {gp.status.charAt(0).toUpperCase() + gp.status.slice(1)}
                  </span>
                  {gp.effective_irrigation_zone_name && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                      Rachio: {gp.effective_irrigation_zone_name}
                      {gp.irrigation_inherited ? ' (area)' : ''}
                    </span>
                  )}
                </div>
                {gp.planted_date && <p className="text-xs text-earth-400 dark:text-gray-500 mt-2">Planted {gp.planted_date}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {beds.length === 0 && trays.length === 0 && groundPlants.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">{'\u{1F4CD}'}</div>
          <h2 className="text-xl font-bold text-earth-700 dark:text-gray-200 mb-2">This area is empty</h2>
          <p className="text-earth-400 dark:text-gray-500">Assign planters, trays, or ground plants to this area from their respective pages.</p>
        </div>
      )}
    </div>
  );
}
