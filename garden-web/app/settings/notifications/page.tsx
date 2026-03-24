'use client';

import { useEffect, useState } from 'react';
import { useToast } from '../../toast';

// Configure for your domain — set NEXT_PUBLIC_API_URL in .env.local or docker-compose.yml
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3402';

interface Channel {
  id: number;
  channel_type: string;
  enabled: number;
  config: string;
}

interface LogEntry {
  id: number;
  channel_type: string;
  event_type: string;
  title: string;
  status: string;
  error: string | null;
  created_at: string;
}

interface Preference {
  event_type: string;
  channel_type: string;
  enabled: number;
}

const CHANNEL_INFO: Record<string, { name: string; emoji: string; description: string }> = {
  email: { name: 'Email', emoji: '\u{1F4E7}', description: 'SMTP email notifications' },
  discord: { name: 'Discord', emoji: '\u{1F4AC}', description: 'Discord webhook messages' },
  webpush: { name: 'Web Push', emoji: '\u{1F514}', description: 'Browser push notifications' },
  pushbullet: { name: 'Pushbullet', emoji: '\u{1F4F1}', description: 'Pushbullet notifications' },
};

const EVENT_TYPES = [
  { key: 'task_due', label: 'Task Due', description: 'When a task is due today' },
  { key: 'task_overdue', label: 'Task Overdue', description: 'When a task is past due' },
  { key: 'harvest_ready', label: 'Harvest Ready', description: 'When plants are ready to harvest' },
  { key: 'frost_warning', label: 'Frost Warning', description: 'When frost is forecasted' },
  { key: 'plant_health', label: 'Plant Health Alert', description: 'When AI detects plant issues' },
  { key: 'invite_accepted', label: 'Invite Accepted', description: 'When someone joins your garden' },
];

