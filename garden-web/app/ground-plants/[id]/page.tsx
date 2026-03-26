'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getGroundPlant, updateGroundPlant, getIrrigationZones, getJournalEntries, createJournalEntry, uploadJournalPhotos, getJournalPhotos, deleteJournalPhoto, getJournalPhotoUrl } from '../../api';
import SoilAmendments from '../../components/SoilAmendments';
import IrrigationSettings from '../../components/IrrigationSettings';
import RelatedTasks from '../../components/RelatedTasks';
import SensorReadings from '../../components/SensorReadings';
import { getPlantIcon } from '../../plant-icons';
import { useToast } from '../../toast';
import { useModal } from '../../confirm-modal';
import { plantingStatusColors as statusColors } from '../../constants';
import { formatGardenDate } from '../../timezone';

const STATUS_OPTIONS = ['planned', 'planted', 'growing', 'established', 'dormant', 'removed'] as const;

const IRRIGATION_LABELS: Record<string, string> = {
  manual: 'Manual',
  rachio_controller: 'Rachio Controller',
  rachio_hose_timer: 'Rachio Hose Timer',
  drip: 'Drip System',
  sprinkler: 'Sprinkler',
  bubbler: 'Bubbler',
  none: 'None',
};

interface GroundPlantDetail {
  id: number;
  name: string | null;
  plant_id: number;
  plant_name: string;
  plant_category: string;
  variety_id: number | null;
  variety_name: string | null;
  variety_desert_rating: number | null;
  variety_description: string | null;
  x_feet: number | null;
  y_feet: number | null;
  zone_id: number | null;
  zone_name: string | null;
  planted_date: string | null;
  status: string;
  irrigation_type: string;
  irrigation_zone_name: string | null;
  notes: string | null;
  created_at: string;
  area_id: number | null;
  area_name: string | null;
  area_color: string | null;
  effective_irrigation_type: string | null;
  effective_irrigation_zone_name: string | null;
  area_default_irrigation_zone_name: string | null;
  irrigation_inherited: boolean;
  area_auto_assigned?: boolean;
}

interface JournalEntry {
  id: number;
  entry_type: string;
  title: string | null;
  content: string;
  mood: string | null;
  tags: string[] | null;
  created_at: string;
  photos?: { id: number; filename: string; caption: string | null }[];
}

