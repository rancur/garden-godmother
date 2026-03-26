'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../auth-context';
import { useToast } from '../../toast';

// Configure for your domain — set NEXT_PUBLIC_API_URL in .env.local or docker-compose.yml
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3402';

interface Integration {
  integration: string;
  name: string;
  description: string;
  fields: string[];
  enabled: boolean;
  configured: boolean;
  config: Record<string, string>;
}

interface HaEntity {
  entity_id: string;
  friendly_name: string;
  state: string;
  unit: string;
}

const FIELD_LABELS: Record<string, { label: string; type: string; placeholder: string }> = {
  api_key: { label: 'API Key', type: 'password', placeholder: 'Enter API key' },
  api_token: { label: 'API Token', type: 'password', placeholder: 'WeatherFlow API token' },
  token: { label: 'Access Token', type: 'password', placeholder: 'Long-lived access token' },
  url: { label: 'URL', type: 'text', placeholder: 'http://homeassistant.local:8123' },
  person_id: { label: 'Person ID', type: 'text', placeholder: 'Rachio person ID' },
  base_station_id: { label: 'Base Station ID', type: 'text', placeholder: 'Base station ID' },
  valve_id: { label: 'Valve ID', type: 'text', placeholder: 'Valve ID' },
  client_id: { label: 'Client ID', type: 'text', placeholder: 'Client ID' },
  client_secret: { label: 'Client Secret', type: 'password', placeholder: 'Client secret' },
  station_id: { label: 'Station ID', type: 'text', placeholder: 'Weather station ID' },
  local_udp: { label: 'Local UDP', type: 'toggle', placeholder: '' },
};

const ROLE_LABELS: Record<string, string> = {
  outdoor_temperature: 'Outdoor Temperature',
  outdoor_humidity: 'Outdoor Humidity',
  wind_speed: 'Wind Speed',
  rain_accumulation: 'Rain Accumulation',
  soil_moisture: 'Soil Moisture',
  soil_temperature: 'Soil Temperature',
  uv_index: 'UV Index',
  solar_radiation: 'Solar Radiation',
};

const INTEGRATION_ICONS: Record<string, string> = {
  openai: '\u{1F916}',
  home_assistant: '\u{1F3E0}',
  rachio: '\u{1F4A7}',
  rachio_hose_timer: '\u{1F6BF}',
  openplantbook: '\u{1F4D6}',
  weather_tempest: '\u{1F329}\uFE0F',
  weather_openmeteo: '\u{1F30D}',
  weather_openweathermap: '\u26C5',
  weather_nws: '\u{1F1FA}\u{1F1F8}',
};

