'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { getPlantIcon } from '../plant-icons';
import { updatePlantingPosition, checkCompanion } from '../api';
import type { Planting } from '../types';

/** Category fill colors for SVG circles */
const categoryFill: Record<string, string> = {
  vegetable: 'rgba(34, 197, 94, 0.25)',
  herb: 'rgba(168, 85, 247, 0.25)',
  flower: 'rgba(234, 179, 8, 0.25)',
  fruit: 'rgba(239, 68, 68, 0.25)',
};

const categoryStroke: Record<string, string> = {
  vegetable: '#22c55e',
  herb: '#a855f7',
  flower: '#eab308',
  fruit: '#ef4444',
};

interface FreeformPlanting extends Omit<Planting, 'companions'> {
  spacing_inches?: number;
  companions?: string[];
  antagonists?: string[];
}

interface BedData {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  bed_type?: string;
  physical_width_inches?: number | null;
  physical_length_inches?: number | null;
}

interface Props {
  bed: BedData;
  plantings: FreeformPlanting[];
  onPlantingClick: (planting: FreeformPlanting) => void;
  onEmptyClick: (xInches: number, yInches: number) => void;
  onRefresh: () => void;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type OverlapRelation = 'warning' | 'companion' | 'antagonist';

interface OverlapInfo {
  plantingId: number;
  relation: OverlapRelation;
}

export default function FreeformPlanterView({ bed, plantings, onPlantingClick, onEmptyClick, onRefresh, toast }: Props) {
  // Physical dimensions in inches
  const physWidth = bed.physical_width_inches || bed.width_cells * bed.cell_size_inches;
  const physHeight = bed.physical_length_inches || bed.height_cells * bed.cell_size_inches;

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Drag state
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ id: number; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Overlap cache (computed per render)
  const [overlapMap, setOverlapMap] = useState<Record<number, OverlapInfo[]>>({});

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute scale: map physWidth -> containerWidth, keeping aspect ratio
  const padding = 16;
  const availableWidth = containerWidth - padding * 2;
  const scale = availableWidth / physWidth;
  const svgWidth = containerWidth;
  const svgHeight = physHeight * scale + padding * 2;

  // Convert inches to SVG coords
  const toSvg = useCallback((xInches: number, yInches: number) => ({
    x: xInches * scale + padding,
    y: yInches * scale + padding,
  }), [scale]);

  // Convert SVG coords to inches
  const toInches = useCallback((svgX: number, svgY: number) => ({
    x: (svgX - padding) / scale,
    y: (svgY - padding) / scale,
  }), [scale]);

  // Compute overlaps between all plantings
  useEffect(() => {
    const map: Record<number, OverlapInfo[]> = {};
    for (let i = 0; i < plantings.length; i++) {
      const a = plantings[i];
      if (a.position_x_inches == null || a.position_y_inches == null) continue;
      const aRadius = (a.spacing_inches || 12) / 2;

      for (let j = i + 1; j < plantings.length; j++) {
        const b = plantings[j];
        if (b.position_x_inches == null || b.position_y_inches == null) continue;
        const bRadius = (b.spacing_inches || 12) / 2;

        const dx = a.position_x_inches - b.position_x_inches;
        const dy = a.position_y_inches - b.position_y_inches;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = aRadius + bRadius;

        if (dist < minDist) {
          // Overlapping - determine relationship
          const aCompanions = a.companions || [];
          const aAntagonists = a.antagonists || [];

          let relation: OverlapRelation = 'warning';
          if (aAntagonists.includes(b.plant_name) || (b.antagonists || []).includes(a.plant_name)) {
            relation = 'antagonist';
          } else if (aCompanions.includes(b.plant_name) || (b.companions || []).includes(a.plant_name)) {
            relation = 'companion';
          }

          if (!map[a.planting_id ?? a.id]) map[a.planting_id ?? a.id] = [];
          if (!map[b.planting_id ?? b.id]) map[b.planting_id ?? b.id] = [];
          map[a.planting_id ?? a.id].push({ plantingId: b.planting_id ?? b.id, relation });
          map[b.planting_id ?? b.id].push({ plantingId: a.planting_id ?? a.id, relation });
        }
      }
    }
    setOverlapMap(map);
  }, [plantings]);

  const getOverlapColor = (plantingId: number): string | null => {
    const overlaps = overlapMap[plantingId];
    if (!overlaps || overlaps.length === 0) return null;
    // Priority: antagonist > warning > companion
    if (overlaps.some(o => o.relation === 'antagonist')) return 'rgba(239, 68, 68, 0.35)';
    if (overlaps.some(o => o.relation === 'warning')) return 'rgba(249, 115, 22, 0.3)';
    return 'rgba(34, 197, 94, 0.3)';
  };

  const getOverlapStroke = (plantingId: number): string | null => {
    const overlaps = overlapMap[plantingId];
    if (!overlaps || overlaps.length === 0) return null;
    if (overlaps.some(o => o.relation === 'antagonist')) return '#ef4444';
    if (overlaps.some(o => o.relation === 'warning')) return '#f97316';
    return '#22c55e';
  };

  // Handle drag start
  const handlePointerDown = (e: React.PointerEvent, planting: FreeformPlanting) => {
    e.stopPropagation();
    e.preventDefault();
    const svg = (e.target as SVGElement).closest('svg');
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());

    const pid = planting.planting_id ?? planting.id;
    dragStartRef.current = {
      id: pid,
      startX: svgPt.x,
      startY: svgPt.y,
      origX: planting.position_x_inches ?? 0,
      origY: planting.position_y_inches ?? 0,
    };
    setDragging(pid);
    setDragPos({ x: planting.position_x_inches ?? 0, y: planting.position_y_inches ?? 0 });
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const svg = (e.target as SVGElement).closest('svg');
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());

