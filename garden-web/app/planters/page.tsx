'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { getBeds, createBed, deleteBed, updateBed, getAreas, updateArea, deleteArea, reorderBeds, getPlanterTypes, getPlanterType } from '../api';
import { CardSkeleton } from '../skeleton';
import { useToast } from '../toast';
import { useModal } from '../confirm-modal';
import type { Area } from '../types';

interface Bed {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  bed_type?: string;
  description?: string;
  active_plantings: number;
  created_at: string;
  irrigation_type?: string;
  irrigation_zone_name?: string;
  area_id: number | null;
  area_name: string | null;
  area_color: string | null;
  sort_order: number;
  planter_type_id?: number | null;
  planter_type_name?: string | null;
  planter_brand?: string | null;
  planter_tiers?: number | null;
  planter_pockets_per_tier?: number | null;
  planter_total_pockets?: number | null;
  planter_form_factor?: string | null;
  depth_inches?: number | null;
  physical_width_inches?: number | null;
  physical_length_inches?: number | null;
  soil_type?: string | null;
  soil_product_id?: number | null;
  soil_product_brand?: string | null;
  soil_product_name?: string | null;
}

interface PlanterType {
  id: number;
  name: string;
  brand: string;
  form_factor: string;
  tiers: number;
  pockets_per_tier: number;
  total_pockets: number;
  pocket_depth_inches: number;
  pocket_volume_gallons: number;
  footprint_diameter_inches: number;
  height_inches: number;
  watering_system: string;
  desert_notes: string;
}

