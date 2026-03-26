'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSensorReadingsForTarget, getSensorAvailable, upsertSensorAssignment, deleteSensorAssignment } from '../api';
import { useToast } from '../toast';

interface SensorReading {
  assignment_id: number;
  entity_id: string;
  entity_friendly_name: string | null;
  sensor_role: string;
  state: number | null;
  unit: string | null;
  last_updated: string | null;
  friendly_name?: string;
}

interface Assignment {
  id: number;
  entity_id: string;
  entity_friendly_name: string | null;
  target_type: string;
  target_id: number;
  sensor_role: string;
}

interface SensorReadingsProps {
  targetType: 'bed' | 'ground_plant' | 'tray' | 'area';
  targetId: number;
}

interface MoistureSensor {
  name: string;
  entity_id: string;
  friendly_name?: string;
}

const SENSOR_ROLE_LABELS: Record<string, string> = {
  soil_moisture: 'Soil Moisture',
  temperature: 'Temperature',
  humidity: 'Humidity',
  battery: 'Battery',
  light: 'Light',
};

const SENSOR_ROLE_ICONS: Record<string, string> = {
  soil_moisture: '\u{1F4A7}',
  temperature: '\u{1F321}\uFE0F',
  humidity: '\u{1F4A8}',
  battery: '\u{1F50B}',
  light: '\u2600\uFE0F',
};

function formatReading(value: number | null, unit: string | null, role: string): string {
  if (value === null || value === undefined) return 'N/A';
  const v = typeof value === 'number' ? value.toFixed(1) : String(value);
  if (unit) return `${v}${unit}`;
  if (role === 'soil_moisture') return `${v}%`;
  return v;
}

function getMoistureColor(value: number | null): string {
  if (value === null) return 'text-earth-400 dark:text-gray-500';
  if (value < 20) return 'text-red-600 dark:text-red-400';
  if (value < 40) return 'text-amber-600 dark:text-amber-400';
  if (value < 70) return 'text-green-600 dark:text-green-400';
  return 'text-blue-600 dark:text-blue-400';
}