    const dx = (svgPt.x - dragStartRef.current.startX) / scale;
    const dy = (svgPt.y - dragStartRef.current.startY) / scale;

    const newX = Math.max(0, Math.min(physWidth, dragStartRef.current.origX + dx));
    const newY = Math.max(0, Math.min(physHeight, dragStartRef.current.origY + dy));
    setDragPos({ x: newX, y: newY });
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    if (!dragStartRef.current || !dragPos) {
      dragStartRef.current = null;
      setDragging(null);
      setDragPos(null);
      return;
    }

    const dx = Math.abs(dragPos.x - dragStartRef.current.origX);
    const dy = Math.abs(dragPos.y - dragStartRef.current.origY);

    // If barely moved, treat as a click
    if (dx < 1 && dy < 1) {
      const pid = dragStartRef.current.id;
      const clicked = plantings.find(p => (p.planting_id ?? p.id) === pid);
      dragStartRef.current = null;
      setDragging(null);
      setDragPos(null);
      if (clicked) onPlantingClick(clicked);
      return;
    }

    // Save position
    const pid = dragStartRef.current.id;
    const x = Math.round(dragPos.x * 10) / 10;
    const y = Math.round(dragPos.y * 10) / 10;
    dragStartRef.current = null;
    setDragging(null);
    setDragPos(null);

