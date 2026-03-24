'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getHealthSummary, runHealthCheck, getPhotoUrl } from '../api';

interface HealthIssue {
  type: string;
  name: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

interface HealthAnalysis {
  id: number;
  photo_id: number;
  plant_identified: string;
  growth_stage: string;
  health: string;
  health_status: 'healthy' | 'fair' | 'poor' | 'critical';
  issues: HealthIssue[];
  recommendations: string[];
  confidence: string;
  summary: string;
  analyzed_at: string;
  filename: string;
  planting_id: number | null;
  plant_id: number | null;
  plant_name: string | null;
  bed_name: string | null;
}

const STATUS_CONFIG = {
  healthy: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    badge: 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200',
    dot: 'bg-green-500',
    label: 'Healthy',
  },
  fair: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    badge: 'bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200',
    dot: 'bg-yellow-500',
    label: 'Fair',
  },
  poor: {
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-200 dark:border-orange-800',
    badge: 'bg-orange-100 dark:bg-orange-800 text-orange-800 dark:text-orange-200',
    dot: 'bg-orange-500',
    label: 'Poor',
  },
  critical: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    badge: 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200',
    dot: 'bg-red-500',
    label: 'Critical',
  },
};

export default function HealthPage() {
  const [analyses, setAnalyses] = useState<HealthAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ analyzed: number; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await getHealthSummary();
      setAnalyses(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load health data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRunCheck = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await runHealthCheck();
      setRunResult({ analyzed: result.analyzed });
      // Refresh data after check
      await fetchData();
    } catch (err: unknown) {
      setRunResult({ analyzed: 0, error: err instanceof Error ? err.message : 'Health check failed' });
    } finally {
      setRunning(false);
    }
  };

  // Compute summary counts
  const counts = { healthy: 0, fair: 0, poor: 0, critical: 0 };
  for (const a of analyses) {
    const status = a.health_status || 'fair';
    if (status in counts) counts[status as keyof typeof counts]++;
  }
  const total = analyses.length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-64" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl" />
            ))}
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">
            Plant Health Monitor
          </h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">
            AI-powered health analysis of your garden photos
          </p>
        </div>
        <button
          onClick={handleRunCheck}
          disabled={running}
          className={`px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
            running
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 cursor-wait'
              : 'bg-garden-600 hover:bg-garden-700 text-white shadow-sm hover:shadow-md'
          }`}
        >
          {running ? 'Analyzing...' : 'Run Health Check'}
        </button>
      </div>

      {/* Run result banner */}
      {runResult && (
        <div
          className={`p-4 rounded-xl border ${
            runResult.error
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
              : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
          }`}
        >
          {runResult.error
            ? `Health check failed: ${runResult.error}`
            : `Health check complete: ${runResult.analyzed} photo${runResult.analyzed !== 1 ? 's' : ''} analyzed`}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {(Object.entries(STATUS_CONFIG) as [keyof typeof STATUS_CONFIG, typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(
          ([status, config]) => (
            <div
              key={status}
              className={`rounded-xl border p-4 ${config.bg} ${config.border}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-3 h-3 rounded-full ${config.dot}`} />
                <span className="text-sm font-medium text-earth-700 dark:text-gray-300">
                  {config.label}
                </span>
              </div>
              <div className="text-3xl font-bold text-earth-900 dark:text-gray-100">
                {counts[status]}
              </div>
              {total > 0 && (
                <div className="text-xs text-earth-500 dark:text-gray-400 mt-1">
                  {Math.round((counts[status] / total) * 100)}% of analyses
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Analyses list */}
      {analyses.length === 0 ? (
        <div className="text-center py-16 text-earth-500 dark:text-gray-400">
          <p className="text-lg font-medium">No health analyses yet</p>
          <p className="mt-2 text-sm">
            Upload photos to your plantings and run a health check to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100">
            Recent Analyses
          </h2>
          {analyses.map((analysis) => {
            const statusConfig =
              STATUS_CONFIG[analysis.health_status] || STATUS_CONFIG.fair;
            return (
              <div
                key={analysis.id}
                className={`rounded-xl border p-4 ${statusConfig.bg} ${statusConfig.border}`}
              >
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* Photo thumbnail */}
                  <div className="shrink-0">
                    <img
                      src={getPhotoUrl(analysis.photo_id)}
                      alt={analysis.plant_name || 'Plant photo'}
                      className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg object-cover border border-earth-200 dark:border-gray-600"
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-earth-900 dark:text-gray-100">
                        {analysis.plant_name || analysis.plant_identified || 'Unknown Plant'}
                      </h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.badge}`}
                      >
                        {statusConfig.label}
                      </span>
                      {analysis.confidence && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          {analysis.confidence} confidence
                        </span>
                      )}
                    </div>

                    {analysis.bed_name && (
                      <p className="text-xs text-earth-500 dark:text-gray-400 mb-1">
                        {analysis.bed_name}
                        {analysis.growth_stage ? ` - ${analysis.growth_stage}` : ''}
                      </p>
                    )}

                    <p className="text-sm text-earth-700 dark:text-gray-300 mb-2">
                      {analysis.summary}
                    </p>

                    {/* Issues */}
                    {analysis.issues.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {analysis.issues.map((issue, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded text-xs bg-white/60 dark:bg-gray-800/60 text-earth-700 dark:text-gray-300 border border-earth-200 dark:border-gray-600"
                            title={issue.description}
                          >
                            {issue.name} ({issue.severity})
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Recommendations */}
                    {analysis.recommendations.length > 0 && (
                      <ul className="text-xs text-earth-600 dark:text-gray-400 space-y-0.5">
                        {analysis.recommendations.slice(0, 3).map((rec, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="mt-0.5 shrink-0 text-garden-600 dark:text-garden-400">
                              &bull;
                            </span>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Footer links */}
                    <div className="flex items-center gap-4 mt-2 text-xs text-earth-400 dark:text-gray-500">
                      {analysis.analyzed_at && (
                        <span>
                          {new Date(analysis.analyzed_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                      {analysis.planting_id && (
                        <Link
                          href={`/planters`}
                          className="text-garden-600 dark:text-garden-400 hover:underline"
                        >
                          View planting
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
