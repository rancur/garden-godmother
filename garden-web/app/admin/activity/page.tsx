'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../auth-context';
import { useToast } from '../../toast';
import { formatGardenDate } from '../../timezone';

// Configure for your domain — set NEXT_PUBLIC_API_URL in .env.local or docker-compose.yml
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3402';

interface AuditEntry {
  id: number;
  user_id: number;
  user_name: string;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

const actionColors: Record<string, string> = {
  create: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  update: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  delete: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  login: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  logout: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  register: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  complete: 'bg-garden-100 dark:bg-garden-900/40 text-garden-700 dark:text-garden-300',
  generate: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',
};

export default function AdminActivityPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ entity_type: '', action: '' });

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (filter.entity_type) params.set('entity_type', filter.entity_type);
    if (filter.action) params.set('action', filter.action);

    fetch(`${API_URL}/api/audit?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(setEntries)
      .catch(() => toast('Failed to load activity'))
      .finally(() => setLoading(false));
  }, [filter]);

  if (user?.role !== 'admin') {
    return <div className="text-center py-12 text-earth-400 dark:text-gray-500">Admin access required</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Activity Log</h1>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={filter.action}
          onChange={(e) => setFilter(f => ({ ...f, action: e.target.value }))}
          className="text-sm px-3 py-1.5 rounded-lg border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200"
        >
          <option value="">All Actions</option>
          {['create', 'update', 'delete', 'login', 'logout', 'register', 'complete', 'generate'].map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={filter.entity_type}
          onChange={(e) => setFilter(f => ({ ...f, entity_type: e.target.value }))}
          className="text-sm px-3 py-1.5 rounded-lg border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200"
        >
          <option value="">All Types</option>
          {['session', 'user', 'bed', 'planting', 'task', 'harvest', 'journal', 'ground_plant', 'expense', 'seed'].map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Log entries */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-5 py-8 text-center text-earth-400 dark:text-gray-500">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-8 text-center text-earth-400 dark:text-gray-500">No activity yet</div>
        ) : (
          <div className="divide-y divide-earth-100 dark:divide-gray-700">
            {entries.map(entry => (
              <div key={entry.id} className="px-5 py-3 flex items-start gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 ${actionColors[entry.action] || 'bg-gray-100 text-gray-600'}`}>
                  {entry.action}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-earth-800 dark:text-gray-100">
                    <span className="font-medium">{entry.user_name}</span>
                    <span className="text-earth-400 dark:text-gray-500"> {entry.action}d </span>
                    <span className="font-medium">{entry.entity_type}</span>
                    {entry.entity_id && <span className="text-earth-400 dark:text-gray-500"> #{entry.entity_id}</span>}
                  </div>
                  {entry.details && (
                    <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5 truncate">
                      {(() => {
                        try { return JSON.stringify(JSON.parse(entry.details)).slice(0, 100); }
                        catch { return entry.details.slice(0, 100); }
                      })()}
                    </div>
                  )}
                </div>
                <span className="text-xs text-earth-400 dark:text-gray-500 whitespace-nowrap">
                  {formatGardenDate(entry.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
