'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getPlantInstance, updatePlantInstance, getPlantInstanceTimeline, getPhotoUrl } from '../../api';
import PlantTimeline from '../../components/PlantTimeline';
import RelatedTasks from '../../components/RelatedTasks';
import SensorReadings from '../../components/SensorReadings';
import { getPlantIcon } from '../../plant-icons';
import { useToast } from '../../toast';
import { plantingStatusColors as statusColors } from '../../constants';
import { formatGardenDate } from '../../timezone';
import { Skeleton, CardSkeleton } from '../../skeleton';

const INSTANCE_STATUSES = [
  'planned', 'seeded', 'sprouted', 'growing', 'flowering',
  'fruiting', 'harvested', 'established', 'dormant', 'removed', 'died',
] as const;

const locationTypeLabel: Record<string, string> = {
  planter: 'Planter',
  ground: 'In Ground',
  tray: 'Seed Tray',
};

interface PlantInstanceDetail {
  id: number;
  plant_id: number;
  variety_id: number | null;
  label: string | null;
  status: string;
  planted_date: string | null;
  notes: string | null;
  created_at: string;
  plant_name: string;
  plant_category: string;
  sun: string | null;
  water: string | null;
  days_to_maturity_min: number | null;
  days_to_maturity_max: number | null;
  variety_name: string | null;
  planting_id: number | null;
  ground_plant_id: number | null;
  current_location: {
    id: number;
    location_type: string;
    bed_id: number | null;
    cell_x: number | null;
    cell_y: number | null;
    ground_plant_id: number | null;
    tray_id: number | null;
    tray_row: number | null;
    tray_col: number | null;
    bed_name: string | null;
    tray_name: string | null;
    ground_plant_label: string | null;
    placed_at: string;
  } | null;
  location_history: Array<{
    id: number;
    location_type: string;
    bed_name: string | null;
    tray_name: string | null;
    ground_plant_label: string | null;
    placed_at: string;
    removed_at: string | null;
    is_current: number;
  }>;
  journal_entries: Array<Record<string, unknown>>;
  harvests: Array<Record<string, unknown>>;
  photos: Array<Record<string, unknown>>;
}

interface TimelineEntry {
  id: number;
  timeline_type: 'journal' | 'harvest' | 'location_change';
  created_at: string;
  entry_type?: string;
  title?: string;
  content?: string;
  severity?: string;
  milestone_type?: string;
  weight_oz?: number;
  quantity?: number;
  quality?: string;
  notes?: string;
  location_type?: string;
  bed_name?: string;
  tray_name?: string;
  ground_plant_label?: string;
  is_current?: number;
  removed_at?: string | null;
}

