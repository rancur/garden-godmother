'use client';

import { useEffect, useState, useCallback } from 'react';
import { getPestIncidents, createPestIncident, updatePestIncident, deletePestIncident, getPestPatterns, getMyPlantings, getBeds, getPlants } from '../api';
import { useToast } from '../toast';
import { useModal } from '../confirm-modal';
import { getGardenToday } from '../timezone';

interface PestIncident {
  id: number;
  plant_id: number | null;
  bed_id: number | null;
  ground_plant_id: number | null;
  pest_type: string;
  pest_name: string;
  severity: string;
  status: string;
  treatment: string | null;
  notes: string | null;
  detected_date: string;
  resolved_date: string | null;
  created_at: string;
  plant_name: string | null;
  bed_name: string | null;
  ground_plant_name: string | null;
}

interface PestPatterns {
  by_month: { month: string; pest_name: string; pest_type: string; incident_count: number; severe_count: number }[];
  by_plant: { plant_name: string; plant_id: number; incident_count: number; pests_seen: string }[];
  by_bed: { bed_name: string; bed_id: number; incident_count: number; pests_seen: string }[];
  by_pest: { pest_name: string; pest_type: string; incident_count: number; avg_severity: number; resolved_count: number; active_count: number }[];
  effective_treatments: { pest_name: string; treatment: string; times_used: number; resolved_count: number }[];
}

interface MyPlanting {
  id: number;
  plant_name: string;
  plant_id: number;
  container_type: string;
  container_name: string;
  container_id: number;
}

const PEST_TYPES = [
  { value: 'insect', label: 'Insect' },
  { value: 'disease', label: 'Disease' },
  { value: 'fungus', label: 'Fungus' },
  { value: 'nutrient', label: 'Nutrient Deficiency' },
  { value: 'environmental', label: 'Environmental' },
];