export default function SensorReadings({ targetType, targetId }: SensorReadingsProps) {
  const { toast } = useToast();
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [availableSensors, setAvailableSensors] = useState<MoistureSensor[]>([]);
  const [loadingSensors, setLoadingSensors] = useState(false);

  // Assign form state
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedRole, setSelectedRole] = useState('soil_moisture');
  const [customEntityId, setCustomEntityId] = useState('');
  const [assigning, setAssigning] = useState(false);

  const loadReadings = useCallback(async () => {
    try {
      const data = await getSensorReadingsForTarget(targetType, targetId);
      setReadings(data.readings || []);
      setAssignments(data.assignments || []);
    } catch {
      // Silently fail — sensor section is optional
    } finally {
      setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => { loadReadings(); }, [loadReadings]);

  // Auto-refresh readings every 60s
  useEffect(() => {
    const interval = setInterval(loadReadings, 60000);
    return () => clearInterval(interval);
  }, [loadReadings]);

  const loadAvailableSensors = async () => {
    setLoadingSensors(true);
    try {
      const data = await getSensorAvailable();
      const sensors: MoistureSensor[] = (data.sensors || []).map((s: any) => ({
        name: s.location,
        entity_id: s.entity_id,
        friendly_name: s.friendly_name || s.entity_id,
      }));
      setAvailableSensors(sensors);
    } catch {
      setAvailableSensors([]);
    } finally {
      setLoadingSensors(false);
    }
  };

  const handleAssign = async () => {
    const entityId = selectedEntityId === '__custom__' ? customEntityId.trim() : selectedEntityId;
    if (!entityId) {
      toast('Select or enter a sensor entity ID', 'error');
      return;
    }
    setAssigning(true);
    try {
      const sensor = availableSensors.find(s => s.entity_id === entityId);
      await upsertSensorAssignment({
        entity_id: entityId,
        entity_friendly_name: sensor?.friendly_name || entityId,
        target_type: targetType,
        target_id: targetId,
        sensor_role: selectedRole,
      });
      toast('Sensor assigned');
      setShowAssign(false);
      setSelectedEntityId('');
      setCustomEntityId('');
      await loadReadings();
    } catch {
      toast('Failed to assign sensor', 'error');
    } finally {
      setAssigning(false);
    }
  };

  const handleRemove = async (assignmentId: number) => {
    try {
      await deleteSensorAssignment(assignmentId);
      toast('Sensor removed');
      await loadReadings();
    } catch {
      toast('Failed to remove sensor', 'error');
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
        <div className="animate-pulse h-4 bg-earth-100 dark:bg-gray-700 rounded w-1/3 mb-3" />
        <div className="animate-pulse h-8 bg-earth-100 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-1.5">
          <span className="text-blue-500">{'\u{1F4A7}'}</span> Sensors
        </h2>
        <button
          onClick={() => {
            setShowAssign(!showAssign);
            if (!showAssign && availableSensors.length === 0) loadAvailableSensors();
          }}
          className="text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 font-medium"
        >
          {showAssign ? 'Cancel' : '+ Assign Sensor'}
        </button>
      </div>

      {/* Assign sensor form */}
      {showAssign && (
        <div className="mb-4 p-3 bg-earth-50 dark:bg-gray-700/50 rounded-lg space-y-2">
          <div>
            <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">HA Entity</label>
            {loadingSensors ? (
              <div className="text-xs text-earth-400">Loading sensors...</div>
            ) : (
              <select
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              >
                <option value="">Select a sensor...</option>
                {availableSensors.map((s) => (
                  <option key={s.entity_id} value={s.entity_id}>
                    {s.friendly_name || s.name} ({s.entity_id})
                  </option>
                ))}
                <option value="__custom__">Custom entity ID...</option>
              </select>
            )}
          </div>

          {selectedEntityId === '__custom__' && (
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Entity ID</label>
              <input
                type="text"
                value={customEntityId}
                onChange={(e) => setCustomEntityId(e.target.value)}
                placeholder="sensor.my_sensor_soil_moisture"
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Sensor Role</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
            >
              {Object.entries(SENSOR_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleAssign}
            disabled={assigning}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white disabled:opacity-50 transition-colors"
          >
            {assigning ? 'Assigning...' : 'Assign'}
          </button>
        </div>
      )}

      {/* Current readings */}
      {readings.length > 0 ? (
        <div className="space-y-2">
          {readings.map((reading) => (
            <div
              key={reading.assignment_id}
              className="flex items-center justify-between p-2 rounded-lg bg-earth-50 dark:bg-gray-700/30 border border-earth-100 dark:border-gray-700"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">
                  {SENSOR_ROLE_ICONS[reading.sensor_role] || '\u{1F4CF}'}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-earth-700 dark:text-gray-200 truncate">
                    {reading.entity_friendly_name || reading.friendly_name || reading.entity_id}
                  </div>
                  <div className="text-xs text-earth-400 dark:text-gray-500">
                    {SENSOR_ROLE_LABELS[reading.sensor_role] || reading.sensor_role}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-lg font-bold ${
                  reading.sensor_role === 'soil_moisture'
                    ? getMoistureColor(reading.state)
                    : 'text-earth-700 dark:text-gray-200'
                }`}>
                  {formatReading(reading.state, reading.unit, reading.sensor_role)}
                </span>
                <button
                  onClick={() => handleRemove(reading.assignment_id)}
                  className="text-earth-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
                  title="Remove sensor"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : !showAssign ? (
        <div className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">
          No sensors assigned. Tap &ldquo;+ Assign Sensor&rdquo; to link a Home Assistant sensor.
        </div>
      ) : null}
    </div>
  );
}
