'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getTrayGrid, getPlants, getBeds, seedTrayCell, updateTrayCell, transplantTrayCell, updateTray, clearTrayCell, duplicateTray, getIrrigationZones, getAreas, getZoneSchedule, getJournalEntries, deleteTray, moveTrayCellToPlanter, undoAction, getAmendments, createAmendment, deleteAmendment } from '../../api';
import { useToast } from '../../toast';
import { useModal } from '../../confirm-modal';
import { getGardenToday, getGardenDateOffset, formatGardenDateTime, formatGardenDate } from '../../timezone';

interface Plant {
  id: number;
  name: string;
  category: string;
}

interface Bed {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
}

interface CellData {
  cell_id: number;
  plant_id: number | null;
  plant_name: string | null;
  plant_category: string | null;
  status: string;
  seed_date: string | null;
  germination_date: string | null;
  notes: string | null;
}

interface TrayData {
  tray: {
    id: number;
    name: string;
    rows: number;
    cols: number;
    cell_size: string;
    location: string | null;
    irrigation_type?: string;
    irrigation_zone_name?: string;
    area_id?: number | null;
  };
  grid: (CellData | null)[][];
  summary: Record<string, number>;
}

interface TrayArea {
  id: number;
  name: string;
  color: string | null;
}

interface IrrigationZone {
  id: string;
  name: string;
  zone_number: number;
  device_name: string;
  enabled: boolean;
}

interface IrrigationValve {
  id: string;
  name: string;
  device_name: string;
  device_type: string;
}

const statusColors: Record<string, { bg: string; border: string; label: string }> = {
  empty: { bg: 'bg-gray-100 dark:bg-gray-700', border: 'border-earth-200 dark:border-gray-600', label: 'Empty' },
  seeded: { bg: 'bg-blue-200 dark:bg-blue-800', border: 'border-blue-400 dark:border-blue-600', label: 'Seeded' },
  germinated: { bg: 'bg-green-200 dark:bg-green-800', border: 'border-green-400 dark:border-green-600', label: 'Germinated' },
  ready_to_transplant: { bg: 'bg-yellow-200 dark:bg-yellow-800', border: 'border-yellow-400 dark:border-yellow-600', label: 'Ready' },
  transplanted: { bg: 'bg-purple-200 dark:bg-purple-800', border: 'border-purple-400 dark:border-purple-600', label: 'Transplanted' },
  failed: { bg: 'bg-red-200 dark:bg-red-800', border: 'border-red-400 dark:border-red-600', label: 'Failed' },
};

const statusTransitions: Record<string, string[]> = {
  empty: [],
  seeded: ['germinated', 'failed'],
  germinated: ['ready_to_transplant', 'failed'],
  ready_to_transplant: ['transplanted'],
  transplanted: [],
  failed: [],
};

