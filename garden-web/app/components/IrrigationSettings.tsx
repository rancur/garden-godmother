'use client';

import { useState } from 'react';

const IRRIGATION_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'rachio_controller', label: 'Rachio Controller' },
  { value: 'rachio_hose_timer', label: 'Rachio Hose Timer' },
  { value: 'drip', label: 'Drip System' },
  { value: 'sprinkler', label: 'Sprinkler' },
  { value: 'bubbler', label: 'Bubbler' },
  { value: 'none', label: 'None' },
];

const IRRIGATION_LABELS: Record<string, string> = Object.fromEntries(
  IRRIGATION_OPTIONS.map((o) => [o.value, o.label])
);

interface IrrigationSettingsProps {
  irrigationType: string;
  irrigationZoneName: string | null;
  inherited?: boolean;
  onSave: (type: string, zoneName: string | null) => Promise<void>;
  zones?: { name: string; enabled?: boolean }[];
}

export default function IrrigationSettings({
  irrigationType,
  irrigationZoneName,
  inherited,
  onSave,
  zones = [],
}: IrrigationSettingsProps) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(irrigationType || 'manual');
  const [zoneName, setZoneName] = useState(irrigationZoneName || '');
  const [saving, setSaving] = useState(false);

  const showRachioZone = type === 'rachio_controller' || type === 'rachio_hose_timer';

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(type, zoneName || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setType(irrigationType || 'manual');
    setZoneName(irrigationZoneName || '');
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-1.5">
          <span className="text-blue-500">{'💧'}</span> Irrigation Settings
        </h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300"
          >
            Change
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Irrigation Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
            >
              {IRRIGATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {showRachioZone && (
            <div>
              <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Rachio Zone</label>
              <select
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              >
                <option value="">Select zone...</option>
                {zones.map((z) => (
                  <option key={z.name} value={z.name}>
                    {z.name}{z.enabled === false ? ' (disabled)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-earth-700 dark:text-gray-200 space-y-1">
          <div>
            <span className="text-earth-500 dark:text-gray-400">Type:</span>{' '}
            {IRRIGATION_LABELS[irrigationType] || irrigationType || 'Manual'}
          </div>
          {irrigationZoneName && (
            <div>
              <span className="text-earth-500 dark:text-gray-400">Zone:</span>{' '}
              {irrigationZoneName}
            </div>
          )}
          {inherited && (
            <div className="text-xs text-earth-400 dark:text-gray-500 italic">Inherited from area</div>
          )}
        </div>
      )}
    </div>
  );
}
