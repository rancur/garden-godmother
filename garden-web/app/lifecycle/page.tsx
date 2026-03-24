'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useModal } from '../confirm-modal';
import { useToast } from '../toast';
import {
  getPlants,
  getBeds,
  getBedGrid,
  getTrays,
  getTrayGrid,
  createLifecyclePlan,
  getLifecycles,
  getLifecycleDetail,
  cancelLifecycle,
  completeTask,
  failTask,
  getLifecycleRecommendation,
  getQuickSuggestions,
} from '../api';
import { getPlantIcon } from '../plant-icons';
import { getGardenToday } from '../timezone';

// --- Types ---
interface Plant {
  id: number;
  name: string;
  category: string;
  days_to_maturity_min: number | null;
  days_to_maturity_max: number | null;
  sow_indoor_weeks_before_transplant: number | null;
  desert_sow_outdoor: string[] | null;
  desert_transplant: string[] | null;
}

interface Bed {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
}

interface Tray {
  id: number;
  name: string;
  rows: number;
  cols: number;
}

interface TrayCell {
  id: number;
  row: number;
  col: number;
  plant_id: number | null;
  status: string;
}

interface BedCell {
  cell_x: number;
  cell_y: number;
  plant_id: number | null;
  plant_name: string | null;
  status: string | null;
}

interface LifecycleSummary {
  lifecycle_id: string;
  plant_id: number;
  plant_name: string;
  method: string;
  start_date: string;
  total_tasks: number;
  completed_tasks: number;
  pending_tasks: number;
  current_stage: string;
  current_stage_due: string | null;
  estimated_harvest: string | null;
}

interface LifecycleTask {
  id: number;
  task_type: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  due_date: string | null;
  plant_name: string | null;
  bed_name: string | null;
  lifecycle_order: number;
}

interface LifecycleDetail {
  lifecycle_id: string;
  plant_id: number;
  plant_name: string;
  method: string;
  start_date: string;
  total_tasks: number;
  completed_tasks: number;
  pending_tasks: number;
  current_stage: string;
  estimated_harvest: string | null;
  tasks: LifecycleTask[];
}

const methodLabels: Record<string, string> = {
  seed: 'From Seed (Indoor)',
  direct_sow: 'Direct Sow',
  transplant: 'Buy Transplants',
};

const methodDescriptions: Record<string, string> = {
  seed: 'Start seeds indoors, harden off, then transplant outside',
  direct_sow: 'Plant seeds directly in the planter',
  transplant: 'Buy starts from a nursery and transplant',
};

const statusColors: Record<string, string> = {
  completed: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
  pending: 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700',
  in_progress: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
  skipped: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 line-through',
  overdue: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
};

const priorityDot: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
};

interface QuickSuggestion {
  plant_id: number;
  plant_name: string;
  category: string;
  score: number;
  recommended_method: string;
  reasons: string[];
  urgency: 'high' | 'medium' | 'low';
  has_seeds: boolean;
  currently_growing: boolean;
  spacing_inches: number | null;
  days_to_maturity: string;
  sun: string | null;
  water: string | null;
}

const categoryColor: Record<string, string> = {
  vegetable: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700',
  herb: 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700',
  flower: 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-700',
  fruit: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700',
};

interface LifecycleRecommendation {
  recommended_method: 'seed' | 'direct_sow' | 'transplant';
  reason: string;
  alternatives: { method: string; available: boolean; note: string }[];
  has_seeds: boolean;
  has_tray_space: boolean;
  available_trays: { id: number; name: string; empty_cells: number }[];
  suggested_start_date: string;
}