export default function GroundPlantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const gpId = Number(params.id);
  const { toast } = useToast();
  const { showConfirm } = useModal();

  const [gp, setGp] = useState<GroundPlantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Irrigation zones (for IrrigationSettings component)
  const [irrigationZones, setIrrigationZones] = useState<{ name: string; enabled: boolean }[]>([]);

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Status editing
  const [editingStatus, setEditingStatus] = useState(false);

  // Journal entries
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [newJournalContent, setNewJournalContent] = useState('');
  const [savingJournal, setSavingJournal] = useState(false);

  // Photos per journal entry
  const [entryPhotos, setEntryPhotos] = useState<Record<number, any[]>>({});

  // Photo upload
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const loadGp = useCallback(async () => {
    try {
      const data = await getGroundPlant(gpId);
      setGp(data);
      setNotesText(data.notes || '');
    } catch {
      setError('Ground plant not found');
    } finally {
      setLoading(false);
    }
  }, [gpId]);

  const loadJournal = useCallback(async () => {
    try {
      const data = await getJournalEntries({ ground_plant_id: gpId });
      setJournalEntries(data);
      // Load photos for each entry
      const photoMap: Record<number, any[]> = {};
      for (const entry of data) {
        if (entry.photos && entry.photos.length > 0) {
          photoMap[entry.id] = entry.photos;
        } else {
          try {
            const photos = await getJournalPhotos(entry.id);
            if (photos.length > 0) photoMap[entry.id] = photos;
          } catch { /* ignore */ }
        }
      }
      setEntryPhotos(photoMap);
    } catch { setJournalEntries([]); }
  }, [gpId]);

  useEffect(() => { loadGp(); }, [loadGp]);
  useEffect(() => { loadJournal(); }, [loadJournal]);

  useEffect(() => {
    getIrrigationZones().then((data: any) => {
      setIrrigationZones(data?.zones || []);
    }).catch(() => {});
  }, []);

  const handleSaveIrrigation = async (type: string, zoneName: string | null) => {
    await updateGroundPlant(gpId, {
      irrigation_type: type,
      irrigation_zone_name: zoneName || undefined,
    });
    await loadGp();
    toast('Irrigation settings updated');
  };

  const handleSaveNotes = async () => {
    if (!gp) return;
    setSavingNotes(true);
    try {
      await updateGroundPlant(gpId, { notes: notesText || undefined });
      await loadGp();
      setEditingNotes(false);
      toast('Notes updated');
    } catch {
      toast('Failed to update notes', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!gp) return;
    try {
      await updateGroundPlant(gpId, { status: newStatus });
      await loadGp();
      toast(`Status changed to ${newStatus}`);
    } catch {
      toast('Failed to update status', 'error');
    }
    setEditingStatus(false);
  };

  const handleAddJournalEntry = async () => {
    if (!newJournalContent.trim()) return;
    setSavingJournal(true);
    try {
      await createJournalEntry({
        entry_type: 'observation',
        content: newJournalContent.trim(),
        ground_plant_id: gpId,
      });
      setNewJournalContent('');
      loadJournal();
      toast('Observation added');
    } catch {
      toast('Failed to add observation', 'error');
    } finally {
      setSavingJournal(false);
    }
  };

  const handlePhotoUpload = async (entryId: number, files: FileList) => {
    setUploadingPhotos(true);
    try {
      await uploadJournalPhotos(entryId, Array.from(files));
      loadJournal();
      toast('Photo uploaded');
    } catch {
      toast('Failed to upload photo', 'error');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (!await showConfirm({ title: 'Delete Photo', message: 'Delete this photo?', confirmText: 'Delete', destructive: true })) return;
    try {
      await deleteJournalPhoto(photoId);
      loadJournal();
      toast('Photo deleted');
    } catch {
      toast('Failed to delete photo', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-garden-600" />
      </div>
    );
  }

  if (error || !gp) {
    return (
      <div className="space-y-4">
        <Link href="/ground-plants" className="text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 transition-colors">
          &larr; Ground
        </Link>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-600 dark:text-red-400">{error || 'Ground plant not found'}</p>
        </div>
      </div>
    );
  }

  const displayName = gp.name || gp.plant_name;
  const plantIcon = getPlantIcon(gp.plant_name, gp.plant_category);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/ground-plants" className="text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 transition-colors shrink-0">
            &larr; Ground
          </Link>
          <span className="text-earth-300 dark:text-gray-600 shrink-0">/</span>
          <h1 className="text-xl sm:text-2xl font-bold text-earth-800 dark:text-gray-100 truncate">
            <span className="mr-2">{plantIcon}</span>
            {displayName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Status badge */}
          {editingStatus ? (
            <select
              value={gp.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              onBlur={() => setEditingStatus(false)}
              autoFocus
              className="text-xs px-2 py-1 rounded border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-600 dark:text-gray-300"
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingStatus(true)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${statusColors[gp.status] || 'bg-gray-100 text-gray-600'}`}
              title="Click to change status"
            >
              {gp.status.charAt(0).toUpperCase() + gp.status.slice(1)}
            </button>
          )}
          {/* Category */}
          <span className="text-xs text-earth-500 dark:text-gray-400 px-2 py-0.5 bg-earth-100 dark:bg-gray-700 rounded-full">
            {gp.plant_category}
          </span>
          {/* Variety */}
          {gp.variety_name && (
            <span className="text-xs text-purple-700 dark:text-purple-300 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 rounded-full">
              {gp.variety_name}
              {gp.variety_desert_rating != null && (
                <span className="ml-1 opacity-75">({gp.variety_desert_rating}/5 desert)</span>
              )}
            </span>
          )}
          {/* Plant name if custom name exists */}
          {gp.name && gp.name !== gp.plant_name && (
            <span className="text-xs text-earth-400 dark:text-gray-500">
              {gp.plant_name}
            </span>
          )}
          {/* Edit link back to list */}
          <button
            onClick={() => router.push('/ground-plants')}
            className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded transition-colors"
            title="Edit in list view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
          </button>
        </div>
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Planted Date */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-3">
          <div className="text-[10px] uppercase tracking-wider text-earth-400 dark:text-gray-500 mb-1">Planted</div>
          <div className="text-sm font-medium text-earth-700 dark:text-gray-200">
            {gp.planted_date ? formatGardenDate(gp.planted_date) : 'Not set'}
          </div>
        </div>

        {/* Irrigation */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-3">
          <div className="text-[10px] uppercase tracking-wider text-earth-400 dark:text-gray-500 mb-1">Irrigation</div>
          <div className="text-sm font-medium text-earth-700 dark:text-gray-200">
            {IRRIGATION_LABELS[gp.effective_irrigation_type || gp.irrigation_type || 'manual'] || gp.irrigation_type || 'Manual'}
          </div>
          {gp.effective_irrigation_zone_name && (
            <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">{gp.effective_irrigation_zone_name}</div>
          )}
          {gp.irrigation_inherited && (
            <div className="text-[10px] text-earth-400 dark:text-gray-500 italic mt-0.5">Inherited from area</div>
          )}
        </div>

        {/* Area */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-3">
          <div className="text-[10px] uppercase tracking-wider text-earth-400 dark:text-gray-500 mb-1">Area</div>
          <div className="text-sm font-medium text-earth-700 dark:text-gray-200 flex items-center gap-1.5">
            {gp.area_color && (
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: gp.area_color }} />
            )}
            {gp.area_name || 'Unassigned'}
          </div>
          {gp.area_auto_assigned && (
            <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5">Auto-assigned from map</div>
          )}
        </div>

        {/* Map Position */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-3">
          <div className="text-[10px] uppercase tracking-wider text-earth-400 dark:text-gray-500 mb-1">Map Position</div>
          <div className="text-sm font-medium text-earth-700 dark:text-gray-200">
            {gp.x_feet != null && gp.y_feet != null ? (
              <Link href="/map" className="text-garden-600 dark:text-garden-400 hover:underline">
                ({gp.x_feet.toFixed(1)}, {gp.y_feet.toFixed(1)}) ft
              </Link>
            ) : (
              <span className="text-earth-400 dark:text-gray-500">Not placed</span>
            )}
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200">Notes</h2>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300"
            >
              Edit
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200 resize-y"
              placeholder="Add notes about this plant..."
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white disabled:opacity-50 transition-colors"
              >
                {savingNotes ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingNotes(false); setNotesText(gp.notes || ''); }}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-earth-600 dark:text-gray-400 whitespace-pre-wrap">
            {gp.notes || 'No notes yet.'}
          </p>
        )}
      </div>

      {/* Irrigation Settings Section */}
      <IrrigationSettings
        irrigationType={gp.effective_irrigation_type || gp.irrigation_type || 'manual'}
        irrigationZoneName={gp.effective_irrigation_zone_name || gp.irrigation_zone_name}
        inherited={gp.irrigation_inherited}
        onSave={handleSaveIrrigation}
        zones={irrigationZones}
      />

      {/* Soil Amendments Section */}
      <SoilAmendments entityType="ground_plant" entityId={gp.id} entityName={displayName} alwaysOpen />

      {/* Journal / Observations Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
          <span className="text-green-600">{'📝'}</span> Observations & Photos
        </h2>

        {/* Add observation */}
        <div className="space-y-2 mb-4">
          <textarea
            value={newJournalContent}
            onChange={(e) => setNewJournalContent(e.target.value)}
            rows={3}
            placeholder="Add an observation..."
            className="w-full px-3 py-2 text-sm rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200 resize-y"
          />
          <button
            disabled={savingJournal || !newJournalContent.trim()}
            onClick={handleAddJournalEntry}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white disabled:opacity-50 transition-colors"
          >
            {savingJournal ? 'Saving...' : 'Add Observation'}
          </button>
        </div>

        {/* Journal entries timeline */}
        {journalEntries.length > 0 ? (
          <div className="space-y-3">
            {journalEntries.map((entry) => {
              const photos = entryPhotos[entry.id] || [];
              return (
                <div key={entry.id} className="border border-earth-100 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 text-xs text-earth-400 dark:text-gray-500">
                      <span className="px-1.5 py-0.5 rounded bg-earth-100 dark:bg-gray-700 capitalize">{entry.entry_type}</span>
                      <span>{formatGardenDate(entry.created_at)}</span>
                      {entry.mood && <span>{entry.mood}</span>}
                    </div>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex gap-1">
                        {entry.tags.map((tag, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {entry.title && <div className="text-sm font-medium text-earth-700 dark:text-gray-200 mb-1">{entry.title}</div>}
                  <p className="text-sm text-earth-600 dark:text-gray-400 whitespace-pre-wrap">{entry.content}</p>

                  {/* Photos */}
                  {photos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {photos.map((photo: any) => (
                        <div key={photo.id} className="relative group">
                          <img
                            src={getJournalPhotoUrl(photo.id)}
                            alt={photo.caption || 'Plant photo'}
                            className="w-20 h-20 object-cover rounded-lg border border-earth-200 dark:border-gray-600"
                          />
                          <button
                            onClick={() => handleDeletePhoto(photo.id)}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            title="Delete photo"
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload photos to this entry */}
                  <label className="mt-2 inline-flex items-center gap-1 text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 cursor-pointer">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    {uploadingPhotos ? 'Uploading...' : 'Add Photo'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { if (e.target.files?.length) handlePhotoUpload(entry.id, e.target.files); }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">No observations yet.</div>
        )}
      </div>

      {/* Sensors */}
      <SensorReadings targetType="ground_plant" targetId={gp.id} />

      {/* Related Tasks Section */}
      <RelatedTasks entityType="ground_plant" entityId={gp.id} entityName={displayName} />

      {/* Variety Info */}
      {gp.variety_description && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
            <span className="text-purple-500">{'🌱'}</span> Variety Info
          </h2>
          <p className="text-sm text-earth-600 dark:text-gray-400">{gp.variety_description}</p>
        </div>
      )}

      {/* Metadata Footer */}
      <div className="text-xs text-earth-400 dark:text-gray-600 text-center pb-4">
        Added {formatGardenDate(gp.created_at)} &middot; ID #{gp.id}
      </div>
    </div>
  );
}