export default function TrayDetailPage() {
  const params = useParams();
  const router = useRouter();
  const trayId = Number(params.id);
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useModal();

  const [data, setData] = useState<TrayData | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [trayAreas, setTrayAreas] = useState<TrayArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Grid keyboard navigation state
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);

  // Sidebar visibility state (hidden by default, shown on cell click)
  const [showSidebar, setShowSidebar] = useState(false);

  // Transplant modal
  const [showTransplant, setShowTransplant] = useState(false);
  const [transplantBed, setTransplantBed] = useState<number | null>(null);
  const [transplantX, setTransplantX] = useState(0);
  const [transplantY, setTransplantY] = useState(0);
  const [transplantCellId, setTransplantCellId] = useState<number | null>(null);

  // Move to planter modal
  const [showMoveToPlanter, setShowMoveToPlanter] = useState(false);
  const [moveBed, setMoveBed] = useState<number | null>(null);
  const [moveCellX, setMoveCellX] = useState(0);
  const [moveCellY, setMoveCellY] = useState(0);
  const [moveCellId, setMoveCellId] = useState<number | null>(null);
  const [movingToPlanter, setMovingToPlanter] = useState(false);

  // Tray settings state
  const [showTraySettings, setShowTraySettings] = useState(false);

  // Tray history state
  const [showTrayHistory, setShowTrayHistory] = useState(false);
  const [trayHistory, setTrayHistory] = useState<any[]>([]);
  const [trayHistoryLoading, setTrayHistoryLoading] = useState(false);

  // Irrigation settings state
  const [showIrrigation, setShowIrrigation] = useState(false);
  const [irrigationZones, setIrrigationZones] = useState<IrrigationZone[]>([]);
  const [irrigationValves, setIrrigationValves] = useState<IrrigationValve[]>([]);
  const [irrigationLoading, setIrrigationLoading] = useState(false);
  const [irrigationType, setIrrigationType] = useState<string>('manual');
  const [irrigationZoneName, setIrrigationZoneName] = useState<string>('');
  const [savingIrrigation, setSavingIrrigation] = useState(false);
  const [traySchedule, setTraySchedule] = useState<any>(null);
  const [trayScheduleLoading, setTrayScheduleLoading] = useState(false);

  // Soil amendments state
  const [showAmendments, setShowAmendments] = useState(false);
  const [amendments, setAmendments] = useState<any[]>([]);
  const [amendmentForm, setAmendmentForm] = useState({
    amendment_type: 'compost', product_name: '', amount: '', applied_date: getGardenToday(), next_due_date: '', notes: '',
  });
  const [savingAmendment, setSavingAmendment] = useState(false);

  const loadAmendments = useCallback(() => {
    getAmendments({ tray_id: trayId }).then(setAmendments).catch(() => setAmendments([]));
  }, [trayId]);

  const loadData = useCallback(() => {
    getTrayGrid(trayId)
      .then(setData)
      .catch(() => setError('Failed to load tray'));
  }, [trayId]);

  useEffect(() => {
    Promise.all([getTrayGrid(trayId), getPlants(), getBeds(), getAreas('trays')])
      .then(([trayData, plantsData, bedsData, areasData]) => {
        setData(trayData);
        setPlants(plantsData);
        setBeds(bedsData);
        setTrayAreas(areasData);
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [trayId]);

  // Sync irrigation state when tray data loads
  useEffect(() => {
    if (data?.tray) {
      setIrrigationType(data.tray.irrigation_type || 'manual');
      setIrrigationZoneName(data.tray.irrigation_zone_name || '');
    }
  }, [data?.tray?.id, data?.tray?.irrigation_type, data?.tray?.irrigation_zone_name]);

  const handleLoadIrrigationZones = useCallback(() => {
    setIrrigationLoading(true);
    getIrrigationZones()
      .then((res: { zones: IrrigationZone[]; valves?: IrrigationValve[] }) => {
        setIrrigationZones(res.zones || []);
        setIrrigationValves(res.valves || []);
      })
      .catch(() => {
        setIrrigationZones([]);
        setIrrigationValves([]);
      })
      .finally(() => setIrrigationLoading(false));
  }, []);

  const loadTraySchedule = useCallback(() => {
    const zoneName = data?.tray?.irrigation_zone_name;
    if (!zoneName) return;
    setTrayScheduleLoading(true);
    getZoneSchedule(zoneName)
      .then(setTraySchedule)
      .catch(() => setTraySchedule(null))
      .finally(() => setTrayScheduleLoading(false));
  }, [data?.tray?.irrigation_zone_name]);

  const handleSaveIrrigation = useCallback(async () => {
    if (!data) return;
    setSavingIrrigation(true);
    try {
      await updateTray(trayId, {
        irrigation_type: irrigationType,
        irrigation_zone_name: irrigationZoneName || undefined,
      });
      loadData();
    } catch {
      setError('Failed to save irrigation settings');
    } finally {
      setSavingIrrigation(false);
    }
  }, [data, trayId, irrigationType, irrigationZoneName, loadData]);

  const loadTrayHistory = useCallback(() => {
    setTrayHistoryLoading(true);
    getJournalEntries({ tray_id: trayId, limit: 50 })
      .then((entries: any[]) => setTrayHistory(entries || []))
      .catch(() => setTrayHistory([]))
      .finally(() => setTrayHistoryLoading(false));
  }, [trayId]);

  const handleDeleteTray = async () => {
    if (!await showConfirm({ title: 'Delete Tray', message: 'Are you sure you want to delete this tray and all its cells?', confirmText: 'Delete', destructive: true })) return;
    try {
      const res = await deleteTray(trayId);
      toast('Tray deleted', 'success', {
        action: { label: 'Undo', onClick: async () => { try { await undoAction(res.undo_id); router.push(`/trays/${trayId}`); } catch { toast('Undo failed', 'error'); } } },
      });
      router.push('/trays');
    } catch {
      setError('Failed to delete tray');
    }
  };

  const getCell = (row: number, col: number): CellData | null => {
    return data?.grid[row]?.[col] ?? null;
  };

  const handleCellClick = (row: number, col: number) => {
    const cell = getCell(row, col);
    setSelectedCell({ row, col });
    setShowSidebar(true);

    if (cell && cell.status !== 'empty') {
      // Clicking a filled cell: show detail
      setSelectedPlant(null);
    }
  };

  const handleTrayGridKeyDown = useCallback((e: React.KeyboardEvent, row: number, col: number) => {
    if (!data) return;
    let nextRow = row;
    let nextCol = col;
    switch (e.key) {
      case 'ArrowRight': nextCol = Math.min(col + 1, data.tray.cols - 1); break;
      case 'ArrowLeft': nextCol = Math.max(col - 1, 0); break;
      case 'ArrowDown': nextRow = Math.min(row + 1, data.tray.rows - 1); break;
      case 'ArrowUp': nextRow = Math.max(row - 1, 0); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleCellClick(row, col);
        return;
      default: return;
    }
    e.preventDefault();
    setFocusedCell({ row: nextRow, col: nextCol });
    const nextEl = document.querySelector(`[data-tray-cell="${nextRow}-${nextCol}"]`) as HTMLElement;
    nextEl?.focus();
  }, [data]);

  const handleSeedCell = async () => {
    if (!selectedCell || !selectedPlant || !data) return;
    try {
      await seedTrayCell(trayId, {
        row: selectedCell.row,
        col: selectedCell.col,
        plant_id: selectedPlant.id,
        seed_date: getGardenToday(),
      });
      loadData();
      setSelectedPlant(null);
      setSelectedCell(null);
      setShowSidebar(false);
      toast('Cell seeded!');
    } catch {
      setError('Failed to seed cell');
    }
  };

  const handleStatusUpdate = async (cellId: number, newStatus: string) => {
    try {
      const updateData: { status: string; germination_date?: string } = { status: newStatus };
      if (newStatus === 'germinated') {
        updateData.germination_date = getGardenToday();
      }
      await updateTrayCell(trayId, cellId, updateData);
      loadData();
      toast(`Status updated to ${newStatus}`);
    } catch {
      setError('Failed to update cell');
    }
  };

  const handleTransplant = async () => {
    if (!transplantCellId) return;
    try {
      await transplantTrayCell(trayId, transplantCellId, {
        bed_id: transplantBed ?? undefined,
        cell_x: transplantBed ? transplantX : undefined,
        cell_y: transplantBed ? transplantY : undefined,
      });
      setShowTransplant(false);
      setTransplantCellId(null);
      setTransplantBed(null);
      loadData();
      toast('Cell transplanted!');
    } catch {
      setError('Failed to transplant');
    }
  };

  const openTransplant = (cellId: number) => {
    setTransplantCellId(cellId);
    setShowTransplant(true);
  };

  const openMoveToPlanter = (cellId: number) => {
    setMoveCellId(cellId);
    setMoveBed(null);
    setMoveCellX(0);
    setMoveCellY(0);
    setShowMoveToPlanter(true);
  };

  const handleMoveToPlanter = async () => {
    if (!moveCellId || !moveBed) return;
    setMovingToPlanter(true);
    try {
      await moveTrayCellToPlanter(trayId, moveCellId, {
        bed_id: moveBed,
        cell_x: moveCellX,
        cell_y: moveCellY,
      });
      setShowMoveToPlanter(false);
      setMoveCellId(null);
      setMoveBed(null);
      loadData();
      setSelectedCell(null);
      setShowSidebar(false);
      toast('Seedling moved to planter!');
    } catch {
      setError('Failed to move seedling');
    } finally {
      setMovingToPlanter(false);
    }
  };

  const handleDuplicate = async () => {
    if (!data) return;
    const newName = await showPrompt({ title: 'Duplicate Tray', message: 'Name for duplicated tray:', defaultValue: `${data.tray.name} (Copy)` });
    if (newName === null) return;
    const copyCells = await showConfirm({ title: 'Copy Plantings?', message: 'Copy cell plantings to the new tray?', confirmText: 'Copy Cells', cancelText: 'Empty Cells' });
    try {
      const newTray = await duplicateTray(trayId, { name: newName || undefined, copy_cells: copyCells });
      toast('Tray duplicated!');
      router.push(`/trays/${newTray.id}`);
    } catch {
      setError('Failed to duplicate tray');
    }
  };

  const filteredPlants = plants.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return <div className="text-center py-16 text-earth-400 dark:text-gray-500">Loading tray...</div>;
  }

  if (error && !data) {
    return (
      <div className="text-center py-16">
        <div className="text-red-500 mb-4">{error}</div>
        <Link href="/trays" className="text-garden-600 hover:underline">Back to trays</Link>
      </div>
    );
  }

  if (!data) return null;

  const { tray, grid, summary } = data;
  const total = tray.rows * tray.cols;
  const selectedCellData = selectedCell ? getCell(selectedCell.row, selectedCell.col) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        {/* Row 1: Breadcrumb + name */}
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/trays" className="text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 transition-colors shrink-0">
            &larr; Trays
          </Link>
          <span className="text-earth-300 dark:text-gray-600 shrink-0">/</span>
          <h1
            className="text-xl sm:text-2xl font-bold text-earth-800 dark:text-gray-100 cursor-pointer hover:bg-earth-100 dark:hover:bg-gray-700 px-2 py-1 -mx-2 rounded truncate"
            title="Click to rename"
            onClick={async () => {
              const newName = await showPrompt({ title: 'Rename Tray', message: 'Enter a new name for this tray:', defaultValue: tray.name });
              if (newName && newName !== tray.name) {
                updateTray(trayId, { name: newName }).then(() => {
                  loadData();
                  toast('Tray renamed');
                }).catch(() => setError('Failed to rename tray'));
              }
            }}
          >{tray.name} <span className="text-earth-300 dark:text-gray-600 text-sm">&#9998;</span></h1>
        </div>
        {/* Row 2: Metadata + actions */}
        <div className="flex flex-wrap items-center gap-2">
          {trayAreas.length > 0 && (
            <select
              value={tray.area_id ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                updateTray(trayId, { area_id: val === '' ? 0 : Number(val) }).then(() => {
                  loadData();
                  toast('Area updated');
                }).catch(() => toast('Failed to update area', 'error'));
              }}
              className="text-xs px-2 py-1 rounded border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-600 dark:text-gray-300 min-h-[44px] sm:min-h-0"
            >
              <option value="">No Area</option>
              {trayAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <span className="text-sm text-earth-400 dark:text-gray-500">
            {tray.rows}x{tray.cols} &middot; {tray.cell_size}
            {tray.location && <> &middot; {tray.location}</>}
          </span>
          <button
            onClick={handleDuplicate}
            className="min-h-[44px] sm:min-h-0 text-sm bg-earth-100 hover:bg-earth-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-earth-600 dark:text-gray-300 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ml-auto"
            title="Duplicate tray"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            <span className="hidden sm:inline">Duplicate</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {/* Summary stats */}
      <div className="flex flex-wrap gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-earth-200 dark:border-gray-700 px-4 py-2 text-sm">
          <span className="text-earth-400 dark:text-gray-500">Total</span>{' '}
          <span className="font-bold text-earth-700 dark:text-gray-200">{total}</span>
        </div>
        {Object.entries(statusColors).map(([status, { bg, label }]) => {
          const count = summary[status] || 0;
          if (count === 0 && status === 'empty') {
            return (
              <div key={status} className="bg-white dark:bg-gray-800 rounded-lg border border-earth-200 dark:border-gray-700 px-4 py-2 text-sm">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${bg} mr-1.5`} />
                <span className="text-earth-400">{label}</span>{' '}
                <span className="font-bold text-earth-700">{count}</span>
              </div>
            );
          }
          if (count === 0) return null;
          return (
            <div key={status} className="bg-white dark:bg-gray-800 rounded-lg border border-earth-200 dark:border-gray-700 px-4 py-2 text-sm">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${bg} mr-1.5`} />
              <span className="text-earth-400">{label}</span>{' '}
              <span className="font-bold text-earth-700">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-earth-500">
        {Object.entries(statusColors).map(([status, { bg, label }]) => (
          <span key={status} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded-sm ${bg} border border-earth-300 inline-block`} />
            {label}
          </span>
        ))}
      </div>

      <div className="flex gap-4 sm:gap-6 flex-col lg:flex-row relative">
        {/* Grid */}
        <div className={showSidebar ? 'flex-1 min-w-0' : 'w-full'}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-3 sm:p-4 shadow-sm overflow-x-auto">
            {selectedPlant && (
              <div className="mb-3 flex items-center gap-2 bg-garden-50 border border-garden-200 text-garden-800 px-3 py-2 rounded-lg text-sm">
                <span>Seeding: {selectedPlant.name}</span>
                <span className="text-garden-500">&mdash; click an empty cell</span>
                <button
                  onClick={() => setSelectedPlant(null)}
                  className="ml-auto text-garden-600 hover:text-garden-800 font-bold"
                >
                  &times; Cancel
                </button>
              </div>
            )}
            <div
              className="inline-grid gap-1"
              role="grid"
              aria-label={`${tray.name} seed tray grid, ${tray.cols} columns by ${tray.rows} rows`}
              style={{
                gridTemplateColumns: `repeat(${tray.cols}, minmax(70px, 120px))`,
              }}
            >
              {Array.from({ length: tray.rows }).map((_, row) =>
                Array.from({ length: tray.cols }).map((_, col) => {
                  const cell = getCell(row, col);
                  const status = cell?.status || 'empty';
                  const colors = statusColors[status] || statusColors.empty;
                  const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                  const isFocused = focusedCell?.row === row && focusedCell?.col === col;

                  return (
                    <button
                      key={`${row}-${col}`}
                      data-tray-cell={`${row}-${col}`}
                      role="gridcell"
                      aria-label={cell && cell.plant_name ? `${cell.plant_name} at row ${row + 1}, column ${col + 1} - ${statusColors[status]?.label || status}` : `Empty cell at row ${row + 1}, column ${col + 1}`}
                      tabIndex={isFocused || (!focusedCell && row === 0 && col === 0) ? 0 : -1}
                      onClick={() => {
                        if (selectedPlant && (!cell || cell.status === 'empty')) {
                          // Directly seed when plant is selected
                          setSelectedCell({ row, col });
                          seedTrayCell(trayId, {
                            row,
                            col,
                            plant_id: selectedPlant.id,
                            seed_date: getGardenToday(),
                          }).then(() => {
                            loadData();
                            setSelectedPlant(null);
                            setSelectedCell(null);
                            setShowSidebar(false);
                            toast('Cell seeded');
                          }).catch(() => toast('Failed to seed cell', 'error'));
                        } else {
                          handleCellClick(row, col);
                        }
                      }}
                      onKeyDown={(e) => handleTrayGridKeyDown(e, row, col)}
                      onFocus={() => setFocusedCell({ row, col })}
                      className={`
                        aspect-square rounded-md border-2 flex flex-col items-center justify-center text-xs
                        transition-all cursor-pointer
                        ${colors.bg} ${colors.border}
                        ${selectedPlant && (!cell || cell.status === 'empty') ? 'hover:brightness-90 border-dashed' : 'hover:brightness-95'}
                        ${isSelected ? 'ring-2 ring-garden-500 ring-offset-1' : ''}
                      `}
                      title={cell && cell.plant_name ? `${cell.plant_name} (${status})` : `Empty (${row}, ${col})`}
                    >
                      {cell && cell.status !== 'empty' ? (
                        <>
                          <span className="text-sm font-medium text-earth-700 dark:text-earth-300 truncate max-w-full px-0.5">
                            {cell.plant_name && cell.plant_name.length > 8
                              ? cell.plant_name.slice(0, 8) + '..'
                              : cell.plant_name}
                          </span>
                          <span className="text-xs text-earth-500 dark:text-gray-300 mt-0.5">
                            {statusColors[status]?.label.slice(0, 5)}
                          </span>
                        </>
                      ) : (
                        <span className="text-earth-300 dark:text-gray-500 text-xl">+</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Sidebar - hidden by default, shown on cell click */}
        {showSidebar && (
        <>
          {/* Mobile overlay backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden"
            onClick={() => { setShowSidebar(false); setSelectedPlant(null); setSelectedCell(null); }}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl p-4 lg:static lg:max-h-none lg:rounded-xl lg:shadow-sm lg:p-0 lg:bg-transparent lg:dark:bg-transparent lg:z-auto w-full lg:w-80 lg:flex-shrink-0 space-y-4">

          {/* Close button */}
          <div className="flex justify-end mb-1">
            <button
              onClick={() => { setShowSidebar(false); setSelectedPlant(null); setSelectedCell(null); }}
              className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-sm font-bold px-2 py-1 rounded hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors"
              title="Close sidebar"
            >
              &#10005; Close
            </button>
          </div>

          {/* Cell detail panel - only for occupied cells */}
          {selectedCell && selectedCellData && selectedCellData.status !== 'empty' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div>
                  <Link href={`/plants?highlight=${selectedCellData.plant_id}`} className="font-bold text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                    {selectedCellData.plant_name}
                  </Link>
                  <p className="text-xs text-earth-400 dark:text-gray-500">
                    Cell ({selectedCell.row}, {selectedCell.col})
                    {selectedCellData.seed_date && <> &middot; Seeded {selectedCellData.seed_date}</>}
                    {selectedCellData.germination_date && <> &middot; Sprouted {selectedCellData.germination_date}</>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mb-3">
                <Link
                  href={`/plants?highlight=${selectedCellData.plant_id}`}
                  className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
                >
                  View in Library
                </Link>
                <Link
                  href={`/lifecycle?plant_id=${selectedCellData.plant_id}`}
                  className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
                >
                  Plan Lifecycle
                </Link>
              </div>
              <div className="mb-3">
                <span className={`text-sm px-2 py-1 rounded-full font-medium ${statusColors[selectedCellData.status]?.bg} text-earth-700`}>
                  {statusColors[selectedCellData.status]?.label}
                </span>
              </div>

              {/* Status transitions */}
              {statusTransitions[selectedCellData.status]?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-earth-500 mb-2">Update Status:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {statusTransitions[selectedCellData.status].map((s) => {
                      if (s === 'transplanted') {
                        return null; // Handled by transplant button
                      }
                      return (
                        <button
                          key={s}
                          onClick={() => handleStatusUpdate(selectedCellData.cell_id, s)}
                          className="text-xs px-2.5 py-1 rounded-full border bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 border-earth-300 dark:border-gray-600 hover:border-garden-400 dark:hover:border-garden-600 hover:text-garden-700 dark:hover:text-garden-400 transition-colors"
                        >
                          {statusColors[s]?.label || s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Transplant button */}
              {selectedCellData.status === 'ready_to_transplant' && (
                <button
                  onClick={() => openTransplant(selectedCellData.cell_id)}
                  className="mt-3 w-full bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Transplant to Planter
                </button>
              )}

              {/* Move to Planter button — for any occupied cell */}
              {selectedCellData.plant_id && selectedCellData.status !== 'transplanted' && selectedCellData.status !== 'failed' && (
                <button
                  onClick={() => openMoveToPlanter(selectedCellData.cell_id)}
                  className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Move to Planter
                </button>
              )}

              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={async () => {
                    if (!await showConfirm({ title: 'Clear Cell', message: 'Clear this cell? It will be reset to empty.', confirmText: 'Clear', destructive: true })) return;
                    try {
                      await clearTrayCell(trayId, selectedCellData.cell_id);
                      loadData();
                      setSelectedCell(null);
                      setShowSidebar(false);
                      toast('Cell cleared');
                    } catch {
                      setError('Failed to clear cell');
                    }
                  }}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                >
                  Clear Cell
                </button>
              </div>
            </div>
          )}

          {/* Empty cell prompt */}
          {selectedCell && (!selectedCellData || selectedCellData.status === 'empty') && !selectedPlant && (
            <div className="bg-garden-50 border border-garden-200 rounded-xl p-4 text-sm text-garden-700">
              Cell ({selectedCell.row}, {selectedCell.col}) is empty. Select a plant below to seed it.
            </div>
          )}

          {/* Plant picker - only show when no occupied cell is selected (empty cell) */}
          {(!selectedCellData || selectedCellData.status === 'empty') && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
            <h3 className="font-bold text-earth-800 dark:text-gray-100 mb-3">Plant Picker</h3>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search plants..."
              aria-label="Search plants"
              className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none mb-2 bg-white dark:bg-gray-700 dark:text-gray-100"
            />
            <div className="flex gap-1 mb-3 flex-wrap">
              {['all', 'vegetable', 'herb', 'flower', 'fruit'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    categoryFilter === cat
                      ? 'bg-garden-600 text-white border-garden-600'
                      : 'bg-white dark:bg-gray-700 text-earth-500 dark:text-gray-400 border-earth-300 dark:border-gray-600 hover:border-garden-400'
                  }`}
                >
                  {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
            <div className="max-h-96 overflow-y-auto scrollbar-thin space-y-1">
              {filteredPlants.length === 0 ? (
                <p className="text-earth-400 dark:text-gray-500 text-sm py-4 text-center">No plants found</p>
              ) : (
                filteredPlants.map((plant) => (
                  <button
                    key={plant.id}
                    onClick={() => {
                      setSelectedPlant(selectedPlant?.id === plant.id ? null : plant);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      selectedPlant?.id === plant.id
                        ? 'bg-garden-100 dark:bg-garden-900/30 border border-garden-300 dark:border-garden-700'
                        : 'hover:bg-earth-50 dark:hover:bg-gray-700 border border-transparent'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-earth-800 dark:text-gray-100 truncate">{plant.name}</div>
                      <div className="text-xs text-earth-400 dark:text-gray-500">{plant.category}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* Irrigation Settings (collapsible) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
          onClick={() => {
            setShowIrrigation(!showIrrigation);
            if (!showIrrigation && irrigationZones.length === 0) {
              handleLoadIrrigationZones();
            }
            if (!showIrrigation) {
              loadTraySchedule();
            }
          }}
        >
          <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            {'💧'} Irrigation Settings
          </span>
          <svg className={`w-5 h-5 text-earth-400 transition-transform ${showIrrigation ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showIrrigation && (
          <div className="px-5 pb-5 space-y-4 border-t border-earth-100 dark:border-gray-700 pt-4">
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Watering Method</label>
              <select
                value={irrigationType}
                onChange={(e) => setIrrigationType(e.target.value)}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
              >
                <option value="rachio_hose_timer">Rachio Hose Timer</option>
                <option value="manual">Manual</option>
                <option value="none">None</option>
              </select>
            </div>

            {irrigationType === 'rachio_hose_timer' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Hose Timer Valve</label>
                {irrigationLoading ? (
                  <div className="text-sm text-earth-400">Loading valves...</div>
                ) : irrigationValves.length > 0 ? (
                  <select
                    value={irrigationZoneName}
                    onChange={(e) => setIrrigationZoneName(e.target.value)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  >
                    <option value="">Select a valve...</option>
                    {irrigationValves.map((v) => (
                      <option key={v.id} value={v.name}>
                        {v.device_name}: {v.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={irrigationZoneName}
                    onChange={(e) => setIrrigationZoneName(e.target.value)}
                    placeholder="e.g., Hose Timer 1"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                )}
              </div>
            )}

            {irrigationType === 'manual' && (
              <div className="text-sm text-earth-500 dark:text-gray-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
                {'✋'} Manual watering for seed trays.
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleSaveIrrigation}
                disabled={savingIrrigation}
                className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {savingIrrigation ? 'Saving...' : 'Save Irrigation Settings'}
              </button>
            </div>

            {/* Hose Timer Schedule Info */}
            {trayScheduleLoading && (
              <div className="text-sm text-earth-400 dark:text-gray-500 mt-3">Loading schedule data...</div>
            )}
            {traySchedule && !trayScheduleLoading && traySchedule.schedules?.length > 0 && (
              <div className="mt-4 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-3">
                <h4 className="text-sm font-semibold text-earth-600 dark:text-gray-300">Hose Timer Schedule</h4>
                {traySchedule.schedules.map((s: any, i: number) => (
                  <div key={i} className="text-xs bg-teal-50 dark:bg-teal-900/20 rounded px-3 py-2 border border-teal-100 dark:border-teal-800">
                    <span className="font-medium text-teal-800 dark:text-teal-300">{s.schedule_name}</span>
                    <span className="text-teal-600 dark:text-teal-400 ml-2">{s.duration_minutes} min, {s.frequency}</span>
                  </div>
                ))}
                {traySchedule.next_run && (
                  <div className="text-xs text-blue-600 dark:text-blue-400">
                    {traySchedule.next_run.active ? 'Currently running' : 'Next run'}: {traySchedule.next_run.start_time ? formatGardenDateTime(traySchedule.next_run.start_time) : traySchedule.next_run.message || 'Unknown'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>


      {/* Tray Settings (collapsible) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
          onClick={() => setShowTraySettings(!showTraySettings)}
        >
          <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            {'⚙️'} Tray Settings
          </span>
          <svg className={`w-5 h-5 text-earth-400 transition-transform ${showTraySettings ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showTraySettings && (
          <div className="px-5 pb-5 space-y-4 border-t border-earth-100 dark:border-gray-700 pt-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-xs text-earth-500 dark:text-gray-400">Rows</span>
                <p className="font-medium text-earth-700 dark:text-gray-200">{tray.rows}</p>
              </div>
              <div>
                <span className="text-xs text-earth-500 dark:text-gray-400">Columns</span>
                <p className="font-medium text-earth-700 dark:text-gray-200">{tray.cols}</p>
              </div>
              <div>
                <span className="text-xs text-earth-500 dark:text-gray-400">Cell Size</span>
                <p className="font-medium text-earth-700 dark:text-gray-200">{tray.cell_size}</p>
              </div>
            </div>
            {tray.location && (
              <div>
                <span className="text-xs text-earth-500 dark:text-gray-400">Location</span>
                <p className="text-sm font-medium text-earth-700 dark:text-gray-200">{tray.location}</p>
              </div>
            )}
            <div className="pt-2 border-t border-earth-100 dark:border-gray-700">
              <button
                onClick={handleDeleteTray}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/50"
              >
                Delete Tray
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tray History (collapsible) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
          onClick={() => {
            if (!showTrayHistory) {
              loadTrayHistory();
            }
            setShowTrayHistory(!showTrayHistory);
          }}
        >
          <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            {'📋'} Tray History
          </span>
          <svg className={`w-5 h-5 text-earth-400 transition-transform ${showTrayHistory ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showTrayHistory && (
          <div className="px-5 pb-5 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-4">
            {/* Cell usage summary */}
            <div>
              <h4 className="text-sm font-semibold text-earth-600 dark:text-gray-300 mb-2">Cell Summary</h4>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-green-700 dark:text-green-300">{summary.germinated || 0}</div>
                  <div className="text-xs text-green-600 dark:text-green-400">Germinated</div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-purple-700 dark:text-purple-300">{summary.transplanted || 0}</div>
                  <div className="text-xs text-purple-600 dark:text-purple-400">Transplanted</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-red-700 dark:text-red-300">{summary.failed || 0}</div>
                  <div className="text-xs text-red-600 dark:text-red-400">Failed</div>
                </div>
              </div>
              {(summary.germinated || 0) + (summary.failed || 0) > 0 && (
                <div className="mt-2 text-xs text-earth-500 dark:text-gray-400">
                  Germination rate: <strong className="text-earth-700 dark:text-gray-200">
                    {Math.round(((summary.germinated || 0) / ((summary.germinated || 0) + (summary.failed || 0))) * 100)}%
                  </strong>
                </div>
              )}
            </div>

            {/* Journal entries for this tray */}
            {trayHistoryLoading && (
              <p className="text-sm text-earth-400 dark:text-gray-500">Loading history...</p>
            )}
            {!trayHistoryLoading && trayHistory.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-earth-600 dark:text-gray-300 mb-2">Activity Log</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {trayHistory.map((entry: any) => (
                    <div key={entry.id} className="text-xs p-2.5 rounded-lg bg-earth-50 dark:bg-gray-700/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          entry.entry_type === 'seeding' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                          entry.entry_type === 'transplant' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' :
                          entry.entry_type === 'observation' ? 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300' :
                          'bg-earth-100 dark:bg-gray-600 text-earth-600 dark:text-gray-300'
                        }`}>{entry.entry_type}</span>
                        <span className="text-earth-400 dark:text-gray-500">
                          {formatGardenDate(entry.created_at)}
                        </span>
                      </div>
                      {entry.title && <p className="font-medium text-earth-700 dark:text-gray-200">{entry.title}</p>}
                      <p className="text-earth-600 dark:text-gray-400">{entry.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!trayHistoryLoading && trayHistory.length === 0 && (
              <p className="text-sm text-earth-400 dark:text-gray-500">No history entries yet. Journal entries linked to this tray will appear here.</p>
            )}
          </div>
        )}
      </div>

      {/* Soil Amendments (collapsible) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
          onClick={() => {
            const next = !showAmendments;
            setShowAmendments(next);
            if (next) loadAmendments();
          }}
        >
          <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            {'🧪'} Soil Amendments
            {amendments.some(a => a.next_due_date && a.next_due_date <= getGardenDateOffset(14)) && (
              <span className="inline-block px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">Due soon</span>
            )}
          </span>
          <svg className={`w-5 h-5 text-earth-400 transition-transform ${showAmendments ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showAmendments && (
          <div className="px-5 pb-5 space-y-4 border-t border-earth-100 dark:border-gray-700 pt-4">
            {/* Log new amendment form */}
            <div className="bg-earth-50 dark:bg-gray-750 rounded-lg p-3 space-y-2">
              <div className="text-xs font-medium text-earth-600 dark:text-gray-300 mb-1">Log Amendment</div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={amendmentForm.amendment_type}
                  onChange={(e) => setAmendmentForm(f => ({ ...f, amendment_type: e.target.value }))}
                  className="px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
                >
                  <option value="compost">Compost</option>
                  <option value="fertilizer">Fertilizer</option>
                  <option value="sulfur">Sulfur</option>
                  <option value="gypsum">Gypsum</option>
                  <option value="mulch">Mulch</option>
                  <option value="worm_castings">Worm Castings</option>
                  <option value="bone_meal">Bone Meal</option>
                  <option value="fish_emulsion">Fish Emulsion</option>
                  <option value="other">Other</option>
                </select>
                <input type="text" placeholder="Product name" value={amendmentForm.product_name}
                  onChange={(e) => setAmendmentForm(f => ({ ...f, product_name: e.target.value }))}
                  className="px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input type="text" placeholder="Amount (e.g. 2 cups)" value={amendmentForm.amount}
                  onChange={(e) => setAmendmentForm(f => ({ ...f, amount: e.target.value }))}
                  className="px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
                <div>
                  <label className="block text-[10px] text-earth-400 dark:text-gray-500">Applied</label>
                  <input type="date" value={amendmentForm.applied_date}
                    onChange={(e) => setAmendmentForm(f => ({ ...f, applied_date: e.target.value }))}
                    className="w-full px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
                </div>
                <div>
                  <label className="block text-[10px] text-earth-400 dark:text-gray-500">Next due</label>
                  <input type="date" value={amendmentForm.next_due_date}
                    onChange={(e) => setAmendmentForm(f => ({ ...f, next_due_date: e.target.value }))}
                    className="w-full px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
                </div>
              </div>
              <input type="text" placeholder="Notes (optional)" value={amendmentForm.notes}
                onChange={(e) => setAmendmentForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
              <button
                disabled={savingAmendment || !amendmentForm.applied_date}
                onClick={async () => {
                  setSavingAmendment(true);
                  try {
                    await createAmendment({
                      tray_id: trayId,
                      amendment_type: amendmentForm.amendment_type,
                      product_name: amendmentForm.product_name || undefined,
                      amount: amendmentForm.amount || undefined,
                      applied_date: amendmentForm.applied_date,
                      next_due_date: amendmentForm.next_due_date || undefined,
                      notes: amendmentForm.notes || undefined,
                    });
                    setAmendmentForm({ amendment_type: 'compost', product_name: '', amount: '', applied_date: getGardenToday(), next_due_date: '', notes: '' });
                    loadAmendments();
                    toast('Amendment recorded');
                  } catch { toast('Failed to save amendment', 'error'); }
                  setSavingAmendment(false);
                }}
                className="w-full px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white disabled:opacity-50 transition-colors"
              >
                {savingAmendment ? 'Saving...' : 'Log Amendment'}
              </button>
            </div>

            {/* Amendment history */}
            {amendments.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-earth-600 dark:text-gray-300">History</div>
                {amendments.map((a: any) => {
                  const isDueSoon = a.next_due_date && a.next_due_date <= getGardenDateOffset(14);
                  return (
                    <div key={a.id} className="flex items-start justify-between gap-2 text-sm border border-earth-100 dark:border-gray-700 rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-earth-700 dark:text-gray-200 capitalize">{a.amendment_type.replace('_', ' ')}</span>
                          {a.product_name && <span className="text-earth-400 dark:text-gray-500 text-xs">({a.product_name})</span>}
                          {a.amount && <span className="text-earth-500 dark:text-gray-400 text-xs">{a.amount}</span>}
                          {isDueSoon && (
                            <span className="inline-block px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">Due soon</span>
                          )}
                        </div>
                        <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
                          Applied {a.applied_date}
                          {a.next_due_date && <> &middot; Next: {a.next_due_date}</>}
                        </div>
                        {a.notes && <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5 italic">{a.notes}</div>}
                      </div>
                      <button
                        onClick={async () => { await deleteAmendment(a.id); loadAmendments(); }}
                        className="text-red-400 hover:text-red-600 text-xs shrink-0" title="Delete"
                      >x</button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">
                No amendments logged yet. Add compost, fertilizer, or other soil treatments above.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transplant modal */}
      {showTransplant && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4">
            <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">Transplant to Planter</h3>
            <p className="text-sm text-earth-500 dark:text-gray-400">
              Optionally select a planter to create a planting record. Leave empty to just mark as transplanted.
            </p>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Target Planter</label>
              <select
                value={transplantBed ?? ''}
                onChange={(e) => setTransplantBed(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">None (just mark transplanted)</option>
                {beds.map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.name} ({bed.width_cells}x{bed.height_cells})
                  </option>
                ))}
              </select>
            </div>
            {transplantBed && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Cell X</label>
                  <input
                    type="number"
                    min={0}
                    value={transplantX}
                    onChange={(e) => setTransplantX(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Cell Y</label>
                  <input
                    type="number"
                    min={0}
                    value={transplantY}
                    onChange={(e) => setTransplantY(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleTransplant}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Transplant
              </button>
              <button
                onClick={() => { setShowTransplant(false); setTransplantCellId(null); setTransplantBed(null); }}
                className="flex-1 bg-earth-100 hover:bg-earth-200 text-earth-700 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move to Planter modal */}
      {showMoveToPlanter && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4">
            <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">Move to Planter</h3>
            <p className="text-sm text-earth-500 dark:text-gray-400">
              Select a planter and cell position. The seedling data will be preserved.
            </p>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Target Planter</label>
              <select
                value={moveBed ?? ''}
                onChange={(e) => setMoveBed(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">Select a planter...</option>
                {beds.map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.name} ({bed.width_cells}x{bed.height_cells})
                  </option>
                ))}
              </select>
            </div>
            {moveBed && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Cell X</label>
                  <input type="number" min={0} value={moveCellX} onChange={(e) => setMoveCellX(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Cell Y</label>
                  <input type="number" min={0} value={moveCellY} onChange={(e) => setMoveCellY(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleMoveToPlanter}
                disabled={!moveBed || movingToPlanter}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                {movingToPlanter ? 'Moving...' : 'Move'}
              </button>
              <button
                onClick={() => { setShowMoveToPlanter(false); setMoveCellId(null); setMoveBed(null); }}
                className="flex-1 bg-earth-100 dark:bg-gray-700 hover:bg-earth-200 dark:hover:bg-gray-600 text-earth-700 dark:text-gray-300 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