function LifecyclePageInner() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const urlPlantId = searchParams.get('plant_id') ? Number(searchParams.get('plant_id')) : null;
  const urlMethod = searchParams.get('method') as 'seed' | 'direct_sow' | 'transplant' | null;

  // Wizard state
  const [step, setStep] = useState(0); // 0=list, 1=plant, 2=method, 3=tray, 4=bed, 5=date, 6=preview
  const [plants, setPlants] = useState<Plant[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [trays, setTrays] = useState<Tray[]>([]);
  const [plantSearch, setPlantSearch] = useState('');

  // Recommendation state
  const [recommendation, setRecommendation] = useState<LifecycleRecommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [urlParamsProcessed, setUrlParamsProcessed] = useState(false);

  // Selections
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [method, setMethod] = useState<'seed' | 'direct_sow' | 'transplant'>('seed');
  const [selectedTray, setSelectedTray] = useState<Tray | null>(null);
  const [trayGrid, setTrayGrid] = useState<TrayCell[]>([]);
  const [selectedTrayCell, setSelectedTrayCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  const [bedGrid, setBedGrid] = useState<BedCell[]>([]);
  const [selectedBedCell, setSelectedBedCell] = useState<{ x: number; y: number } | null>(null);
  const [startDate, setStartDate] = useState(getGardenToday());

  // Preview / result
  const [previewTasks, setPreviewTasks] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<any>(null);

  // Lifecycle list
  const [lifecycles, setLifecycles] = useState<LifecycleSummary[]>([]);
  const [expandedLifecycle, setExpandedLifecycle] = useState<string | null>(null);
  const [lifecycleDetail, setLifecycleDetail] = useState<LifecycleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Quick suggestions
  const [quickSuggestions, setQuickSuggestions] = useState<QuickSuggestion[]>([]);

  const loadLifecycles = useCallback(() => {
    getLifecycles().then(setLifecycles).catch(() => {});
  }, []);

  useEffect(() => {
    loadLifecycles();
    getQuickSuggestions()
      .then((data: any) => setQuickSuggestions(data.suggestions || []))
      .catch(() => {});
  }, [loadLifecycles]);

  // Auto-start wizard from URL params
  useEffect(() => {
    if (urlPlantId && !urlParamsProcessed) {
      setUrlParamsProcessed(true);
      // Load data and auto-select plant
      Promise.all([getPlants(), getBeds(), getTrays()]).then(([p, b, t]) => {
        const allPlants = Array.isArray(p) ? p : [];
        setPlants(allPlants);
        setBeds(Array.isArray(b) ? b : []);
        setTrays(Array.isArray(t) ? t : []);

        const plant = allPlants.find((pl: Plant) => pl.id === urlPlantId);
        if (plant) {
          setSelectedPlant(plant);
          if (urlMethod) {
            setMethod(urlMethod);
          }
          setStep(2); // Go to method selection
          // Fetch recommendation
          setRecommendationLoading(true);
          getLifecycleRecommendation(urlPlantId)
            .then((rec: LifecycleRecommendation) => {
              setRecommendation(rec);
              if (!urlMethod) {
                setMethod(rec.recommended_method);
              }
              if (rec.suggested_start_date) {
                setStartDate(rec.suggested_start_date);
              }
            })
            .catch(() => {})
            .finally(() => setRecommendationLoading(false));
        }
      });
    }
  }, [urlPlantId, urlMethod, urlParamsProcessed]);

  // Fetch recommendation when plant is selected in wizard
  const fetchRecommendation = useCallback((plantId: number) => {
    setRecommendationLoading(true);
    setRecommendation(null);
    getLifecycleRecommendation(plantId)
      .then((rec: LifecycleRecommendation) => {
        setRecommendation(rec);
        setMethod(rec.recommended_method);
        if (rec.suggested_start_date) {
          setStartDate(rec.suggested_start_date);
        }
      })
      .catch(() => {})
      .finally(() => setRecommendationLoading(false));
  }, []);

  // Load plants, beds, trays when wizard starts
  const startWizard = () => {
    setStep(1);
    setSelectedPlant(null);
    setMethod('seed');
    setSelectedTray(null);
    setTrayGrid([]);
    setSelectedTrayCell(null);
    setSelectedBed(null);
    setBedGrid([]);
    setSelectedBedCell(null);
    setStartDate(getGardenToday());
    setPreviewTasks([]);
    setCreateResult(null);
    setRecommendation(null);

    Promise.all([getPlants(), getBeds(), getTrays()]).then(([p, b, t]) => {
      setPlants(Array.isArray(p) ? p : []);
      setBeds(Array.isArray(b) ? b : []);
      setTrays(Array.isArray(t) ? t : []);
    });
  };

  const cancelWizard = () => {
    setStep(0);
  };

  // Load tray grid when tray selected
  useEffect(() => {
    if (selectedTray) {
      getTrayGrid(selectedTray.id).then((data: any) => {
        setTrayGrid(data.cells || []);
      }).catch(() => setTrayGrid([]));
    }
  }, [selectedTray]);

  // Load bed grid when bed selected
  useEffect(() => {
    if (selectedBed) {
      getBedGrid(selectedBed.id).then((data: any) => {
        setBedGrid(data.cells || []);
      }).catch(() => setBedGrid([]));
    }
  }, [selectedBed]);

  // Generate preview when reaching preview step
  const generatePreview = () => {
    if (!selectedPlant) return;
    // We build a local preview by calling the API with a dry-run-like approach
    // Actually, we just show what will be created based on the parameters
    setStep(6);
  };

  const handleCreate = async () => {
    if (!selectedPlant) return;
    setCreating(true);
    try {
      const payload: any = {
        plant_id: selectedPlant.id,
        method,
        start_date: startDate,
      };
      if (selectedBed) {
        payload.target_bed_id = selectedBed.id;
        if (selectedBedCell) {
          payload.target_cell_x = selectedBedCell.x;
          payload.target_cell_y = selectedBedCell.y;
        }
      }
      if (method === 'seed' && selectedTray) {
        payload.tray_id = selectedTray.id;
        if (selectedTrayCell) {
          payload.tray_row = selectedTrayCell.row;
          payload.tray_col = selectedTrayCell.col;
        }
      }
      const result = await createLifecyclePlan(payload);
      setCreateResult(result);
      setPreviewTasks(result.tasks || []);
      setStep(7); // success step
      loadLifecycles();
    } catch (e: any) {
      toast(e.message || 'Failed to create lifecycle plan', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleExpandLifecycle = async (id: string) => {
    if (expandedLifecycle === id) {
      setExpandedLifecycle(null);
      setLifecycleDetail(null);
      return;
    }
    setExpandedLifecycle(id);
    setLoadingDetail(true);
    try {
      const detail = await getLifecycleDetail(id);
      setLifecycleDetail(detail);
    } catch {
      setLifecycleDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCompleteTask = async (taskId: number) => {
    try {
      await completeTask(taskId);
      if (expandedLifecycle) {
        const detail = await getLifecycleDetail(expandedLifecycle);
        setLifecycleDetail(detail);
      }
      loadLifecycles();
      toast('Task completed');
    } catch { toast('Failed to complete task', 'error'); }
  };

  const handleFailTask = async (taskId: number) => {
    if (!await showConfirm({ title: 'Fail Task', message: 'Mark this task as failed? All downstream tasks will be deleted.', confirmText: 'Mark Failed', destructive: true })) return;
    try {
      await failTask(taskId);
      if (expandedLifecycle) {
        const detail = await getLifecycleDetail(expandedLifecycle);
        setLifecycleDetail(detail);
      }
      loadLifecycles();
      toast('Task marked as failed');
    } catch { toast('Failed to update task', 'error'); }
  };

  const handleCancelLifecycle = async (id: string) => {
    if (!await showConfirm({ title: 'Cancel Lifecycle', message: 'Cancel this entire lifecycle? All pending tasks will be deleted.', confirmText: 'Cancel Lifecycle', destructive: true })) return;
    try {
      await cancelLifecycle(id);
      setExpandedLifecycle(null);
      setLifecycleDetail(null);
      loadLifecycles();
      toast('Lifecycle cancelled');
    } catch { toast('Failed to cancel lifecycle', 'error'); }
  };

  const filteredPlants = plants.filter(
    (p) => p.name.toLowerCase().includes(plantSearch.toLowerCase()),
  );

  // --- Render ---

  // Wizard step: Select Plant
  if (step === 1) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Plan a New Plant</h1>
          <button onClick={cancelWizard} className="text-sm text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300">Cancel</button>
        </div>
        <div className="text-sm text-earth-500 dark:text-gray-400">Step 1 of 5: Select a plant</div>
        <input
          type="text"
          placeholder="Search plants..."
          value={plantSearch}
          onChange={(e) => setPlantSearch(e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-earth-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent"
          autoFocus
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
          {filteredPlants.map((p) => (
            <button
              key={p.id}
              onClick={() => { setSelectedPlant(p); setStep(2); fetchRecommendation(p.id); }}
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all hover:shadow-md ${
                selectedPlant?.id === p.id
                  ? 'border-garden-500 bg-garden-50 dark:bg-garden-900/30 ring-2 ring-garden-500'
                  : 'border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-garden-300'
              }`}
            >
              <span className="text-2xl">{getPlantIcon(p.name, p.category)}</span>
              <div>
                <div className="font-medium text-earth-800 dark:text-gray-100 text-sm">{p.name}</div>
                <div className="text-xs text-earth-400 dark:text-gray-500">{p.category}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Wizard step: Choose Method
  if (step === 2 && selectedPlant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Plan: {selectedPlant.name}</h1>
          <button onClick={cancelWizard} className="text-sm text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300">Cancel</button>
        </div>
        <div className="text-sm text-earth-500 dark:text-gray-400">Step 2 of 5: Choose growing method</div>

        {/* Smart Recommendation */}
        {recommendationLoading && (
          <div className="bg-garden-50 dark:bg-garden-900/20 border border-garden-200 dark:border-garden-700 rounded-xl p-4 text-sm text-garden-700 dark:text-garden-300">
            Analyzing best method...
          </div>
        )}
        {recommendation && !recommendationLoading && (
          <div className="bg-garden-50 dark:bg-garden-900/20 border border-garden-200 dark:border-garden-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{'\u{1F4A1}'}</span>
              <span className="text-sm font-bold text-garden-800 dark:text-garden-300">Recommended: {methodLabels[recommendation.recommended_method]}</span>
            </div>
            <p className="text-sm text-garden-700 dark:text-garden-400">{recommendation.reason}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {recommendation.has_seeds && (
                <span className="inline-flex items-center gap-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-1 rounded-full font-medium">
                  {'\u{1F331}'} You have seeds!
                </span>
              )}
              {recommendation.has_tray_space && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full font-medium">
                  {'\u{1FAB4}'} Tray space: {recommendation.available_trays[0]?.name}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4">
          {(['seed', 'direct_sow', 'transplant'] as const).map((m) => {
            const isRecommended = recommendation?.recommended_method === m;
            return (
            <button
              key={m}
              onClick={() => {
                setMethod(m);
                if (m === 'seed') setStep(3);
                else setStep(4);
              }}
              className={`p-5 rounded-xl border text-left transition-all hover:shadow-md ${
                isRecommended
                  ? 'border-garden-500 bg-garden-50 dark:bg-garden-900/30 ring-2 ring-garden-400'
                  : method === m
                    ? 'border-garden-500 bg-garden-50 dark:bg-garden-900/30'
                    : 'border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-earth-800 dark:text-gray-100">{methodLabels[m]}</span>
                {isRecommended && (
                  <span className="text-xs bg-garden-600 text-white px-2 py-0.5 rounded-full font-medium">
                    Recommended
                  </span>
                )}
              </div>
              <div className="text-sm text-earth-500 dark:text-gray-400 mt-1">{methodDescriptions[m]}</div>
              {m === 'seed' && selectedPlant.sow_indoor_weeks_before_transplant && (
                <div className="text-xs text-garden-600 dark:text-garden-400 mt-2">
                  Start {selectedPlant.sow_indoor_weeks_before_transplant} weeks before transplant window
                </div>
              )}
              {recommendation?.alternatives.find((a) => a.method === m) && (
                <div className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                  {recommendation.alternatives.find((a) => a.method === m)?.note}
                </div>
              )}
            </button>
            );
          })}
        </div>
        <button onClick={() => setStep(1)} className="text-sm text-garden-600 dark:text-garden-400 hover:text-garden-700">&larr; Back to plant selection</button>
      </div>
    );
  }

  // Wizard step: Select Tray (for seed method)
  if (step === 3 && selectedPlant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Select Seed Tray</h1>
          <button onClick={cancelWizard} className="text-sm text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300">Cancel</button>
        </div>
        <div className="text-sm text-earth-500 dark:text-gray-400">Step 3 of 5: Choose a tray and cell (optional)</div>

        {trays.length === 0 ? (
          <div className="text-earth-500 dark:text-gray-400">
            <p>No seed trays found. You can skip this step or <Link href="/trays" className="text-garden-600 underline">create a tray</Link> first.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {trays.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTray(t); setSelectedTrayCell(null); }}
                  className={`p-4 rounded-lg border text-left transition-all ${
                    selectedTray?.id === t.id
                      ? 'border-garden-500 bg-garden-50 dark:bg-garden-900/30 ring-2 ring-garden-500'
                      : 'border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-garden-300'
                  }`}
                >
                  <div className="font-medium text-earth-800 dark:text-gray-100">{t.name}</div>
                  <div className="text-xs text-earth-400 dark:text-gray-500">{t.rows} x {t.cols} cells</div>
                </button>
              ))}
            </div>

            {selectedTray && (
              <div>
                <div className="text-sm font-medium text-earth-600 dark:text-gray-300 mb-2">Select a cell (tap an empty cell):</div>
                <div className="inline-grid gap-1 p-3 bg-earth-100 dark:bg-gray-750 rounded-lg" style={{ gridTemplateColumns: `repeat(${selectedTray.cols}, 2.5rem)` }}>
                  {Array.from({ length: selectedTray.rows }, (_, r) =>
                    Array.from({ length: selectedTray.cols }, (_, c) => {
                      const cell = trayGrid.find((tc) => tc.row === r && tc.col === c);
                      const isEmpty = !cell || cell.status === 'empty';
                      const isSelected = selectedTrayCell?.row === r && selectedTrayCell?.col === c;
                      return (
                        <button
                          key={`${r}-${c}`}
                          onClick={() => isEmpty && setSelectedTrayCell({ row: r, col: c })}
                          disabled={!isEmpty}
                          className={`w-10 h-10 rounded text-xs font-mono flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-garden-500 text-white ring-2 ring-garden-300'
                              : isEmpty
                                ? 'bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 hover:border-garden-400 cursor-pointer'
                                : 'bg-earth-200 dark:bg-gray-700 text-earth-400 dark:text-gray-500 cursor-not-allowed'
                          }`}
                          title={isEmpty ? `Row ${r}, Col ${c}` : `Occupied`}
                        >
                          {isEmpty ? '' : '\u{1F331}'}
                        </button>
                      );
                    }),
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => setStep(2)} className="text-sm text-garden-600 dark:text-garden-400 hover:text-garden-700">&larr; Back</button>
          <button
            onClick={() => setStep(4)}
            className="px-4 py-2 bg-garden-600 hover:bg-garden-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {selectedTray ? 'Next' : 'Skip Tray'} &rarr;
          </button>
        </div>
      </div>
    );
  }

  // Wizard step: Select Planter
  if (step === 4 && selectedPlant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Select Target Planter</h1>
          <button onClick={cancelWizard} className="text-sm text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300">Cancel</button>
        </div>
        <div className="text-sm text-earth-500 dark:text-gray-400">Step {method === 'seed' ? '4' : '3'} of 5: Choose where to plant (optional)</div>

        {beds.length === 0 ? (
          <div className="text-earth-500 dark:text-gray-400">
            <p>No planters found. You can skip this step or <Link href="/planters" className="text-garden-600 underline">create a planter</Link> first.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {beds.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setSelectedBed(b); setSelectedBedCell(null); }}
                  className={`p-4 rounded-lg border text-left transition-all ${
                    selectedBed?.id === b.id
                      ? 'border-garden-500 bg-garden-50 dark:bg-garden-900/30 ring-2 ring-garden-500'
                      : 'border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-garden-300'
                  }`}
                >
                  <div className="font-medium text-earth-800 dark:text-gray-100">{b.name}</div>
                  <div className="text-xs text-earth-400 dark:text-gray-500">{b.width_cells} x {b.height_cells}</div>
                </button>
              ))}
            </div>

            {selectedBed && (
              <div>
                <div className="text-sm font-medium text-earth-600 dark:text-gray-300 mb-2">Select a cell (tap an empty cell):</div>
                <div className="inline-grid gap-1 p-3 bg-earth-100 dark:bg-gray-750 rounded-lg" style={{ gridTemplateColumns: `repeat(${selectedBed.width_cells}, 2.5rem)` }}>
                  {Array.from({ length: selectedBed.height_cells }, (_, y) =>
                    Array.from({ length: selectedBed.width_cells }, (_, x) => {
                      const cell = bedGrid.find((bc) => bc.cell_x === x && bc.cell_y === y);
                      const isEmpty = !cell || !cell.plant_id;
                      const isSelected = selectedBedCell?.x === x && selectedBedCell?.y === y;
                      return (
                        <button
                          key={`${x}-${y}`}
                          onClick={() => isEmpty && setSelectedBedCell({ x, y })}
                          disabled={!isEmpty}
                          className={`w-10 h-10 rounded text-xs font-mono flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-garden-500 text-white ring-2 ring-garden-300'
                              : isEmpty
                                ? 'bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 hover:border-garden-400 cursor-pointer'
                                : 'bg-green-200 dark:bg-green-900 text-green-700 dark:text-green-300 cursor-not-allowed'
                          }`}
                          title={isEmpty ? `(${x},${y})` : cell?.plant_name || 'Occupied'}
                        >
                          {isEmpty ? '' : '\u{1F33F}'}
                        </button>
                      );
                    }),
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => setStep(method === 'seed' ? 3 : 2)} className="text-sm text-garden-600 dark:text-garden-400 hover:text-garden-700">&larr; Back</button>
          <button
            onClick={() => setStep(5)}
            className="px-4 py-2 bg-garden-600 hover:bg-garden-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {selectedBed ? 'Next' : 'Skip Planter'} &rarr;
          </button>
        </div>
      </div>
    );
  }

  // Wizard step: Start Date
  if (step === 5 && selectedPlant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Choose Start Date</h1>
          <button onClick={cancelWizard} className="text-sm text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300">Cancel</button>
        </div>
        <div className="text-sm text-earth-500 dark:text-gray-400">Step 5 of 5: When to begin</div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 max-w-md">
          <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-2">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-earth-800 dark:text-gray-100"
          />
          {selectedPlant.desert_sow_outdoor && (
            <p className="text-xs text-earth-400 dark:text-gray-500 mt-2">
              Outdoor sow window: {selectedPlant.desert_sow_outdoor[0]} to {selectedPlant.desert_sow_outdoor[1]}
            </p>
          )}
          {selectedPlant.desert_transplant && (
            <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
              Transplant window: {selectedPlant.desert_transplant[0]} to {selectedPlant.desert_transplant[1]}
            </p>
          )}
        </div>

        {/* Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 max-w-md">
          <h3 className="font-bold text-earth-800 dark:text-gray-100 mb-3">Plan Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-earth-500 dark:text-gray-400">Plant</span>
              <span className="font-medium text-earth-800 dark:text-gray-100">{getPlantIcon(selectedPlant.name, selectedPlant.category)} {selectedPlant.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-earth-500 dark:text-gray-400">Method</span>
              <span className="font-medium text-earth-800 dark:text-gray-100">{methodLabels[method]}</span>
            </div>
            {method === 'seed' && selectedTray && (
              <div className="flex justify-between">
                <span className="text-earth-500 dark:text-gray-400">Tray</span>
                <span className="font-medium text-earth-800 dark:text-gray-100">
                  {selectedTray.name} {selectedTrayCell ? `(${selectedTrayCell.row},${selectedTrayCell.col})` : ''}
                </span>
              </div>
            )}
            {selectedBed && (
              <div className="flex justify-between">
                <span className="text-earth-500 dark:text-gray-400">Planter</span>
                <span className="font-medium text-earth-800 dark:text-gray-100">
                  {selectedBed.name} {selectedBedCell ? `(${selectedBedCell.x},${selectedBedCell.y})` : ''}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-earth-500 dark:text-gray-400">Start</span>
              <span className="font-medium text-earth-800 dark:text-gray-100">{startDate}</span>
            </div>
            {selectedPlant.days_to_maturity_min && (
              <div className="flex justify-between">
                <span className="text-earth-500 dark:text-gray-400">Est. Maturity</span>
                <span className="font-medium text-earth-800 dark:text-gray-100">{selectedPlant.days_to_maturity_min}-{selectedPlant.days_to_maturity_max} days</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => setStep(4)} className="text-sm text-garden-600 dark:text-garden-400 hover:text-garden-700">&larr; Back</button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-6 py-2.5 bg-garden-600 hover:bg-garden-700 disabled:bg-garden-400 text-white rounded-lg font-semibold transition-colors"
          >
            {creating ? 'Creating...' : 'Create Plan'}
          </button>
        </div>
      </div>
    );
  }

  // Success step
  if (step === 7 && createResult) {
    return (
      <div className="space-y-6">
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-6">
          <h1 className="text-2xl font-bold text-green-700 dark:text-green-300">{'\u2705'} Lifecycle Plan Created!</h1>
          <p className="text-green-600 dark:text-green-400 mt-2">
            {createResult.tasks_created} tasks created for {createResult.plant_name || selectedPlant?.name}
          </p>
          {createResult.estimated_harvest && (
            <p className="text-green-600 dark:text-green-400">
              Estimated first harvest: {createResult.estimated_harvest}
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6">
          <h2 className="font-bold text-earth-800 dark:text-gray-100 mb-4">Task Timeline</h2>
          <div className="space-y-2">
            {(createResult.tasks || []).map((t: any, i: number) => (
              <div key={t.id || i} className="flex items-center gap-3 p-3 rounded-lg border border-earth-100 dark:border-gray-700 bg-earth-50 dark:bg-gray-750">
                <div className={`w-2 h-2 rounded-full ${priorityDot[t.priority] || 'bg-gray-400'}`} />
                <div className="text-xs text-earth-400 dark:text-gray-500 w-24 shrink-0">{t.due_date}</div>
                <div className="flex-1 text-sm font-medium text-earth-800 dark:text-gray-100">{t.title}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => { setStep(0); loadLifecycles(); }} className="px-4 py-2 bg-garden-600 hover:bg-garden-700 text-white rounded-lg text-sm font-medium transition-colors">
            View All Lifecycles
          </button>
          <button onClick={startWizard} className="px-4 py-2 border border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg text-sm font-medium text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors">
            Plan Another Plant
          </button>
        </div>
      </div>
    );
  }

  // Main lifecycle list (step 0)
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">Plant Lifecycle Planner</h1>
          <p className="text-earth-500 dark:text-gray-400 text-sm mt-1">Plan the full growing journey from seed to success</p>
        </div>
        <button
          onClick={startWizard}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-garden-600 hover:bg-garden-700 text-white rounded-lg font-semibold text-sm transition-colors shadow-sm self-start sm:self-auto"
        >
          <span>{'\u{1F33F}'}</span> Plan a New Plant
        </button>
      </div>

      {/* Quick Suggestions */}
      {quickSuggestions.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-3">Top Suggestions</h2>

          {/* Hero card for #1 suggestion */}
          {(() => {
            const hero = quickSuggestions[0];
            const urgencyBadge = hero.urgency === 'high'
              ? { icon: '\uD83D\uDD34', label: 'Act now', cls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' }
              : hero.urgency === 'medium'
              ? { icon: '\uD83D\uDFE1', label: 'This month', cls: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' }
              : { icon: '\uD83D\uDFE2', label: 'Plenty of time', cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' };
            return (
              <div className={`rounded-xl border-2 p-5 shadow-md mb-4 ${categoryColor[hero.category] || 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700'}`}>
                <div className="flex items-start gap-4">
                  <span className="text-4xl">{getPlantIcon(hero.plant_name, hero.category)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-earth-800 dark:text-gray-100 text-lg">{hero.plant_name}</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300">
                        Score {hero.score}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${urgencyBadge.cls}`}>
                        {urgencyBadge.icon} {urgencyBadge.label}
                      </span>
                      {hero.has_seeds && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          You have seeds!
                        </span>
                      )}
                      {!hero.currently_growing && hero.score >= 60 && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                          New to your garden!
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-earth-500 dark:text-gray-400 mb-2">
                      Recommended: <span className="font-semibold">{methodLabels[hero.recommended_method] || hero.recommended_method}</span>
                    </div>
                    <ul className="space-y-1 mb-3">
                      {hero.reasons.map((r, i) => (
                        <li key={i} className="text-sm text-earth-600 dark:text-gray-300 flex items-start gap-1.5">
                          <span className="text-garden-500 mt-0.5 shrink-0">&#10003;</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-3 text-xs text-earth-400 dark:text-gray-500 mb-3">
                      {hero.days_to_maturity && <span>{hero.days_to_maturity}d to maturity</span>}
                      {hero.sun && <span>{hero.sun}</span>}
                      {hero.spacing_inches && <span>{hero.spacing_inches}&quot; spacing</span>}
                    </div>
                    <button
                      onClick={() => {
                        window.history.replaceState({}, '', `/lifecycle?plant_id=${hero.plant_id}&method=${hero.recommended_method}`);
                        window.location.reload();
                      }}
                      className="inline-flex items-center justify-center gap-1 text-sm bg-garden-600 hover:bg-garden-700 text-white font-semibold px-5 py-2 rounded-lg transition-colors"
                    >
                      Plan This &rarr;
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Grid for remaining suggestions */}
          {quickSuggestions.length > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {quickSuggestions.slice(1).map((s) => {
                const urgencyBadge = s.urgency === 'high'
                  ? { icon: '\uD83D\uDD34', label: 'Act now', cls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' }
                  : s.urgency === 'medium'
                  ? { icon: '\uD83D\uDFE1', label: 'This month', cls: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' }
                  : { icon: '\uD83D\uDFE2', label: 'Plenty of time', cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' };
                return (
                  <div
                    key={s.plant_id}
                    className={`rounded-xl border p-4 shadow-sm ${categoryColor[s.category] || 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700'}`}
                  >
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-2xl">{getPlantIcon(s.plant_name, s.category)}</span>
                      <span className="font-bold text-earth-800 dark:text-gray-100 text-sm">{s.plant_name}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${urgencyBadge.cls}`}>
                        {urgencyBadge.icon} {urgencyBadge.label}
                      </span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {s.has_seeds && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          Has seeds
                        </span>
                      )}
                      {!s.currently_growing && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                          New!
                        </span>
                      )}
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-earth-100 dark:bg-gray-700 text-earth-500 dark:text-gray-400">
                        {methodLabels[s.recommended_method] || s.recommended_method}
                      </span>
                    </div>
                    <ul className="space-y-1 mb-2">
                      {s.reasons.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-xs text-earth-500 dark:text-gray-400 flex items-start gap-1">
                          <span className="text-garden-500 mt-0.5 shrink-0">&#10003;</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2 mt-2 text-[10px] text-earth-400 dark:text-gray-500">
                      {s.days_to_maturity && <span>{s.days_to_maturity}d</span>}
                      {s.sun && <span>{s.sun}</span>}
                      {s.spacing_inches && <span>{s.spacing_inches}&quot; spacing</span>}
                    </div>
                    <button
                      onClick={() => {
                        window.history.replaceState({}, '', `/lifecycle?plant_id=${s.plant_id}&method=${s.recommended_method}`);
                        window.location.reload();
                      }}
                      className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs bg-garden-600 hover:bg-garden-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Plan This &rarr;
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Active Lifecycles */}
      {lifecycles.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-12 text-center">
          <div className="text-4xl mb-3">{'\u{1F331}'}</div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-2">No lifecycle plans yet</h2>
          <p className="text-earth-500 dark:text-gray-400 mb-4">Create your first plan to track a plant from seed to harvest</p>
          <button
            onClick={startWizard}
            className="px-5 py-2.5 bg-garden-600 hover:bg-garden-700 text-white rounded-lg font-semibold text-sm transition-colors"
          >
            Get Started
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {lifecycles.map((lc) => {
            const progress = lc.total_tasks > 0 ? Math.round((lc.completed_tasks / lc.total_tasks) * 100) : 0;
            const isExpanded = expandedLifecycle === lc.lifecycle_id;

            return (
              <div key={lc.lifecycle_id} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <button
                  onClick={() => handleExpandLifecycle(lc.lifecycle_id)}
                  className="w-full p-5 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{getPlantIcon(lc.plant_name || '', '')}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-earth-800 dark:text-gray-100">{lc.plant_name}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-earth-100 dark:bg-gray-700 text-earth-500 dark:text-gray-400">
                          {methodLabels[lc.method] || lc.method}
                        </span>
                      </div>
                      <div className="text-sm text-earth-500 dark:text-gray-400 mt-0.5">
                        {lc.current_stage}
                        {lc.current_stage_due && <span className="ml-1">({lc.current_stage_due})</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-earth-700 dark:text-gray-300">{progress}%</div>
                      <div className="text-xs text-earth-400 dark:text-gray-500">
                        {lc.completed_tasks}/{lc.total_tasks} tasks
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-2 bg-earth-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-garden-500 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-earth-400 dark:text-gray-500">
                    <span>Started: {lc.start_date}</span>
                    {lc.estimated_harvest && <span>Est. Harvest: {lc.estimated_harvest}</span>}
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-earth-200 dark:border-gray-700 p-5">
                    {loadingDetail ? (
                      <div className="text-center py-4 text-earth-400 dark:text-gray-500">Loading...</div>
                    ) : lifecycleDetail ? (
                      <div className="space-y-3">
                        {lifecycleDetail.tasks.map((task) => (
                          <div
                            key={task.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${statusColors[task.status] || statusColors.pending}`}
                          >
                            {task.status === 'pending' || task.status === 'in_progress' ? (
                              <div className="flex gap-1 shrink-0">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCompleteTask(task.id); }}
                                  className="w-6 h-6 rounded border-2 border-earth-300 dark:border-gray-500 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors flex items-center justify-center"
                                  title="Complete"
                                >
                                  <span className="text-xs opacity-0 hover:opacity-100">{'\u2713'}</span>
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleFailTask(task.id); }}
                                  className="w-6 h-6 rounded border-2 border-earth-300 dark:border-gray-500 hover:border-red-400 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors flex items-center justify-center text-xs text-earth-300 dark:text-gray-500 hover:text-red-500"
                                  title="Mark as failed"
                                >
                                  {'\u2717'}
                                </button>
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                                {task.status === 'completed' ? (
                                  <span className="text-green-500">{'\u2713'}</span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </div>
                            )}
                            <div className={`w-2 h-2 rounded-full shrink-0 ${priorityDot[task.priority] || 'bg-gray-400'}`} />
                            <div className="text-xs text-earth-400 dark:text-gray-500 w-24 shrink-0">{task.due_date}</div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium ${task.status === 'skipped' ? 'text-gray-400 dark:text-gray-500' : 'text-earth-800 dark:text-gray-100'}`}>
                                {task.title}
                              </div>
                              {task.description && (
                                <div className="text-xs text-earth-400 dark:text-gray-500 line-clamp-1">{task.description}</div>
                              )}
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => handleCancelLifecycle(lc.lifecycle_id)}
                            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                          >
                            Cancel Entire Lifecycle
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-earth-400 dark:text-gray-500">Failed to load detail</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LifecyclePage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading lifecycle planner...</div>}>
      <LifecyclePageInner />
    </Suspense>
  );
}
