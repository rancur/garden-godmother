'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAmendments, createAmendment, deleteAmendment } from '../api';
import { useToast } from '../toast';
import { getGardenToday, getGardenDateOffset } from '../timezone';

interface Amendment {
  id: number;
  amendment_type: string;
  product_name: string | null;
  amount: string | null;
  applied_date: string;
  next_due_date: string | null;
  notes: string | null;
}

interface SoilAmendmentsProps {
  entityType: 'bed' | 'ground_plant' | 'tray';
  entityId: number;
  entityName: string;
  /** If true, section is always expanded (no collapse toggle). Default: false. */
  alwaysOpen?: boolean;
}

const AMENDMENT_TYPES = [
  { value: 'compost', label: 'Compost' },
  { value: 'fertilizer', label: 'Fertilizer' },
  { value: 'sulfur', label: 'Sulfur' },
  { value: 'gypsum', label: 'Gypsum' },
  { value: 'mulch', label: 'Mulch' },
  { value: 'worm_castings', label: 'Worm Castings' },
  { value: 'bone_meal', label: 'Bone Meal' },
  { value: 'fish_emulsion', label: 'Fish Emulsion' },
  { value: 'other', label: 'Other' },
];

export default function SoilAmendments({ entityType, entityId, entityName, alwaysOpen = false }: SoilAmendmentsProps) {
  const { toast } = useToast();

  const [expanded, setExpanded] = useState(alwaysOpen);
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [amendmentForm, setAmendmentForm] = useState({
    amendment_type: 'compost',
    product_name: '',
    amount: '',
    applied_date: getGardenToday(),
    next_due_date: '',
    notes: '',
  });
  const [savingAmendment, setSavingAmendment] = useState(false);

  const loadAmendments = useCallback(() => {
    const params: Record<string, number> = {};
    if (entityType === 'bed') params.bed_id = entityId;
    else if (entityType === 'ground_plant') params.ground_plant_id = entityId;
    else if (entityType === 'tray') params.tray_id = entityId;
    getAmendments(params).then(setAmendments).catch(() => setAmendments([]));
  }, [entityType, entityId]);

  useEffect(() => {
    if (alwaysOpen) loadAmendments();
  }, [alwaysOpen, loadAmendments]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadAmendments();
  };

  const handleAdd = async () => {
    setSavingAmendment(true);
    try {
      const payload: any = {
        amendment_type: amendmentForm.amendment_type,
        applied_date: amendmentForm.applied_date,
        product_name: amendmentForm.product_name || undefined,
        amount: amendmentForm.amount || undefined,
        next_due_date: amendmentForm.next_due_date || undefined,
        notes: amendmentForm.notes || undefined,
      };
      if (entityType === 'bed') payload.bed_id = entityId;
      else if (entityType === 'ground_plant') payload.ground_plant_id = entityId;
      else if (entityType === 'tray') payload.tray_id = entityId;

      await createAmendment(payload);
      setAmendmentForm({
        amendment_type: 'compost',
        product_name: '',
        amount: '',
        applied_date: getGardenToday(),
        next_due_date: '',
        notes: '',
      });
      loadAmendments();
      toast('Amendment recorded');
    } catch {
      toast('Failed to save amendment', 'error');
    }
    setSavingAmendment(false);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAmendment(id);
      loadAmendments();
    } catch {
      toast('Failed to delete amendment', 'error');
    }
  };

  const hasDueSoon = amendments.some(
    (a) => a.next_due_date && a.next_due_date <= getGardenDateOffset(14)
  );

  const renderForm = () => (
    <div className="bg-earth-50 dark:bg-gray-750 rounded-lg p-3 space-y-2">
      <div className="text-xs font-medium text-earth-600 dark:text-gray-300 mb-1">Log Amendment</div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={amendmentForm.amendment_type}
          onChange={(e) => setAmendmentForm((f) => ({ ...f, amendment_type: e.target.value }))}
          className="px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
        >
          {AMENDMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Product name"
          value={amendmentForm.product_name}
          onChange={(e) => setAmendmentForm((f) => ({ ...f, product_name: e.target.value }))}
          className="px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input
          type="text"
          placeholder="Amount (e.g. 2 cups)"
          value={amendmentForm.amount}
          onChange={(e) => setAmendmentForm((f) => ({ ...f, amount: e.target.value }))}
          className="px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
        />
        <div>
          <label className="block text-[10px] text-earth-400 dark:text-gray-500">Applied</label>
          <input
            type="date"
            value={amendmentForm.applied_date}
            onChange={(e) => setAmendmentForm((f) => ({ ...f, applied_date: e.target.value }))}
            className="w-full px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
          />
        </div>
        <div>
          <label className="block text-[10px] text-earth-400 dark:text-gray-500">Next due</label>
          <input
            type="date"
            value={amendmentForm.next_due_date}
            onChange={(e) => setAmendmentForm((f) => ({ ...f, next_due_date: e.target.value }))}
            className="w-full px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
          />
        </div>
      </div>
      <input
        type="text"
        placeholder="Notes (optional)"
        value={amendmentForm.notes}
        onChange={(e) => setAmendmentForm((f) => ({ ...f, notes: e.target.value }))}
        className="w-full px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
      />
      <button
        disabled={savingAmendment || !amendmentForm.applied_date}
        onClick={handleAdd}
        className="w-full px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white disabled:opacity-50 transition-colors"
      >
        {savingAmendment ? 'Saving...' : 'Log Amendment'}
      </button>
    </div>
  );

  const renderHistory = () => (
    <>
      {amendments.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-earth-600 dark:text-gray-300">History</div>
          {amendments.map((a) => {
            const isDueSoon = a.next_due_date && a.next_due_date <= getGardenDateOffset(14);
            return (
              <div key={a.id} className="flex items-start justify-between gap-2 text-sm border border-earth-100 dark:border-gray-700 rounded-lg p-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-earth-700 dark:text-gray-200 capitalize">
                      {a.amendment_type.replace('_', ' ')}
                    </span>
                    {a.product_name && (
                      <span className="text-earth-400 dark:text-gray-500 text-xs">({a.product_name})</span>
                    )}
                    {a.amount && (
                      <span className="text-earth-500 dark:text-gray-400 text-xs">{a.amount}</span>
                    )}
                    {isDueSoon && (
                      <span className="inline-block px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
                        Due soon
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
                    Applied {a.applied_date}
                    {a.next_due_date && <> &middot; Next: {a.next_due_date}</>}
                  </div>
                  {a.notes && (
                    <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5 italic">{a.notes}</div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(a.id)}
                  className="text-red-400 hover:text-red-600 text-xs shrink-0"
                  title="Delete"
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">
          No amendments logged yet. Add compost, fertilizer, or other soil treatments above.
        </div>
      )}
    </>
  );

  // Always-open variant (used by ground-plants detail)
  if (alwaysOpen) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
          <span className="text-amber-600">{'🧪'}</span> Soil Amendments
          {hasDueSoon && (
            <span className="inline-block px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
              Due soon
            </span>
          )}
        </h2>
        <div className="space-y-2 mb-4">
          {renderForm()}
        </div>
        {renderHistory()}
      </div>
    );
  }

  // Collapsible variant (used by planters and trays)
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
        onClick={handleToggle}
      >
        <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
          {'🧪'} Soil Amendments
          {hasDueSoon && (
            <span className="inline-block px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
              Due soon
            </span>
          )}
        </span>
        <svg
          className={`w-5 h-5 text-earth-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-earth-100 dark:border-gray-700 pt-4">
          {renderForm()}
          {renderHistory()}
        </div>
      )}
    </div>
  );
}