const COMMON_PESTS: Record<string, string[]> = {
  insect: ['Aphids', 'Whiteflies', 'Spider Mites', 'Tomato Hornworm', 'Squash Bugs', 'Leaf Miners', 'Cabbage Loopers', 'Flea Beetles', 'Thrips', 'Mealybugs'],
  disease: ['Powdery Mildew', 'Root Rot', 'Blossom End Rot', 'Bacterial Wilt', 'Mosaic Virus', 'Damping Off', 'Leaf Spot'],
  fungus: ['Powdery Mildew', 'Downy Mildew', 'Fusarium Wilt', 'Sooty Mold', 'Rust', 'Anthracnose'],
  nutrient: ['Iron Chlorosis', 'Nitrogen Deficiency', 'Phosphorus Deficiency', 'Potassium Deficiency', 'Magnesium Deficiency', 'Calcium Deficiency'],
  environmental: ['Sunscald', 'Heat Stress', 'Frost Damage', 'Wind Damage', 'Overwatering', 'Underwatering'],
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  monitoring: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  treated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysSince(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default function PestsPage() {
  const { toast } = useToast();
  const { showConfirm } = useModal();
  const [incidents, setIncidents] = useState<PestIncident[]>([]);
  const [patterns, setPatterns] = useState<PestPatterns | null>(null);
  const [plantings, setPlantings] = useState<MyPlanting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);

  // Form state
  const [form, setForm] = useState({
    pest_type: 'insect',
    pest_name: '',
    custom_pest_name: '',
    severity: 'low',
    detected_date: getGardenToday(),
    planting_id: '',
    treatment: '',
    notes: '',
  });

  const loadData = useCallback(async () => {
    try {
      const params = statusFilter ? { status: statusFilter } : undefined;
      const [incidentData, plantingData] = await Promise.all([
        getPestIncidents(params),
        getMyPlantings(),
      ]);
      setIncidents(incidentData);
      setPlantings(plantingData);
    } catch {
      toast('Failed to load pest data', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  const loadPatterns = useCallback(async () => {
    try {
      const data = await getPestPatterns();
      setPatterns(data);
    } catch {
      toast('Failed to load patterns', 'error');
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (showPatterns && !patterns) loadPatterns();
  }, [showPatterns, patterns, loadPatterns]);

  const handleSubmit = async () => {
    const pestName = form.pest_name === '__custom__' ? form.custom_pest_name.trim() : form.pest_name;
    if (!pestName) {
      toast('Select or enter a pest name', 'error');
      return;
    }

    setSubmitting(true);
    try {
      // Resolve planting to plant_id, bed_id, or ground_plant_id
      let plant_id: number | null = null;
      let bed_id: number | null = null;
      let ground_plant_id: number | null = null;

      if (form.planting_id) {
        const planting = plantings.find(p => String(p.id) === form.planting_id);
        if (planting) {
          plant_id = planting.plant_id;
          if (planting.container_type === 'planter') {
            bed_id = planting.container_id;
          } else if (planting.container_type === 'ground') {
            ground_plant_id = planting.container_id;
          }
        }
      }

      await createPestIncident({
        pest_type: form.pest_type,
        pest_name: pestName,
        severity: form.severity,
        detected_date: form.detected_date,
        plant_id,
        bed_id,
        ground_plant_id,
        treatment: form.treatment || undefined,
        notes: form.notes || undefined,
      });

      toast('Incident logged');
      setShowForm(false);
      setForm({
        pest_type: 'insect',
        pest_name: '',
        custom_pest_name: '',
        severity: 'low',
        detected_date: getGardenToday(),
        planting_id: '',
        treatment: '',
        notes: '',
      });
      await loadData();
    } catch {
      toast('Failed to log incident', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: number, newStatus: string) => {
    try {
      await updatePestIncident(id, { status: newStatus });
      toast(`Status updated to ${newStatus}`);
      await loadData();
    } catch {
      toast('Failed to update status', 'error');
    }
  };

  const handleUpdateTreatment = async (id: number, treatment: string) => {
    try {
      await updatePestIncident(id, { treatment });
      toast('Treatment updated');
      setEditingId(null);
      await loadData();
    } catch {
      toast('Failed to update treatment', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    const confirmed = await showConfirm({ title: 'Delete Incident', message: 'Delete this pest incident?', confirmText: 'Delete', destructive: true });
    if (!confirmed) return;
    try {
      await deletePestIncident(id);
      toast('Incident deleted');
      await loadData();
    } catch {
      toast('Failed to delete', 'error');
    }
  };

  const activeCount = incidents.filter(i => i.status === 'active').length;
  const monitoringCount = incidents.filter(i => i.status === 'monitoring').length;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="animate-pulse h-8 bg-earth-100 dark:bg-gray-700 rounded w-1/3" />
        <div className="animate-pulse h-32 bg-earth-100 dark:bg-gray-700 rounded" />
        <div className="animate-pulse h-32 bg-earth-100 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-earth-800 dark:text-gray-100 flex items-center gap-2">
            {'\u{1F41B}'} Pest & Disease Tracker
          </h1>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-0.5">
            {activeCount > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{activeCount} active</span>}
            {activeCount > 0 && monitoringCount > 0 && ' \u00B7 '}
            {monitoringCount > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">{monitoringCount} monitoring</span>}
            {activeCount === 0 && monitoringCount === 0 && 'No active incidents'}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
        >
          {showForm ? 'Cancel' : '+ Log Incident'}
        </button>
      </div>

      {/* Log Form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200">New Pest/Disease Incident</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Pest Type */}
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Type</label>
              <select
                value={form.pest_type}
                onChange={(e) => setForm({ ...form, pest_type: e.target.value, pest_name: '', custom_pest_name: '' })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              >
                {PEST_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Pest Name */}
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Name</label>
              <select
                value={form.pest_name}
                onChange={(e) => setForm({ ...form, pest_name: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              >
                <option value="">Select...</option>
                {(COMMON_PESTS[form.pest_type] || []).map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="__custom__">Other (custom)...</option>
              </select>
            </div>

            {form.pest_name === '__custom__' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Custom Name</label>
                <input
                  type="text"
                  value={form.custom_pest_name}
                  onChange={(e) => setForm({ ...form, custom_pest_name: e.target.value })}
                  placeholder="Enter pest or disease name"
                  className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
                />
              </div>
            )}

            {/* Severity */}
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Severity</label>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Detected Date</label>
              <input
                type="date"
                value={form.detected_date}
                onChange={(e) => setForm({ ...form, detected_date: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              />
            </div>

            {/* Affected Plant */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Affected Plant (optional)</label>
              <select
                value={form.planting_id}
                onChange={(e) => setForm({ ...form, planting_id: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              >
                <option value="">None / general</option>
                {plantings.map(p => (
                  <option key={`${p.container_type}-${p.id}`} value={String(p.id)}>
                    {p.plant_name} ({p.container_name || p.container_type})
                  </option>
                ))}
              </select>
            </div>

            {/* Treatment */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Treatment (optional)</label>
              <input
                type="text"
                value={form.treatment}
                onChange={(e) => setForm({ ...form, treatment: e.target.value })}
                placeholder="e.g., Neem oil spray, removed affected leaves"
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              />
            </div>

            {/* Notes */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="Additional observations..."
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200 resize-y"
              />
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving...' : 'Log Incident'}
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {['', 'active', 'monitoring', 'treated', 'resolved'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === s
                ? 'bg-garden-600 text-white'
                : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Incidents list */}
      {incidents.length > 0 ? (
        <div className="space-y-3">
          {incidents.map((incident) => {
            const days = daysSince(incident.detected_date);
            const affectedLabel = incident.plant_name
              ? `${incident.plant_name}${incident.bed_name ? ` (${incident.bed_name})` : ''}${incident.ground_plant_name ? ` (${incident.ground_plant_name})` : ''}`
              : incident.bed_name || incident.ground_plant_name || 'General';

            return (
              <div
                key={incident.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-100">
                        {incident.pest_name}
                      </h3>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${SEVERITY_COLORS[incident.severity] || ''}`}>
                        {incident.severity.toUpperCase()}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[incident.status] || ''}`}>
                        {incident.status}
                      </span>
                    </div>
                    <div className="text-xs text-earth-500 dark:text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
                      <span className="capitalize">{incident.pest_type}</span>
                      <span>&middot;</span>
                      <span>{affectedLabel}</span>
                      <span>&middot;</span>
                      <span>
                        {incident.status === 'resolved' ? 'Resolved' : `${days}d active`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Status transitions */}
                    {incident.status === 'active' && (
                      <button
                        onClick={() => handleStatusChange(incident.id, 'treated')}
                        className="text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                      >
                        Treated
                      </button>
                    )}
                    {(incident.status === 'active' || incident.status === 'treated') && (
                      <button
                        onClick={() => handleStatusChange(incident.id, 'monitoring')}
                        className="text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        Monitor
                      </button>
                    )}
                    {incident.status !== 'resolved' && (
                      <button
                        onClick={() => handleStatusChange(incident.id, 'resolved')}
                        className="text-xs px-2 py-1 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
                      >
                        Resolved
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(incident.id)}
                      className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Treatment */}
                {editingId === incident.id ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      defaultValue={incident.treatment || ''}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateTreatment(incident.id, (e.target as HTMLInputElement).value);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      placeholder="Treatment applied..."
                      className="flex-1 text-sm px-2 py-1 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
                    />
                    <button onClick={() => setEditingId(null)} className="text-xs text-earth-400">Cancel</button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    {incident.treatment ? (
                      <p className="text-xs text-earth-600 dark:text-gray-400">
                        <span className="font-medium">Treatment:</span> {incident.treatment}
                      </p>
                    ) : null}
                    <button
                      onClick={() => setEditingId(incident.id)}
                      className="text-[10px] text-garden-600 dark:text-garden-400 hover:text-garden-700"
                    >
                      {incident.treatment ? 'Edit' : '+ Add treatment'}
                    </button>
                  </div>
                )}

                {/* Notes */}
                {incident.notes && (
                  <p className="mt-1 text-xs text-earth-500 dark:text-gray-500 italic">{incident.notes}</p>
                )}

                <div className="mt-2 text-[10px] text-earth-400 dark:text-gray-600">
                  Detected {incident.detected_date}
                  {incident.resolved_date && ` \u00B7 Resolved ${incident.resolved_date}`}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-8 text-center">
          <div className="text-4xl mb-2">{'\u{1F389}'}</div>
          <p className="text-sm text-earth-500 dark:text-gray-400">
            {statusFilter ? `No ${statusFilter} incidents found.` : 'No pest or disease incidents recorded. Your garden is clean!'}
          </p>
        </div>
      )}

      {/* Patterns section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => setShowPatterns(!showPatterns)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-earth-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-1.5">
            {'\u{1F4CA}'} Patterns & Analysis
          </h2>
          <svg
            className={`w-4 h-4 text-earth-400 transition-transform ${showPatterns ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showPatterns && patterns && (
          <div className="px-4 pb-4 space-y-4">
            {/* Most common pests */}
            {patterns.by_pest.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-earth-600 dark:text-gray-300 mb-2 uppercase tracking-wide">Most Common Pests</h3>
                <div className="space-y-1">
                  {patterns.by_pest.slice(0, 8).map((p) => (
                    <div key={p.pest_name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-earth-700 dark:text-gray-200 font-medium">{p.pest_name}</span>
                        <span className="text-[10px] text-earth-400 dark:text-gray-500 capitalize">{p.pest_type}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-earth-500 dark:text-gray-400">{p.incident_count}x</span>
                        {p.active_count > 0 && (
                          <span className="text-red-600 dark:text-red-400">{p.active_count} active</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Seasonal patterns */}
            {patterns.by_month.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-earth-600 dark:text-gray-300 mb-2 uppercase tracking-wide">Seasonal Patterns</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {patterns.by_month.slice(0, 12).map((m, i) => {
                    const monthIdx = parseInt(m.month) - 1;
                    const monthName = MONTH_NAMES[monthIdx] || m.month;
                    return (
                      <div key={i} className="text-xs bg-earth-50 dark:bg-gray-700/30 rounded p-2">
                        <div className="font-medium text-earth-600 dark:text-gray-300">{monthName}</div>
                        <div className="text-earth-800 dark:text-gray-200">{m.pest_name}</div>
                        <div className="text-earth-400 dark:text-gray-500">{m.incident_count}x</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Most affected plants */}
            {patterns.by_plant.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-earth-600 dark:text-gray-300 mb-2 uppercase tracking-wide">Most Affected Plants</h3>
                <div className="space-y-1">
                  {patterns.by_plant.slice(0, 6).map((p) => (
                    <div key={p.plant_id} className="flex items-center justify-between text-sm">
                      <span className="text-earth-700 dark:text-gray-200">{p.plant_name}</span>
                      <div className="text-xs text-earth-400 dark:text-gray-500">
                        {p.incident_count}x &middot; {p.pests_seen}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Effective treatments */}
            {patterns.effective_treatments.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-earth-600 dark:text-gray-300 mb-2 uppercase tracking-wide">Effective Treatments</h3>
                <div className="space-y-1">
                  {patterns.effective_treatments.slice(0, 6).map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="text-earth-700 dark:text-gray-200 font-medium">{t.treatment}</span>
                        <span className="text-xs text-earth-400 dark:text-gray-500 ml-2">for {t.pest_name}</span>
                      </div>
                      <span className="text-xs text-green-600 dark:text-green-400">{t.resolved_count}/{t.times_used} resolved</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {patterns.by_pest.length === 0 && patterns.by_month.length === 0 && (
              <p className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">
                Not enough data to show patterns yet. Log some incidents first.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
