'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../auth-context';
import { useToast } from '../../toast';

// Configure for your domain — set NEXT_PUBLIC_API_URL in .env.local or docker-compose.yml
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3402';

interface UpdateStatus {
  current_commit: string | null;
  current_date: string | null;
  remote_commit: string | null;
  remote_date: string | null;
  remote_message: string | null;
  commits_behind: number;
  update_available: boolean;
  auto_update_enabled: boolean;
  auto_update_schedule: string;
  auto_update_time: string;
  last_update_at: string | null;
  last_update_result: string | null;
}

interface Commit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export default function UpdatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);

  const apiFetch = (path: string, opts?: RequestInit) =>
    fetch(`${API_URL}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    });

  const loadStatus = async () => {
    setChecking(true);
    try {
      const [s, c] = await Promise.all([
        apiFetch('/api/admin/update/status'),
        apiFetch('/api/admin/update/changelog'),
      ]);
      setStatus(s);
      setCommits(c.commits || []);
    } catch {
      toast('Failed to check for updates');
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  if (user?.role !== 'admin') {
    return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Admin access required</div>;
  }

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const result = await apiFetch('/api/admin/update/apply', { method: 'POST' });
      toast(result.message || 'Update applied! Container rebuild in progress.');
      // Reload status after a delay (container may restart)
      setTimeout(loadStatus, 5000);
    } catch (e: any) {
      toast(`Update failed: ${e?.message || 'unknown error'}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveAutoUpdate = async (enabled: boolean, schedule?: string, time?: string) => {
    if (!status) return;
    const newSchedule = schedule ?? status.auto_update_schedule ?? 'daily';
    const newTime = time ?? status.auto_update_time ?? '03:00';
    try {
      await apiFetch('/api/admin/update/auto', {
        method: 'PUT',
        body: JSON.stringify({ enabled, schedule: newSchedule, time: newTime }),
      });
      setStatus(prev => prev ? { ...prev, auto_update_enabled: enabled, auto_update_schedule: newSchedule, auto_update_time: newTime } : null);
      toast(enabled ? 'Auto-update settings saved' : 'Auto-update disabled');
    } catch {
      toast('Failed to save auto-update settings');
    }
  };

  if (loading) return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Checking for updates...</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Updates</h1>

      {/* Current Version */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-earth-700 dark:text-gray-200">Current Version</h2>
          <button
            onClick={loadStatus}
            disabled={checking}
            className="text-xs px-3 py-1 rounded-lg border border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-earth-400 dark:text-gray-500">Version</div>
            <div className="font-mono text-sm text-earth-800 dark:text-gray-100">{status?.current_commit || 'unknown'}</div>
          </div>
          <div>
            <div className="text-xs text-earth-400 dark:text-gray-500">Last Updated</div>
            <div className="text-sm text-earth-800 dark:text-gray-100">{status?.current_date ? status.current_date.replace(/ [+-]\d{4}$/, '') : 'unknown'}</div>
          </div>
        </div>
        {status?.remote_message && (
          <div className="mt-2 text-xs text-earth-400 dark:text-gray-500">{status.remote_message}</div>
        )}
        {status?.last_update_at && (
          <div className="mt-3 pt-3 border-t border-earth-100 dark:border-gray-700 text-xs text-earth-400 dark:text-gray-500">
            Last update: {new Date(status.last_update_at).toLocaleString()}
            {status.last_update_result && (
              <span className={status.last_update_result.startsWith('success') ? ' text-green-600 dark:text-green-400' : ' text-red-500'}>
                {' '}&mdash; {status.last_update_result.slice(0, 60)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Update Available */}
      {status?.update_available && (
        <div className="bg-garden-50 dark:bg-garden-900/20 border border-garden-200 dark:border-garden-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-bold text-garden-700 dark:text-garden-300">Update Available</h2>
              <p className="text-sm text-garden-600 dark:text-garden-400 mt-0.5">
                {status.commits_behind} commit{status.commits_behind !== 1 ? 's' : ''} behind
                {status.remote_message && <span className="ml-1">&mdash; {status.remote_message}</span>}
              </p>
            </div>
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition-colors"
            >
              {updating ? 'Updating...' : 'Update Now'}
            </button>
          </div>

          {/* Changelog */}
          {commits.length > 0 && (
            <div className="mt-3 pt-3 border-t border-garden-200 dark:border-garden-800">
              <h3 className="text-xs font-medium text-garden-600 dark:text-garden-400 mb-2 uppercase tracking-wide">What's New</h3>
              <div className="space-y-1.5">
                {commits.slice(0, 10).map(c => (
                  <div key={c.hash} className="flex items-start gap-2 text-sm">
                    <span className="font-mono text-xs text-garden-500 dark:text-garden-500 mt-0.5 shrink-0">{c.hash}</span>
                    <span className="text-earth-700 dark:text-gray-200">{c.message}</span>
                  </div>
                ))}
                {commits.length > 10 && (
                  <div className="text-xs text-garden-500">+{commits.length - 10} more commits</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!status?.update_available && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-5 text-center">
          <div className="text-green-700 dark:text-green-300 font-medium">You're up to date!</div>
          <div className="text-xs text-green-600 dark:text-green-400 mt-1">Running the latest version</div>
        </div>
      )}

      {/* Auto-Update Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-earth-700 dark:text-gray-200">Auto-Update</h2>
            <p className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">Automatically pull and deploy new versions</p>
          </div>
          <button
            onClick={() => handleSaveAutoUpdate(!status?.auto_update_enabled)}
            className={`relative w-12 h-6 rounded-full transition-colors ${status?.auto_update_enabled ? 'bg-garden-600' : 'bg-earth-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${status?.auto_update_enabled ? 'translate-x-[24px]' : 'translate-x-0'}`} />
          </button>
        </div>
        {status?.auto_update_enabled && (
          <div className="pt-3 border-t border-earth-100 dark:border-gray-700 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Frequency</label>
                <select
                  value={status.auto_update_schedule || 'daily'}
                  onChange={(e) => handleSaveAutoUpdate(true, e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="daily">Daily</option>
                  <option value="twice_daily">Twice Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Time</label>
                <input
                  type="time"
                  value={status.auto_update_time || '03:00'}
                  onChange={(e) => handleSaveAutoUpdate(true, undefined, e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>
            <p className="text-xs text-earth-400 dark:text-gray-500">
              {status.auto_update_schedule === 'daily' && `Updates checked daily at ${status.auto_update_time || '3:00 AM'}. A backup is created before each update.`}
              {status.auto_update_schedule === 'twice_daily' && `Updates checked at ${status.auto_update_time || '3:00 AM'} and 12 hours later. A backup is created before each update.`}
              {status.auto_update_schedule === 'weekly' && `Updates checked weekly at ${status.auto_update_time || '3:00 AM'}. A backup is created before each update.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