export default function PlantInstancePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const id = Number(params.id);

  const [instance, setInstance] = useState<PlantInstanceDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');

  const load = useCallback(async () => {
    try {
      const [inst, tl] = await Promise.all([
        getPlantInstance(id),
        getPlantInstanceTimeline(id),
      ]);
      setInstance(inst);
      setTimeline(tl);
      setNotesValue(inst.notes || '');
    } catch {
      setError('Failed to load plant instance.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updatePlantInstance(id, { status: newStatus });
      setInstance((prev) => prev ? { ...prev, status: newStatus } : prev);
      setEditingStatus(false);
      toast('Status updated');
    } catch {
      toast('Failed to update status', 'error');
    }
  };

  const handleSaveNotes = async () => {
    try {
      await updatePlantInstance(id, { notes: notesValue });
      setInstance((prev) => prev ? { ...prev, notes: notesValue } : prev);
      setEditingNotes(false);
      toast('Notes saved');
    } catch {
      toast('Failed to save notes', 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (error || !instance) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
        {error || 'Plant instance not found.'}
      </div>
    );
  }

  const icon = getPlantIcon(instance.plant_name, instance.plant_category);
  const loc = instance.current_location;

  // Build location link
  let locationLink: string | null = null;
  let locationLabel = 'No location set';
  if (loc) {
    if (loc.location_type === 'planter' && loc.bed_id) {
      locationLink = `/planters/${loc.bed_id}`;
      locationLabel = loc.bed_name || 'Planter';
      if (loc.cell_x != null && loc.cell_y != null) {
        locationLabel += ` (${loc.cell_x}, ${loc.cell_y})`;
      }
    } else if (loc.location_type === 'ground' && loc.ground_plant_id) {
      locationLink = `/ground-plants/${loc.ground_plant_id}`;
      locationLabel = loc.ground_plant_label || 'In Ground';
    } else if (loc.location_type === 'tray' && loc.tray_id) {
      locationLink = `/trays/${loc.tray_id}`;
      locationLabel = loc.tray_name || 'Seed Tray';
      if (loc.tray_row != null && loc.tray_col != null) {
        locationLabel += ` (Row ${loc.tray_row}, Col ${loc.tray_col})`;
      }
    }
  }

  const formatTimelineDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) return `${Math.max(1, Math.round(diffMs / (1000 * 60)))}m ago`;
    if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatGardenDate(dateStr, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/my-plantings"
        className="text-sm text-garden-600 dark:text-garden-400 hover:underline"
      >
        &larr; Back to My Plantings
      </Link>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="text-4xl">{icon}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">
              {instance.label || instance.plant_name}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {instance.variety_name && (
                <span className="text-sm text-earth-500 dark:text-gray-400">
                  {instance.variety_name}
                </span>
              )}
              {instance.label && (
                <span className="text-sm text-earth-400 dark:text-gray-500">
                  ({instance.plant_name})
                </span>
              )}
            </div>
            {instance.planted_date && (
              <p className="text-sm text-earth-400 dark:text-gray-500 mt-1">
                Planted {formatGardenDate(instance.planted_date, { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}
            {instance.days_to_maturity_min && (
              <p className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
                Maturity: {instance.days_to_maturity_min}
                {instance.days_to_maturity_max && instance.days_to_maturity_max !== instance.days_to_maturity_min
                  ? `\u2013${instance.days_to_maturity_max}`
                  : ''} days
              </p>
            )}
          </div>
          {/* Status badge */}
          <div className="shrink-0">
            {editingStatus ? (
              <select
                value={instance.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                onBlur={() => setEditingStatus(false)}
                autoFocus
                className="px-3 py-1 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
              >
                {INSTANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setEditingStatus(true)}
                className={`px-3 py-1 text-sm rounded-full font-medium cursor-pointer hover:ring-2 hover:ring-garden-400 transition-all ${
                  statusColors[instance.status] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
                title="Click to change status"
              >
                {instance.status.charAt(0).toUpperCase() + instance.status.slice(1)}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Location Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
          <span className="text-blue-500">{'\uD83D\uDCCD'}</span> Current Location
        </h2>
        {loc ? (
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 mr-2">
                {locationTypeLabel[loc.location_type] || loc.location_type}
              </span>
              {locationLink ? (
                <Link href={locationLink} className="text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium">
                  {locationLabel}
                </Link>
              ) : (
                <span className="text-sm text-earth-600 dark:text-gray-300">{locationLabel}</span>
              )}
              <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                Since {formatGardenDate(loc.placed_at, { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-earth-400 dark:text-gray-500">No location assigned.</p>
        )}

        {/* Location history */}
        {instance.location_history.length > 1 && (
          <details className="mt-3">
            <summary className="text-xs text-earth-400 dark:text-gray-500 cursor-pointer hover:text-earth-600 dark:hover:text-gray-300">
              Location history ({instance.location_history.length} locations)
            </summary>
            <div className="mt-2 space-y-1">
              {instance.location_history.map((lh) => (
                <div
                  key={lh.id}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    lh.is_current
                      ? 'border-garden-300 dark:border-garden-700 bg-garden-50 dark:bg-garden-900/20'
                      : 'border-earth-100 dark:border-gray-700 bg-earth-50 dark:bg-gray-800'
                  }`}
                >
                  <span className="font-medium">
                    {locationTypeLabel[lh.location_type] || lh.location_type}
                  </span>
                  {' \u2014 '}
                  {lh.bed_name || lh.tray_name || lh.ground_plant_label || 'Unknown'}
                  <span className="text-earth-400 dark:text-gray-500 ml-2">
                    {formatGardenDate(lh.placed_at, { month: 'short', day: 'numeric' })}
                    {lh.removed_at && ` \u2013 ${formatGardenDate(lh.removed_at, { month: 'short', day: 'numeric' })}`}
                  </span>
                  {lh.is_current ? (
                    <span className="ml-1 text-garden-600 dark:text-garden-400 font-medium">(current)</span>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Notes */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200">Notes</h2>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-xs text-garden-600 dark:text-garden-400 hover:underline"
            >
              Edit
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200 resize-y"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveNotes}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setNotesValue(instance.notes || '');
                  setEditingNotes(false);
                }}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-earth-600 dark:text-gray-400 whitespace-pre-wrap">
            {instance.notes || 'No notes yet.'}
          </p>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
          <span className="text-blue-500">{'\uD83D\uDCC5'}</span> Timeline
        </h2>
        {timeline.length === 0 ? (
          <p className="text-xs text-earth-400 dark:text-gray-500 text-center py-4">
            No timeline entries yet.
          </p>
        ) : (
          <div className="space-y-2">
            {timeline.map((entry, idx) => {
              const key = `${entry.timeline_type}_${entry.id}_${idx}`;
              let entryIcon = '\uD83D\uDCDD';
              let borderColor = 'border-l-earth-300 dark:border-l-gray-600';
              let label = '';

              if (entry.timeline_type === 'journal') {
                switch (entry.entry_type) {
                  case 'problem': entryIcon = '\u26A0\uFE0F'; borderColor = 'border-l-red-400 dark:border-l-red-600'; break;
                  case 'milestone': entryIcon = '\uD83C\uDF89'; borderColor = 'border-l-yellow-400 dark:border-l-yellow-500'; break;
                  case 'observation': entryIcon = '\uD83D\uDC40'; borderColor = 'border-l-blue-400 dark:border-l-blue-500'; break;
                  default: entryIcon = '\uD83D\uDCDD';
                }
                label = entry.entry_type || 'note';
              } else if (entry.timeline_type === 'harvest') {
                entryIcon = '\uD83E\uDDFA';
                borderColor = 'border-l-green-400 dark:border-l-green-600';
                label = 'harvest';
              } else if (entry.timeline_type === 'location_change') {
                entryIcon = '\uD83D\uDCCD';
                borderColor = 'border-l-purple-400 dark:border-l-purple-500';
                label = entry.is_current ? 'moved here' : 'was here';
              }

              return (
                <div
                  key={key}
                  className={`border-l-3 rounded-lg border border-earth-100 dark:border-gray-700 p-2.5 ${borderColor}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{entryIcon}</span>
                    <span className="text-[10px] uppercase tracking-wide font-medium text-earth-400 dark:text-gray-500">
                      {label}
                    </span>
                    {entry.severity && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                        {entry.severity}
                      </span>
                    )}
                    {entry.timeline_type === 'harvest' && (entry.weight_oz || entry.quantity) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                        {entry.weight_oz ? `${entry.weight_oz}oz` : ''}{entry.weight_oz && entry.quantity ? ', ' : ''}{entry.quantity ? `${entry.quantity} ct` : ''}
                      </span>
                    )}
                    <span className="text-[10px] text-earth-300 dark:text-gray-600 ml-auto">
                      {entry.created_at ? formatTimelineDate(entry.created_at) : ''}
                    </span>
                  </div>

                  {entry.title && (
                    <div className="text-xs font-medium text-earth-700 dark:text-gray-200 mb-0.5">{entry.title}</div>
                  )}
                  {(entry.content || entry.notes) && (
                    <p className="text-xs text-earth-600 dark:text-gray-400 whitespace-pre-wrap">
                      {entry.content || entry.notes}
                    </p>
                  )}
                  {entry.timeline_type === 'location_change' && (
                    <p className="text-xs text-earth-500 dark:text-gray-400">
                      {locationTypeLabel[entry.location_type || ''] || entry.location_type}
                      {' \u2014 '}
                      {entry.bed_name || entry.tray_name || entry.ground_plant_label || 'Unknown'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Plant Timeline component (for quick-add journal) */}
      {instance.planting_id && (
        <PlantTimeline
          plantType="planting"
          plantId={instance.planting_id}
          plantName={instance.label || instance.plant_name}
        />
      )}
      {instance.ground_plant_id && !instance.planting_id && (
        <PlantTimeline
          plantType="ground_plant"
          plantId={instance.ground_plant_id}
          plantName={instance.label || instance.plant_name}
        />
      )}

      {/* Photos */}
      {instance.photos.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
            <span className="text-blue-500">{'\uD83D\uDCF7'}</span> Photos ({instance.photos.length})
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {instance.photos.slice(0, 8).map((photo: Record<string, unknown>) => (
              <div
                key={photo.id as number}
                className="aspect-square rounded-lg overflow-hidden bg-earth-100 dark:bg-gray-700"
              >
                <img
                  src={getPhotoUrl(photo.id as number)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Harvest summary */}
      {instance.harvests.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
            <span className="text-green-500">{'\uD83E\uDDFA'}</span> Harvests ({instance.harvests.length})
          </h2>
          <div className="space-y-1">
            {instance.harvests.map((h: Record<string, unknown>) => {
              const parts: string[] = [];
              if (h.weight_oz) parts.push(`${h.weight_oz}oz`);
              if (h.quantity) parts.push(`${h.quantity} ct`);
              const amountStr = parts.join(', ') || 'Harvested';
              return (
                <div
                  key={h.id as number}
                  className="flex items-center justify-between text-sm text-earth-600 dark:text-gray-400 py-1 border-b border-earth-50 dark:border-gray-700 last:border-0"
                >
                  <span>
                    {amountStr}
                    {h.quality ? (
                      <span className="ml-2 text-xs text-earth-400 dark:text-gray-500">
                        Quality: {String(h.quality)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-earth-400 dark:text-gray-500">
                    {h.harvest_date ? formatGardenDate(h.harvest_date as string, { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Related Tasks */}
      {instance.planting_id && (
        <RelatedTasks entityType="bed" entityId={instance.planting_id} entityName={instance.label || instance.plant_name} />
      )}
      {instance.ground_plant_id && !instance.planting_id && (
        <RelatedTasks entityType="ground_plant" entityId={instance.ground_plant_id} entityName={instance.label || instance.plant_name} />
      )}

      {/* Sensor Readings */}
      {instance.planting_id && (
        <SensorReadings targetType="bed" targetId={instance.planting_id} />
      )}
      {instance.ground_plant_id && !instance.planting_id && (
        <SensorReadings targetType="ground_plant" targetId={instance.ground_plant_id} />
      )}

      {/* Info footer */}
      <div className="text-xs text-earth-400 dark:text-gray-500 flex items-center gap-3">
        <span>Instance #{instance.id}</span>
        {instance.sun && <span>Sun: {instance.sun}</span>}
        {instance.water && <span>Water: {instance.water}</span>}
        <span>Created {formatGardenDate(instance.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
    </div>
  );
}