export default function IntegrationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Entity mapping state
  const [showEntityMapping, setShowEntityMapping] = useState(false);
  const [haEntities, setHaEntities] = useState<HaEntity[]>([]);
  const [entityMappings, setEntityMappings] = useState<Record<string, string>>({});
  const [sensorRoles, setSensorRoles] = useState<string[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);

  const apiFetch = (path: string, opts?: RequestInit) =>
    fetch(`${API_URL}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    });

  const loadIntegrations = () => {
    apiFetch('/api/integrations')
      .then(setIntegrations)
      .catch(() => toast('Failed to load integrations'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadIntegrations(); }, []);

  if (user?.role !== 'admin') {
    return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Admin access required</div>;
  }

  const handleSave = async (integration: string) => {
    setSaving(true);
    try {
      await apiFetch(`/api/integrations/${integration}`, {
        method: 'PUT',
        body: JSON.stringify({ config: configForm, enabled: true }),
      });
      toast('Integration saved');
      setEditingKey(null);
      loadIntegrations();
    } catch { toast('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDisable = async (integration: string) => {
    try {
      await apiFetch(`/api/integrations/${integration}`, { method: 'DELETE' });
      toast('Integration removed');
      loadIntegrations();
    } catch { toast('Failed to remove'); }
  };

  const handleTest = async (integration: string) => {
    setTesting(integration);
    try {
      const result = await apiFetch(`/api/integrations/${integration}/test`, { method: 'POST' });
      toast(result.message || 'Connection successful!');
    } catch (e: any) {
      toast(`Test failed: ${e?.message || 'unknown error'}`);
    } finally { setTesting(null); }
  };

  const loadEntityMappings = async () => {
    setLoadingEntities(true);
    try {
      const [entitiesRes, mappingsRes] = await Promise.all([
        apiFetch('/api/sensors/ha-entities'),
        apiFetch('/api/sensors/entity-mappings'),
      ]);
      setHaEntities(entitiesRes.entities || []);
      setEntityMappings(mappingsRes.mappings || {});
      setSensorRoles(mappingsRes.roles || []);
      if (entitiesRes.error) toast(entitiesRes.error);
    } catch { toast('Failed to load entities'); }
    finally { setLoadingEntities(false); }
  };

  const handleToggleEntityMapping = () => {
    if (!showEntityMapping) loadEntityMappings();
    setShowEntityMapping(!showEntityMapping);
  };

  const handleSaveMappings = async () => {
    setSavingMappings(true);
    try {
      await apiFetch('/api/sensors/entity-mappings', {
        method: 'PUT',
        body: JSON.stringify({ mappings: entityMappings }),
      });
      toast('Sensor mappings saved');
    } catch { toast('Failed to save mappings'); }
    finally { setSavingMappings(false); }
  };

  if (loading) return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading...</div>;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Integrations</h1>
        <p className="text-earth-400 dark:text-gray-500 text-sm mt-1">Connect your garden tools and services</p>
      </div>

      <div className="space-y-4">
        {integrations.map(int_ => {
          const isEditing = editingKey === int_.integration;
          const icon = INTEGRATION_ICONS[int_.integration] || '\u2699';

          return (
            <div key={int_.integration} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <div className="font-medium text-earth-800 dark:text-gray-100">{int_.name}</div>
                    <div className="text-xs text-earth-400 dark:text-gray-500">{int_.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {int_.configured && int_.enabled && (
                    <button
                      onClick={() => handleTest(int_.integration)}
                      disabled={testing === int_.integration}
                      className="text-xs px-3 py-1 rounded-lg border border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700"
                    >
                      {testing === int_.integration ? 'Testing...' : 'Test'}
                    </button>
                  )}
                  {int_.configured && int_.enabled ? (
                    <>
                      <span className="text-xs px-3 py-1 rounded-lg font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                        Connected
                      </span>
                      <button
                        onClick={() => { setConfigForm(int_.config); setEditingKey(isEditing ? null : int_.integration); }}
                        className="text-xs text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300"
                      >
                        {isEditing ? 'Cancel' : 'Edit'}
                      </button>
                      <button
                        onClick={() => handleDisable(int_.integration)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => { setConfigForm(int_.config); setEditingKey(int_.integration); }}
                      className="text-xs px-3 py-1 rounded-lg font-medium bg-garden-600 text-white hover:bg-garden-700"
                    >
                      Configure
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="px-5 pb-4 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-3">
                  {int_.fields.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {int_.fields.map(field => {
                        const meta = FIELD_LABELS[field] || { label: field, type: 'text', placeholder: '' };
                        if (meta.type === 'toggle') {
                          return (
                            <div key={field} className="col-span-2 flex items-center gap-3">
                              <label className="text-xs font-medium text-earth-500 dark:text-gray-400">{meta.label}</label>
                              <button
                                type="button"
                                onClick={() => setConfigForm(f => ({ ...f, [field]: f[field] === 'true' ? 'false' : 'true' }))}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${configForm[field] === 'true' ? 'bg-garden-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${configForm[field] === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
                              </button>
                              <span className="text-xs text-earth-400 dark:text-gray-500">
                                {configForm[field] === 'true' ? 'Receive real-time data from Tempest on local network (UDP 50222)' : 'Disabled'}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <div key={field} className={int_.fields.length === 1 ? 'col-span-2' : ''}>
                            <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">{meta.label}</label>
                            <input
                              type={meta.type}
                              placeholder={meta.placeholder}
                              value={configForm[field] || ''}
                              onChange={e => setConfigForm(f => ({ ...f, [field]: e.target.value }))}
                              className="w-full text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-earth-400 dark:text-gray-500">No configuration needed — uses property coordinates automatically.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSave(int_.integration)}
                      disabled={saving}
                      className="bg-garden-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-garden-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      className="text-sm px-4 py-1.5 rounded-lg border border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sensor Entity Mappings (shown when HA is configured) */}
      {integrations.some(i => i.integration === 'home_assistant' && i.enabled) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{'\u{1F50C}'}</span>
              <div>
                <div className="font-medium text-earth-800 dark:text-gray-100">Sensor Mappings</div>
                <div className="text-xs text-earth-400 dark:text-gray-500">Map Home Assistant entities to garden sensor roles</div>
              </div>
            </div>
            <button
              onClick={handleToggleEntityMapping}
              className="text-xs px-3 py-1 rounded-lg font-medium bg-garden-600 text-white hover:bg-garden-700"
            >
              {showEntityMapping ? 'Close' : 'Configure'}
            </button>
          </div>

          {showEntityMapping && (
            <div className="px-5 pb-4 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-4">
              {loadingEntities ? (
                <p className="text-sm text-earth-400 dark:text-gray-500">Loading entities from Home Assistant...</p>
              ) : (
                <>
                  {haEntities.length === 0 && (
                    <p className="text-sm text-earth-400 dark:text-gray-500">No sensor entities found. Check your Home Assistant connection.</p>
                  )}
                  <div className="space-y-3">
                    {sensorRoles.map(role => (
                      <div key={role} className="flex items-center gap-3">
                        <label className="text-sm font-medium text-earth-600 dark:text-gray-300 w-40 shrink-0">
                          {ROLE_LABELS[role] || role}
                        </label>
                        <select
                          value={entityMappings[role] || ''}
                          onChange={e => setEntityMappings(m => ({ ...m, [role]: e.target.value }))}
                          className="flex-1 text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                        >
                          <option value="">-- Not mapped --</option>
                          {haEntities.map(ent => (
                            <option key={ent.entity_id} value={ent.entity_id}>
                              {ent.friendly_name} ({ent.entity_id}){ent.unit ? ` [${ent.state} ${ent.unit}]` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveMappings}
                      disabled={savingMappings}
                      className="bg-garden-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-garden-700 disabled:opacity-50"
                    >
                      {savingMappings ? 'Saving...' : 'Save Mappings'}
                    </button>
                    <button
                      onClick={loadEntityMappings}
                      disabled={loadingEntities}
                      className="text-sm px-4 py-1.5 rounded-lg border border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700"
                    >
                      Refresh Entities
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
