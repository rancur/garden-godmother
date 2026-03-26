'use client';

import { useEffect, useState, useCallback } from 'react';
import { API_URL } from '../api';
import { formatGardenDateTime } from '../timezone';

interface AuditEntry {
  id: number;
  user_name: string | null;
  action: string;
  details: Record<string, any> | null;
  created_at: string;
}

interface AuditHistoryProps {
  entityType: string;
  entityId: number;
}

export default function AuditHistory({ entityType, entityId }: AuditHistoryProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/audit/entity/${entityType}/${entityId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        setError(true);
        setEntries([]);
        return;
      }
      const data = await res.json();
      setEntries(data);
    } catch {
      setError(true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  if (loading) {
    return null;
  }

  // Don't render if the API doesn't exist or returned an error
  if (error || entries.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
        <span className="text-gray-500">{'📜'}</span> Change History
      </h2>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="border border-earth-100 dark:border-gray-700 rounded-lg p-2.5 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-earth-700 dark:text-gray-200 capitalize">
                  {entry.action.replace('_', ' ')}
                </span>
                {entry.user_name && (
                  <span className="text-earth-400 dark:text-gray-500 text-xs">
                    by {entry.user_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-earth-400 dark:text-gray-500">
                  {formatGardenDateTime(entry.created_at)}
                </span>
                {entry.details && (
                  <button
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    className="text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300"
                  >
                    {expandedId === entry.id ? 'Hide' : 'Details'}
                  </button>
                )}
              </div>
            </div>
            {expandedId === entry.id && entry.details && (
              <pre className="mt-2 text-xs text-earth-500 dark:text-gray-400 bg-earth-50 dark:bg-gray-750 rounded p-2 overflow-x-auto">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