export default function BedsPage() {
  const { toast } = useToast();
  const { showConfirm } = useModal();
  const [beds, setBeds] = useState<Bed[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', width_cells: 4, height_cells: 8, cell_size_inches: 12, bed_type: 'grid' as string, description: '', planter_type_id: null as number | null, depth_inches: null as number | null, physical_width_inches: null as number | null, physical_length_inches: null as number | null });
  const [planterTypes, setPlanterTypes] = useState<PlanterType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [editingArea, setEditingArea] = useState<number | null>(null);
  const [editAreaName, setEditAreaName] = useState('');
  const [dragItem, setDragItem] = useState<{ id: number; areaId: number | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ areaId: number | null; index: number } | null>(null);

  // Planter types modal state
  const [showPlanterModal, setShowPlanterModal] = useState(false);
  const [allPlanterTypes, setAllPlanterTypes] = useState<PlanterType[]>([]);
  const [planterModalLoading, setPlanterModalLoading] = useState(false);
  const [expandedPlanterId, setExpandedPlanterId] = useState<number | null>(null);
  const [expandedPlanterData, setExpandedPlanterData] = useState<any>(null);
  const [expandPlanterLoading, setExpandPlanterLoading] = useState(false);

  // Touch drag state
  const [touchDrag, setTouchDrag] = useState<{ id: number; areaId: number | null; startY: number; currentY: number; element: HTMLElement | null } | null>(null);
  const touchCloneRef = useRef<HTMLElement | null>(null);
  const cardRefsMap = useRef<Map<string, HTMLElement>>(new Map());

  const [initialCollapseApplied, setInitialCollapseApplied] = useState(false);

  const loadData = useCallback(() => {
    Promise.all([getBeds(), getAreas(), getPlanterTypes()])
      .then(([b, a, pt]) => { setBeds(b); setAreas(a); setPlanterTypes(pt); })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Collapse all areas by default on initial load
  useEffect(() => {
    if (!initialCollapseApplied && !loading && areas.length > 0) {
      const keys = new Set<string>();
      areas.forEach(a => keys.add(String(a.id)));
      // Keep "Unassigned" expanded if it has items
      const unassignedCount = beds.filter(b => b.area_id === null).length;
      if (unassignedCount === 0) keys.add('unassigned');
      setCollapsedAreas(keys);
      setInitialCollapseApplied(true);
    }
  }, [initialCollapseApplied, loading, areas, beds]);

  const openPlanterModal = async () => {
    setShowPlanterModal(true);
    setPlanterModalLoading(true);
    try {
      const all = await getPlanterTypes();
      setAllPlanterTypes(all);
    } catch { setAllPlanterTypes([]); }
    finally { setPlanterModalLoading(false); }
  };

  const handleExpandPlanter = async (id: number) => {
    if (expandedPlanterId === id) {
      setExpandedPlanterId(null);
      setExpandedPlanterData(null);
      return;
    }
    setExpandedPlanterId(id);
    setExpandPlanterLoading(true);
    try {
      const data = await getPlanterType(id);
      setExpandedPlanterData(data);
    } catch { setExpandedPlanterData(null); }
    finally { setExpandPlanterLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setSubmitting(true);
    try {
      const submitData = { ...formData };
      // For single planters, store physical dimensions and set grid defaults
      if (submitData.bed_type === 'single') {
        submitData.width_cells = 1;
        submitData.height_cells = 1;
        submitData.cell_size_inches = 12;
        // Build a description from physical dims for display
        const parts: string[] = [];
        if (submitData.physical_width_inches) parts.push(`${submitData.physical_width_inches}" W`);
        if (submitData.physical_length_inches) parts.push(`${submitData.physical_length_inches}" L`);
        if (submitData.depth_inches) parts.push(`${submitData.depth_inches}" D`);
        submitData.description = parts.join(' x ');
      }
      await createBed(submitData);
      setFormData({ name: '', width_cells: 4, height_cells: 8, cell_size_inches: 12, bed_type: 'grid', description: '', planter_type_id: null, depth_inches: null, physical_width_inches: null, physical_length_inches: null });
      setShowForm(false);
      loadData();
      toast('Planter created!');
    } catch { setError('Failed to create planter'); }
    finally { setSubmitting(false); }
  };

  const handleDeleteBed = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!await showConfirm({ title: 'Delete Planter', message: 'Are you sure you want to delete this planter and all its plantings?', confirmText: 'Delete', destructive: true })) return;
    try { await deleteBed(id); loadData(); toast('Planter deleted'); }
    catch { setError('Failed to delete planter'); }
  };

  const handleDeleteArea = async (areaId: number) => {
    if (!await showConfirm({ title: 'Delete Area', message: 'Delete this area? Planters will be moved to Unassigned.', confirmText: 'Delete', destructive: true })) return;
    try { await deleteArea(areaId); loadData(); toast('Area deleted'); }
    catch { setError('Failed to delete area'); }
  };

  const handleRenameArea = async (areaId: number) => {
    if (!editAreaName.trim()) { setEditingArea(null); return; }
    try { await updateArea(areaId, { name: editAreaName }); setEditingArea(null); loadData(); }
    catch { setError('Failed to rename area'); }
  };

  const handleAreaAssign = async (bedId: number, areaId: number | null) => {
    try { await updateBed(bedId, { area_id: areaId === null ? 0 : areaId }); loadData(); }
    catch { setError('Failed to assign area'); }
  };

  const toggleCollapse = (key: string) => {
    setCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Group beds by area
  const grouped: { areaId: number | null; area: Area | null; beds: Bed[] }[] = [];
  const areaMap = new Map<number, Area>();
  areas.forEach(a => areaMap.set(a.id, a));

  const bedsByArea = new Map<number | null, Bed[]>();
  beds.forEach(b => {
    const key = b.area_id;
    if (!bedsByArea.has(key)) bedsByArea.set(key, []);
    bedsByArea.get(key)!.push(b);
  });

  areas.forEach(a => {
    grouped.push({ areaId: a.id, area: a, beds: bedsByArea.get(a.id) || [] });
  });
  // Sort areas: ones with items first, empty ones last
  grouped.sort((a, b) => {
    const aCount = a.beds.length;
    const bCount = b.beds.length;
    if (aCount > 0 && bCount === 0) return -1;
    if (aCount === 0 && bCount > 0) return 1;
    return 0;
  });
  const unassigned = bedsByArea.get(null) || [];
  grouped.push({ areaId: null, area: null, beds: unassigned });

  // Build a flat list of all cards with their positions for touch drag hit-testing
  const getAllCardPositions = useCallback(() => {
    const positions: { id: number; areaId: number | null; index: number; rect: DOMRect }[] = [];
    cardRefsMap.current.forEach((el, key) => {
      const [areaStr, indexStr] = key.split(':');
      const areaId = areaStr === 'null' ? null : Number(areaStr);
      const index = Number(indexStr);
      const bed = beds.find(b => {
        const bArea = b.area_id;
        const areaBeds = bedsByArea.get(bArea) || [];
        return areaBeds[index]?.id === b.id && bArea === areaId;
      });
      if (el) {
        positions.push({ id: bed?.id ?? 0, areaId, index, rect: el.getBoundingClientRect() });
      }
    });
    return positions;
  }, [beds, bedsByArea]);

  // Compute drop target from a Y coordinate (used by both mouse drag and touch drag)
  const computeDropTarget = useCallback((clientY: number, clientX: number): { areaId: number | null; index: number } | null => {
    // Check each card's bounding rect
    let closest: { areaId: number | null; index: number; dist: number } | null = null;

    for (const group of grouped) {
      const areaBeds = group.beds;
      for (let i = 0; i < areaBeds.length; i++) {
        const key = `${group.areaId}:${i}`;
        const el = cardRefsMap.current.get(key);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        // Determine if we're above or below midpoint
        const targetIndex = clientY < midY ? i : i + 1;
        const dist = Math.abs(clientY - midY);
        if (!closest || dist < closest.dist) {
          closest = { areaId: group.areaId, index: targetIndex, dist };
        }
      }
      // Also check empty areas or end of area
      if (areaBeds.length === 0) {
        // For empty areas, check if the cursor is within the area section
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

  // Drag and drop handlers
  const handleDragHandleMouseDown = (e: React.MouseEvent, bedId: number) => {
    // Mark that a drag is starting from the handle
    const card = (e.currentTarget as HTMLElement).closest('[data-bed-card]') as HTMLElement;
    if (card) {
      card.setAttribute('draggable', 'true');
    }
  };

  const onDragStart = (e: React.DragEvent, bed: Bed) => {
    // Only allow drag if initiated from handle
    const target = e.target as HTMLElement;
    const card = target.closest('[data-bed-card]') as HTMLElement;
    if (!card || card.getAttribute('draggable') !== 'true') {
      e.preventDefault();
      return;
    }
    setDragItem({ id: bed.id, areaId: bed.area_id });
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: bed.id, type: 'bed' }));
    e.dataTransfer.effectAllowed = 'move';

    // Create a ghost image
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    ghost.style.opacity = '0.8';
    ghost.style.width = `${card.offsetWidth}px`;
    ghost.style.transform = 'rotate(1deg)';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    requestAnimationFrame(() => document.body.removeChild(ghost));

    card.style.opacity = '0.4';
  };

  const onDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    const card = target.closest('[data-bed-card]') as HTMLElement;
    if (card) {
      card.style.opacity = '1';
      card.removeAttribute('draggable');
    }
    setDragItem(null);
    setDropTarget(null);
  };

  const onDragOverCard = (e: React.DragEvent, areaId: number | null, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    // Use clientY to determine if drop should be before or after this card
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const targetIndex = e.clientY < midY ? index : index + 1;
    setDropTarget({ areaId, index: targetIndex });
  };

  const onDragOverArea = (e: React.DragEvent, areaId: number | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Only set to end of area if not already targeting a specific card position in this area
    if (!dropTarget || dropTarget.areaId !== areaId) {
      const areaBeds = bedsByArea.get(areaId) || [];
      setDropTarget({ areaId, index: areaBeds.length });
    }
  };

  const executeReorder = async (draggedId: number, draggedAreaId: number | null, targetAreaId: number | null, targetIndex: number) => {
    const sourceBeds = [...(bedsByArea.get(draggedAreaId) || [])];
    const targetBeds = draggedAreaId === targetAreaId
      ? sourceBeds
      : [...(bedsByArea.get(targetAreaId) || [])];

    const dragIdx = sourceBeds.findIndex(b => b.id === draggedId);
    if (dragIdx === -1) return;
    const [moved] = sourceBeds.splice(dragIdx, 1);

    let insertIdx = targetIndex;
    if (draggedAreaId === targetAreaId && dragIdx < targetIndex) {
      insertIdx = Math.max(0, targetIndex - 1);
    }

    if (draggedAreaId === targetAreaId) {
      sourceBeds.splice(insertIdx, 0, moved);
      const orders = sourceBeds.map((b, i) => ({ id: b.id, sort_order: i, area_id: targetAreaId ?? 0 }));
      try { await reorderBeds(orders); loadData(); }
      catch { setError('Failed to reorder'); }
    } else {
      targetBeds.splice(insertIdx, 0, moved);
      const orders = [
        ...sourceBeds.map((b, i) => ({ id: b.id, sort_order: i })),
        ...targetBeds.map((b, i) => ({ id: b.id, sort_order: i, area_id: targetAreaId ?? 0 })),
      ];
      try { await reorderBeds(orders); loadData(); }
      catch { setError('Failed to reorder'); }
    }
  };

  const onDrop = async (e: React.DragEvent, targetAreaId: number | null, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragItem) return;

    // Use the dropTarget index if available (more accurate from dragover midpoint calc)
    const finalIndex = dropTarget && dropTarget.areaId === targetAreaId ? dropTarget.index : targetIndex;
    await executeReorder(dragItem.id, dragItem.areaId, targetAreaId, finalIndex);

    setDragItem(null);
    setDropTarget(null);
  };

  // Touch drag handlers
  const onTouchStart = (e: React.TouchEvent, bed: Bed) => {
    const touch = e.touches[0];
    const card = (e.currentTarget as HTMLElement).closest('[data-bed-card]') as HTMLElement;
    setTouchDrag({ id: bed.id, areaId: bed.area_id, startY: touch.clientY, currentY: touch.clientY, element: card });

    // Create a floating clone
    if (card) {
      const clone = card.cloneNode(true) as HTMLElement;
      clone.style.position = 'fixed';
      clone.style.left = `${card.getBoundingClientRect().left}px`;
      clone.style.top = `${touch.clientY - 30}px`;
      clone.style.width = `${card.offsetWidth}px`;
      clone.style.opacity = '0.85';
      clone.style.zIndex = '9999';
      clone.style.pointerEvents = 'none';
      clone.style.transform = 'rotate(1deg) scale(1.02)';
      clone.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
      clone.style.transition = 'none';
      document.body.appendChild(clone);
      touchCloneRef.current = clone;
      card.style.opacity = '0.3';
    }
  };

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchDrag) return;
    e.preventDefault();
    const touch = e.touches[0];

    // Move the clone
    if (touchCloneRef.current) {
      touchCloneRef.current.style.top = `${touch.clientY - 30}px`;
    }

    // Compute drop target from position
    const target = computeDropTarget(touch.clientY, touch.clientX);
    if (target) {
      setDropTarget(target);
    }

    setTouchDrag(prev => prev ? { ...prev, currentY: touch.clientY } : null);
  }, [touchDrag, computeDropTarget]);

  const onTouchEnd = useCallback(async () => {
    if (!touchDrag) return;

    // Clean up clone
    if (touchCloneRef.current) {
      document.body.removeChild(touchCloneRef.current);
      touchCloneRef.current = null;
    }
    if (touchDrag.element) {
      touchDrag.element.style.opacity = '1';
    }

    // Execute reorder if we have a drop target
    if (dropTarget) {
      await executeReorder(touchDrag.id, touchDrag.areaId, dropTarget.areaId, dropTarget.index);
    }

    setTouchDrag(null);
    setDropTarget(null);
  }, [touchDrag, dropTarget]);

  const registerCardRef = useCallback((areaId: number | null, index: number, el: HTMLElement | null) => {
    const key = `${areaId}:${index}`;
    if (el) {
      cardRefsMap.current.set(key, el);
    } else {
      cardRefsMap.current.delete(key);
    }
  }, []);

  const registerAreaRef = useCallback((areaId: number | null, el: HTMLElement | null) => {
    const key = `area:${areaId}`;
    if (el) {
      cardRefsMap.current.set(key, el);
    } else {
      cardRefsMap.current.delete(key);
    }
  }, []);

  const renderBedCard = (bed: Bed, areaId: number | null, index: number) => {
    const isDropBefore = dropTarget && dropTarget.areaId === areaId && dropTarget.index === index;
    const isDropAfter = dropTarget && dropTarget.areaId === areaId && dropTarget.index === index + 1;
    const isDragging = (dragItem?.id === bed.id) || (touchDrag?.id === bed.id);

    return (
      <div key={bed.id} ref={(el) => registerCardRef(areaId, index, el)}>
        {isDropBefore && (
          <div className="h-1 bg-blue-500 rounded-full mx-2 my-1 transition-all animate-pulse" />
        )}
        <div
          data-bed-card
          onDragStart={(e) => onDragStart(e, bed)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOverCard(e, areaId, index)}
          onDrop={(e) => onDrop(e, areaId, dropTarget?.areaId === areaId ? dropTarget.index : index)}
          className={`flex items-stretch bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm hover:shadow-md hover:border-garden-300 dark:hover:border-garden-600 transition-all group ${isDragging ? 'opacity-40' : ''}`}
        >
          {/* Drag handle */}
          <div
            className="flex items-center px-2 cursor-grab active:cursor-grabbing text-earth-300 dark:text-gray-600 hover:text-earth-500 dark:hover:text-gray-400 shrink-0 select-none touch-none"
            role="button"
            aria-label="Drag to reorder"
            tabIndex={0}
            onMouseDown={(e) => handleDragHandleMouseDown(e, bed.id)}
            onTouchStart={(e) => onTouchStart(e, bed)}
            onTouchMove={(e) => onTouchMove(e)}
            onTouchEnd={() => onTouchEnd()}
          >
            <span className="text-sm leading-none tracking-widest" style={{ letterSpacing: '2px' }}>&#8942;&#8942;</span>
          </div>
          <Link href={`/planters/${bed.id}`} className="flex-1 p-5 min-w-0">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100 group-hover:text-garden-700 dark:group-hover:text-garden-400 transition-colors truncate">
                  {bed.name}
                </h3>
                {bed.irrigation_type === 'rachio_controller' || bed.irrigation_type === 'rachio_hose_timer' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 shrink-0">
                    Auto
                  </span>
                ) : bed.irrigation_type === 'none' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">
                    None
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 shrink-0">
                    Manual
                  </span>
                )}
              </div>
              <button
                onClick={(e) => handleDeleteBed(e, bed.id)}
                className="text-earth-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-1 rounded transition-colors shrink-0 ml-2"
                title="Delete planter"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
            <div className="mt-3 flex items-center gap-4 text-sm text-earth-500 dark:text-gray-400">
              {bed.bed_type && bed.bed_type !== 'grid' && bed.bed_type !== 'linear' && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                  bed.bed_type === 'single' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                  bed.bed_type === 'vertical' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' :
                  'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                }`}>
                  {bed.bed_type === 'single' ? 'Single' : bed.bed_type === 'vertical' ? 'Vertical' : 'Free-form'}
                </span>
              )}
              {bed.planter_type_name && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300">
                  {bed.planter_brand ? `${bed.planter_brand} · ` : ''}{bed.planter_type_name}
                </span>
              )}
              {bed.bed_type === 'single' ? (
                <span>
                  {[
                    bed.physical_width_inches ? `${bed.physical_width_inches}" W` : null,
                    bed.physical_length_inches ? `${bed.physical_length_inches}" L` : null,
                    bed.depth_inches ? `${bed.depth_inches}" D` : null,
                  ].filter(Boolean).join(' x ') || bed.description || 'Single planter'}
                </span>
              ) : (
                <>
                  <span>{bed.bed_type === 'vertical' ? `${bed.height_cells}T x ${bed.width_cells}P` : `${bed.width_cells}x${bed.height_cells}`} {bed.bed_type === 'vertical' ? 'pockets' : 'cells'}</span>
                  <span>{bed.cell_size_inches}&quot;</span>
                  <span>{(bed.width_cells * bed.cell_size_inches / 12).toFixed(1)}ft x {(bed.height_cells * bed.cell_size_inches / 12).toFixed(1)}ft</span>
                  {bed.depth_inches && <span>{bed.depth_inches}&quot; deep</span>}
                </>
              )}
              <span className="text-garden-600 font-bold ml-auto">{bed.active_plantings || 0} plantings</span>
            </div>
            {bed.soil_type && (
              <div className="mt-1.5 text-xs text-earth-400 dark:text-gray-500">
                {(() => {
                  const SOIL_LABELS: Record<string, string> = {
                    native_ground: 'Native Ground', amended_native: 'Amended Native',
                    raised_bed_mix: 'Raised Bed Mix', potting_mix: 'Potting Mix',
                    cactus_succulent_mix: 'Cactus/Succulent Mix', custom_blend: 'Custom Blend',
                    'native-clay': 'Native Clay', 'native-amended': 'Amended Native',
                    'raised-bed-mix': 'Raised Bed Mix', 'potting-soil': 'Potting Mix',
                  };
                  const label = SOIL_LABELS[bed.soil_type] || bed.soil_type;
                  if (bed.soil_product_brand) {
                    return `${label} (${bed.soil_product_brand})`;
                  }
                  return label;
                })()}
              </div>
            )}
            {/* Area assigned via drag-and-drop between sections */}
          </Link>
        </div>
        {/* Show drop-after indicator for last item only */}
        {isDropAfter && index === (bedsByArea.get(areaId) || []).length - 1 && (
          <div className="h-1 bg-blue-500 rounded-full mx-2 my-1 transition-all animate-pulse" />
        )}
      </div>
    );
  };

  const renderAreaSection = (group: { areaId: number | null; area: Area | null; beds: Bed[] }) => {
    const key = group.areaId !== null ? String(group.areaId) : 'unassigned';
    const isCollapsed = collapsedAreas.has(key);
    const color = group.area?.color || '#9ca3af';
    const isUnassigned = group.areaId === null;
    const count = group.beds.length;

    // Don't show unassigned section if empty and there are areas
    if (isUnassigned && count === 0 && areas.length > 0) return null;

    const isAreaDropTarget = dropTarget && dropTarget.areaId === group.areaId;

    return (
      <div
        key={key}
        className={`space-y-2 rounded-lg transition-colors ${isAreaDropTarget && !isCollapsed ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''} ${count === 0 && !isUnassigned ? 'opacity-50' : ''}`}
        ref={(el) => registerAreaRef(group.areaId, el)}
        onDragOver={(e) => onDragOverArea(e, group.areaId)}
        onDrop={(e) => onDrop(e, group.areaId, group.beds.length)}
      >
        {/* Area header */}
        <div
          className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-earth-50 dark:hover:bg-gray-800 transition-colors"
          onClick={() => toggleCollapse(key)}
        >
          <div
            className="w-1 h-8 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <button className="text-earth-400 dark:text-gray-500 transition-transform shrink-0" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {editingArea === group.areaId ? (
            <input
              autoFocus
              value={editAreaName}
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
          <span className="text-sm text-earth-400 dark:text-gray-500">{count} planter{count !== 1 ? 's' : ''}</span>
          {!isUnassigned && (
            <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { setEditingArea(group.areaId); setEditAreaName(group.area!.name); }}
                className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded transition-colors"
                title="Rename area"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
              <button
                onClick={() => handleDeleteArea(group.areaId!)}
                className="text-earth-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-1 rounded transition-colors"
                title="Delete area"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          )}
        </div>

        {/* Beds in this area */}
        {!isCollapsed && (
          <div className="space-y-2 pl-4">
            {group.beds.length === 0 ? (
              <div
                className={`text-sm text-earth-400 dark:text-gray-500 py-4 text-center border-2 border-dashed rounded-lg transition-colors ${
                  isAreaDropTarget ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600' : 'border-earth-200 dark:border-gray-700'
                }`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget({ areaId: group.areaId, index: 0 }); }}
                onDrop={(e) => onDrop(e, group.areaId, 0)}
              >
                Drag planters here
              </div>
            ) : (
              group.beds.map((bed, i) => renderBedCard(bed, group.areaId, i))
            )}
            {/* Drop indicator at end */}
            {dropTarget && dropTarget.areaId === group.areaId && dropTarget.index === group.beds.length && group.beds.length > 0 && (
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
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">Planters</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">Manage your planters and planting areas</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openPlanterModal}
            className="bg-sky-100 hover:bg-sky-200 dark:bg-sky-900/30 dark:hover:bg-sky-900/50 text-sky-700 dark:text-sky-300 px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
          >
            Manage Planter Types
          </button>
          <button
            onClick={() => { setShowForm(!showForm); }}
            className="bg-garden-600 hover:bg-garden-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
          >
            {showForm ? 'Cancel' : '+ New Planter'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {/* Create planter form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">Create New Planter</h2>

          {/* Planter type selector */}
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-2">Planter Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { value: 'grid', icon: '\u{1F7E9}', label: 'Grid', desc: 'Raised planter with rows & columns' },
                { value: 'vertical', icon: '\u{1F3D7}', label: 'Vertical', desc: 'Vertical tower planter' },
                { value: 'single', icon: '\u{1F333}', label: 'Single Plant', desc: 'One plant in a pot' },
                { value: 'freeform', icon: '\u{1F33F}', label: 'Free-form', desc: 'Scattered plants in an area' },
              ] as const).map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    const updates: Partial<typeof formData> = { bed_type: t.value, planter_type_id: null, depth_inches: null, physical_width_inches: null, physical_length_inches: null };
                    if (t.value === 'single') { updates.width_cells = 1; updates.height_cells = 1; }
                    if (t.value === 'vertical') {
                      const verticalPt = planterTypes.find(p => p.form_factor === 'vertical_tower');
                      if (verticalPt) {
                        updates.planter_type_id = verticalPt.id;
                        updates.width_cells = verticalPt.pockets_per_tier;
                        updates.height_cells = verticalPt.tiers;
                      }
                    }
                    setFormData({ ...formData, ...updates });
                  }}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    formData.bed_type === t.value
                      ? 'border-garden-500 bg-garden-50 dark:bg-garden-900/30'
                      : 'border-earth-200 dark:border-gray-600 hover:border-garden-300'
                  }`}
                >
                  <div className="text-xl mb-1">{t.icon}</div>
                  <div className="text-sm font-medium text-earth-800 dark:text-gray-100">{t.label}</div>
                  <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Planter Model (optional) — available for all types */}
          {planterTypes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-2">Planter Model (optional)</label>
              <select
                value={formData.planter_type_id || ''}
                onChange={(e) => {
                  const ptId = e.target.value ? Number(e.target.value) : null;
                  const pt = ptId ? planterTypes.find(p => p.id === ptId) : null;
                  if (formData.bed_type === 'vertical' && pt) {
                    setFormData({
                      ...formData,
                      planter_type_id: ptId,
                      width_cells: pt.pockets_per_tier,
                      height_cells: pt.tiers,
                      cell_size_inches: Math.round((pt.pocket_volume_gallons || 1) * 12),
                    });
                  } else {
                    setFormData({ ...formData, planter_type_id: ptId });
                  }
                }}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
              >
                <option value="">None / Custom</option>
                {(() => {
                  const groups: { label: string; key: string; items: PlanterType[] }[] = [
                    { label: 'Vertical Towers', key: 'vertical_tower', items: [] },
                    { label: 'Raised Beds', key: 'raised_bed', items: [] },
                    { label: 'Containers', key: 'container', items: [] },
                  ];
                  const otherItems: PlanterType[] = [];
                  for (const pt of planterTypes) {
                    const group = groups.find(g => g.key === pt.form_factor);
                    if (group) group.items.push(pt);
                    else otherItems.push(pt);
                  }
                  if (otherItems.length > 0) groups.push({ label: 'Other', key: 'other', items: otherItems });
                  return groups.filter(g => g.items.length > 0).map(g => (
                    <optgroup key={g.key} label={g.label}>
                      {g.items.map(pt => (
                        <option key={pt.id} value={pt.id}>{pt.brand ? `${pt.brand} - ` : ''}{pt.name}</option>
                      ))}
                    </optgroup>
                  ));
                })()}
              </select>
              {formData.planter_type_id && (() => {
                const pt = planterTypes.find(p => p.id === formData.planter_type_id);
                if (!pt) return null;
                const ffLabels: Record<string, string> = { vertical_tower: 'Vertical Tower', raised_bed: 'Raised Bed', container: 'Container', vertical_wall: 'Vertical Wall', ground: 'Ground', trellis: 'Trellis', hanging: 'Hanging' };
                return (
                  <div className="mt-2 p-3 bg-earth-50 dark:bg-gray-700/50 rounded-lg text-xs text-earth-500 dark:text-gray-400 space-y-0.5">
                    {pt.form_factor && <div>Type: <span className="font-semibold text-earth-700 dark:text-gray-300">{ffLabels[pt.form_factor] || pt.form_factor}</span></div>}
                    {pt.tiers > 0 && <div>{pt.tiers} tiers x {pt.pockets_per_tier} pockets = <span className="font-bold text-garden-600 dark:text-garden-400">{pt.total_pockets} total</span></div>}
                    {pt.footprint_diameter_inches > 0 && <div>Footprint: {pt.footprint_diameter_inches}&quot; diameter</div>}
                    {pt.height_inches > 0 && <div>Height: {pt.height_inches}&quot; ({(pt.height_inches / 12).toFixed(1)}ft)</div>}
                    {pt.watering_system && <div>Watering: {pt.watering_system}</div>}
                  </div>
                );
              })()}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Planter Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={formData.bed_type === 'single' ? 'e.g., Lemon Tree' : formData.bed_type === 'vertical' ? 'e.g., Herb Tower' : 'e.g., Front Raised Planter'}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                required
              />
            </div>

            {/* Grid / Freeform: width + height (not vertical - auto-set from planter type) */}
            {(formData.bed_type === 'grid' || formData.bed_type === 'freeform') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Width (cells)</label>
                  <input
                    type="number" min={1} max={50} value={formData.width_cells}
                    onChange={(e) => setFormData({ ...formData, width_cells: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Height (cells)</label>
                  <input
                    type="number" min={1} max={50} value={formData.height_cells}
                    onChange={(e) => setFormData({ ...formData, height_cells: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
              </>
            )}

            {/* Single Plant: width, length, depth (physical dimensions) */}
            {formData.bed_type === 'single' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Width (inches)</label>
                  <input
                    type="number" min={1} max={120} value={formData.physical_width_inches || ''}
                    onChange={(e) => setFormData({ ...formData, physical_width_inches: parseFloat(e.target.value) || null })}
                    placeholder="e.g., 24"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Length (inches)</label>
                  <input
                    type="number" min={1} max={120} value={formData.physical_length_inches || ''}
                    onChange={(e) => setFormData({ ...formData, physical_length_inches: parseFloat(e.target.value) || null })}
                    placeholder="e.g., 48"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Depth (inches)</label>
                  <input
                    type="number" min={1} max={120} value={formData.depth_inches || ''}
                    onChange={(e) => setFormData({ ...formData, depth_inches: parseFloat(e.target.value) || null })}
                    placeholder="e.g., 18"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
              </>
            )}

            {/* Cell size for grid/freeform only */}
            {formData.bed_type !== 'single' && formData.bed_type !== 'vertical' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Cell Size (inches)</label>
                <input
                  type="number" min={6} max={24} value={formData.cell_size_inches}
                  onChange={(e) => setFormData({ ...formData, cell_size_inches: parseInt(e.target.value) || 12 })}
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            )}

            {/* Depth for grid type */}
            {formData.bed_type === 'grid' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Depth (inches)</label>
                <input
                  type="number" min={1} max={120} value={formData.depth_inches || ''}
                  onChange={(e) => setFormData({ ...formData, depth_inches: parseFloat(e.target.value) || null })}
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            )}
          </div>

          {/* Summary */}
          <p className="text-sm text-earth-400 dark:text-gray-500">
            {formData.bed_type === 'single' ? (
              <>{formData.physical_width_inches ? `${formData.physical_width_inches}" W` : ''}{formData.physical_length_inches ? ` x ${formData.physical_length_inches}" L` : ''}{formData.depth_inches ? ` x ${formData.depth_inches}" D` : ''}{!formData.physical_width_inches && !formData.physical_length_inches && !formData.depth_inches ? 'Enter planter dimensions' : ''}</>
            ) : formData.bed_type === 'vertical' ? (
              <>{formData.height_cells} tiers x {formData.width_cells} pockets = {formData.width_cells * formData.height_cells} total planting pockets.
              {formData.planter_type_id && planterTypes.find(pt => pt.id === formData.planter_type_id) &&
                <> {planterTypes.find(pt => pt.id === formData.planter_type_id)!.footprint_diameter_inches}&quot; diameter, {planterTypes.find(pt => pt.id === formData.planter_type_id)!.height_inches}&quot; tall.</>
              }</>
            ) : (
              <>{formData.width_cells} x {formData.height_cells} grid ({formData.width_cells * formData.height_cells} cells), each {formData.cell_size_inches}&quot;{formData.depth_inches ? `, ${formData.depth_inches}" deep` : ''}. Total: {(formData.width_cells * formData.cell_size_inches / 12).toFixed(1)}ft x {(formData.height_cells * formData.cell_size_inches / 12).toFixed(1)}ft</>
            )}
          </p>
          <button
            type="submit" disabled={submitting}
            className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
          >
            {submitting ? 'Creating...' : 'Create Planter'}
          </button>
        </form>
      )}

      {/* Planters list grouped by area */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : beds.length === 0 && areas.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🌱</div>
          <h2 className="text-xl font-bold text-earth-700 dark:text-gray-200 mb-2">No planters yet</h2>
          <p className="text-earth-400 dark:text-gray-500">Create your first planter to get started!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(g => renderAreaSection(g))}
        </div>
      )}

      {/* Planter Types Modal */}
      {showPlanterModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-16 px-4" onClick={() => setShowPlanterModal(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-earth-200 dark:border-gray-700 w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-earth-200 dark:border-gray-700 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100">Planter Types</h2>
                <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">Browse vertical planters and their specs</p>
              </div>
              <button
                onClick={() => setShowPlanterModal(false)}
                className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 p-2 rounded-lg hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto p-6">
              {planterModalLoading ? (
                <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading planter types...</div>
              ) : allPlanterTypes.length === 0 ? (
                <div className="text-center py-12 text-earth-400 dark:text-gray-500">No planter types found.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {allPlanterTypes.map(pt => (
                    <div key={pt.id} className="bg-earth-50 dark:bg-gray-750 rounded-xl border border-earth-200 dark:border-gray-700 overflow-hidden">
                      <button
                        onClick={() => handleExpandPlanter(pt.id)}
                        className="w-full text-left p-4 hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-bold text-earth-800 dark:text-gray-100 text-sm">{pt.name}</h3>
                            <p className="text-xs text-earth-500 dark:text-gray-400">{pt.brand}</p>
                          </div>
                          <span className="text-2xl shrink-0">{'\u{1F3D7}'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                          <div className="text-earth-500 dark:text-gray-400">
                            <span className="font-semibold text-earth-700 dark:text-gray-300">{pt.tiers}</span> tiers
                          </div>
                          <div className="text-earth-500 dark:text-gray-400">
                            <span className="font-semibold text-earth-700 dark:text-gray-300">{pt.pockets_per_tier}</span> pockets/tier
                          </div>
                          <div className="text-earth-500 dark:text-gray-400">
                            <span className="font-semibold text-garden-600 dark:text-garden-400">{pt.total_pockets}</span> total
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-1 text-xs text-earth-500 dark:text-gray-400">
                          <div>{pt.pocket_depth_inches}&quot; deep</div>
                          <div>{pt.footprint_diameter_inches}&quot; dia</div>
                          <div>{pt.height_inches}&quot; tall</div>
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {expandedPlanterId === pt.id && (
                        <div className="border-t border-earth-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 space-y-3">
                          {expandPlanterLoading ? (
                            <p className="text-sm text-earth-400">Loading details...</p>
                          ) : expandedPlanterData ? (
                            <>
                              <div>
                                <h4 className="text-xs font-bold text-earth-600 dark:text-gray-300 uppercase tracking-wider mb-1">Watering System</h4>
                                <p className="text-xs text-earth-700 dark:text-gray-300">{expandedPlanterData.watering_system}</p>
                              </div>
                              {expandedPlanterData.desert_notes && (
                                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                  <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-1">Desert Notes</h4>
                                  <p className="text-xs text-amber-800 dark:text-amber-200">{expandedPlanterData.desert_notes}</p>
                                </div>
                              )}
                              {expandedPlanterData.recommended_plants && expandedPlanterData.recommended_plants.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-bold text-earth-600 dark:text-gray-300 uppercase tracking-wider mb-1">Recommended Plants</h4>
                                  <div className="flex flex-wrap gap-1">
                                    {expandedPlanterData.recommended_plants.map((p: string, i: number) => (
                                      <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">{p}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {expandedPlanterData.url && (
                                <a href={expandedPlanterData.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium">
                                  View on {expandedPlanterData.brand} website &rarr;
                                </a>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-earth-400">Failed to load details.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