export default function NotificationSettingsPage() {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [savingPref, setSavingPref] = useState<string | null>(null);

  const apiFetch = (path: string, opts?: RequestInit) =>
    fetch(`${API_URL}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => r.json());

  useEffect(() => {
    Promise.all([
      apiFetch('/api/notifications/channels'),
      apiFetch('/api/notifications/log?limit=20'),
      apiFetch('/api/notifications/preferences'),
    ])
      .then(([ch, lg, prefs]) => { setChannels(ch); setLog(lg); setPreferences(prefs.preferences || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getChannelConfig = (type: string): Record<string, string> => {
    const ch = channels.find(c => c.channel_type === type);
    if (!ch) return {};
    try { return JSON.parse(ch.config); } catch { return {}; }
  };

  const isChannelEnabled = (type: string) => channels.some(c => c.channel_type === type && c.enabled);

  const handleSaveChannel = async (type: string) => {
    try {
      await apiFetch(`/api/notifications/channels/${type}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: true, config: configForm }),
      });
      const updated = await apiFetch('/api/notifications/channels');
      setChannels(updated);
      setEditingChannel(null);
      toast('Channel saved');
    } catch { toast('Failed to save channel'); }
  };

  const handleToggleChannel = async (type: string, enabled: boolean) => {
    const existing = getChannelConfig(type);
    try {
      if (!enabled) {
        await apiFetch(`/api/notifications/channels/${type}`, { method: 'DELETE' });
      } else {
        await apiFetch(`/api/notifications/channels/${type}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: true, config: existing }),
        });
      }
      const updated = await apiFetch('/api/notifications/channels');
      setChannels(updated);
    } catch { toast('Failed to update channel'); }
  };

  const handleTest = async (type: string) => {
    setTesting(type);
    try {
      await apiFetch(`/api/notifications/test/${type}`, { method: 'POST' });
      toast('Test notification sent!');
    } catch (e: any) {
      toast(`Test failed: ${e?.message || 'unknown error'}`);
    } finally { setTesting(null); }
  };

  const handleEnableWebPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast('Web push not supported in this browser');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const vapidRes = await apiFetch('/api/notifications/vapid-key');
      if (!vapidRes.public_key) { toast('VAPID key not configured'); return; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidRes.public_key),
      });

      await apiFetch('/api/notifications/webpush/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });

      await apiFetch('/api/notifications/channels/webpush', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true, config: {} }),
      });

      const updated = await apiFetch('/api/notifications/channels');
      setChannels(updated);
      toast('Web push enabled!');
    } catch (e: any) {
      toast(`Failed to enable web push: ${e?.message || 'unknown'}`);
    }
  };

  const enabledChannels = Object.keys(CHANNEL_INFO).filter(type => isChannelEnabled(type));

  const isPrefEnabled = (eventType: string, channelType: string): boolean => {
    const pref = preferences.find(p => p.event_type === eventType && p.channel_type === channelType);
    return pref ? !!pref.enabled : false;
  };

  const handleTogglePref = async (eventType: string, channelType: string, enabled: boolean) => {
    const key = `${eventType}:${channelType}`;
    setSavingPref(key);

    // Optimistic update
    setPreferences(prev => {
      const existing = prev.find(p => p.event_type === eventType && p.channel_type === channelType);
      if (existing) {
        return prev.map(p => p.event_type === eventType && p.channel_type === channelType ? { ...p, enabled: enabled ? 1 : 0 } : p);
      }
      return [...prev, { event_type: eventType, channel_type: channelType, enabled: enabled ? 1 : 0 }];
    });

    try {
      await apiFetch('/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ preferences: [{ event_type: eventType, channel_type: channelType, enabled }] }),
      });
    } catch {
      // Revert on failure
      setPreferences(prev =>
        prev.map(p => p.event_type === eventType && p.channel_type === channelType ? { ...p, enabled: enabled ? 0 : 1 } : p)
      );
      toast('Failed to save preference');
    } finally {
      setSavingPref(null);
    }
  };

  if (loading) return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading...</div>;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Notifications</h1>
        <p className="text-earth-400 dark:text-gray-500 text-sm mt-1">Configure how you receive garden alerts</p>
      </div>

      {/* Channel Cards */}
      <div className="space-y-4">
        {Object.entries(CHANNEL_INFO).map(([type, info]) => {
          const enabled = isChannelEnabled(type);
          const config = getChannelConfig(type);
          const isEditing = editingChannel === type;

          return (
            <div key={type} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{info.emoji}</span>
                  <div>
                    <div className="font-medium text-earth-800 dark:text-gray-100">{info.name}</div>
                    <div className="text-xs text-earth-400 dark:text-gray-500">{info.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {enabled && (
                    <button
                      onClick={() => handleTest(type)}
                      disabled={testing === type}
                      className="text-xs px-3 py-1 rounded-lg border border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700"
                    >
                      {testing === type ? 'Sending...' : 'Test'}
                    </button>
                  )}
                  {type === 'webpush' ? (
                    <button
                      onClick={enabled ? () => handleToggleChannel(type, false) : handleEnableWebPush}
                      className={`text-xs px-3 py-1 rounded-lg font-medium ${enabled ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-garden-600 text-white hover:bg-garden-700'}`}
                    >
                      {enabled ? 'Enabled' : 'Enable'}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (enabled) handleToggleChannel(type, false);
                        else { setConfigForm(config); setEditingChannel(type); }
                      }}
                      className={`text-xs px-3 py-1 rounded-lg font-medium ${enabled ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300'}`}
                    >
                      {enabled ? 'Enabled' : 'Configure'}
                    </button>
                  )}
                  {enabled && type !== 'webpush' && (
                    <button
                      onClick={() => { setConfigForm(config); setEditingChannel(isEditing ? null : type); }}
                      className="text-xs text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Config form */}
              {isEditing && type === 'email' && (
                <div className="px-5 pb-4 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="SMTP Host" value={configForm.smtp_host || ''} onChange={e => setConfigForm(f => ({ ...f, smtp_host: e.target.value }))} className="text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" />
                    <input placeholder="Port" value={configForm.smtp_port || ''} onChange={e => setConfigForm(f => ({ ...f, smtp_port: e.target.value }))} className="text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" />
                    <input placeholder="Username" value={configForm.smtp_user || ''} onChange={e => setConfigForm(f => ({ ...f, smtp_user: e.target.value }))} className="text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" />
                    <input placeholder="Password" type="password" value={configForm.smtp_pass || ''} onChange={e => setConfigForm(f => ({ ...f, smtp_pass: e.target.value }))} className="text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                  <button onClick={() => handleSaveChannel(type)} disabled={!configForm.smtp_host || !configForm.smtp_port || !configForm.smtp_user || !configForm.smtp_pass} className="bg-garden-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-garden-700 disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
                </div>
              )}

              {isEditing && type === 'discord' && (
                <div className="px-5 pb-4 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-3">
                  <input placeholder="Discord Webhook URL" value={configForm.webhook_url || ''} onChange={e => setConfigForm(f => ({ ...f, webhook_url: e.target.value }))} className="w-full text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" />
                  <button onClick={() => handleSaveChannel(type)} className="bg-garden-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-garden-700">Save</button>
                </div>
              )}

              {isEditing && type === 'pushbullet' && (
                <div className="px-5 pb-4 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-3">
                  <input placeholder="Pushbullet Access Token" value={configForm.access_token || ''} onChange={e => setConfigForm(f => ({ ...f, access_token: e.target.value }))} className="w-full text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" />
                  <button onClick={() => handleSaveChannel(type)} className="bg-garden-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-garden-700">Save</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Notification Preferences Matrix */}
      {enabledChannels.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-1">Notification Preferences</h2>
          <p className="text-earth-400 dark:text-gray-500 text-sm mb-3">Choose which events notify you on each channel</p>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-earth-100 dark:border-gray-700">
                  <th className="text-left px-5 py-3 text-earth-600 dark:text-gray-400 font-medium">Event</th>
                  {enabledChannels.map(type => (
                    <th key={type} className="px-4 py-3 text-center text-earth-600 dark:text-gray-400 font-medium whitespace-nowrap">
                      <span className="mr-1">{CHANNEL_INFO[type].emoji}</span>
                      {CHANNEL_INFO[type].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EVENT_TYPES.map((evt, i) => (
                  <tr key={evt.key} className={i < EVENT_TYPES.length - 1 ? 'border-b border-earth-50 dark:border-gray-700/50' : ''}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-earth-800 dark:text-gray-100">{evt.label}</div>
                      <div className="text-xs text-earth-400 dark:text-gray-500">{evt.description}</div>
                    </td>
                    {enabledChannels.map(type => {
                      const checked = isPrefEnabled(evt.key, type);
                      const saving = savingPref === `${evt.key}:${type}`;
                      return (
                        <td key={type} className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={saving}
                            onChange={e => handleTogglePref(evt.key, type, e.target.checked)}
                            className="w-4 h-4 rounded border-earth-300 dark:border-gray-600 text-garden-600 focus:ring-garden-500 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Notification Log */}
      {log.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-3">Recent Notifications</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm divide-y divide-earth-100 dark:divide-gray-700">
            {log.map(entry => (
              <div key={entry.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm text-earth-800 dark:text-gray-100">
                    <span className="font-medium">{entry.title}</span>
                    <span className="text-earth-400 dark:text-gray-500 ml-2 text-xs">{entry.channel_type}</span>
                  </div>
                  {entry.error && <div className="text-xs text-red-500 mt-0.5">{entry.error}</div>}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${entry.status === 'sent' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'}`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
