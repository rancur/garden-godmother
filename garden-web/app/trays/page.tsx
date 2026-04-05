'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { getTrays, createTray, updateTray, deleteTray, duplicateTray, getAreas, updateArea, deleteArea, reorderTrays, refillTrayReservoir } from '../api';
import { useToast } from '../toast';
import { useModal } from '../confirm-modal';
import type { Area } from '../types';

interface Tray {
  id: number;
  name: string;
  rows: number;
  cols: number;
  cell_size: string;
  location: string | null;
  notes: string | null;
  created_at: string;
  cell_counts: Record<string, number>;
  area_id: number | null;
  area_name: string | null;
  area_color: string | null;
  sort_order: number;
  watering_type: string | null;
  reservoir_capacity_ml: number | null;
  reservoir_last_refilled: string | null;
}

export default function TraysPage() {
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useModal();
  const [trays, setTrays] = useState<Tray[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', rows: 6, cols: 12, cell_size: 'standard', location: '', watering_type: 'top' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [editingArea, setEditingArea] = useState<number | null>(null);
  const [editAreaName, setEditAreaName] = useState('');
  const [dragItem, setDragItem] = useState<{ id: number; areaId: number | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ areaId: number | null; index: number } | null>(null);

  // Touch drag state
  const [touchDrag, setTouchDrag] = useState<{ id: number; areaId: number | null; startY: number; currentY: number; element: HTMLElement | null } | null>(null);
  const touchCloneRef = useRef<HTMLElement | null>(null);
  const cardRefsMap = useRef<Map<string, HTMLElement>>(new Map());

  const loadData = useCallback(() => {
    Promise.all([getTrays(), getAreas()])
      .then(([t, a]) => { setTrays(t); setAreas(a); })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  const [initialCollapseApplied, setInitialCollapseApplied] = useState(false);

  useEffect(() => { loadData(); }, [loadData]);

  // Collapse all areas by default on initial load
  useEffect(() => {
    if (!initialCollapseApplied && !loading && areas.length > 0) {
      const keys = new Set<string>();
      areas.forEach(a => keys.add(String(a.id)));
      const unassignedCount = trays.filter(t => t.area_id === null).length;
      if (unassignedCount === 0) keys.add('unassigned');
      setCollapsedAreas(keys);
      setInitialCollapseApplied(true);
    }
  }, [initialCollapseApplied, loading, areas, trays]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setSubmitting(true);
    try {
      await createTray({ name: formData.name, rows: formData.rows, cols: formData.cols, cell_size: formData.cell_size, location: formData.location || undefined, watering_type: formData.watering_type });
      setFormData({ name: '', rows: 6, cols: 12, cell_size: 'standard', location: '', watering_type: 'top' });
      setShowForm(false);
      loadData();
    } catch { setError('Failed to create tray'); }
    finally { setSubmitting(false); }
  };

  const handleDeleteTray = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!await showConfirm({ title: 'Delete Tray', message: 'Are you sure you want to delete this tray and all its cells?', confirmText: 'Delete', destructive: true })) return;
    try { await deleteTray(id); loadData(); toast('Tray deleted'); }
    catch { setError('Failed to delete tray'); }
  };

  const handleRenameTray = async (e: React.MouseEvent, tray: Tray) => {
    e.preventDefault();
    e.stopPropagation();
    const newName = await showPrompt({ title: 'Rename Tray', message: 'Enter a new name for this tray:', defaultValue: tray.name });
    if (newName && newName !== tray.name) {
      try { await updateTray(tray.id, { name: newName }); loadData(); toast('Tray renamed'); }
      catch { setError('Failed to rename tray'); }
    }
  };

  const handleDuplicateTray = async (e: React.MouseEvent, tray: Tray) => {
    e.preventDefault();
    e.stopPropagation();
    const newName = await showPrompt({ title: 'Duplicate Tray', message: 'Name for duplicated tray:', defaultValue: `${tray.name} (Copy)` });
    if (newName === null) return;
    const copyCells = await showConfirm({ title: 'Copy Plantings?', message: 'Copy cell plantings to the new tray?', confirmText: 'Copy Cells', cancelText: 'Empty Cells' });
    try { await duplicateTray(tray.id, { name: newName || undefined, copy_cells: copyCells }); loadData(); toast('Tray duplicated!'); }
    catch { setError('Failed to duplicate tray'); }
  };

  const handleRefillReservoir = async (e: React.MouseEvent, tray: Tray) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await refillTrayReservoir(tray.id);
      loadData();
      toast('Reservoir refilled!', 'success');
    } catch { setError('Failed to log reservoir refill'); }
  };

  const handleDeleteArea = async (areaId: number) => {
    if (!await showConfirm({ title: 'Delete Area', message: 'Delete this area? Trays will be moved to Unassigned.', confirmText: 'Delete', destructive: true })) return;
    try { await deleteArea(areaId); loadData(); toast('Area deleted'); }
    catch { setError('Failed to delete area'); }
  };

  const handleRenameArea = async (areaId: number) => {
    if (!editAreaName.trim()) { setEditingArea(null); return; }
    try { await updateArea(areaId, { name: editAreaName }); setEditingArea(null); loadData(); }
    catch { setError('Failed to rename area'); }
  };

  const handleAreaAssign = async (trayId: number, areaId: number | null) => {
    try { await updateTray(trayId, { area_id: areaId === null ? 0 : areaId }); loadData(); }
    catch { setError('Failed to assign area'); }
  };

  const toggleCollapse = (key: string) => {
    setCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Group trays by area
  const grouped: { areaId: number | null; area: Area | null; trays: Tray[] }[] = [];
  const traysByArea = new Map<number | null, Tray[]>();
  trays.forEach(t => {
    const key = t.area_id;
    if (!traysByArea.has(key)) traysByArea.set(key, []);
    traysByArea.get(key)!.push(t);
  });
  areas.forEach(a => { grouped.push({ areaId: a.id, area: a, trays: traysByArea.get(a.id) || [] }); });
  // Sort areas: ones with items first, empty ones last
  grouped.sort((a, b) => {
    const aCount = a.trays.length;
    const bCount = b.trays.length;
    if (aCount > 0 && bCount === 0) return -1;
    if (aCount === 0 && bCount > 0) return 1;
    return 0;
  });
  grouped.push({ areaId: null, area: null, trays: traysByArea.get(null) || [] });

  // Compute drop target from a Y coordinate (used by both mouse drag and touch drag)
  const computeDropTarget = useCallback((clientY: number, clientX: number): { areaId: number | null; index: number } | null => {
    let closest: { areaId: number | null; index: number; dist: number } | null = null;

    for (const group of grouped) {
      const areaTrays = group.trays;
      for (let i = 0; i < areaTrays.length; i++) {
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
      // Check empty areas
      if (areaTrays.length === 0) {
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
  const handleDragHandleMouseDown = (e: React.MouseEvent) => {
    const card = (e.currentTarget as HTMLElement).closest('[data-tray-card]') as HTMLElement;
    if (card) {
      card.setAttribute('draggable', 'true');
    }
  };

  const onDragStart = (e: React.DragEvent, tray: Tray) => {
    const target = e.target as HTMLElement;
    const card = target.closest('[data-tray-card]') as HTMLElement;
    if (!card || card.getAttribute('draggable') !== 'true') {
      e.preventDefault();
      return;
    }
    setDragItem({ id: tray.id, areaId: tray.area_id });
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: tray.id, type: 'tray' }));
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
    const card = target.closest('[data-tray-card]') as HTMLElement;
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

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const targetIndex = e.clientY < midY ? index : index + 1;
    setDropTarget({ areaId, index: targetIndex });
  };

  const onDragOverArea = (e: React.DragEvent, areaId: number | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dropTarget || dropTarget.areaId !== areaId) {
      const areaTrays = traysByArea.get(areaId) || [];
      setDropTarget({ areaId, index: areaTrays.length });
    }
  };

  const executeReorder = async (draggedId: number, draggedAreaId: number | null, targetAreaId: number | null, targetIndex: number) => {
    const sourceTrays = [...(traysByArea.get(draggedAreaId) || [])];
    const targetTrays = draggedAreaId === targetAreaId ? sourceTrays : [...(traysByArea.get(targetAreaId) || [])];

    const dragIdx = sourceTrays.findIndex(t => t.id === draggedId);
    if (dragIdx === -1) return;
    const [moved] = sourceTrays.splice(dragIdx, 1);

    let insertIdx = targetIndex;
    if (draggedAreaId === targetAreaId && dragIdx < targetIndex) {
      insertIdx = Math.max(0, targetIndex - 1);
    }

    if (draggedAreaId === targetAreaId) {
      sourceTrays.splice(insertIdx, 0, moved);
      const orders = sourceTrays.map((t, i) => ({ id: t.id, sort_order: i, area_id: targetAreaId ?? 0 }));
      try { await reorderTrays(orders); loadData(); } catch { setError('Failed to reorder'); }
    } else {
      targetTrays.splice(insertIdx, 0, moved);
      const orders = [
        ...sourceTrays.map((t, i) => ({ id: t.id, sort_order: i })),
        ...targetTrays.map((t, i) => ({ id: t.id, sort_order: i, area_id: targetAreaId ?? 0 })),
      ];
      try { await reorderTrays(orders); loadData(); } catch { setError('Failed to reorder'); }
    }
  };

  const onDrop = async (e: React.DragEvent, targetAreaId: number | null, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragItem) return;

    const finalIndex = dropTarget && dropTarget.areaId === targetAreaId ? dropTarget.index : targetIndex;
    await executeReorder(dragItem.id, dragItem.areaId, targetAreaId, finalIndex);

    setDragItem(null);
    setDropTarget(null);
  };

  // Touch drag handlers
  const onTouchStart = (e: React.TouchEvent, tray: Tray) => {
    const touch = e.touches[0];
    const card = (e.currentTarget as HTMLElement).closest('[data-tray-card]') as HTMLElement;
    setTouchDrag({ id: tray.id, areaId: tray.area_id, startY: touch.clientY, currentY: touch.clientY, element: card });

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

    if (touchCloneRef.current) {
      touchCloneRef.current.style.top = `${touch.clientY - 30}px`;
    }

    const target = computeDropTarget(touch.clientY, touch.clientX);
    if (target) {
      setDropTarget(target);
    }

    setTouchDrag(prev => prev ? { ...prev, currentY: touch.clientY } : null);
  }, [touchDrag, computeDropTarget]);

  const onTouchEnd = useCallback(async () => {
    if (!touchDrag) return;

    if (touchCloneRef.current) {
      document.body.removeChild(touchCloneRef.current);
      touchCloneRef.current = null;
    }
    if (touchDrag.element) {
      touchDrag.element.style.opacity = '1';
    }

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

  const getReservoirDaysAgo = (tray: Tray): number | null => {
    if (!tray.reservoir_last_refilled) return null;
    try {
      const dt = new Date(tray.reservoir_last_refilled);
      return Math.floor((Date.now() - dt.getTime()) / 86400000);
    } catch { return null; }
  };

  const renderTrayCard = (tray: Tray, areaId: number | null, index: number) => {
    const seeded = tray.cell_counts?.seeded || 0;
    const germinated = tray.cell_counts?.germinated || 0;
    const ready = tray.cell_counts?.ready_to_transplant || 0;
    const transplanted = tray.cell_counts?.transplanted || 0;
    const failed = tray.cell_counts?.failed || 0;
    const total = tray.rows * tray.cols;
    const isBottomWatering = tray.watering_type === 'bottom' || tray.watering_type === 'self_watering';
    const reservoirDaysAgo = getReservoirDaysAgo(tray);
    const isDropBefore = dropTarget && dropTarget.areaId === areaId && dropTarget.index === index;
    const isDropAfter = dropTarget && dropTarget.areaId === areaId && dropTarget.index === index + 1;
    const isDragging = (dragItem?.id === tray.id) || (touchDrag?.id === tray.id);

    return (
      <div key={tray.id} ref={(el) => registerCardRef(areaId, index, el)}>
        {isDropBefore && <div className="h-1 bg-blue-500 rounded-full mx-2 my-1 transition-all animate-pulse" />}
        <div
          data-tray-card
          onDragStart={(e) => onDragStart(e, tray)}
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
            onMouseDown={(e) => handleDragHandleMouseDown(e)}
            onTouchStart={(e) => onTouchStart(e, tray)}
            onTouchMove={(e) => onTouchMove(e)}
            onTouchEnd={() => onTouchEnd()}
          >
            <span className="text-sm leading-none tracking-widest" style={{ letterSpacing: '2px' }}>&#8942;&#8942;</span>
          </div>
          <Link href={`/trays/${tray.id}`} className="flex-1 p-5 min-w-0">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100 group-hover:text-garden-700 dark:group-hover:text-garden-400 transition-colors truncate">
                  {tray.name}
                </h3>
                {tray.location && <p className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">{tray.location}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button onClick={(e) => handleRenameTray(e, tray)} className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded transition-colors" title="Rename">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
                <button onClick={(e) => handleDuplicateTray(e, tray)} className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded transition-colors" title="Duplicate">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
                <button onClick={(e) => handleDeleteTray(e, tray.id)} className="text-earth-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-1 rounded transition-colors" title="Delete">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4 text-sm text-earth-500 dark:text-gray-400">
              <span>{tray.rows}x{tray.cols} ({total} cells)</span>
              {seeded > 0 && <span className="text-blue-600">Seeded: {seeded}</span>}
              {germinated > 0 && <span className="text-green-600">Germ: {germinated}</span>}
              {ready > 0 && <span className="text-yellow-600">Ready: {ready}</span>}
              {transplanted > 0 && <span className="text-purple-600">Trans: {transplanted}</span>}
              {failed > 0 && <span className="text-red-600">Failed: {failed}</span>}
            </div>
            {/* Mini tray preview */}
            <div className="mt-3 flex gap-0.5 flex-wrap" style={{ maxWidth: `${Math.min(tray.cols * 12, 200)}px` }}>
              {Array.from({ length: Math.min(total, 48) }).map((_, i) => (
                <div key={i} className={`w-2.5 h-2.5 rounded-sm border border-earth-200 ${i < seeded ? 'bg-blue-300' : i < seeded + germinated ? 'bg-green-300' : i < seeded + germinated + ready ? 'bg-yellow-300' : 'bg-earth-100'}`} />
              ))}
              {total > 48 && <span className="text-xs text-earth-300 ml-1">...</span>}
            </div>
            {/* Bottom-watering reservoir info */}
            {isBottomWatering && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">
                  {tray.watering_type === 'self_watering' ? 'Self-watering' : 'Bottom watering'}
                </span>
                {reservoirDaysAgo !== null ? (
                  <span className={`text-xs ${reservoirDaysAgo >= 7 ? 'text-orange-600 dark:text-orange-400 font-semibold' : 'text-earth-400 dark:text-gray-500'}`}>
                    Last refilled: {reservoirDaysAgo === 0 ? 'today' : `${reservoirDaysAgo}d ago`}
                  </span>
                ) : (
                  <span className="text-xs text-earth-400 dark:text-gray-500">Reservoir: never refilled</span>
                )}
              </div>
            )}
            {/* Area assigned via drag-and-drop between sections */}
          </Link>
          {/* Reservoir refill button — outside Link to avoid navigation */}
          {isBottomWatering && (
            <div className="flex items-center pr-3">
              <button
                onClick={(e) => handleRefillReservoir(e, tray)}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700 font-medium transition-colors whitespace-nowrap"
                title="Log reservoir refill"
              >
                <span>&#128167;</span> Refill Reservoir
              </button>
            </div>
          )}
        </div>
        {/* Show drop-after indicator for last item only */}
        {isDropAfter && index === (traysByArea.get(areaId) || []).length - 1 && (
          <div className="h-1 bg-blue-500 rounded-full mx-2 my-1 transition-all animate-pulse" />
        )}
      </div>
    );
  };

  const renderAreaSection = (group: { areaId: number | null; area: Area | null; trays: Tray[] }) => {
    const key = group.areaId !== null ? String(group.areaId) : 'unassigned';
    const isCollapsed = collapsedAreas.has(key);
    const color = group.area?.color || '#9ca3af';
    const isUnassigned = group.areaId === null;
    const count = group.trays.length;

    if (isUnassigned && count === 0 && areas.length > 0) return null;

    const isAreaDropTarget = dropTarget && dropTarget.areaId === group.areaId;

    return (
      <div
        key={key}
        className={`space-y-2 rounded-lg transition-colors ${isAreaDropTarget && !isCollapsed ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''} ${count === 0 && !isUnassigned ? 'opacity-50' : ''}`}
        ref={(el) => registerAreaRef(group.areaId, el)}
        onDragOver={(e) => onDragOverArea(e, group.areaId)}
        onDrop={(e) => onDrop(e, group.areaId, group.trays.length)}
      >
        <div className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-earth-50 dark:hover:bg-gray-800 transition-colors" onClick={() => toggleCollapse(key)}>
          <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <button className="text-earth-400 dark:text-gray-500 transition-transform shrink-0" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {editingArea === group.areaId ? (
            <input autoFocus value={editAreaName} onChange={(e) => setEditAreaName(e.target.value)}
              onBlur={() => group.areaId !== null && handleRenameArea(group.areaId)}
              onKeyDown={(e) => { if (e.key === 'Enter' && group.areaId !== null) handleRenameArea(group.areaId); if (e.key === 'Escape') setEditingArea(null); }}
              onClick={(e) => e.stopPropagation()}
              className="text-lg font-bold text-earth-800 dark:text-gray-100 bg-transparent border-b-2 border-garden-500 outline-none px-1"
            />
          ) : (
            <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">{isUnassigned ? 'Unassigned' : group.area!.name}</h2>
          )}
          <span className="text-sm text-earth-400 dark:text-gray-500">{count} tray{count !== 1 ? 's' : ''}</span>
          {!isUnassigned && (
            <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setEditingArea(group.areaId); setEditAreaName(group.area!.name); }} className="text-earth-400 hover:text-garden-600 dark:text-gray-500 dark:hover:text-garden-400 p-1 rounded transition-colors" title="Rename area">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
              <button onClick={() => handleDeleteArea(group.areaId!)} className="text-earth-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-1 rounded transition-colors" title="Delete area">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <div className="space-y-2 pl-4">
            {group.trays.length === 0 ? (
              <div
                className={`text-sm text-earth-400 dark:text-gray-500 py-4 text-center border-2 border-dashed rounded-lg transition-colors ${
                  isAreaDropTarget ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600' : 'border-earth-200 dark:border-gray-700'
                }`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget({ areaId: group.areaId, index: 0 }); }}
                onDrop={(e) => onDrop(e, group.areaId, 0)}
              >
                Drag trays here
              </div>
            ) : (
              group.trays.map((tray, i) => renderTrayCard(tray, group.areaId, i))
            )}
            {dropTarget && dropTarget.areaId === group.areaId && dropTarget.index === group.trays.length && group.trays.length > 0 && (
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
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">Seed Trays</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">Manage your seed starting trays and track germination</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowForm(!showForm); }}
            className="bg-garden-600 hover:bg-garden-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
          >
            {showForm ? 'Cancel' : '+ New Tray'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {/* Create tray form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">Create New Seed Tray</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Tray Name</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Spring Tomato Starts"
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Rows</label>
              <input type="number" min={1} max={20} value={formData.rows} onChange={(e) => setFormData({ ...formData, rows: parseInt(e.target.value) || 1 })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Columns</label>
              <input type="number" min={1} max={20} value={formData.cols} onChange={(e) => setFormData({ ...formData, cols: parseInt(e.target.value) || 1 })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Cell Size</label>
              <select value={formData.cell_size} onChange={(e) => setFormData({ ...formData, cell_size: e.target.value })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                <option value="small">Small (72-cell)</option>
                <option value="standard">Standard (50-cell)</option>
                <option value="large">Large (36-cell)</option>
                <option value="xl">Extra Large (18-cell)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Location</label>
              <input type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} placeholder="e.g., South window, grow tent"
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Watering Type</label>
              <select value={formData.watering_type} onChange={(e) => setFormData({ ...formData, watering_type: e.target.value })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                <option value="top">Top watering</option>
                <option value="bottom">Bottom watering (reservoir)</option>
                <option value="self_watering">Self-watering / wicking</option>
              </select>
            </div>
          </div>
          <p className="text-sm text-earth-400">This creates a {formData.rows} x {formData.cols} tray ({formData.rows * formData.cols} cells).</p>
          <button type="submit" disabled={submitting} className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
            {submitting ? 'Creating...' : 'Create Tray'}
          </button>
        </form>
      )}

      {/* Trays list grouped by area */}
      {loading ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading trays...</div>
      ) : trays.length === 0 && areas.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🌱</div>
          <h2 className="text-xl font-bold text-earth-700 dark:text-gray-200 mb-2">No seed trays yet</h2>
          <p className="text-earth-400 dark:text-gray-500">Create your first seed tray to start tracking germination!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(g => renderAreaSection(g))}
        </div>
      )}
    </div>
  );
}
