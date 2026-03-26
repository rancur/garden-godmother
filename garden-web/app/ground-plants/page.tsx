'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { getGroundPlants, createGroundPlant, updateGroundPlant, deleteGroundPlant, getPlants, getZones, getAreas, updateArea, deleteArea, reorderGroundPlants, getIrrigationZones, undoAction, getBeds, moveGroundPlantToPlanter, getAmendments, createAmendment, deleteAmendment } from '../api';
import { TypeaheadSelect } from '../typeahead-select';
import { getPlantIcon } from '../plant-icons';
import { useModal } from '../confirm-modal';
import { useToast } from '../toast';
import { plantingStatusColors as statusColors } from '../constants';
import { getGardenToday, getGardenDateOffset } from '../timezone';
import type { Plant, Zone, Area, GroundPlant } from '../types';

const STATUS_OPTIONS = ['planned', 'planted', 'growing', 'established', 'dormant', 'removed'] as const;
const IRRIGATION_OPTIONS = ['manual', 'rachio_controller', 'rachio_hose_timer', 'drip', 'sprinkler', 'bubbler', 'none'] as const;

const IRRIGATION_LABELS: Record<string, string> = {
  manual: 'Manual',
  rachio_controller: 'Rachio Controller',
  rachio_hose_timer: 'Rachio Hose Timer',
  drip: 'Drip System',
  sprinkler: 'Sprinkler',
  bubbler: 'Bubbler',
  none: 'None',
};

