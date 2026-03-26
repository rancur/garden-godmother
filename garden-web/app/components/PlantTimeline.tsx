'use client';

import { useEffect, useState, useCallback } from 'react';
import { getPlantTimeline, quickAddJournal } from '../api';
import { useToast } from '../toast';
import { formatGardenDate } from '../timezone';

interface TimelineEntry {
  id: number;
  title: string | null;
  content: string | null;
  entry_type?: string;
  severity?: string;
  milestone_type?: string;
  created_at: string;
  timeline_type: 'journal' | 'harvest';
  amount?: string;
  unit?: string;
  quality_rating?: string;
}

interface PlantTimelineProps {
  plantType: 'planting' | 'ground_plant';
  plantId: number;
  plantName: string;
}

const ENTRY_TYPE_ICONS: Record<string, string> = {
  observation: '\u{1F440}',
  harvest: '\u{1F9FA}',
  problem: '\u26A0\uFE0F',
  milestone: '\u{1F389}',
  note: '\u{1F4DD}',
  weather: '\u{1F324}\uFE0F',
  photo: '\u{1F4F7}',
};

const MILESTONE_LABELS: Record<string, string> = {
  sprouted: '\u{1F331} Sprouted',
  flowering: '\u{1F33C} Flowering',
  fruiting: '\u{1F345} Fruiting',
  first_harvest: '\u{1F389} First Harvest',
  established: '\u{1F333} Established',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  medium: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  critical: 'bg-red-200 text-red-900 dark:bg-red-800/40 dark:text-red-200',
};

const QUICK_ENTRY_TYPES = [
  { value: 'observation', label: 'Observation', icon: '\u{1F440}' },
  { value: 'problem', label: 'Problem', icon: '\u26A0\uFE0F' },
  { value: 'milestone', label: 'Milestone', icon: '\u{1F389}' },
  { value: 'note', label: 'Note', icon: '\u{1F4DD}' },
];

export default function PlantTimeline({ plantType, plantId, plantName }: PlantTimelineProps) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Quick-add form state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickContent, setQuickContent] = useState('');
  const [quickType, setQuickType] = useState('observation');
  const [submitting, setSubmitting] = useState(false);

  const loadTimeline = useCallback(async () => {
    try {
      const data = await getPlantTimeline(plantType, plantId);
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [plantType, plantId]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const toggleExpand = (key: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleQuickAdd = async () => {
    if (!quickContent.trim()) return;
    setSubmitting(true);
    try {
      const data: Record<string, unknown> = {
        entry_type: quickType,
        content: quickContent.trim(),
      };
      if (plantType === 'planting') data.planting_id = plantId;
      else data.ground_plant_id = plantId;

      await quickAddJournal(data as Parameters<typeof quickAddJournal>[0]);
      setQuickContent('');
      setShowQuickAdd(false);
      loadTimeline();
      toast('Journal entry added');
    } catch {
      toast('Failed to add entry', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const entryBorderColor = (entry: TimelineEntry) => {
    if (entry.timeline_type === 'harvest') return 'border-l-green-400 dark:border-l-green-600';
    switch (entry.entry_type) {
      case 'problem': return 'border-l-red-400 dark:border-l-red-600';
      case 'milestone': return 'border-l-yellow-400 dark:border-l-yellow-500';
      case 'observation': return 'border-l-blue-400 dark:border-l-blue-500';
      case 'weather': return 'border-l-sky-400 dark:border-l-sky-500';
      case 'harvest': return 'border-l-green-400 dark:border-l-green-500';
      default: return 'border-l-earth-300 dark:border-l-gray-600';
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) return `${Math.max(1, Math.round(diffMs / (1000 * 60)))}m ago`;
    if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatGardenDate(dateStr, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-1.5">
          <span className="text-blue-500">{'\u{1F4C5}'}</span> Timeline
        </h2>
        <button
          onClick={() => setShowQuickAdd(!showQuickAdd)}
          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition-colors"
        >
          {showQuickAdd ? 'Cancel' : '+ Quick Journal'}
        </button>
      </div>

      {/* Quick-add form */}
      {showQuickAdd && (
        <div className="mb-4 p-3 bg-earth-50 dark:bg-gray-700/50 rounded-lg border border-earth-200 dark:border-gray-600 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ENTRY_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setQuickType(t.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                  quickType === t.value
                    ? 'bg-garden-50 dark:bg-garden-900/30 border-garden-500 dark:border-garden-500 text-garden-700 dark:text-garden-300'
                    : 'bg-white dark:bg-gray-700 border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-400 hover:border-garden-300'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={quickContent}
            onChange={(e) => setQuickContent(e.target.value)}
            rows={2}
            placeholder={`Add ${quickType} for ${plantName}...`}
            className="w-full px-3 py-2 text-sm rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200 resize-y"
          />
          <button
            onClick={handleQuickAdd}
            disabled={submitting || !quickContent.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving...' : 'Add Entry'}
          </button>
        </div>
      )}

      {/* Timeline entries */}
      {loading ? (
        <div className="text-center py-4 text-earth-400 dark:text-gray-500 text-xs">Loading timeline...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-4 text-earth-400 dark:text-gray-500 text-xs">
          No timeline entries yet. Use Quick Journal to add one.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const key = `${entry.timeline_type}_${entry.id}`;
            const isExpanded = expandedIds.has(key);
            const content = entry.content || '';
            const isLong = content.length > 120;
            const icon = entry.timeline_type === 'harvest'
              ? '\u{1F9FA}'
              : ENTRY_TYPE_ICONS[entry.entry_type || 'note'] || '\u{1F4DD}';

            return (
              <div
                key={key}
                className={`border-l-3 rounded-lg border border-earth-100 dark:border-gray-700 p-2.5 cursor-pointer hover:bg-earth-50 dark:hover:bg-gray-700/50 transition-colors ${entryBorderColor(entry)}`}
                onClick={() => isLong && toggleExpand(key)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm" title={entry.timeline_type === 'harvest' ? 'Harvest' : entry.entry_type}>{icon}</span>

                  {/* Type badge */}
                  <span className="text-[10px] uppercase tracking-wide font-medium text-earth-400 dark:text-gray-500">
                    {entry.timeline_type === 'harvest' ? 'Harvest' : entry.entry_type}
                  </span>

                  {/* Milestone badge */}
                  {entry.milestone_type && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 font-medium">
                      {MILESTONE_LABELS[entry.milestone_type] || entry.milestone_type}
                    </span>
                  )}

                  {/* Severity badge */}
                  {entry.severity && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[entry.severity] || ''}`}>
                      {entry.severity}
                    </span>
                  )}

                  {/* Harvest amount badge */}
                  {entry.timeline_type === 'harvest' && entry.amount && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium">
                      {entry.amount} {entry.unit}
                    </span>
                  )}

                  <span className="text-[10px] text-earth-300 dark:text-gray-600 ml-auto">{formatDate(entry.created_at)}</span>
                </div>

                {entry.title && (
                  <div className="text-xs font-medium text-earth-700 dark:text-gray-200 mb-0.5">{entry.title}</div>
                )}

                {content && (
                  <p className="text-xs text-earth-600 dark:text-gray-400 whitespace-pre-wrap">
                    {isLong && !isExpanded ? content.slice(0, 120) + '...' : content}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