    try {
      await updatePlantingPosition(pid, x, y);
      onRefresh();
    } catch {
      toast('Failed to save position', 'error');
    }
  };

  // Handle tap on empty area
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // Only respond to direct clicks on the SVG background (not on plant circles)
    if ((e.target as SVGElement).tagName !== 'svg' && (e.target as SVGElement).tagName !== 'rect') return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const inches = toInches(svgPt.x, svgPt.y);
    // Clamp to bed boundaries
    const x = Math.max(0, Math.min(physWidth, Math.round(inches.x * 10) / 10));
    const y = Math.max(0, Math.min(physHeight, Math.round(inches.y * 10) / 10));
    onEmptyClick(x, y);
  };

  return (
    <div ref={containerRef} className="w-full">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-earth-500 dark:text-gray-400 mb-3 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-green-500/30 border border-green-500 inline-block" /> Companion overlap
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-orange-500/30 border border-orange-500 inline-block" /> Spacing warning
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-red-500/30 border border-red-500 inline-block" /> Antagonist overlap
        </span>
        <span className="text-earth-400 dark:text-gray-500">
          {Math.round(physWidth)}&quot; x {Math.round(physHeight)}&quot;
        </span>
      </div>

      <svg
        width={svgWidth}
        height={svgHeight}
        className="touch-none select-none"
        onClick={handleSvgClick}
        style={{ cursor: 'crosshair' }}
      >
        {/* Bed background */}
        <rect
          x={padding}
          y={padding}
          width={physWidth * scale}
          height={physHeight * scale}
          rx={8}
          ry={8}
          className="fill-amber-50 dark:fill-amber-900/20 stroke-amber-300 dark:stroke-amber-700"
          strokeWidth={2}
        />

        {/* Grid lines (every 6 inches) */}
        {Array.from({ length: Math.floor(physWidth / 6) }).map((_, i) => {
          const x = (i + 1) * 6 * scale + padding;
          return (
            <line key={`vg-${i}`} x1={x} y1={padding} x2={x} y2={physHeight * scale + padding}
              className="stroke-amber-200/40 dark:stroke-amber-800/30" strokeWidth={0.5} />
          );
        })}
        {Array.from({ length: Math.floor(physHeight / 6) }).map((_, i) => {
          const y = (i + 1) * 6 * scale + padding;
          return (
            <line key={`hg-${i}`} x1={padding} y1={y} x2={physWidth * scale + padding} y2={y}
              className="stroke-amber-200/40 dark:stroke-amber-800/30" strokeWidth={0.5} />
          );
        })}

        {/* Ruler marks along top edge (every 12 inches) */}
        {Array.from({ length: Math.floor(physWidth / 12) + 1 }).map((_, i) => {
          const x = i * 12 * scale + padding;
          return (
            <g key={`rt-${i}`}>
              <line x1={x} y1={padding - 6} x2={x} y2={padding}
                className="stroke-amber-400 dark:stroke-amber-600" strokeWidth={1} />
              <text x={x} y={padding - 8} textAnchor="middle"
                className="fill-amber-500 dark:fill-amber-400" fontSize={9}>
                {i * 12}&quot;
              </text>
            </g>
          );
        })}

        {/* Ruler marks along left edge (every 12 inches) */}
        {Array.from({ length: Math.floor(physHeight / 12) + 1 }).map((_, i) => {
          const y = i * 12 * scale + padding;
          return (
            <g key={`rl-${i}`}>
              <line x1={padding - 6} y1={y} x2={padding} y2={y}
                className="stroke-amber-400 dark:stroke-amber-600" strokeWidth={1} />
              <text x={padding - 8} y={y + 3} textAnchor="end"
                className="fill-amber-500 dark:fill-amber-400" fontSize={9}>
                {i * 12}&quot;
              </text>
            </g>
          );
        })}

        {/* Plant spacing zones (rendered behind plant icons) */}
        {plantings.map((p) => {
          const pid = p.planting_id ?? p.id;
          const posX = dragging === pid && dragPos ? dragPos.x : (p.position_x_inches ?? 0);
          const posY = dragging === pid && dragPos ? dragPos.y : (p.position_y_inches ?? 0);
          const radius = ((p.spacing_inches || 12) / 2) * scale;
          const svgPos = toSvg(posX, posY);
          const overlapFill = getOverlapColor(pid);
          const overlapStk = getOverlapStroke(pid);

          return (
            <circle
              key={`zone-${pid}`}
              cx={svgPos.x}
              cy={svgPos.y}
              r={radius}
              fill={overlapFill || categoryFill[p.category] || 'rgba(156, 163, 175, 0.2)'}
              stroke={overlapStk || categoryStroke[p.category] || '#9ca3af'}
              strokeWidth={overlapStk ? 2 : 1}
              strokeDasharray={overlapStk ? undefined : '4 2'}
              opacity={dragging === pid ? 0.5 : 0.8}
            />
          );
        })}

        {/* Plant circles and labels */}
        {plantings.map((p) => {
          const pid = p.planting_id ?? p.id;
          const posX = dragging === pid && dragPos ? dragPos.x : (p.position_x_inches ?? 0);
          const posY = dragging === pid && dragPos ? dragPos.y : (p.position_y_inches ?? 0);
          const svgPos = toSvg(posX, posY);
          const iconRadius = Math.max(14, Math.min(24, ((p.spacing_inches || 12) / 2) * scale * 0.5));

          return (
            <g
              key={`plant-${pid}`}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => handlePointerDown(e, p)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {/* Solid plant circle */}
              <circle
                cx={svgPos.x}
                cy={svgPos.y}
                r={iconRadius}
                fill={categoryFill[p.category]?.replace('0.25', '0.7') || 'rgba(156, 163, 175, 0.7)'}
                stroke={categoryStroke[p.category] || '#9ca3af'}
                strokeWidth={dragging === pid ? 2.5 : 1.5}
                className="transition-all"
              />
              {/* Plant emoji */}
              <text
                x={svgPos.x}
                y={svgPos.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(12, iconRadius * 0.9)}
                style={{ pointerEvents: 'none' }}
              >
                {getPlantIcon(p.plant_name, p.category)}
              </text>
              {/* Name label */}
              <text
                x={svgPos.x}
                y={svgPos.y + iconRadius + 12}
                textAnchor="middle"
                className="fill-earth-700 dark:fill-gray-300"
                fontSize={10}
                fontWeight={500}
                style={{ pointerEvents: 'none' }}
              >
                {p.plant_name}
              </text>
              {/* Spacing label */}
              <text
                x={svgPos.x}
                y={svgPos.y + iconRadius + 23}
                textAnchor="middle"
                className="fill-earth-400 dark:fill-gray-500"
                fontSize={8}
                style={{ pointerEvents: 'none' }}
              >
                {p.spacing_inches || 12}&quot; spacing
              </text>
            </g>
          );
        })}

        {/* Empty state */}
        {plantings.length === 0 && (
          <text
            x={svgWidth / 2}
            y={svgHeight / 2}
            textAnchor="middle"
            className="fill-earth-400 dark:fill-gray-500"
            fontSize={14}
          >
            Tap anywhere to place a plant
          </text>
        )}
      </svg>
    </div>
  );
}