export default function GroundPlantsPage() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const [groundPlants, setGroundPlants] = useState<GroundPlant[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [editingArea, setEditingArea] = useState<number | null>(null);
  const [editAreaName, setEditAreaName] = useState('');
  const [dragItem, setDragItem] = useState<{ id: number; areaId: number | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ areaId: number | null; index: number } | null>(null);
  const [irrigationZones, setIrrigationZones] = useState<{ name: string; enabled: boolean; zone_number?: number }[]>([]);
  const [irrigationValves, setIrrigationValves] = useState<{ id: string; name: string; device_name: string }[]>([]);

  // Move to planter state
  const [showMoveToPlanterDialog, setShowMoveToPlanterDialog] = useState(false);
  const [moveGpId, setMoveGpId] = useState<number | null>(null);
  const [moveGpName, setMoveGpName] = useState('');
  const [allBeds, setAllBeds] = useState<{ id: number; name: string; width_cells: number; height_cells: number }[]>([]);
  const [moveTargetBed, setMoveTargetBed] = useState<number | null>(null);
  const [moveCellX, setMoveCellX] = useState(0);
  const [moveCellY, setMoveCellY] = useState(0);
  const [movingToPlanter, setMovingToPlanter] = useState(false);

  // Expanded card state (for amendments & irrigation detail)
  const [expandedGpId, setExpandedGpId] = useState<number | null>(null);
  const [amendments, setAmendments] = useState<any[]>([]);
  const [amendmentForm, setAmendmentForm] = useState({
    amendment_type: 'compost', product_name: '', amount: '', applied_date: getGardenToday(), next_due_date: '', notes: '',
  });
  const [savingAmendment, setSavingAmendment] = useState(false);

  const loadAmendments = useCallback((gpId: number) => {
    getAmendments({ ground_plant_id: gpId }).then(setAmendments).catch(() => setAmendments([]));
  }, []);

  const toggleExpanded = (gpId: number) => {
    if (expandedGpId === gpId) {
      setExpandedGpId(null);
    } else {
      setExpandedGpId(gpId);
      loadAmendments(gpId);
      setAmendmentForm({ amendment_type: 'compost', product_name: '', amount: '', applied_date: getGardenToday(), next_due_date: '', notes: '' });
    }
  };

  // Touch drag state
  const [touchDrag, setTouchDrag] = useState<{ id: number; areaId: number | null; startY: number; currentY: number; element: HTMLElement | null } | null>(null);
  const touchCloneRef = useRef<HTMLElement | null>(null);
  const cardRefsMap = useRef<Map<string, HTMLElement>>(new Map());

  const [formData, setFormData] = useState({
    plant_id: 0,
    name: '',
    zone_id: '',
    area_id: '',
    planted_date: '',
    status: 'growing',
    irrigation_type: 'manual',
    irrigation_zone_name: '',
    notes: '',
    x_feet: '',
    y_feet: '',
  });

  const loadData = useCallback(async () => {
    try {
      const [gp, p, z, a, izData] = await Promise.all([getGroundPlants(), getPlants(), getZones(), getAreas(), getIrrigationZones().catch(() => ({ zones: [] }))]);
      setGroundPlants(gp);
      setPlants(p);
      setZones(z);
      setAreas(a);
      const izList = izData?.zones || [];
      if (Array.isArray(izList)) setIrrigationZones(izList);
      setIrrigationValves(izData?.valves || []);
    } catch {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  const [initialCollapseApplied, setInitialCollapseApplied] = useState(false);

  useEffect(() => { loadData(); }, [loadData]);

  // Collapse all areas by default on initial load
  useEffect(() => {
    if (!initialCollapseApplied && !loading && areas.length > 0) {
      const keys = new Set<string>();
      areas.forEach(a => keys.add(String(a.id)));
      const unassignedCount = groundPlants.filter(gp => gp.area_id === null).length;
      if (unassignedCount === 0) keys.add('unassigned');
      setCollapsedAreas(keys);
      setInitialCollapseApplied(true);
    }
  }, [initialCollapseApplied, loading, areas, groundPlants]);

  const resetForm = () => {
    setFormData({ plant_id: 0, name: '', zone_id: '', area_id: '', planted_date: '', status: 'growing', irrigation_type: 'manual', irrigation_zone_name: '', notes: '', x_feet: '', y_feet: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.plant_id) return;
    setSubmitting(true);
    try {
      const payload = {
        plant_id: formData.plant_id,
        name: formData.name || undefined,
        zone_id: formData.zone_id ? Number(formData.zone_id) : undefined,
        planted_date: formData.planted_date || undefined,
        status: formData.status,
        irrigation_type: formData.irrigation_type,
        irrigation_zone_name: formData.irrigation_zone_name || undefined,
        notes: formData.notes || undefined,
        x_feet: formData.x_feet ? Number(formData.x_feet) : undefined,
        y_feet: formData.y_feet ? Number(formData.y_feet) : undefined,
        area_id: formData.area_id ? Number(formData.area_id) : (editingId ? 0 : undefined),
      };
      if (editingId) {
        await updateGroundPlant(editingId, payload);
      } else {
        await createGroundPlant(payload);
      }
      resetForm();
      loadData();
      toast(editingId ? 'Ground plant updated' : 'Ground plant added');
    } catch {
      toast('Failed to save ground plant', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (gp: GroundPlant) => {
    setFormData({
      plant_id: gp.plant_id,
      name: gp.name || '',
      zone_id: gp.zone_id ? String(gp.zone_id) : '',
      area_id: gp.area_id ? String(gp.area_id) : '',
      planted_date: gp.planted_date || '',
      status: gp.status,
      irrigation_type: gp.irrigation_type || 'manual',
      irrigation_zone_name: gp.irrigation_zone_name || '',
      notes: gp.notes || '',
      x_feet: gp.x_feet != null ? String(gp.x_feet) : '',
      y_feet: gp.y_feet != null ? String(gp.y_feet) : '',
    });
    setEditingId(gp.id);
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm({ title: 'Remove Plant', message: 'Remove this ground plant?', confirmText: 'Remove', destructive: true })) return;
    try {
      const res = await deleteGroundPlant(id);
      loadData();
      toast('Ground plant removed', 'success', {
        action: { label: 'Undo', onClick: async () => { try { await undoAction(res.undo_id); loadData(); } catch { toast('Undo failed', 'error'); } } },
      });
    } catch {
      setError('Failed to delete');
    }
  };

  const openMoveToPlanterDialog = async (gp: GroundPlant) => {
    setMoveGpId(gp.id);
    setMoveGpName(gp.name || gp.plant_name);
    setMoveTargetBed(null);
    setMoveCellX(0);
    setMoveCellY(0);
    setShowMoveToPlanterDialog(true);
    try {
      const beds = await getBeds();
      setAllBeds(beds);
    } catch { /* ignore */ }
  };

  const handleMoveToPlanterSubmit = async () => {
    if (!moveGpId || !moveTargetBed) return;
    setMovingToPlanter(true);
    try {
      await moveGroundPlantToPlanter(moveGpId, {
        bed_id: moveTargetBed,
        cell_x: moveCellX,
        cell_y: moveCellY,
      });
      setShowMoveToPlanterDialog(false);
      setMoveGpId(null);
      loadData();
      toast('Plant moved to planter!');
    } catch {
      setError('Failed to move plant');
    } finally {
      setMovingToPlanter(false);
    }
  };

  const handleDeleteArea = async (areaId: number) => {
    if (!await showConfirm({ title: 'Delete Area', message: 'Delete this area? Plants will be moved to Unassigned.', confirmText: 'Delete', destructive: true })) return;
    try { await deleteArea(areaId); loadData(); }
    catch { setError('Failed to delete area'); }
  };

  const handleRenameArea = async (areaId: number) => {
    if (!editAreaName.trim()) { setEditingArea(null); return; }
    try { await updateArea(areaId, { name: editAreaName }); setEditingArea(null); loadData(); }
    catch { setError('Failed to rename area'); }
  };

  const handleAreaAssign = async (gpId: number, areaId: number | null) => {
    try { await updateGroundPlant(gpId, { area_id: areaId === null ? 0 : areaId }); loadData(); }
    catch { setError('Failed to assign area'); }
  };

  const toggleCollapse = (key: string) => {
    setCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Filter
  const filtered = groundPlants.filter(gp => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (gp.name && gp.name.toLowerCase().includes(q)) ||
           gp.plant_name.toLowerCase().includes(q) ||
           (gp.zone_name && gp.zone_name.toLowerCase().includes(q)) ||
           (gp.area_name && gp.area_name.toLowerCase().includes(q));
  });

  // Group by area
  const gpByArea = new Map<number | null, GroundPlant[]>();
  filtered.forEach(gp => {
    const key = gp.area_id;
    if (!gpByArea.has(key)) gpByArea.set(key, []);
    gpByArea.get(key)!.push(gp);
  });

  const grouped: { areaId: number | null; area: Area | null; plants: GroundPlant[] }[] = [];
  areas.forEach(a => { grouped.push({ areaId: a.id, area: a, plants: gpByArea.get(a.id) || [] }); });
  // Sort areas: ones with items first, empty ones last
  grouped.sort((a, b) => {
    const aCount = a.plants.length;
    const bCount = b.plants.length;
    if (aCount > 0 && bCount === 0) return -1;
    if (aCount === 0 && bCount > 0) return 1;
    return 0;
  });
  grouped.push({ areaId: null, area: null, plants: gpByArea.get(null) || [] });

  // Drag/drop compute
  const computeDropTarget = useCallback((clientY: number, clientX: number): { areaId: number | null; index: number } | null => {
    let closest: { areaId: number | null; index: number; dist: number } | null = null;
    for (const group of grouped) {
      const areaPlants = group.plants;
      for (let i = 0; i < areaPlants.length; i++) {
        const key = `${group.areaId}:${i}`;
        const el = cardRefsMap.current.get(key);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const targetIndex = clientY < midY ? i : i + 1;
        const dist = Math.abs(clientY - midY);
        if (!closest || dist < closest.dist) {
          closest = { areaId: group.areaId, index: targetIndex, dist };
        }
      }
      if (areaPlants.length === 0) {
        const areaKey = `area:${group.areaId}`;
        const areaEl = cardRefsMap.current.get(areaKey);
        if (areaEl) {
          const rect = areaEl.getBoundingClientRect();
          if (clientY >= rect.top && clientY <= rect.bottom && clientX >= rect.left && clientX <= rect.right) {
            return { areaId: group.areaId, index: 0 };
          }
        }
      }
    }
    return closest;
  }, [grouped]);

  const handleDragHandleMouseDown = (e: React.MouseEvent) => {
    const card = (e.currentTarget as HTMLElement).closest('[data-gp-card]') as HTMLElement;
    if (card) card.setAttribute('draggable', 'true');
  };

  const onDragStart = (e: React.DragEvent, gp: GroundPlant) => {
    const target = e.target as HTMLElement;
    const card = target.closest('[data-gp-card]') as HTMLElement;
    if (!card || card.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
    setDragItem({ id: gp.id, areaId: gp.area_id });
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: gp.id, type: 'ground_plant' }));
    e.dataTransfer.effectAllowed = 'move';
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.style.position = 'absolute'; ghost.style.top = '-1000px'; ghost.style.opacity = '0.8';
    ghost.style.width = `${card.offsetWidth}px`; ghost.style.transform = 'rotate(1deg)';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    requestAnimationFrame(() => document.body.removeChild(ghost));
    card.style.opacity = '0.4';
  };

  const onDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    const card = target.closest('[data-gp-card]') as HTMLElement;
    if (card) { card.style.opacity = '1'; card.removeAttribute('draggable'); }
    setDragItem(null); setDropTarget(null);
  };

  const onDragOverCard = (e: React.DragEvent, areaId: number | null, index: number) => {
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropTarget({ areaId, index: e.clientY < midY ? index : index + 1 });
  };

  const onDragOverArea = (e: React.DragEvent, areaId: number | null) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (!dropTarget || dropTarget.areaId !== areaId) {
      setDropTarget({ areaId, index: (gpByArea.get(areaId) || []).length });
    }
  };

  const executeReorder = async (draggedId: number, draggedAreaId: number | null, targetAreaId: number | null, targetIndex: number) => {
    const source = [...(gpByArea.get(draggedAreaId) || [])];
    const target = draggedAreaId === targetAreaId ? source : [...(gpByArea.get(targetAreaId) || [])];
    const dragIdx = source.findIndex(g => g.id === draggedId);
    if (dragIdx === -1) return;
    const [moved] = source.splice(dragIdx, 1);
    let insertIdx = targetIndex;
    if (draggedAreaId === targetAreaId && dragIdx < targetIndex) insertIdx = Math.max(0, targetIndex - 1);
    if (draggedAreaId === targetAreaId) {
      source.splice(insertIdx, 0, moved);
      const orders = source.map((g, i) => ({ id: g.id, sort_order: i, area_id: targetAreaId ?? 0 }));
      try { await reorderGroundPlants(orders); loadData(); } catch { setError('Failed to reorder'); }
    } else {
      target.splice(insertIdx, 0, moved);
      const orders = [
        ...source.map((g, i) => ({ id: g.id, sort_order: i })),
        ...target.map((g, i) => ({ id: g.id, sort_order: i, area_id: targetAreaId ?? 0 })),
      ];
      try { await reorderGroundPlants(orders); loadData(); } catch { setError('Failed to reorder'); }
    }
  };

  const onDrop = async (e: React.DragEvent, targetAreaId: number | null, targetIndex: number) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragItem) return;
    const finalIndex = dropTarget && dropTarget.areaId === targetAreaId ? dropTarget.index : targetIndex;
    await executeReorder(dragItem.id, dragItem.areaId, targetAreaId, finalIndex);
    setDragItem(null); setDropTarget(null);
  };

  // Touch drag
  const onTouchStart = (e: React.TouchEvent, gp: GroundPlant) => {
    const touch = e.touches[0];
    const card = (e.currentTarget as HTMLElement).closest('[data-gp-card]') as HTMLElement;
    setTouchDrag({ id: gp.id, areaId: gp.area_id, startY: touch.clientY, currentY: touch.clientY, element: card });
    if (card) {
      const clone = card.cloneNode(true) as HTMLElement;
      clone.style.position = 'fixed'; clone.style.left = `${card.getBoundingClientRect().left}px`;
      clone.style.top = `${touch.clientY - 30}px`; clone.style.width = `${card.offsetWidth}px`;
      clone.style.opacity = '0.85'; clone.style.zIndex = '9999'; clone.style.pointerEvents = 'none';
      clone.style.transform = 'rotate(1deg) scale(1.02)'; clone.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
      clone.style.transition = 'none';
      document.body.appendChild(clone); touchCloneRef.current = clone; card.style.opacity = '0.3';
    }
  };

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchDrag) return; e.preventDefault();
    const touch = e.touches[0];
    if (touchCloneRef.current) touchCloneRef.current.style.top = `${touch.clientY - 30}px`;
    const t = computeDropTarget(touch.clientY, touch.clientX);
    if (t) setDropTarget(t);
    setTouchDrag(prev => prev ? { ...prev, currentY: touch.clientY } : null);
  }, [touchDrag, computeDropTarget]);

  const onTouchEnd = useCallback(async () => {
    if (!touchDrag) return;
    if (touchCloneRef.current) { document.body.removeChild(touchCloneRef.current); touchCloneRef.current = null; }
    if (touchDrag.element) touchDrag.element.style.opacity = '1';
    if (dropTarget) await executeReorder(touchDrag.id, touchDrag.areaId, dropTarget.areaId, dropTarget.index);
    setTouchDrag(null); setDropTarget(null);
  }, [touchDrag, dropTarget]);

  const registerCardRef = useCallback((areaId: number | null, index: number, el: HTMLElement | null) => {
    const key = `${areaId}:${index}`;
    if (el) cardRefsMap.current.set(key, el); else cardRefsMap.current.delete(key);
  }, []);

  const registerAreaRef = useCallback((areaId: number | null, el: HTMLElement | null) => {
    const key = `area:${areaId}`;
    if (el) cardRefsMap.current.set(key, el); else cardRefsMap.current.delete(key);
  }, []);

  const renderPlantCard = (gp: GroundPlant, areaId: number | null, index: number) => {
    const isDropBefore = dropTarget && dropTarget.areaId === areaId && dropTarget.index === index;
    const isDropAfter = dropTarget && dropTarget.areaId === areaId && dropTarget.index === index + 1;
    const isDragging = (dragItem?.id === gp.id) || (touchDrag?.id === gp.id);

    return (
      <div key={gp.id} ref={(el) => registerCardRef(areaId, index, el)}>
        {isDropBefore && <div className="h-1 bg-blue-500 rounded-full mx-2 my-1 transition-all animate-pulse" />}
        <div
          data-gp-card
          onDragStart={(e) => onDragStart(e, gp)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOverCard(e, areaId, index)}
          onDrop={(e) => onDrop(e, areaId, dropTarget?.areaId === areaId ? dropTarget.index : index)}
          className={`flex items-stretch bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all ${isDragging ? 'opacity-40' : ''}`}
        >
          {/* Drag handle */}
          <div
            className="flex items-center px-2 cursor-grab active:cursor-grabbing text-earth-300 dark:text-gray-600 hover:text-earth-500 dark:hover:text-gray-400 shrink-0 select-none touch-none"
            role="button"
            aria-label="Drag to reorder"
            tabIndex={0}
            onMouseDown={handleDragHandleMouseDown}
            onTouchStart={(e) => onTouchStart(e, gp)}
            onTouchMove={(e) => onTouchMove(e)}
            onTouchEnd={() => onTouchEnd()}
          >
            <span className="text-sm leading-none tracking-widest" style={{ letterSpacing: '2px' }}>&#8942;&#8942;</span>
          </div>
          <div className="flex-1 p-3 min-w-0">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">{getPlantIcon(gp.plant_name, gp.plant_category)}</span>
                <div className="min-w-0">
                  <Link href={`/ground-plants/${gp.id}`} className="block">
                    <h3 className="font-bold text-earth-800 dark:text-gray-100 truncate hover:text-garden-600 dark:hover:text-garden-400 transition-colors">
                      {gp.name || gp.plant_name}
                    </h3>
                  </Link>
                  {gp.name && gp.name !== gp.plant_name && (
                    <p className="text-xs text-earth-400 dark:text-gray-500">{gp.plant_name}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                {gp.status !== 'removed' && (
                  <button onClick={() => openMoveToPlanterDialog(gp)} className="text-earth-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 p-1 rounded" title="Move to Planter">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                  </button>
                )}
                <button onClick={() => handleEdit(gp)} className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded" title="Edit">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
                <button onClick={() => handleDelete(gp.id)} className="text-earth-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-1 rounded" title="Delete">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full font-medium ${statusColors[gp.status] || 'bg-gray-100 text-gray-600'}`}>
                {gp.status.charAt(0).toUpperCase() + gp.status.slice(1)}
              </span>
              {gp.effective_irrigation_zone_name ? (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  {IRRIGATION_LABELS[gp.effective_irrigation_type || ''] || gp.effective_irrigation_type}: {gp.effective_irrigation_zone_name}
                  {gp.irrigation_inherited ? ' (from area)' : ' (override)'}
                </span>
              ) : gp.irrigation_type && gp.irrigation_type !== 'manual' ? (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{IRRIGATION_LABELS[gp.irrigation_type] || gp.irrigation_type}</span>
              ) : null}
              {gp.area_auto_assigned && (
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" title="Area auto-assigned from map position">
                  auto-assigned
                </span>
              )}
            </div>

            {gp.planted_date && <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">Planted {gp.planted_date}</p>}
            {gp.notes && <p className="text-xs text-earth-500 dark:text-gray-400 mt-1 line-clamp-2">{gp.notes}</p>}

            {/* Expand/collapse toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(gp.id); }}
              className="mt-2 text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 font-medium flex items-center gap-1"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${expandedGpId === gp.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {expandedGpId === gp.id ? 'Hide Details' : 'Amendments & Irrigation'}
            </button>

            {/* Expanded section: Irrigation Detail + Soil Amendments */}
            {expandedGpId === gp.id && (
              <div className="mt-3 space-y-3 border-t border-earth-100 dark:border-gray-700 pt-3">
                {/* Irrigation Detail */}
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                  <div className="text-xs font-medium text-earth-600 dark:text-gray-300 mb-2 flex items-center gap-1">
                    <span>{'💧'}</span> Irrigation
                  </div>
                  <div className="text-sm text-earth-700 dark:text-gray-200 space-y-1">
                    <div><span className="text-earth-500 dark:text-gray-400">Type:</span> {IRRIGATION_LABELS[gp.effective_irrigation_type || gp.irrigation_type || 'manual'] || gp.irrigation_type || 'Manual'}</div>
                    {(gp.effective_irrigation_zone_name || gp.irrigation_zone_name) && (
                      <div><span className="text-earth-500 dark:text-gray-400">Zone:</span> {gp.effective_irrigation_zone_name || gp.irrigation_zone_name}</div>
                    )}
                    {gp.irrigation_inherited && (
                      <div className="text-xs text-earth-400 dark:text-gray-500 italic">Inherited from area</div>
                    )}
                  </div>
                </div>

                {/* Soil Amendments */}
                <div className="bg-earth-50 dark:bg-gray-750 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-medium text-earth-600 dark:text-gray-300 mb-1 flex items-center gap-1">
                    <span>{'🧪'}</span> Soil Amendments
                    {amendments.some(a => a.next_due_date && a.next_due_date <= getGardenDateOffset(14)) && (
                      <span className="inline-block px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">Due soon</span>
                    )}
                  </div>
                  {/* Log new amendment form */}
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
                    <input type="text" placeholder="Amount" value={amendmentForm.amount}
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
                    onClick={async (e) => {
                      e.stopPropagation();
                      setSavingAmendment(true);
                      try {
                        await createAmendment({
                          ground_plant_id: gp.id,
                          amendment_type: amendmentForm.amendment_type,
                          product_name: amendmentForm.product_name || undefined,
                          amount: amendmentForm.amount || undefined,
                          applied_date: amendmentForm.applied_date,
                          next_due_date: amendmentForm.next_due_date || undefined,
                          notes: amendmentForm.notes || undefined,
                        });
                        setAmendmentForm({ amendment_type: 'compost', product_name: '', amount: '', applied_date: getGardenToday(), next_due_date: '', notes: '' });
                        loadAmendments(gp.id);
                        toast('Amendment recorded');
                      } catch { toast('Failed to save amendment', 'error'); }
                      setSavingAmendment(false);
                    }}
                    className="w-full px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white disabled:opacity-50 transition-colors"
                  >
                    {savingAmendment ? 'Saving...' : 'Log Amendment'}
                  </button>

                  {/* Amendment history */}
                  {amendments.length > 0 ? (
                    <div className="space-y-2 mt-2">
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
                              onClick={async (e) => { e.stopPropagation(); await deleteAmendment(a.id); loadAmendments(gp.id); }}
                              className="text-red-400 hover:text-red-600 text-xs shrink-0" title="Delete"
                            >x</button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">
                      No amendments logged yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {isDropAfter && index === (gpByArea.get(areaId) || []).length - 1 && (
          <div className="h-1 bg-blue-500 rounded-full mx-2 my-1 transition-all animate-pulse" />
        )}
      </div>
    );
  };

  const renderAreaSection = (group: { areaId: number | null; area: Area | null; plants: GroundPlant[] }) => {
    const key = group.areaId !== null ? String(group.areaId) : 'unassigned';
    const isCollapsed = collapsedAreas.has(key);
    const color = group.area?.color || '#9ca3af';
    const isUnassigned = group.areaId === null;
    const count = group.plants.length;

    if (isUnassigned && count === 0 && areas.length > 0) return null;

    const isAreaDropTarget = dropTarget && dropTarget.areaId === group.areaId;

    return (
      <div
        key={key}
        className={`space-y-2 rounded-lg transition-colors ${isAreaDropTarget && !isCollapsed ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''} ${count === 0 && !isUnassigned ? 'opacity-50' : ''}`}
        ref={(el) => registerAreaRef(group.areaId, el)}
        onDragOver={(e) => onDragOverArea(e, group.areaId)}
        onDrop={(e) => onDrop(e, group.areaId, group.plants.length)}
      >
        <div
          className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-earth-50 dark:hover:bg-gray-800 transition-colors"
          onClick={() => toggleCollapse(key)}
        >
          <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <button className="text-earth-400 dark:text-gray-500 transition-transform shrink-0" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {editingArea === group.areaId ? (
            <input
              autoFocus value={editAreaName}
              onChange={(e) => setEditAreaName(e.target.value)}
              onBlur={() => group.areaId !== null && handleRenameArea(group.areaId)}
              onKeyDown={(e) => { if (e.key === 'Enter' && group.areaId !== null) handleRenameArea(group.areaId); if (e.key === 'Escape') setEditingArea(null); }}
              onClick={(e) => e.stopPropagation()}
              className="text-lg font-bold text-earth-800 dark:text-gray-100 bg-transparent border-b-2 border-garden-500 outline-none px-1"
            />
          ) : (
            <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">
              {isUnassigned ? 'Unassigned' : group.area!.name}
            </h2>
          )}
          <span className="text-sm text-earth-400 dark:text-gray-500">{count} plant{count !== 1 ? 's' : ''}</span>
          {!isUnassigned && group.area?.default_irrigation_zone_name && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              Rachio: {group.area.default_irrigation_zone_name}
            </span>
          )}
          {!isUnassigned && (
            <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { setEditingArea(group.areaId); setEditAreaName(group.area!.name); }}
                className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded transition-colors" title="Rename area"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
              <button
                onClick={() => handleDeleteArea(group.areaId!)}
                className="text-earth-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-1 rounded transition-colors" title="Delete area"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="space-y-2 pl-4">
            {group.plants.length === 0 ? (
              <div
                className={`text-sm text-earth-400 dark:text-gray-500 py-4 text-center border-2 border-dashed rounded-lg transition-colors ${
                  isAreaDropTarget ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600' : 'border-earth-200 dark:border-gray-700'
                }`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget({ areaId: group.areaId, index: 0 }); }}
                onDrop={(e) => onDrop(e, group.areaId, 0)}
              >
                Drag plants here
              </div>
            ) : (
              group.plants.map((gp, i) => renderPlantCard(gp, group.areaId, i))
            )}
            {dropTarget && dropTarget.areaId === group.areaId && dropTarget.index === group.plants.length && group.plants.length > 0 && (
              <div className="h-1 bg-blue-500 rounded-full mx-2 my-1 animate-pulse" />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">Ground</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">Trees, shrubs, and vines planted in the ground</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { if (showForm) resetForm(); else { setShowForm(true); } }}
            className="bg-garden-600 hover:bg-garden-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
          >
            {showForm ? 'Cancel' : '+ Add Plant'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">
            {editingId ? 'Edit Ground Plant' : 'Add Ground Plant'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Plant</label>
              <TypeaheadSelect
                options={plants.map(p => ({ value: String(p.id), label: p.name, icon: getPlantIcon(p.name, p.category) }))}
                value={formData.plant_id ? String(formData.plant_id) : ''}
                onChange={(val) => {
                  const pid = Number(val);
                  const plant = plants.find(p => p.id === pid);
                  setFormData({ ...formData, plant_id: pid, name: formData.name || (plant?.name || '') });
                }}
                placeholder="Type to search plants..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Display Name</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Backyard Lemon Tree" className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Area</label>
              <select value={formData.area_id} onChange={(e) => setFormData({ ...formData, area_id: e.target.value })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                <option value="">Unassigned</option>
                {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Planted Date</label>
              <input type="date" value={formData.planted_date} onChange={(e) => setFormData({ ...formData, planted_date: e.target.value })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Status</label>
              <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Irrigation Type</label>
              <select value={formData.irrigation_type} onChange={(e) => setFormData({ ...formData, irrigation_type: e.target.value, irrigation_zone_name: '' })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                {IRRIGATION_OPTIONS.map(t => <option key={t} value={t}>{IRRIGATION_LABELS[t] || t}</option>)}
              </select>
            </div>
            {formData.irrigation_type === 'rachio_controller' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Rachio Controller Zone</label>
                <select value={formData.irrigation_zone_name} onChange={(e) => setFormData({ ...formData, irrigation_zone_name: e.target.value })}
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                  <option value="">
                    {(() => {
                      const selectedArea = formData.area_id ? areas.find(a => a.id === Number(formData.area_id)) : null;
                      return selectedArea?.default_irrigation_zone_name
                        ? `Inherit from area (${selectedArea.default_irrigation_zone_name})`
                        : 'Select a zone...';
                    })()}
                  </option>
                  {irrigationZones.map(z => <option key={z.name} value={z.name}>{z.zone_number ? `Zone ${z.zone_number}: ` : ''}{z.name}</option>)}
                </select>
              </div>
            )}
            {formData.irrigation_type === 'rachio_hose_timer' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Rachio Hose Timer Valve</label>
                <select value={formData.irrigation_zone_name} onChange={(e) => setFormData({ ...formData, irrigation_zone_name: e.target.value })}
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                  <option value="">
                    {(() => {
                      const selectedArea = formData.area_id ? areas.find(a => a.id === Number(formData.area_id)) : null;
                      return selectedArea?.default_irrigation_zone_name
                        ? `Inherit from area (${selectedArea.default_irrigation_zone_name})`
                        : 'Select a valve...';
                    })()}
                  </option>
                  {irrigationValves.map(v => <option key={v.id} value={v.name}>{v.device_name}: {v.name}</option>)}
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
          </div>
          <button type="submit" disabled={submitting || !formData.plant_id}
            className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
            {submitting ? 'Saving...' : editingId ? 'Update Plant' : 'Add Plant'}
          </button>
        </form>
      )}

      {/* Search */}
      {!loading && groundPlants.length > 0 && (
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search ground plants..." aria-label="Search ground plants"
          className="w-full px-4 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
      )}

      {/* Grouped plant cards */}
      {loading ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading ground plants...</div>
      ) : filtered.length === 0 && !showForm ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">{'\u{1F333}'}</div>
          <h2 className="text-xl font-bold text-earth-700 dark:text-gray-200 mb-2">
            {groundPlants.length === 0 ? 'No ground plants yet' : 'No matches'}
          </h2>
          <p className="text-earth-400 dark:text-gray-500">
            {groundPlants.length === 0 ? 'Add trees, vines, or landscaping plants that live in the ground.' : 'Try a different search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(g => renderAreaSection(g))}
        </div>
      )}

      {/* Move to Planter dialog */}
      {showMoveToPlanterDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowMoveToPlanterDialog(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">Move to Planter</h3>
            <p className="text-sm text-earth-500 dark:text-gray-400">
              Move <span className="font-medium">{moveGpName}</span> to a planter. The original ground plant will be marked as removed.
            </p>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Target Planter</label>
              <select
                value={moveTargetBed ?? ''}
                onChange={(e) => setMoveTargetBed(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">Select a planter...</option>
                {allBeds.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.width_cells}x{b.height_cells})</option>
                ))}
              </select>
            </div>
            {moveTargetBed && (
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
                onClick={handleMoveToPlanterSubmit}
                disabled={!moveTargetBed || movingToPlanter}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                {movingToPlanter ? 'Moving...' : 'Move'}
              </button>
              <button
                onClick={() => { setShowMoveToPlanterDialog(false); setMoveGpId(null); }}
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
