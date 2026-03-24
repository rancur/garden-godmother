'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  getBeds,
  getBedGrid,
  getProperty,
  updateProperty,
  getZones,
  createZone,
  updateZone,
  deleteZone,
  getBedPositions,
  setBedPosition,
  deleteBedPosition,
  getSunPosition,
  getSunDaily,
  getSunShadows,
  getGroundPlants,
  updateGroundPlant,
  deleteGroundPlant,
  getAreas,
  updateArea,
  getSoilForPlant,
} from '../api';
import Link from 'next/link';
import { getPlantIcon } from '../plant-icons';
import { useToast } from '../toast';
import { useModal } from '../confirm-modal';
import { getGardenToday } from '../timezone';

// ─── Types ───

interface Bed {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
}

interface Planting {
  id: number;
  plant_id: number;
  plant_name: string;
  category: string;
  status: string;
  cell_x: number;
  cell_y: number;
}

interface BedGrid {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  grid: (Planting | null)[][];
}

interface Property {
  id: number;
  name: string;
  width_feet: number;
  height_feet: number;
  orientation_degrees: number;
  latitude: number;
  longitude: number;
  address: string;
  default_soil_type?: string;
  default_soil_ph?: number;
  default_soil_notes?: string;
}

interface Zone {
  id: number;
  property_id: number;
  name: string;
  zone_type: string;
  x_feet: number;
  y_feet: number;
  width_feet: number;
  height_feet: number;
  color: string | null;
  notes: string | null;
  rotation_degrees: number;
  polygon_points: string | null;
  is_cutout: number;
  parent_zone_id: number | null;
  soil_type: string | null;
  soil_ph_min: number | null;
  soil_ph_max: number | null;
  soil_amendments: string | null;
  soil_notes: string | null;
  height_ft: number | null;
}

const SOIL_TYPE_LABELS: Record<string, string> = {
  'native-clay': 'Native Clay/Caliche',
  'native-amended': 'Native Amended',
  'raised-bed-mix': 'Raised Bed Mix',
  'potting-soil': 'Potting Soil',
  'sandy': 'Sandy',
  'loamy': 'Loam',
  'custom': 'Custom Mix',
};

interface BedPosition {
  id: number;
  bed_id: number;
  zone_id: number | null;
  x_feet: number;
  y_feet: number;
  rotation_degrees: number;
  bed_name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  bed_type?: string;
  physical_width_inches?: number | null;
  physical_length_inches?: number | null;
}

interface GroundPlantMapItem {
  id: number;
  name: string | null;
  plant_name: string;
  plant_category: string;
  x_feet: number | null;
  y_feet: number | null;
  status: string;
  area_id: number | null;
  area_name: string | null;
  irrigation_zone_name: string | null;
  zone_name: string | null;
  zone_id: number | null;
}

interface Area {
  id: number;
  name: string;
  area_type: string;
  sort_order: number;
  color: string | null;
  map_x_feet: number | null;
  map_y_feet: number | null;
  map_width_feet: number | null;
  map_height_feet: number | null;
  map_polygon_points: string | null;
}

interface PolygonPoint {
  x: number;
  y: number;
}

interface SunPosition {
  altitude: number;
  azimuth: number;
  sunrise: string;
  sunset: string;
  daylight_hours: number;
}

interface ShadeSource {
  type: string;
  name: string;
  shaded_hours: number;
  time_range: string;
}

interface BedSunData {
  bed_id: number;
  bed_name: string;
  sun_hours: number;
  morning_sun_hours: number;
  afternoon_sun_hours: number;
  sun_quality: string;
  best_plants: string[];
  shade_sources: ShadeSource[];
}

interface ShadowPolygon {
  source_type: string;
  source_name: string;
  source_id: number;
  height_ft: number;
  polygon: { x: number; y: number }[];
}

// ─── Constants ───

const ZONE_COLORS: Record<string, { bg: string; border: string; label: string; hex?: string }> = {
  house:        { bg: 'bg-gray-300 dark:bg-gray-600',      border: 'border-gray-500',   label: 'House' },
  garden:       { bg: 'bg-green-200 dark:bg-green-900',     border: 'border-green-500',  label: 'Garden' },
  patio:        { bg: 'bg-amber-200 dark:bg-amber-900',     border: 'border-amber-500',  label: 'Patio' },
  lawn:         { bg: 'bg-lime-200 dark:bg-lime-900',       border: 'border-lime-500',   label: 'Lawn' },
  driveway:     { bg: 'bg-stone-400 dark:bg-stone-700',     border: 'border-stone-600',  label: 'Driveway' },
  walkway:      { bg: 'bg-orange-200 dark:bg-orange-900',   border: 'border-orange-400', label: 'Walkway' },
  fence:        { bg: 'bg-yellow-800 dark:bg-yellow-900',   border: 'border-yellow-900', label: 'Fence' },
  mulch:        { bg: '',                                    border: '',                  label: 'Mulch',   hex: '#8B4513' },
  turf:         { bg: '',                                    border: '',                  label: 'Turf',    hex: '#22c55e' },
  planter_area: { bg: '',                                    border: '',                  label: 'Planter Area', hex: '#40916c' },
  other:        { bg: 'bg-slate-300 dark:bg-slate-700',     border: 'border-slate-500',  label: 'Other' },
};

// Hex colors for SVG polygon rendering
const ZONE_HEX_COLORS: Record<string, string> = {
  house: '#9CA3AF', garden: '#86EFAC', patio: '#FCD34D', lawn: '#BEF264',
  driveway: '#A8A29E', walkway: '#FDBA74', fence: '#854D0E',
  mulch: '#8B4513', turf: '#22c55e', planter_area: '#40916c', other: '#94A3B8',
};

type DrawingMode = 'rectangle' | 'polygon' | 'cut';

const categoryColor: Record<string, string> = {
  vegetable: 'bg-green-300',
  herb: 'bg-purple-300',
  flower: 'bg-yellow-300',
  fruit: 'bg-red-300',
};

const categoryBorder: Record<string, string> = {
  vegetable: 'border-green-500',
  herb: 'border-purple-500',
  flower: 'border-yellow-500',
  fruit: 'border-red-500',
};

const SUN_QUALITY_COLORS: Record<string, string> = {
  'full sun': 'rgba(250, 204, 21, 0.45)',
  'partial sun': 'rgba(250, 204, 21, 0.25)',
  'shade': 'rgba(100, 116, 139, 0.35)',
};

// ─── Component ───

export default function PropertyLayoutPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { showConfirm } = useModal();

  // Core state
  const [property, setProperty] = useState<Property | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [grids, setGrids] = useState<Record<number, BedGrid>>({});
  const [bedPositions, setBedPositions] = useState<BedPosition[]>([]);
  const [groundPlants, setGroundPlants] = useState<GroundPlantMapItem[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [zoom, setZoom] = useState(8); // px per foot
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Selection / editing
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [selectedBedPos, setSelectedBedPos] = useState<number | null>(null); // bed_id
  const [showSettings, setShowSettings] = useState(false);
  const [addingZoneType, setAddingZoneType] = useState<string | null>(null);

  // Drawing mode
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('rectangle');

  // Zone drawing (rectangle)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Polygon drawing
  const [polygonPoints, setPolygonPoints] = useState<PolygonPoint[]>([]);
  const [polygonCursor, setPolygonCursor] = useState<PolygonPoint | null>(null);

  // Cut mode parent zone
  const [cutParentZone, setCutParentZone] = useState<number | null>(null);

  // Polygon point editing
  const [editingPolygonPointIndex, setEditingPolygonPointIndex] = useState<number | null>(null);
  const polygonEditDragStart = useRef<{ x: number; y: number } | null>(null);

  // Zone drag
  const [draggingZone, setDraggingZone] = useState<number | null>(null);
  const zoneDragOffset = useRef({ x: 0, y: 0 });

  // Bed drag (from sidebar or repositioning)
  const [draggingBed, setDraggingBed] = useState<number | null>(null);
  const bedDragOffset = useRef({ x: 0, y: 0 });
  const [draggingBedFromSidebar, setDraggingBedFromSidebar] = useState<number | null>(null);
  const [sidebarDragPos, setSidebarDragPos] = useState<{ x: number; y: number } | null>(null);

  // Zone rename
  const [renamingZone, setRenamingZone] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Ground plant drag
  const [draggingGroundPlant, setDraggingGroundPlant] = useState<number | null>(null);
  const groundPlantDragOffset = useRef({ x: 0, y: 0 });

  // Ground plant drag from sidebar (like beds)
  const [draggingGPFromSidebar, setDraggingGPFromSidebar] = useState<number | null>(null);
  const [sidebarGPDragPos, setSidebarGPDragPos] = useState<{ x: number; y: number } | null>(null);

  // Ground plant click-to-place mode
  const [placingGroundPlant, setPlacingGroundPlant] = useState<number | null>(null);

  // View/Edit mode
  const [editMode, setEditMode] = useState(false);

  // Multi-select
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Set-size inline form
  const [sizeFormZone, setSizeFormZone] = useState<number | null>(null);
  const [sizeFormWidth, setSizeFormWidth] = useState('');
  const [sizeFormHeight, setSizeFormHeight] = useState('');
  const [sizeFormHeightFt, setSizeFormHeightFt] = useState('');

  // View mode info tooltip
  const [viewTooltip, setViewTooltip] = useState<{ x: number; y: number; type: string; data: Record<string, string>; link?: string } | null>(null);

  // Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [onCanvasCollapsed, setOnCanvasCollapsed] = useState(true);

  // Ground plant selection / popup
  const [selectedGroundPlant, setSelectedGroundPlant] = useState<number | null>(null);

  // Sun overlay
  const [showSun, setShowSun] = useState(false);
  const [sunTime, setSunTime] = useState(12); // hour (0-24)
  const [sunPosition, setSunPosition] = useState<SunPosition | null>(null);
  const [sunDailyData, setSunDailyData] = useState<BedSunData[]>([]);
  const [shadowPolygons, setShadowPolygons] = useState<ShadowPolygon[]>([]);
  const [hoveredBedSun, setHoveredBedSun] = useState<number | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [autoFitDone, setAutoFitDone] = useState(false);

  // ─── Escape key to cancel zone drawing ───

  // Store selectedZone in a ref so keyboard handler always has current value
  const selectedZoneRef = useRef<number | null>(null);
  selectedZoneRef.current = selectedZone;
  const editModeRef = useRef(false);
  editModeRef.current = editMode;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddingZoneType(null);
        setDrawStart(null);
        setDrawCurrent(null);
        setPolygonPoints([]);
        setPolygonCursor(null);
        setCutParentZone(null);
        setSelectedZone(null);
        setSelectedBedPos(null);
        setSelectedGroundPlant(null);
        setPlacingGroundPlant(null);
        setDrawingMode('rectangle');
        setEditingPolygonPointIndex(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && editModeRef.current && selectedZoneRef.current !== null) {
        // Don't delete if user is typing in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        const zoneId = selectedZoneRef.current;
        showConfirm({ title: 'Delete Zone', message: 'Delete this zone?', confirmText: 'Delete', destructive: true }).then(confirmed => {
          if (!confirmed) return;
          deleteZone(zoneId).then(() => {
            setZones(prev => prev.filter(z => z.id !== zoneId));
            setSelectedZone(null);
            toast('Zone deleted');
          }).catch(() => {});
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ─── Data loading ───

  const loadAll = useCallback(async () => {
    try {
      const [propData, zonesData, bedsData, posData, gpData, areasData] = await Promise.all([
        getProperty(),
        getZones(),
        getBeds(),
        getBedPositions(),
        getGroundPlants().catch(() => []),
        getAreas().catch(() => []),
      ]);
      setProperty(propData);
      setZones(zonesData);
      setBeds(bedsData);
      setBedPositions(posData);
      setGroundPlants(gpData);
      setAreas(areasData);

      // Load grids
      const gridResults = await Promise.allSettled(
        bedsData.map((b: Bed) => getBedGrid(b.id))
      );
      const gridMap: Record<number, BedGrid> = {};
      gridResults.forEach((result: PromiseSettledResult<BedGrid>, i: number) => {
        if (result.status === 'fulfilled') {
          gridMap[bedsData[i].id] = result.value;
        }
      });
      setGrids(gridMap);
    } catch (e) {
      setError('Failed to load property data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ─── Auto-fit on first load ───

  useEffect(() => {
    if (!property || autoFitDone || !canvasRef.current) return;
    // Defer to next frame so canvas has rendered
    requestAnimationFrame(() => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const zx = (rect.width - 40) / property.width_feet;
      const zy = (rect.height - 40) / property.height_feet;
      const fitted = Math.max(2, Math.min(40, Math.floor(Math.min(zx, zy))));
      setZoom(fitted);
      setPanOffset({ x: 20, y: 20 });
      setAutoFitDone(true);
    });
  }, [property, autoFitDone]);

  // ─── Sun data ───

  useEffect(() => {
    if (!showSun) {
      setShadowPolygons([]);
      return;
    }
    const today = getGardenToday();
    const timeStr = `${String(Math.floor(sunTime)).padStart(2, '0')}:${String(Math.round((sunTime % 1) * 60)).padStart(2, '0')}`;
    getSunPosition(today, timeStr).then(setSunPosition).catch(() => {});
    getSunDaily(today).then((data: { beds: BedSunData[] }) => setSunDailyData(data.beds)).catch(() => {});
    getSunShadows(today, timeStr).then((data: { shadows: ShadowPolygon[] }) => setShadowPolygons(data.shadows || [])).catch(() => setShadowPolygons([]));
  }, [showSun, sunTime]);

  // ─── Helpers ───

  const ftToPx = (ft: number) => ft * zoom;
  const pxToFt = (px: number) => Math.round(px / zoom);

  const snapToGrid = (px: number) => {
    const ft = px / zoom;
    return Math.round(ft) * zoom;
  };

  const canvasToProperty = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: pxToFt(clientX - rect.left - panOffset.x),
      y: pxToFt(clientY - rect.top - panOffset.y),
    };
  };

  const placedBedIds = new Set(bedPositions.map(bp => bp.bed_id));
  const unplacedBeds = beds.filter(b => !placedBedIds.has(b.id));

  const bedWidthFt = (bed: Bed | BedPosition) => {
    // Single planters use physical dimensions
    if ('bed_type' in bed && bed.bed_type === 'single' && 'physical_width_inches' in bed && bed.physical_width_inches) {
      return bed.physical_width_inches / 12;
    }
    const w = 'width_cells' in bed ? bed.width_cells : 0;
    const cs = 'cell_size_inches' in bed ? bed.cell_size_inches : 12;
    return (w * cs) / 12;
  };
  const bedHeightFt = (bed: Bed | BedPosition) => {
    // Single planters use physical dimensions
    if ('bed_type' in bed && bed.bed_type === 'single' && 'physical_length_inches' in bed && bed.physical_length_inches) {
      return bed.physical_length_inches / 12;
    }
    const h = 'height_cells' in bed ? bed.height_cells : 0;
    const cs = 'cell_size_inches' in bed ? bed.cell_size_inches : 12;
    return (h * cs) / 12;
  };

  // ─── Pan handlers ───

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only pan if not drawing a zone and not dragging anything
    if (addingZoneType || draggingZone !== null || draggingBed !== null || draggingGroundPlant !== null) return;
    if (e.target !== canvasRef.current && !(e.target as HTMLElement).classList.contains('canvas-grid')) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: panOffset.x, oy: panOffset.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPanOffset({
        x: panStart.current.ox + (e.clientX - panStart.current.x),
        y: panStart.current.oy + (e.clientY - panStart.current.y),
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
  };

  // ─── Zone drawing ───

  const handleDrawMouseDown = (e: React.MouseEvent) => {
    if (!addingZoneType) return;
    e.stopPropagation();
    const pos = canvasToProperty(e.clientX, e.clientY);

    if (drawingMode === 'rectangle') {
      setDrawStart(pos);
      setDrawCurrent(pos);
    }
    // Polygon/Cut: handled by click, not mousedown
  };

  const handleDrawMouseMove = (e: React.MouseEvent) => {
    if (!addingZoneType) return;
    const pos = canvasToProperty(e.clientX, e.clientY);

    if (drawingMode === 'rectangle' && drawStart) {
      setDrawCurrent(pos);
    } else if (drawingMode === 'polygon' || drawingMode === 'cut') {
      // Snap cursor to nearest grid intersection (integer feet)
      setPolygonCursor({ x: Math.round(pos.x), y: Math.round(pos.y) });
    }
  };

  const handleDrawMouseUp = async () => {
    if (drawingMode !== 'rectangle') return;
    if (!drawStart || !drawCurrent || !addingZoneType) return;
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    if (w >= 1 && h >= 1) {
      try {
        const zone = await createZone({
          name: `${ZONE_COLORS[addingZoneType]?.label || addingZoneType}`,
          zone_type: addingZoneType,
          x_feet: x,
          y_feet: y,
          width_feet: w,
          height_feet: h,
        });
        setZones(prev => [...prev, zone]);
      } catch {}
    }
    setDrawStart(null);
    setDrawCurrent(null);
    setAddingZoneType(null);
  };

  const handleCanvasClick = async (e: React.MouseEvent) => {
    // Click-to-place ground plant mode
    if (placingGroundPlant !== null) {
      e.stopPropagation();
      const rawPos = canvasToProperty(e.clientX, e.clientY);
      const pos = { x: Math.round(rawPos.x), y: Math.round(rawPos.y) };
      try {
        await updateGroundPlant(placingGroundPlant, { x_feet: Math.max(0, pos.x), y_feet: Math.max(0, pos.y) });
        setGroundPlants(prev => prev.map(gp => gp.id === placingGroundPlant ? { ...gp, x_feet: Math.max(0, pos.x), y_feet: Math.max(0, pos.y) } : gp));
      } catch {}
      setPlacingGroundPlant(null);
      return;
    }

    if (!addingZoneType) {
      setSelectedZone(null);
      setSelectedBedPos(null);
      setSelectedGroundPlant(null);
      return;
    }

    if (drawingMode !== 'polygon' && drawingMode !== 'cut') return;

    e.stopPropagation();
    const rawPos = canvasToProperty(e.clientX, e.clientY);
    // Snap to nearest 1ft grid intersection (integer feet)
    const pos = { x: Math.round(rawPos.x), y: Math.round(rawPos.y) };

    // Check if clicking near first point to close polygon (within 1ft)
    if (polygonPoints.length >= 3) {
      const first = polygonPoints[0];
      const dist = Math.sqrt((pos.x - first.x) ** 2 + (pos.y - first.y) ** 2);
      if (dist <= 1) {
        // Close and create the polygon zone — snap exactly to first point
        finishPolygon();
        return;
      }
    }

    // Enforce minimum 1ft distance from previous point
    if (polygonPoints.length > 0) {
      const last = polygonPoints[polygonPoints.length - 1];
      const dist = Math.sqrt((pos.x - last.x) ** 2 + (pos.y - last.y) ** 2);
      if (dist < 1) return; // Too close — ignore click
    }

    setPolygonPoints(prev => [...prev, pos]);
  };

  const handleCanvasDoubleClick = async (e: React.MouseEvent) => {
    if (!addingZoneType || (drawingMode !== 'polygon' && drawingMode !== 'cut')) return;
    if (polygonPoints.length < 3) return;
    e.stopPropagation();
    e.preventDefault();
    finishPolygon();
  };

  const finishPolygon = async () => {
    if (!addingZoneType || polygonPoints.length < 3) return;

    // Calculate polygon area using shoelace formula — must be at least 1 sq ft
    let polyArea = 0;
    for (let i = 0; i < polygonPoints.length; i++) {
      const j = (i + 1) % polygonPoints.length;
      polyArea += polygonPoints[i].x * polygonPoints[j].y;
      polyArea -= polygonPoints[j].x * polygonPoints[i].y;
    }
    polyArea = Math.abs(polyArea) / 2;
    if (polyArea < 1) {
      setPolygonPoints([]);
      setPolygonCursor(null);
      return;
    }

    // Calculate bounding box
    const xs = polygonPoints.map(p => p.x);
    const ys = polygonPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    const isCut = drawingMode === 'cut';

    // Auto-detect parent zone for cutouts using centroid point-in-polygon test
    let detectedParentId: number | undefined = undefined;
    if (isCut) {
      const centroidX = polygonPoints.reduce((s, p) => s + p.x, 0) / polygonPoints.length;
      const centroidY = polygonPoints.reduce((s, p) => s + p.y, 0) / polygonPoints.length;

      // Check polygon zones first (ray-casting point-in-polygon)
      for (const z of zones) {
        if (z.is_cutout === 1) continue; // skip existing cutouts
        if (z.polygon_points) {
          try {
            const zPts: PolygonPoint[] = JSON.parse(z.polygon_points);
            if (zPts.length < 3) continue;
            let inside = false;
            for (let i = 0, j = zPts.length - 1; i < zPts.length; j = i++) {
              const xi = zPts[i].x, yi = zPts[i].y;
              const xj = zPts[j].x, yj = zPts[j].y;
              if (((yi > centroidY) !== (yj > centroidY)) && (centroidX < (xj - xi) * (centroidY - yi) / (yj - yi) + xi)) {
                inside = !inside;
              }
            }
            if (inside) { detectedParentId = z.id; break; }
          } catch {}
        } else {
          // Rectangle zone — simple bounds check
          if (centroidX >= z.x_feet && centroidX <= z.x_feet + z.width_feet &&
              centroidY >= z.y_feet && centroidY <= z.y_feet + z.height_feet) {
            detectedParentId = z.id;
            break;
          }
        }
      }
    }

    try {
      const zone = await createZone({
        name: isCut ? 'Cutout' : `${ZONE_COLORS[addingZoneType]?.label || addingZoneType}`,
        zone_type: addingZoneType,
        x_feet: minX,
        y_feet: minY,
        width_feet: Math.max(1, maxX - minX),
        height_feet: Math.max(1, maxY - minY),
        polygon_points: JSON.stringify(polygonPoints),
        is_cutout: isCut ? 1 : 0,
        parent_zone_id: isCut ? (detectedParentId ?? cutParentZone ?? undefined) : undefined,
      });
      setZones(prev => [...prev, zone]);
    } catch {}

    setPolygonPoints([]);
    setPolygonCursor(null);
    setCutParentZone(null);
    if (drawingMode === 'cut') {
      // Stay in cut mode so user can draw multiple cutouts
      // addingZoneType stays as 'other'
    } else {
      setAddingZoneType(null);
    }
  };

  // ─── Polygon point editing ───

  const startPolygonPointDrag = (pointIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingPolygonPointIndex(pointIndex);
    const rawPos = canvasToProperty(e.clientX, e.clientY);
    polygonEditDragStart.current = { x: Math.round(rawPos.x), y: Math.round(rawPos.y) };
  };

  const addPolygonMidpoint = async (afterIndex: number, mx: number, my: number) => {
    if (selectedZone === null) return;
    const zone = zones.find(z => z.id === selectedZone);
    if (!zone?.polygon_points) return;
    try {
      const pts: PolygonPoint[] = JSON.parse(zone.polygon_points);
      const newPts = [...pts];
      newPts.splice(afterIndex + 1, 0, { x: Math.round(mx), y: Math.round(my) });
      const updated = await updateZone(zone.id, { polygon_points: JSON.stringify(newPts) });
      setZones(prev => prev.map(z => z.id === zone.id ? updated : z));
    } catch {}
  };

  const deletePolygonPoint = async (pointIndex: number) => {
    if (selectedZone === null) return;
    const zone = zones.find(z => z.id === selectedZone);
    if (!zone?.polygon_points) return;
    try {
      const pts: PolygonPoint[] = JSON.parse(zone.polygon_points);
      if (pts.length <= 3) return; // Minimum 3 points for a polygon
      const newPts = pts.filter((_, i) => i !== pointIndex);
      // Recalculate bounding box
      const xs = newPts.map(p => p.x);
      const ys = newPts.map(p => p.y);
      const updated = await updateZone(zone.id, {
        polygon_points: JSON.stringify(newPts),
        x_feet: Math.min(...xs),
        y_feet: Math.min(...ys),
        width_feet: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        height_feet: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      });
      setZones(prev => prev.map(z => z.id === zone.id ? updated : z));
    } catch {}
  };

  // Global mousemove/mouseup for polygon point dragging
  useEffect(() => {
    if (editingPolygonPointIndex === null || selectedZone === null) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rawX = (e.clientX - rect.left - panOffset.x) / zoom;
      const rawY = (e.clientY - rect.top - panOffset.y) / zoom;
      const snappedX = Math.round(rawX);
      const snappedY = Math.round(rawY);

      setZones(prev => prev.map(z => {
        if (z.id !== selectedZone || !z.polygon_points) return z;
        try {
          const pts: PolygonPoint[] = JSON.parse(z.polygon_points);
          const newPts = [...pts];
          newPts[editingPolygonPointIndex] = { x: Math.max(0, snappedX), y: Math.max(0, snappedY) };
          return { ...z, polygon_points: JSON.stringify(newPts) };
        } catch { return z; }
      }));
    };
    const handleUp = async () => {
      // Save updated polygon to API
      const zone = zones.find(z => z.id === selectedZone);
      if (zone?.polygon_points) {
        try {
          const pts: PolygonPoint[] = JSON.parse(zone.polygon_points);
          const xs = pts.map(p => p.x);
          const ys = pts.map(p => p.y);
          await updateZone(zone.id, {
            polygon_points: zone.polygon_points,
            x_feet: Math.min(...xs),
            y_feet: Math.min(...ys),
            width_feet: Math.max(1, Math.max(...xs) - Math.min(...xs)),
            height_feet: Math.max(1, Math.max(...ys) - Math.min(...ys)),
          });
        } catch {}
      }
      setEditingPolygonPointIndex(null);
      polygonEditDragStart.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [editingPolygonPointIndex, selectedZone, panOffset, zoom, zones]);

  // ─── Zone drag ───

  const handleZoneMouseDown = (zoneId: number, e: React.MouseEvent) => {
    if (addingZoneType) return;
    e.stopPropagation();
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    if (!editMode) return; // View mode: no drag
    setSelectedZone(zoneId);
    setSelectedBedPos(null);
    setDraggingZone(zoneId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoneDragOffset.current = {
      x: e.clientX - rect.left - panOffset.x - ftToPx(zone.x_feet),
      y: e.clientY - rect.top - panOffset.y - ftToPx(zone.y_feet),
    };
  };

  useEffect(() => {
    if (draggingZone === null) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const newX = pxToFt(e.clientX - rect.left - panOffset.x - zoneDragOffset.current.x);
      const newY = pxToFt(e.clientY - rect.top - panOffset.y - zoneDragOffset.current.y);
      setZones(prev => prev.map(z => z.id === draggingZone ? { ...z, x_feet: Math.max(0, newX), y_feet: Math.max(0, newY) } : z));
    };
    const handleUp = async () => {
      const zone = zones.find(z => z.id === draggingZone);
      if (zone) {
        try {
          await updateZone(zone.id, { x_feet: zone.x_feet, y_feet: zone.y_feet });
        } catch {}
      }
      setDraggingZone(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [draggingZone, panOffset, zones]);

  // ─── Bed drag (on canvas) ───

  const handleBedPosMouseDown = (bedId: number, e: React.MouseEvent) => {
    if (addingZoneType) return;
    e.stopPropagation();
    if (!editMode) return; // View mode: no drag
    setSelectedBedPos(bedId);
    setSelectedZone(null);
    setDraggingBed(bedId);
    const bp = bedPositions.find(b => b.bed_id === bedId);
    if (!bp) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    bedDragOffset.current = {
      x: e.clientX - rect.left - panOffset.x - ftToPx(bp.x_feet),
      y: e.clientY - rect.top - panOffset.y - ftToPx(bp.y_feet),
    };
  };

  useEffect(() => {
    if (draggingBed === null) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const newX = pxToFt(e.clientX - rect.left - panOffset.x - bedDragOffset.current.x);
      const newY = pxToFt(e.clientY - rect.top - panOffset.y - bedDragOffset.current.y);
      setBedPositions(prev => prev.map(bp => bp.bed_id === draggingBed ? { ...bp, x_feet: Math.max(0, newX), y_feet: Math.max(0, newY) } : bp));
    };
    const handleUp = async () => {
      const bp = bedPositions.find(b => b.bed_id === draggingBed);
      if (bp) {
        try {
          await setBedPosition(bp.bed_id, { x_feet: bp.x_feet, y_feet: bp.y_feet, rotation_degrees: bp.rotation_degrees });
        } catch {}
      }
      setDraggingBed(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [draggingBed, panOffset, bedPositions]);

  // ─── Sidebar bed drag to canvas ───

  const handleSidebarBedMouseDown = (bedId: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingBedFromSidebar(bedId);
    setSidebarDragPos({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (draggingBedFromSidebar === null) return;
    const handleMove = (e: MouseEvent) => {
      setSidebarDragPos({ x: e.clientX, y: e.clientY });
    };
    const handleUp = async (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const pos = {
          x: pxToFt(e.clientX - rect.left - panOffset.x),
          y: pxToFt(e.clientY - rect.top - panOffset.y),
        };
        try {
          const result = await setBedPosition(draggingBedFromSidebar!, { x_feet: Math.max(0, pos.x), y_feet: Math.max(0, pos.y), rotation_degrees: 0 });
          setBedPositions(prev => [...prev, result]);
        } catch {}
      }
      setDraggingBedFromSidebar(null);
      setSidebarDragPos(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [draggingBedFromSidebar, panOffset]);

  // ─── Sidebar ground plant drag to canvas ───

  const handleSidebarGPMouseDown = (gpId: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingGPFromSidebar(gpId);
    setSidebarGPDragPos({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (draggingGPFromSidebar === null) return;
    const handleMove = (e: MouseEvent) => {
      setSidebarGPDragPos({ x: e.clientX, y: e.clientY });
    };
    const handleUp = async (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const pos = {
          x: pxToFt(e.clientX - rect.left - panOffset.x),
          y: pxToFt(e.clientY - rect.top - panOffset.y),
        };
        try {
          await updateGroundPlant(draggingGPFromSidebar!, { x_feet: Math.max(0, pos.x), y_feet: Math.max(0, pos.y) });
          setGroundPlants(prev => prev.map(gp => gp.id === draggingGPFromSidebar ? { ...gp, x_feet: Math.max(0, pos.x), y_feet: Math.max(0, pos.y) } : gp));
        } catch {}
      }
      setDraggingGPFromSidebar(null);
      setSidebarGPDragPos(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [draggingGPFromSidebar, panOffset]);

  // ─── Ground plant drag ───

  const handleGroundPlantMouseDown = (gpId: number, e: React.MouseEvent) => {
    if (addingZoneType) return;
    e.stopPropagation();
    if (!editMode) return; // View mode: no drag
    setSelectedGroundPlant(gpId);
    setSelectedZone(null);
    setSelectedBedPos(null);
    setDraggingGroundPlant(gpId);
    const gp = groundPlants.find(g => g.id === gpId);
    if (!gp || gp.x_feet == null || gp.y_feet == null) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    groundPlantDragOffset.current = {
      x: e.clientX - rect.left - panOffset.x - ftToPx(gp.x_feet),
      y: e.clientY - rect.top - panOffset.y - ftToPx(gp.y_feet),
    };
  };

  useEffect(() => {
    if (draggingGroundPlant === null) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const newX = pxToFt(e.clientX - rect.left - panOffset.x - groundPlantDragOffset.current.x);
      const newY = pxToFt(e.clientY - rect.top - panOffset.y - groundPlantDragOffset.current.y);
      setGroundPlants(prev => prev.map(gp => gp.id === draggingGroundPlant ? { ...gp, x_feet: Math.max(0, newX), y_feet: Math.max(0, newY) } : gp));
    };
    const handleUp = async () => {
      const gp = groundPlants.find(g => g.id === draggingGroundPlant);
      if (gp && gp.x_feet != null && gp.y_feet != null) {
        try {
          await updateGroundPlant(gp.id, { x_feet: gp.x_feet, y_feet: gp.y_feet });
        } catch {}
      }
      setDraggingGroundPlant(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [draggingGroundPlant, panOffset, groundPlants]);

  // ─── Ground plant actions ───

  const handleDeleteGroundPlant = async (gpId: number) => {
    if (!await showConfirm({ title: 'Remove Plant', message: 'Remove this ground plant from the map?', confirmText: 'Remove', destructive: true })) return;
    try {
      await deleteGroundPlant(gpId);
      setGroundPlants(prev => prev.filter(gp => gp.id !== gpId));
      setSelectedGroundPlant(null);
      toast('Ground plant removed');
    } catch {}
  };

  // ─── Zone actions ───

  const handleDeleteZone = async (zoneId: number) => {
    if (!await showConfirm({ title: 'Delete Zone', message: 'Delete this zone?', confirmText: 'Delete', destructive: true })) return;
    try {
      await deleteZone(zoneId);
      setZones(prev => prev.filter(z => z.id !== zoneId));
      setSelectedZone(null);
    } catch {}
  };

  const handleRenameZone = async (zoneId: number) => {
    if (!renameValue.trim()) return;
    try {
      const updated = await updateZone(zoneId, { name: renameValue.trim() });
      setZones(prev => prev.map(z => z.id === zoneId ? updated : z));
      setRenamingZone(null);
    } catch {}
  };

  // ─── Zone resize ───

  const [resizingZone, setResizingZone] = useState<{ id: number; handle: string } | null>(null);
  const resizeStart = useRef({ x: 0, y: 0, zx: 0, zy: 0, zw: 0, zh: 0, rot: 0 });

  const handleResizeMouseDown = (zoneId: number, handle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    setResizingZone({ id: zoneId, handle });
    // For 90/270 rotations, dimensions are swapped on screen, so store the rendered (swapped) dimensions
    const rot = zone.rotation_degrees || 0;
    const isSwapped = rot === 90 || rot === 270;
    const renderW = isSwapped ? zone.height_feet : zone.width_feet;
    const renderH = isSwapped ? zone.width_feet : zone.height_feet;
    const offsetX = isSwapped ? (zone.width_feet - zone.height_feet) / 2 : 0;
    const offsetY = isSwapped ? (zone.height_feet - zone.width_feet) / 2 : 0;
    resizeStart.current = { x: e.clientX, y: e.clientY, zx: zone.x_feet - offsetX, zy: zone.y_feet - offsetY, zw: renderW, zh: renderH, rot };
  };

  useEffect(() => {
    if (!resizingZone) return;
    const handleMove = (e: MouseEvent) => {
      const dx = pxToFt(e.clientX - resizeStart.current.x);
      const dy = pxToFt(e.clientY - resizeStart.current.y);
      const { handle } = resizingZone;
      const rot = resizeStart.current.rot;
      const isSwapped = rot === 90 || rot === 270;
      setZones(prev => prev.map(z => {
        if (z.id !== resizingZone.id) return z;
        const s = resizeStart.current;
        // Work in screen (rendered) coordinates
        let newRX = s.zx, newRY = s.zy, newRW = s.zw, newRH = s.zh;
        if (handle.includes('e')) newRW = Math.max(1, s.zw + dx);
        if (handle.includes('w')) { newRX = s.zx + dx; newRW = Math.max(1, s.zw - dx); }
        if (handle.includes('s')) newRH = Math.max(1, s.zh + dy);
        if (handle.includes('n')) { newRY = s.zy + dy; newRH = Math.max(1, s.zh - dy); }
        // Un-swap back to stored dimensions
        const storedW = isSwapped ? newRH : newRW;
        const storedH = isSwapped ? newRW : newRH;
        const storedOffsetX = isSwapped ? (storedW - storedH) / 2 : 0;
        const storedOffsetY = isSwapped ? (storedH - storedW) / 2 : 0;
        return { ...z, x_feet: Math.max(0, newRX + storedOffsetX), y_feet: Math.max(0, newRY + storedOffsetY), width_feet: storedW, height_feet: storedH };
      }));
    };
    const handleUp = async () => {
      const zone = zones.find(z => z.id === resizingZone.id);
      if (zone) {
        // Snap to grid (integer feet) after resize
        const snapped = {
          x_feet: Math.max(0, Math.round(zone.x_feet)),
          y_feet: Math.max(0, Math.round(zone.y_feet)),
          width_feet: Math.max(1, Math.round(zone.width_feet)),
          height_feet: Math.max(1, Math.round(zone.height_feet)),
        };
        setZones(prev => prev.map(z => z.id === zone.id ? { ...z, ...snapped } : z));
        try {
          await updateZone(zone.id, snapped);
        } catch {}
      }
      setResizingZone(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [resizingZone, zones]);

  // ─── Property settings ───

  const [settingsForm, setSettingsForm] = useState({ width_feet: 100, height_feet: 80, orientation_degrees: 0, address: '', name: '', default_soil_type: 'native-clay', default_soil_ph: 8.0, default_soil_notes: '' });

  useEffect(() => {
    if (property) {
      setSettingsForm({
        width_feet: property.width_feet,
        height_feet: property.height_feet,
        orientation_degrees: property.orientation_degrees,
        address: property.address || '',
        name: property.name,
        default_soil_type: property.default_soil_type || 'native-clay',
        default_soil_ph: property.default_soil_ph || 8.0,
        default_soil_notes: property.default_soil_notes || '',
      });
    }
  }, [property]);

  const handleSaveSettings = async () => {
    try {
      const updated = await updateProperty(settingsForm);
      setProperty(updated);
      setShowSettings(false);
    } catch {}
  };

  // ─── Zoom ───

  const handleZoomIn = () => setZoom(z => Math.min(40, z + 1));
  const handleZoomOut = () => setZoom(z => Math.max(2, z - 1));
  const handleFitToScreen = () => {
    if (!property || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const zx = (rect.width - 40) / property.width_feet;
    const zy = (rect.height - 40) / property.height_feet;
    setZoom(Math.max(2, Math.min(40, Math.floor(Math.min(zx, zy)))));
    setPanOffset({ x: 20, y: 20 });
  };

  // Wheel zoom via native event (React onWheel is passive, can't preventDefault)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      setZoom(z => Math.max(2, Math.min(40, z + delta)));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [loading]); // re-attach after loading completes and canvas renders

  // ─── Compass ───

  const compassRotation = property?.orientation_degrees || 0;

  // ─── View mode tooltip ───
  const showViewTooltipForZone = (zone: Zone, e: React.MouseEvent) => {
    const data: Record<string, string> = { Name: zone.name, Type: ZONE_COLORS[zone.zone_type]?.label || zone.zone_type };
    if (zone.width_feet && zone.height_feet) data['Size'] = `${zone.width_feet}ft x ${zone.height_feet}ft`;
    if (zone.height_ft) data['Height'] = `${zone.height_ft}ft`;
    if (zone.soil_type) data['Soil'] = SOIL_TYPE_LABELS[zone.soil_type] || zone.soil_type;
    if (zone.notes) data['Notes'] = zone.notes;
    setViewTooltip({ x: e.clientX, y: e.clientY, type: 'zone', data });
  };

  const showViewTooltipForBed = (bp: BedPosition, e: React.MouseEvent) => {
    const sunData = showSun ? sunDailyData.find(s => s.bed_id === bp.bed_id) : null;
    const data: Record<string, string> = { Name: bp.bed_name, Size: `${bedWidthFt(bp).toFixed(1)}ft x ${bedHeightFt(bp).toFixed(1)}ft` };
    if (sunData) data['Sun'] = `${sunData.sun_hours}h ${sunData.sun_quality}`;
    setViewTooltip({ x: e.clientX, y: e.clientY, type: 'bed', data, link: `/planters/${bp.bed_id}` });
  };

  const showViewTooltipForPlant = (gp: GroundPlantMapItem, e: React.MouseEvent) => {
    const data: Record<string, string> = { Name: gp.name || gp.plant_name, Status: gp.status };
    if (gp.area_name) data['Area'] = gp.area_name;
    if (gp.irrigation_zone_name) data['Irrigation'] = gp.irrigation_zone_name;
    const zone = gp.zone_id ? zones.find(z => z.id === gp.zone_id) : null;
    const soilType = zone?.soil_type || property?.default_soil_type || 'native-clay';
    data['Soil'] = SOIL_TYPE_LABELS[soilType] || soilType;
    setViewTooltip({ x: e.clientX, y: e.clientY, type: 'plant', data, link: `/ground-plants/${gp.id}` });
  };

  // ─── Multi-select handler ───
  const handleItemClick = (type: string, id: number, e: React.MouseEvent) => {
    const key = `${type}-${id}`;
    if (editMode && (e.metaKey || e.ctrlKey)) {
      // Multi-select
      setSelectedItems(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return true; // handled
    }
    // Single click clears multi-select
    if (selectedItems.size > 0 && !e.metaKey && !e.ctrlKey) {
      setSelectedItems(new Set());
    }
    return false; // not handled, continue with normal selection
  };

  // ─── Multi-select group drag ───
  const multiDragStart = useRef<{ x: number; y: number } | null>(null);

  // ─── Set Size handler ───
  const handleSetSize = async (zoneId: number) => {
    const w = parseFloat(sizeFormWidth);
    const h = parseFloat(sizeFormHeight);
    const hFt = sizeFormHeightFt ? parseFloat(sizeFormHeightFt) : undefined;
    if (isNaN(w) || isNaN(h) || w < 0.5 || h < 0.5) return;
    try {
      const updateData: Record<string, number> = { width_feet: Math.round(w), height_feet: Math.round(h) };
      if (hFt !== undefined && !isNaN(hFt) && hFt > 0) {
        (updateData as Record<string, number>)['height_ft'] = hFt;
      }
      const updated = await updateZone(zoneId, updateData);
      setZones(prev => prev.map(z => z.id === zoneId ? updated : z));
      setSizeFormZone(null);
      toast('Zone resized');
    } catch {}
  };

  // ─── Sun path SVG ───

  const renderSunPath = () => {
    if (!showSun || !sunPosition || !property) return null;
    const w = ftToPx(property.width_feet);
    const h = ftToPx(property.height_feet);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.45;

    // Draw arc from east (sunrise ~90) to west (sunset ~270)
    // Sun travels E -> S -> W in northern hemisphere
    const points: string[] = [];
    for (let az = 60; az <= 300; az += 5) {
      const rad = ((az - 180) * Math.PI) / 180;
      const px = cx + r * Math.sin(rad);
      const py = cy + r * Math.cos(rad);
      points.push(`${px},${py}`);
    }

    // Current sun indicator
    const sunRad = ((sunPosition.azimuth - 180) * Math.PI) / 180;
    const altFactor = Math.max(0.3, sunPosition.altitude / 90);
    const sunX = cx + r * altFactor * Math.sin(sunRad);
    const sunY = cy + r * altFactor * Math.cos(sunRad);

    return (
      <svg className="absolute inset-0 pointer-events-none" style={{ width: w, height: h, zIndex: 40 }}>
        {/* Sun direction gradient — faint glow from sun side */}
        <defs>
          <radialGradient id="sunGlow" cx={sunX / w} cy={sunY / h} r="0.6">
            <stop offset="0%" stopColor="rgba(250, 204, 21, 0.15)" />
            <stop offset="100%" stopColor="rgba(250, 204, 21, 0)" />
          </radialGradient>
        </defs>
        {sunPosition.altitude > 0 && (
          <rect x={0} y={0} width={w} height={h} fill="url(#sunGlow)" />
        )}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="rgba(250, 204, 21, 0.6)"
          strokeWidth="3"
          strokeDasharray="8 4"
        />
        {sunPosition.altitude > 0 && (
          <>
            <circle cx={sunX} cy={sunY} r={12} fill="rgba(250, 204, 21, 0.3)" />
            <circle cx={sunX} cy={sunY} r={8} fill="rgba(250, 204, 21, 0.9)" stroke="rgba(234, 179, 8, 1)" strokeWidth="2" />
            <text x={sunX + 14} y={sunY - 10} fill="rgba(161, 98, 7, 0.9)" fontSize="11" fontWeight="bold">
              {Math.round(sunPosition.altitude)}°
            </text>
          </>
        )}
      </svg>
    );
  };

  // ─── Shadow polygons SVG ───

  const renderShadows = () => {
    if (!showSun || !property || shadowPolygons.length === 0) return null;
    const w = ftToPx(property.width_feet);
    const h = ftToPx(property.height_feet);

    const shadowColor: Record<string, string> = {
      house: 'rgba(30, 30, 60, 0.25)',
      fence: 'rgba(80, 60, 20, 0.18)',
      patio: 'rgba(50, 50, 80, 0.15)',
      tree: 'rgba(20, 60, 20, 0.20)',
      other: 'rgba(40, 40, 60, 0.15)',
    };

    return (
      <svg className="absolute inset-0 pointer-events-none" style={{ width: w, height: h, zIndex: 35 }}>
        <defs>
          <filter id="shadowBlur">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
          </filter>
        </defs>
        {shadowPolygons.map((shadow, i) => {
          const pts = shadow.polygon.map(p => `${ftToPx(p.x)},${ftToPx(p.y)}`).join(' ');
          const fill = shadowColor[shadow.source_type] || shadowColor.other;
          return (
            <polygon
              key={`shadow-${shadow.source_type}-${shadow.source_id}-${i}`}
              points={pts}
              fill={fill}
              filter="url(#shadowBlur)"
            />
          );
        })}
      </svg>
    );
  };

  // ─── Render ───

  if (loading) {
    return <div className="text-center py-16 text-earth-400">Loading property layout...</div>;
  }
  if (error) {
    return <div className="text-center py-16 text-red-500">{error}</div>;
  }
  if (!property) return null;

  const canvasWidth = ftToPx(property.width_feet);
  const canvasHeight = ftToPx(property.height_feet);

  // Mini cell size is now calculated per-bed from its rendered pixel dimensions (see mini plant grid below)

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Top toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100 hidden sm:block">Property Layout</h1>
            <p className="text-earth-500 dark:text-gray-400 text-sm hidden sm:block">{property.name} &mdash; {property.width_feet}ft x {property.height_feet}ft</p>
            <h1 className="text-lg font-bold text-earth-800 dark:text-gray-100 sm:hidden">{property.name}</h1>
          </div>
          {/* Edit mode toggle */}
          <button
            onClick={() => {
              setEditMode(!editMode);
              if (editMode) {
                // Exiting edit mode - clear selections
                setSelectedZone(null);
                setSelectedBedPos(null);
                setSelectedGroundPlant(null);
                setSelectedItems(new Set());
                setAddingZoneType(null);
                setDrawStart(null);
                setDrawCurrent(null);
                setPolygonPoints([]);
                setPolygonCursor(null);
                setSizeFormZone(null);
              }
            }}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              editMode
                ? 'bg-garden-600 text-white hover:bg-garden-700'
                : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 border border-earth-300 dark:border-gray-600 hover:border-garden-400 hover:text-garden-700'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
            {editMode ? 'Done Editing' : 'Edit Map'}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Drawing mode selector — only in edit mode */}
          {editMode && (
            <>
              <div className="flex items-center gap-0.5 bg-earth-100 dark:bg-gray-800 rounded-lg p-0.5">
                {([['rectangle', '\u25A1'] as const, ['polygon', '\u2B20'] as const]).map(([mode, icon]) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setDrawingMode(mode);
                      setPolygonPoints([]);
                      setPolygonCursor(null);
                      setDrawStart(null);
                      setDrawCurrent(null);
                      // If switching from cut mode, clear the auto-set zone type
                      if (drawingMode === 'cut') setAddingZoneType(null);
                    }}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      drawingMode === mode
                        ? 'bg-garden-600 text-white shadow-sm'
                        : 'text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-700'
                    }`}
                    title={mode === 'rectangle' ? 'Rectangle draw' : 'Polygon draw'}
                  >
                    {icon} {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
                <button
                  onClick={() => {
                    if (drawingMode === 'cut') {
                      // Toggle off cut mode
                      setDrawingMode('rectangle');
                      setAddingZoneType(null);
                      setPolygonPoints([]);
                      setPolygonCursor(null);
                    } else {
                      // Enter cut mode — auto-set zone type so drawing works immediately
                      setDrawingMode('cut');
                      setAddingZoneType('other');
                      setPolygonPoints([]);
                      setPolygonCursor(null);
                      setDrawStart(null);
                      setDrawCurrent(null);
                    }
                  }}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    drawingMode === 'cut'
                      ? 'bg-red-500 text-white shadow-sm'
                      : 'text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-700'
                  }`}
                  title="Cut (cutout) — draw a hole inside a zone"
                >
                  ✂ Cut
                </button>
              </div>
              <div className="w-px h-6 bg-earth-300 dark:bg-gray-600" />
              {/* Zone type buttons */}
              <div className="flex items-center gap-1 flex-wrap">
                {Object.entries(ZONE_COLORS).map(([type, { label, hex }]) => (
                  <button
                    key={type}
                    onClick={() => {
                      if (drawingMode === 'cut') setDrawingMode('rectangle');
                      setAddingZoneType(addingZoneType === type ? null : type);
                      setPolygonPoints([]);
                      setPolygonCursor(null);
                    }}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      addingZoneType === type && drawingMode !== 'cut'
                        ? 'bg-garden-600 text-white border-garden-600'
                        : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 border-earth-300 dark:border-gray-600 hover:border-garden-400'
                    }`}
                  >
                    {hex && <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: hex }} />}
                    + {label}
                  </button>
                ))}
              </div>
              <div className="w-px h-6 bg-earth-300 dark:bg-gray-600" />
            </>
          )}
          {/* Multi-select indicator */}
          {editMode && selectedItems.size > 1 && (
            <>
              <span className="text-xs font-medium text-garden-700 dark:text-garden-300 bg-garden-100 dark:bg-garden-900 px-2 py-1 rounded-lg">
                {selectedItems.size} items selected
              </span>
              <button
                onClick={async () => {
                  if (!await showConfirm({ title: 'Delete Selected', message: `Delete ${selectedItems.size} selected items?`, confirmText: 'Delete All', destructive: true })) return;
                  for (const key of Array.from(selectedItems)) {
                    const [type, idStr] = key.split('-');
                    const id = parseInt(idStr);
                    try {
                      if (type === 'zone') { await deleteZone(id); setZones(prev => prev.filter(z => z.id !== id)); }
                      else if (type === 'bed') { await deleteBedPosition(id); setBedPositions(prev => prev.filter(b => b.bed_id !== id)); }
                      else if (type === 'gp') { await deleteGroundPlant(id); setGroundPlants(prev => prev.filter(g => g.id !== id)); }
                    } catch {}
                  }
                  setSelectedItems(new Set());
                  setSelectedZone(null);
                  setSelectedBedPos(null);
                  setSelectedGroundPlant(null);
                  toast('Deleted selected items');
                }}
                className="px-2 py-1 text-xs rounded bg-red-50 dark:bg-red-900 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800"
              >
                Delete All
              </button>
              <div className="w-px h-6 bg-earth-300 dark:bg-gray-600" />
            </>
          )}
          {/* Zoom controls */}
          <button onClick={handleZoomOut} className="px-2 py-1 text-xs rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-earth-50 dark:hover:bg-gray-600 text-earth-600 dark:text-gray-300">-</button>
          <span className="text-xs text-earth-500 dark:text-gray-400 w-12 text-center hidden sm:inline">{zoom}px/ft</span>
          <button onClick={handleZoomIn} className="px-2 py-1 text-xs rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-earth-50 dark:hover:bg-gray-600 text-earth-600 dark:text-gray-300">+</button>
          <button onClick={handleFitToScreen} className="px-2 py-1 text-xs rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-earth-50 dark:hover:bg-gray-600 text-earth-600 dark:text-gray-300">Fit</button>
          <div className="w-px h-6 bg-earth-300 dark:bg-gray-600" />
          {/* Sun toggle */}
          <button
            onClick={() => setShowSun(!showSun)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              showSun
                ? 'bg-yellow-400 text-yellow-900 border-yellow-500'
                : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 border-earth-300 dark:border-gray-600 hover:border-yellow-400'
            }`}
          >
            Sun
          </button>
          {/* Settings — only in edit mode */}
          {editMode && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-xs px-2 py-1 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:border-garden-400"
            >
              Settings
            </button>
          )}
        </div>
      </div>

      {/* Drawing mode hint — edit mode only */}
      {editMode && addingZoneType && drawingMode !== 'cut' && (
        <div className="bg-garden-100 dark:bg-garden-900 text-garden-800 dark:text-garden-200 text-sm px-3 py-1.5 rounded-lg mb-2">
          {drawingMode === 'rectangle' && `Click and drag on the canvas to draw a ${ZONE_COLORS[addingZoneType]?.label || addingZoneType} zone. Press Escape to cancel.`}
          {drawingMode === 'polygon' && (polygonPoints.length === 0
            ? `Click on the canvas to add polygon points for a ${ZONE_COLORS[addingZoneType]?.label || addingZoneType} zone. Press Escape to cancel.`
            : `${polygonPoints.length} points placed. Click near the first point or double-click to close the shape. Press Escape to cancel.`)}
        </div>
      )}
      {editMode && drawingMode === 'cut' && (
        <div className="bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 text-sm px-3 py-1.5 rounded-lg mb-2">
          {polygonPoints.length === 0
            ? 'Click on the canvas to draw a cutout polygon. The parent zone will be auto-detected. Press Escape to cancel.'
            : `${polygonPoints.length} points placed. Double-click or click near the first point to close the cutout. Press Escape to cancel.`}
        </div>
      )}

      {/* Placing ground plant hint — edit mode only */}
      {editMode && placingGroundPlant !== null && !addingZoneType && (
        <div className="bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 text-sm px-3 py-1.5 rounded-lg mb-2">
          Click on the map to place {groundPlants.find(gp => gp.id === placingGroundPlant)?.name || groundPlants.find(gp => gp.id === placingGroundPlant)?.plant_name || 'ground plant'}. Press Escape to cancel.
        </div>
      )}

      {/* Sun time slider */}
      {showSun && (
        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg px-3 py-2 mb-2 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
            {sunPosition ? `${sunPosition.sunrise} sunrise` : '...'}
          </span>
          <input
            type="range"
            min="5"
            max="20"
            step="0.5"
            value={sunTime}
            onChange={(e) => setSunTime(parseFloat(e.target.value))}
            className="flex-1 min-w-[120px] accent-yellow-500"
          />
          <span className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
            {sunPosition ? `${sunPosition.sunset} sunset` : '...'}
          </span>
          <span className="text-xs font-bold text-yellow-900 dark:text-yellow-100 w-14 text-center">
            {String(Math.floor(sunTime)).padStart(2, '0')}:{String(Math.round((sunTime % 1) * 60)).padStart(2, '0')}
          </span>
          {sunPosition && (
            <span className="text-xs text-yellow-700 dark:text-yellow-300">
              Alt: {sunPosition.altitude}° Az: {sunPosition.azimuth}°
            </span>
          )}
        </div>
      )}

      {/* Settings panel — edit mode only */}
      {editMode && showSettings && (
        <div className="bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 rounded-xl p-4 mb-2 shadow-sm">
          <h3 className="font-bold text-earth-700 dark:text-gray-200 mb-3">Property Settings</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block">
              <span className="text-xs text-earth-500 dark:text-gray-400">Name</span>
              <input value={settingsForm.name} onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))} className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
            </label>
            <label className="block">
              <span className="text-xs text-earth-500 dark:text-gray-400">Width (ft)</span>
              <input type="number" value={settingsForm.width_feet} onChange={e => setSettingsForm(f => ({ ...f, width_feet: parseInt(e.target.value) || 100 }))} className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
            </label>
            <label className="block">
              <span className="text-xs text-earth-500 dark:text-gray-400">Height (ft)</span>
              <input type="number" value={settingsForm.height_feet} onChange={e => setSettingsForm(f => ({ ...f, height_feet: parseInt(e.target.value) || 80 }))} className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
            </label>
            <label className="block">
              <span className="text-xs text-earth-500 dark:text-gray-400">Orientation (deg from N)</span>
              <input type="number" value={settingsForm.orientation_degrees} onChange={e => setSettingsForm(f => ({ ...f, orientation_degrees: parseInt(e.target.value) || 0 }))} className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
            </label>
            <label className="block col-span-2">
              <span className="text-xs text-earth-500 dark:text-gray-400">Address</span>
              <input value={settingsForm.address} onChange={e => setSettingsForm(f => ({ ...f, address: e.target.value }))} className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
            </label>
            <label className="block">
              <span className="text-xs text-earth-500 dark:text-gray-400">Latitude</span>
              <input type="text" value={property.latitude} disabled className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900 text-earth-400 dark:text-gray-500" />
            </label>
            <label className="block">
              <span className="text-xs text-earth-500 dark:text-gray-400">Longitude</span>
              <input type="text" value={property.longitude} disabled className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900 text-earth-400 dark:text-gray-500" />
            </label>
          </div>
          {/* Default Soil Profile */}
          <div className="mt-3 pt-3 border-t border-earth-200 dark:border-gray-700">
            <h4 className="text-xs font-bold text-earth-600 dark:text-gray-300 mb-2">Default Soil Profile</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="block">
                <span className="text-xs text-earth-500 dark:text-gray-400">Soil Type</span>
                <select
                  value={settingsForm.default_soil_type}
                  onChange={e => setSettingsForm(f => ({ ...f, default_soil_type: e.target.value }))}
                  className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
                >
                  {Object.entries(SOIL_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-earth-500 dark:text-gray-400">Default pH</span>
                <input type="number" step="0.1" min="4" max="10" value={settingsForm.default_soil_ph} onChange={e => setSettingsForm(f => ({ ...f, default_soil_ph: parseFloat(e.target.value) || 8.0 }))} className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
              </label>
              <label className="block col-span-2">
                <span className="text-xs text-earth-500 dark:text-gray-400">Soil Notes</span>
                <input value={settingsForm.default_soil_notes} onChange={e => setSettingsForm(f => ({ ...f, default_soil_notes: e.target.value }))} placeholder="e.g. Heavy caliche at 2ft" className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200" />
              </label>
            </div>
            <p className="text-[10px] text-earth-400 dark:text-gray-500 mt-1">Plants on bare ground inherit this default soil profile.</p>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={handleSaveSettings} className="px-3 py-1.5 text-sm rounded bg-garden-600 text-white hover:bg-garden-700 transition-colors">Save</button>
            <button onClick={() => setShowSettings(false)} className="px-3 py-1.5 text-sm rounded border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex flex-1 gap-3 min-h-0">
        {/* Sidebar — edit mode only, hidden on mobile */}
        {editMode && (
        <div className={`${sidebarCollapsed ? 'w-8' : 'w-48'} shrink-0 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm hidden sm:flex flex-col transition-all duration-200`}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 transition-colors self-end"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
          {!sidebarCollapsed && (
          <div className="overflow-y-auto flex-1">

          {/* ── Available to Place ── */}
          <div className="px-3 py-2 border-b border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900 rounded-t-xl">
            <h3 className="font-bold text-sm text-earth-700 dark:text-gray-200">Available to Place</h3>
            <p className="text-[10px] text-earth-400 dark:text-gray-500">Drag onto canvas or click Place</p>
          </div>

          {/* Unplaced Planters */}
          {unplacedBeds.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-medium text-earth-400 dark:text-gray-500 uppercase tracking-wide border-b border-earth-100 dark:border-gray-700">
                Planters ({unplacedBeds.length})
              </div>
              {unplacedBeds.map(bed => (
                <div
                  key={bed.id}
                  className="mx-2 my-1.5 p-2 bg-green-50 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow select-none"
                  onMouseDown={(e) => handleSidebarBedMouseDown(bed.id, e)}
                >
                  <div className="font-bold text-xs text-earth-700 dark:text-gray-200 truncate">{bed.name}</div>
                  <div className="text-[10px] text-earth-400 dark:text-gray-500">
                    {bedWidthFt(bed).toFixed(1)}ft x {bedHeightFt(bed).toFixed(1)}ft
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Unplaced Ground Plants */}
          {(() => {
            const unplacedGP = groundPlants.filter(gp => gp.x_feet == null || gp.y_feet == null);
            if (unplacedGP.length === 0) return null;
            return (
              <>
                <div className="px-3 py-1 text-[10px] font-medium text-earth-400 dark:text-gray-500 uppercase tracking-wide border-b border-earth-100 dark:border-gray-700">
                  Ground Plants ({unplacedGP.length})
                </div>
                {unplacedGP.map(gp => (
                  <div
                    key={gp.id}
                    className={`mx-2 my-1.5 p-2 bg-amber-50 dark:bg-amber-900/20 border rounded-lg hover:shadow-sm transition-shadow select-none ${
                      placingGroundPlant === gp.id
                        ? 'border-garden-500 ring-1 ring-garden-400'
                        : 'border-amber-300 dark:border-amber-700'
                    }`}
                  >
                    <div className="flex items-center gap-1 cursor-grab active:cursor-grabbing" onMouseDown={(e) => handleSidebarGPMouseDown(gp.id, e)}>
                      <span className="text-sm">{getPlantIcon(gp.plant_name, gp.plant_category)}</span>
                      <span className="font-bold text-xs text-earth-700 dark:text-gray-200 truncate flex-1">{gp.name || gp.plant_name}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-earth-400 dark:text-gray-500">{gp.plant_category}</span>
                      <button
                        onClick={() => setPlacingGroundPlant(placingGroundPlant === gp.id ? null : gp.id)}
                        className={`ml-auto px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                          placingGroundPlant === gp.id
                            ? 'bg-garden-600 text-white border-garden-600'
                            : 'bg-white dark:bg-gray-700 text-garden-700 dark:text-garden-300 border-garden-300 dark:border-garden-600 hover:bg-garden-50 dark:hover:bg-garden-900'
                        }`}
                      >
                        {placingGroundPlant === gp.id ? 'Click map...' : 'Place'}
                      </button>
                    </div>
                  </div>
                ))}
              </>
            );
          })()}

          {/* Empty state */}
          {unplacedBeds.length === 0 && groundPlants.filter(gp => gp.x_feet == null || gp.y_feet == null).length === 0 && (
            <div className="p-3 text-xs text-earth-400 dark:text-gray-500 text-center">
              {beds.length === 0 && groundPlants.length === 0 ? 'No planters or ground plants yet.' : 'All items placed on canvas.'}
            </div>
          )}

          {/* Placing ground plant hint */}
          {placingGroundPlant !== null && (
            <div className="mx-2 my-1.5 p-2 bg-garden-100 dark:bg-garden-900 border border-garden-300 dark:border-garden-700 rounded-lg text-xs text-garden-800 dark:text-garden-200">
              Click on the map to place. Press Escape to cancel.
            </div>
          )}

          {/* ── On Canvas (collapsed by default) ── */}
          {(bedPositions.length > 0 || groundPlants.filter(gp => gp.x_feet != null).length > 0) && (
            <>
              <div
                className="px-3 py-2 border-t border-earth-200 dark:border-gray-700 mt-1 bg-earth-50 dark:bg-gray-900 cursor-pointer hover:bg-earth-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-between"
                onClick={() => setOnCanvasCollapsed(!onCanvasCollapsed)}
              >
                <h3 className="font-bold text-sm text-earth-700 dark:text-gray-200">
                  On Canvas
                </h3>
                <span className="text-xs text-earth-400 dark:text-gray-500">
                  {onCanvasCollapsed ? '\u25B6' : '\u25BC'}
                </span>
              </div>
              {!onCanvasCollapsed && (
                <>
                  {/* Placed planters */}
                  {bedPositions.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-medium text-earth-400 dark:text-gray-500 uppercase tracking-wide">
                        Planters ({bedPositions.length})
                      </div>
                      {bedPositions.map(bp => {
                        const sunData = sunDailyData.find(s => s.bed_id === bp.bed_id);
                        return (
                          <div
                            key={bp.bed_id}
                            className={`mx-2 my-1 p-2 border rounded-lg text-xs cursor-pointer transition-colors ${
                              selectedBedPos === bp.bed_id
                                ? 'bg-garden-100 dark:bg-garden-900 border-garden-400'
                                : 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700 hover:border-garden-300'
                            }`}
                            onClick={() => { setSelectedBedPos(bp.bed_id); setSelectedZone(null); }}
                          >
                            <div className="font-bold text-earth-700 dark:text-gray-200 truncate">{bp.bed_name}</div>
                            <div className="text-[10px] text-earth-400 dark:text-gray-500">
                              ({bp.x_feet}, {bp.y_feet})ft
                            </div>
                            {showSun && sunData && (
                              <div className="mt-1 text-[10px]">
                                <span className={`font-medium ${sunData.sun_quality === 'full sun' ? 'text-yellow-600' : sunData.sun_quality === 'partial sun' ? 'text-amber-600' : 'text-gray-500'}`}>
                                  {sunData.sun_hours}h {sunData.sun_quality}
                                </span>
                                {sunData.shade_sources && sunData.shade_sources.length > 0 && (
                                  <div className="text-earth-400 dark:text-gray-500 mt-0.5">
                                    {sunData.shade_sources.map((src, si) => (
                                      <div key={si}>
                                        {typeof src === 'string' ? src : `${src.name}: ${src.time_range}`}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* Placed ground plants */}
                  {(() => {
                    const placedGP = groundPlants.filter(gp => gp.x_feet != null && gp.y_feet != null);
                    if (placedGP.length === 0) return null;
                    // Group by area
                    const grouped: Record<string, GroundPlantMapItem[]> = {};
                    placedGP.forEach(gp => {
                      const areaKey = gp.area_name || 'Unassigned';
                      if (!grouped[areaKey]) grouped[areaKey] = [];
                      grouped[areaKey].push(gp);
                    });
                    return (
                      <>
                        <div className="px-3 py-1 text-[10px] font-medium text-earth-400 dark:text-gray-500 uppercase tracking-wide border-t border-earth-100 dark:border-gray-700 mt-1">
                          Ground Plants ({placedGP.length})
                        </div>
                        {Object.entries(grouped).map(([areaName, plants]) => (
                          <div key={areaName}>
                            <div className="px-3 py-0.5 text-[9px] font-medium text-earth-400 dark:text-gray-500 uppercase tracking-wide">
                              {areaName} ({plants.length})
                            </div>
                            {plants.map(gp => (
                              <div
                                key={gp.id}
                                className={`mx-2 my-0.5 px-2 py-1 border rounded-lg text-xs cursor-pointer transition-colors ${
                                  selectedGroundPlant === gp.id
                                    ? 'bg-garden-100 dark:bg-garden-900 border-garden-400'
                                    : 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700 hover:border-garden-300'
                                }`}
                                onClick={() => {
                                  setSelectedGroundPlant(gp.id);
                                  setSelectedZone(null);
                                  setSelectedBedPos(null);
                                  if (gp.x_feet != null && gp.y_feet != null && canvasRef.current) {
                                    const rect = canvasRef.current.getBoundingClientRect();
                                    setPanOffset({
                                      x: rect.width / 2 - ftToPx(gp.x_feet),
                                      y: rect.height / 2 - ftToPx(gp.y_feet),
                                    });
                                  }
                                }}
                              >
                                <div className="flex items-center gap-1">
                                  <span className="text-sm">{getPlantIcon(gp.plant_name, gp.plant_category)}</span>
                                  <span className="font-bold text-earth-700 dark:text-gray-200 truncate">{gp.name || gp.plant_name}</span>
                                </div>
                                <div className="text-[10px] text-earth-400 dark:text-gray-500">
                                  ({gp.x_feet}, {gp.y_feet})ft
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </>
              )}
            </>
          )}

          {/* Sun exposure legend when sun overlay active */}
          {showSun && sunDailyData.length > 0 && (
            <div className="px-3 py-2 border-t border-earth-200 dark:border-gray-700 mt-1">
              <p className="text-[10px] text-earth-400 dark:text-gray-500 font-medium mb-1">SUN LEGEND</p>
              <div className="flex flex-col gap-1 text-[10px]">
                <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(250,204,21,0.45)' }} /> Full Sun (6h+)</div>
                <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(250,204,21,0.25)' }} /> Partial (3-6h)</div>
                <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(100,116,139,0.35)' }} /> Shade (&lt;3h)</div>
                {shadowPolygons.length > 0 && (
                  <>
                    <div className="border-t border-earth-200 dark:border-gray-600 mt-1 pt-1 text-[10px] text-earth-400 dark:text-gray-500 font-medium">SHADOWS</div>
                    <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(30,30,60,0.25)' }} /> House</div>
                    <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(80,60,20,0.18)' }} /> Fence</div>
                    <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(20,60,20,0.20)' }} /> Tree</div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Footer link */}
          <div className="px-3 py-2 border-t border-earth-200 dark:border-gray-700 mt-1">
            <Link
              href="/ground-plants"
              className="text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 font-medium transition-colors"
            >
              Manage Ground Plants &rarr;
            </Link>
          </div>
          </div>
          )}
        </div>
        )}

        {/* Canvas area */}
        <div className="flex-1 relative bg-earth-100 dark:bg-gray-900 rounded-xl border border-earth-200 dark:border-gray-700 overflow-hidden">
          {/* Compass */}
          <div className="absolute top-3 right-3 z-30 w-14 h-14 rounded-full bg-white/90 dark:bg-gray-800/90 border border-earth-300 dark:border-gray-600 shadow-sm flex items-center justify-center">
            <div style={{ transform: `rotate(${-compassRotation}deg)` }} className="w-10 h-10 relative">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 text-[9px] font-bold text-red-600">N</div>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] font-bold text-earth-400 dark:text-gray-500">S</div>
              <div className="absolute top-1/2 right-0 -translate-y-1/2 text-[9px] font-bold text-earth-400 dark:text-gray-500">E</div>
              <div className="absolute top-1/2 left-0 -translate-y-1/2 text-[9px] font-bold text-earth-400 dark:text-gray-500">W</div>
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-b-[10px] border-transparent border-b-red-500" />
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[10px] border-transparent border-t-earth-300 dark:border-t-gray-600" />
            </div>
          </div>

          {/* Scrollable canvas */}
          <div
            ref={canvasRef}
            className={`absolute inset-0 overflow-hidden ${editMode && (addingZoneType || placingGroundPlant !== null) ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'} touch-none`}
            onMouseDown={(e) => { if (editMode && addingZoneType && drawingMode === 'rectangle') { handleDrawMouseDown(e); } else if (!addingZoneType) { handleCanvasMouseDown(e); } }}
            onMouseMove={(e) => { if (editMode && addingZoneType) { handleDrawMouseMove(e); } else { handleCanvasMouseMove(e); } }}
            onMouseUp={() => { if (editMode && addingZoneType && drawingMode === 'rectangle' && drawStart) { handleDrawMouseUp(); } else { handleCanvasMouseUp(); } }}
            onMouseLeave={() => { handleCanvasMouseUp(); setPolygonCursor(null); }}
            onClick={(e) => { setViewTooltip(null); handleCanvasClick(e); }}
            onDoubleClick={(e) => handleCanvasDoubleClick(e)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setAddingZoneType(null); setDrawStart(null); setDrawCurrent(null); setPolygonPoints([]); setPolygonCursor(null); } }}
            tabIndex={0}
          >
            {/* Property boundary with grid */}
            <div
              className="absolute border-2 border-earth-400 dark:border-gray-500 rounded-sm"
              style={{
                left: panOffset.x,
                top: panOffset.y,
                width: canvasWidth,
                height: canvasHeight,
                backgroundImage: `
                  linear-gradient(to right, rgba(168,162,158,0.15) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(168,162,158,0.15) 1px, transparent 1px)
                `,
                backgroundSize: `${zoom}px ${zoom}px`,
              }}
            >
              {/* Scale labels */}
              {Array.from({ length: Math.floor(property.width_feet / 10) + 1 }).map((_, i) => (
                <div key={`sx-${i}`} className="absolute text-[8px] text-earth-400 dark:text-gray-600 select-none" style={{ left: ftToPx(i * 10) - 4, top: -12 }}>
                  {i * 10}
                </div>
              ))}
              {Array.from({ length: Math.floor(property.height_feet / 10) + 1 }).map((_, i) => (
                <div key={`sy-${i}`} className="absolute text-[8px] text-earth-400 dark:text-gray-600 select-none" style={{ left: -18, top: ftToPx(i * 10) - 5 }}>
                  {i * 10}
                </div>
              ))}

              {/* Sun path overlay */}
              {renderSunPath()}

              {/* Shadow polygons overlay */}
              {renderShadows()}

              {/* Area overlays (rendered behind zones) */}
              {areas.filter(a => a.map_x_feet != null && a.map_width_feet != null).map(area => {
                const polyPts: PolygonPoint[] | null = area.map_polygon_points ? (() => { try { return JSON.parse(area.map_polygon_points!); } catch { return null; } })() : null;
                if (polyPts && polyPts.length >= 3) {
                  const pointsStr = polyPts.map(p => `${ftToPx(p.x)},${ftToPx(p.y)}`).join(' ');
                  return (
                    <svg key={`area-${area.id}`} className="absolute inset-0 pointer-events-none" style={{ zIndex: 5, width: canvasWidth, height: canvasHeight }}>
                      <polygon
                        points={pointsStr}
                        fill={area.color || '#6366f1'}
                        fillOpacity={0.15}
                        stroke={area.color || '#6366f1'}
                        strokeWidth={2}
                        strokeDasharray="6 4"
                      />
                      {(() => {
                        const cx = polyPts.reduce((s, p) => s + p.x, 0) / polyPts.length;
                        const cy = polyPts.reduce((s, p) => s + p.y, 0) / polyPts.length;
                        return (
                          <text x={ftToPx(cx)} y={ftToPx(cy)} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight="bold" fill={area.color || '#6366f1'} opacity={0.7}>
                            {area.name}
                          </text>
                        );
                      })()}
                    </svg>
                  );
                }
                return (
                  <div
                    key={`area-${area.id}`}
                    className="absolute rounded-md pointer-events-none"
                    style={{
                      left: ftToPx(area.map_x_feet!),
                      top: ftToPx(area.map_y_feet!),
                      width: ftToPx(area.map_width_feet!),
                      height: ftToPx(area.map_height_feet!),
                      backgroundColor: area.color ? `${area.color}22` : 'rgba(99,102,241,0.1)',
                      border: `2px dashed ${area.color || '#6366f1'}`,
                      zIndex: 5,
                    }}
                  >
                    <span className="absolute top-0.5 left-1 text-[9px] font-bold" style={{ color: area.color || '#6366f1', opacity: 0.7 }}>
                      {area.name}
                    </span>
                  </div>
                );
              })}

              {/* Zones — SVG layer for polygon zones */}
              {zones.filter(z => z.polygon_points).length > 0 && (
                <svg className="absolute inset-0" style={{ zIndex: 10, pointerEvents: 'none', width: canvasWidth, height: canvasHeight }}>
                  {zones.filter(z => z.polygon_points).map(zone => {
                    let pts: PolygonPoint[];
                    try { pts = JSON.parse(zone.polygon_points!); } catch { return null; }
                    if (!pts || pts.length < 3) return null;
                    const hexColor = ZONE_HEX_COLORS[zone.zone_type] || ZONE_HEX_COLORS.other;
                    const isSelected = selectedZone === zone.id;
                    const isCutout = zone.is_cutout === 1;
                    const pointsStr = pts.map(p => `${ftToPx(p.x)},${ftToPx(p.y)}`).join(' ');

                    return (
                      <g key={`zone-svg-${zone.id}`} style={{ pointerEvents: addingZoneType ? 'none' : 'all', cursor: 'move' }}
                        onMouseDown={(e) => { if (addingZoneType) return; handleZoneMouseDown(zone.id, e as unknown as React.MouseEvent); }}
                        onClick={(e) => { if (addingZoneType) return; e.stopPropagation(); if (!editMode) { showViewTooltipForZone(zone, e as unknown as React.MouseEvent); return; } if (handleItemClick('zone', zone.id, e as unknown as React.MouseEvent)) return; setSelectedZone(zone.id); setSelectedBedPos(null); }}
                      >
                        <polygon
                          points={pointsStr}
                          fill={isCutout ? 'rgba(255,255,255,0.8)' : hexColor}
                          fillOpacity={isCutout ? 0.9 : 0.5}
                          stroke={isSelected ? '#22c55e' : hexColor}
                          strokeWidth={isSelected ? 3 : 2}
                          strokeDasharray={isCutout ? '4 3' : undefined}
                        />
                        {/* Label */}
                        {(() => {
                          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
                          const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
                          return (
                            <text x={ftToPx(cx)} y={ftToPx(cy)} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="bold" fill="rgba(0,0,0,0.5)">
                              {zone.name}
                            </text>
                          );
                        })()}
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* Zones — rectangle zones (non-polygon) */}
              {zones.filter(z => !z.polygon_points).map(zone => {
                const colors = ZONE_COLORS[zone.zone_type] || ZONE_COLORS.other;
                const isSelected = selectedZone === zone.id;
                const useHex = colors.hex && !colors.bg;
                // Dimension swap for 90/270 rotation instead of CSS rotate
                const zoneIsSwapped = zone.rotation_degrees === 90 || zone.rotation_degrees === 270;
                const zoneRenderW = zoneIsSwapped ? zone.height_feet : zone.width_feet;
                const zoneRenderH = zoneIsSwapped ? zone.width_feet : zone.height_feet;
                const zoneOffsetX = zoneIsSwapped ? (zone.width_feet - zone.height_feet) / 2 : 0;
                const zoneOffsetY = zoneIsSwapped ? (zone.height_feet - zone.width_feet) / 2 : 0;
                return (
                  <div
                    key={`zone-${zone.id}`}
                    className={`absolute ${!useHex ? colors.bg : ''} ${!useHex ? colors.border : ''} ${!useHex ? 'border-2' : ''} rounded-sm transition-shadow cursor-move select-none ${
                      isSelected ? 'shadow-lg ring-2 ring-garden-400 z-20' : 'z-10 hover:shadow-md'
                    } ${draggingZone === zone.id ? 'opacity-90' : ''}`}
                    style={{
                      left: ftToPx(zone.x_feet - zoneOffsetX),
                      top: ftToPx(zone.y_feet - zoneOffsetY),
                      width: ftToPx(zoneRenderW),
                      height: ftToPx(zoneRenderH),
                      transform: zone.rotation_degrees === 180 ? 'rotate(180deg)' : undefined,
                      transformOrigin: zone.rotation_degrees === 180 ? 'center center' : undefined,
                      ...(useHex ? { backgroundColor: `${colors.hex}66`, border: `2px solid ${colors.hex}` } : {}),
                      ...(addingZoneType ? { pointerEvents: 'none' as const } : {}),
                    }}
                    onMouseDown={(e) => { if (addingZoneType) return; handleZoneMouseDown(zone.id, e); }}
                    onClick={(e) => {
                      if (addingZoneType) return;
                      e.stopPropagation();
                      if (!editMode) { showViewTooltipForZone(zone, e); return; }
                      if (handleItemClick('zone', zone.id, e)) return;
                      setSelectedZone(zone.id); setSelectedBedPos(null);
                    }}
                  >
                    {/* Multi-select highlight */}
                    {editMode && selectedItems.has(`zone-${zone.id}`) && (
                      <div className="absolute inset-0 ring-2 ring-blue-400 bg-blue-100/20 dark:bg-blue-900/20 rounded-sm pointer-events-none z-[1]" />
                    )}
                    {/* Zone label */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      {editMode && renamingZone === zone.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => handleRenameZone(zone.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameZone(zone.id); if (e.key === 'Escape') setRenamingZone(null); }}
                          className="text-xs px-1 py-0.5 rounded border border-earth-400 bg-white/90 dark:bg-gray-800/90 text-earth-800 dark:text-gray-200 w-20 text-center pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-[10px] font-bold text-earth-700/70 dark:text-gray-300/70 truncate px-1">
                          {zone.name}
                        </span>
                      )}
                    </div>

                    {/* Resize handles (only when selected in edit mode) */}
                    {editMode && isSelected && !draggingZone && (
                      <>
                        {['nw', 'ne', 'sw', 'se'].map(handle => (
                          <div
                            key={handle}
                            className="absolute w-3 h-3 bg-white dark:bg-gray-200 border-2 border-garden-500 rounded-full cursor-nwse-resize z-30"
                            style={{
                              top: handle.includes('n') ? -6 : undefined,
                              bottom: handle.includes('s') ? -6 : undefined,
                              left: handle.includes('w') ? -6 : undefined,
                              right: handle.includes('e') ? -6 : undefined,
                              cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                            }}
                            onMouseDown={(e) => handleResizeMouseDown(zone.id, handle, e)}
                          />
                        ))}
                        {/* Actions */}
                        <div className="absolute -top-7 left-0 flex gap-1 z-30" onMouseDown={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setRenamingZone(zone.id); setRenameValue(zone.name); }}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-600 shadow-sm"
                          >
                            Rename
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteZone(zone.id); }}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 dark:bg-red-900 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800 shadow-sm"
                          >
                            Delete
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const z = zones.find(zn => zn.id === zone.id);
                              if (!z) return;
                              const newRot = (z.rotation_degrees + 90) % 360;
                              updateZone(zone.id, { rotation_degrees: newRot }).then((updated) => {
                                setZones(prev => prev.map(zn => zn.id === zone.id ? updated : zn));
                              }).catch(() => {
                                // Optimistic update even if API fails
                                setZones(prev => prev.map(zn => zn.id === zone.id ? { ...zn, rotation_degrees: newRot } : zn));
                              });
                            }}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-600 shadow-sm"
                          >
                            Rotate
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setSizeFormZone(zone.id); setSizeFormWidth(String(zone.width_feet)); setSizeFormHeight(String(zone.height_feet)); setSizeFormHeightFt(String(zone.height_ft ?? 6)); }} className="px-1.5 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-600 shadow-sm">Set Size</button>
                        </div>
                        {sizeFormZone === zone.id && (
                          <div className="absolute -top-[72px] left-0 flex items-end gap-1 z-40 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 rounded-lg shadow-lg p-2" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                            <label className="block"><span className="text-[9px] text-earth-500 dark:text-gray-400">W (ft)</span><input type="number" step="0.5" min="0.5" value={sizeFormWidth} onChange={(e) => setSizeFormWidth(e.target.value)} className="w-14 text-[10px] px-1 py-0.5 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200 block" autoFocus /></label>
                            <span className="text-[10px] text-earth-400 dark:text-gray-500 mb-0.5">x</span>
                            <label className="block"><span className="text-[9px] text-earth-500 dark:text-gray-400">D (ft)</span><input type="number" step="0.5" min="0.5" value={sizeFormHeight} onChange={(e) => setSizeFormHeight(e.target.value)} className="w-14 text-[10px] px-1 py-0.5 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200 block" /></label>
                            {(zone.zone_type === 'fence' || zone.zone_type === 'house' || zone.zone_type === 'other') && (<label className="block"><span className="text-[9px] text-earth-500 dark:text-gray-400">H (ft)</span><input type="number" step="0.5" min="0.1" value={sizeFormHeightFt} onChange={(e) => setSizeFormHeightFt(e.target.value)} className="w-14 text-[10px] px-1 py-0.5 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200 block" /></label>)}
                            <button onClick={() => handleSetSize(zone.id)} className="px-1.5 py-0.5 text-[10px] rounded bg-garden-600 text-white hover:bg-garden-700 shadow-sm">Apply</button>
                            <button onClick={() => setSizeFormZone(null)} className="px-1.5 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 shadow-sm">Cancel</button>
                          </div>
                        )}
                        {/* Soil info popup below zone */}
                        <div
                          className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 rounded-lg shadow-lg p-2 z-40 min-w-[180px] max-w-[220px]"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-bold text-earth-600 dark:text-gray-300 mb-1">Zone Soil</div>
                          <div className="flex flex-col gap-1">
                            <select
                              value={zone.soil_type || ''}
                              onChange={(e) => {
                                const val = e.target.value || undefined;
                                updateZone(zone.id, { soil_type: val }).then(updated => {
                                  setZones(prev => prev.map(z => z.id === zone.id ? updated : z));
                                }).catch(() => {});
                              }}
                              className="text-[10px] px-1 py-0.5 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200"
                            >
                              <option value="">Inherit from property</option>
                              {Object.entries(SOIL_TYPE_LABELS).map(([val, label]) => (
                                <option key={val} value={val}>{label}</option>
                              ))}
                            </select>
                            {zone.soil_type && (
                              <div className="flex gap-1">
                                <input
                                  type="number"
                                  step="0.1"
                                  placeholder="pH min"
                                  value={zone.soil_ph_min ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value ? parseFloat(e.target.value) : null;
                                    updateZone(zone.id, { soil_ph_min: val as any }).then(updated => {
                                      setZones(prev => prev.map(z => z.id === zone.id ? updated : z));
                                    }).catch(() => {});
                                  }}
                                  className="w-14 text-[10px] px-1 py-0.5 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200"
                                />
                                <span className="text-[10px] text-earth-400">-</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  placeholder="pH max"
                                  value={zone.soil_ph_max ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value ? parseFloat(e.target.value) : null;
                                    updateZone(zone.id, { soil_ph_max: val as any }).then(updated => {
                                      setZones(prev => prev.map(z => z.id === zone.id ? updated : z));
                                    }).catch(() => {});
                                  }}
                                  className="w-14 text-[10px] px-1 py-0.5 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200"
                                />
                              </div>
                            )}
                            <span className="text-[9px] text-earth-400 dark:text-gray-500">
                              {zone.soil_type ? SOIL_TYPE_LABELS[zone.soil_type] : `Default: ${SOIL_TYPE_LABELS[property.default_soil_type || 'native-clay'] || 'Native Clay'}`}
                              {zone.soil_ph_min && zone.soil_ph_max ? ` (pH ${zone.soil_ph_min}-${zone.soil_ph_max})` : ''}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Placed beds */}
              {bedPositions.map(bp => {
                const bed = beds.find(b => b.id === bp.bed_id);
                if (!bed) return null;
                const grid = grids[bp.bed_id];
                const wFt = bedWidthFt(bp);
                const hFt = bedHeightFt(bp);
                const isSelected = selectedBedPos === bp.bed_id;
                const sunData = showSun ? sunDailyData.find(s => s.bed_id === bp.bed_id) : null;
                const sunBg = sunData ? SUN_QUALITY_COLORS[sunData.sun_quality] || 'transparent' : 'transparent';
                // Dimension swap for 90/270 rotation instead of CSS rotate
                const bedIsSwapped = bp.rotation_degrees === 90 || bp.rotation_degrees === 270;
                const bedRenderW = bedIsSwapped ? hFt : wFt;
                const bedRenderH = bedIsSwapped ? wFt : hFt;

                return (
                  <div
                    key={`bed-${bp.bed_id}`}
                    className={`absolute rounded-md border-2 cursor-move select-none transition-shadow ${
                      isSelected
                        ? 'border-garden-500 shadow-lg ring-2 ring-garden-300 z-25'
                        : 'border-green-600 dark:border-green-500 hover:shadow-md z-15'
                    } ${draggingBed === bp.bed_id ? 'opacity-90' : ''}`}
                    style={{
                      left: ftToPx(bp.x_feet),
                      top: ftToPx(bp.y_feet),
                      width: ftToPx(bedRenderW),
                      height: ftToPx(bedRenderH),
                      transform: bp.rotation_degrees === 180 ? 'rotate(180deg)' : undefined,
                      transformOrigin: bp.rotation_degrees === 180 ? 'center center' : undefined,
                      background: showSun && sunData
                        ? sunBg
                        : undefined,
                      zIndex: isSelected ? 25 : 15,
                      ...(addingZoneType ? { pointerEvents: 'none' as const } : {}),
                    }}
                    onMouseDown={(e) => { if (addingZoneType) return; handleBedPosMouseDown(bp.bed_id, e); }}
                    onClick={(e) => { if (addingZoneType) return; e.stopPropagation(); if (!editMode) { showViewTooltipForBed(bp, e); return; } if (handleItemClick('bed', bp.bed_id, e)) return; setSelectedBedPos(bp.bed_id); setSelectedZone(null); }}
                    onDoubleClick={() => { if (addingZoneType) return; router.push(`/planters/${bp.bed_id}`); }}
                    onMouseEnter={() => { if (showSun && sunData) setHoveredBedSun(bp.bed_id); }}
                    onMouseLeave={() => { setHoveredBedSun(null); }}
                  >
                    {/* Multi-select highlight */}
                    {editMode && selectedItems.has(`bed-${bp.bed_id}`) && (
                      <div className="absolute inset-0 ring-2 ring-blue-400 bg-blue-100/20 dark:bg-blue-900/20 rounded-md pointer-events-none z-[1]" />
                    )}
                    {/* Bed background when sun is off */}
                    {!showSun && (
                      <div className="absolute inset-0 bg-green-100/80 dark:bg-green-900/40 rounded-[4px]" />
                    )}

                    {/* Sun exposure hover tooltip */}
                    {showSun && sunData && hoveredBedSun === bp.bed_id && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 bottom-full mb-6 bg-white dark:bg-gray-800 border border-yellow-300 dark:border-yellow-700 rounded-lg shadow-lg p-2.5 z-50 min-w-[180px] max-w-[240px] pointer-events-none"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-yellow-500 text-sm">&#9728;</span>
                          <span className="font-bold text-xs text-earth-800 dark:text-gray-100">{bp.bed_name}</span>
                        </div>
                        <div className="text-[10px] text-earth-600 dark:text-gray-300 space-y-0.5">
                          <div className={`font-semibold ${sunData.sun_quality === 'full sun' ? 'text-yellow-600' : sunData.sun_quality === 'partial sun' ? 'text-amber-600' : 'text-gray-500'}`}>
                            {sunData.sun_hours}h direct sun ({sunData.sun_quality})
                          </div>
                          <div>Morning: {sunData.morning_sun_hours}h | Afternoon: {sunData.afternoon_sun_hours}h</div>
                          {sunData.shade_sources && sunData.shade_sources.length > 0 && (
                            <div className="mt-1 border-t border-earth-200 dark:border-gray-600 pt-1">
                              {sunData.shade_sources.map((src, si) => (
                                <div key={si} className="text-earth-500 dark:text-gray-400">
                                  {typeof src === 'string'
                                    ? `Shaded by ${src}`
                                    : `Shaded ${src.time_range} by ${src.name} (${src.shaded_hours}h)`
                                  }
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Mini plant grid — fills the entire planter footprint */}
                    {zoom >= 4 && grid && (() => {
                      const cols = bedIsSwapped ? bp.height_cells : bp.width_cells;
                      const rows = bedIsSwapped ? bp.width_cells : bp.height_cells;
                      const bedPxW = ftToPx(bedRenderW);
                      const bedPxH = ftToPx(bedRenderH);
                      const padding = 2;
                      const gap = 1;
                      const availW = bedPxW - padding * 2 - gap * (cols - 1);
                      const availH = bedPxH - padding * 2 - gap * (rows - 1);
                      const cellSize = Math.max(2, Math.min(availW / cols, availH / rows));
                      const isSinglePlant = cols === 1 && rows === 1;

                      // Single-plant bed: show one centered icon
                      if (isSinglePlant) {
                        const cell = grid?.grid?.[0]?.[0];
                        const iconSize = Math.min(bedPxW, bedPxH) * 0.6;
                        return (
                          <div className="absolute inset-0 flex items-center justify-center">
                            {cell ? (
                              <span
                                className="flex items-center justify-center"
                                style={{ fontSize: Math.max(8, iconSize), lineHeight: 1 }}
                                title={cell.plant_name}
                              >
                                {getPlantIcon(cell.plant_name, cell.category)}
                              </span>
                            ) : (
                              <div className="rounded bg-green-200/40 dark:bg-green-800/30" style={{ width: iconSize, height: iconSize }} />
                            )}
                          </div>
                        );
                      }

                      return (
                        <div
                          className="absolute inset-0 grid"
                          style={{
                            gridTemplateColumns: `repeat(${cols}, 1fr)`,
                            gridTemplateRows: `repeat(${rows}, 1fr)`,
                            gap: `${gap}px`,
                            padding: `${padding}px`,
                          }}
                        >
                          {Array.from({ length: rows }).map((_, y) =>
                            Array.from({ length: cols }).map((_, x) => {
                              const gridX = bedIsSwapped ? y : x;
                              const gridY = bedIsSwapped ? x : y;
                              const cell = grid?.grid?.[gridY]?.[gridX];
                              return (
                                <div
                                  key={`${x}-${y}`}
                                  className={`rounded-[1px] overflow-hidden flex items-center justify-center ${
                                    cell
                                      ? `${categoryColor[cell.category] || 'bg-gray-200'}`
                                      : 'bg-green-200/40 dark:bg-green-800/30'
                                  }`}
                                  title={cell ? cell.plant_name : ''}
                                >
                                  {cell && cellSize >= 10 && (
                                    <span className="flex items-center justify-center leading-none" style={{ fontSize: Math.max(6, cellSize * 0.7) }}>
                                      {getPlantIcon(cell.plant_name, cell.category)}
                                    </span>
                                  )}
                                  {cell && cellSize >= 30 && (
                                    <span className="text-[6px] leading-tight text-earth-700 dark:text-gray-200 truncate px-px">
                                      {cell.plant_name}
                                    </span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      );
                    })()}

                    {/* Bed label */}
                    <div className="absolute -top-4 left-0 right-0 text-center">
                      <span className="text-[9px] font-bold text-green-800 dark:text-green-300 bg-white/80 dark:bg-gray-900/80 px-1 rounded">
                        {bp.bed_name}
                        {showSun && sunData && (
                          <span className="ml-1 text-yellow-700 dark:text-yellow-400">{sunData.sun_hours}h</span>
                        )}
                      </span>
                    </div>

                    {/* Selected planter actions — edit mode only */}
                    {editMode && isSelected && (
                      <div className="absolute -bottom-6 left-0 flex gap-1 z-30" onMouseDown={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const currentBp = bedPositions.find(b => b.bed_id === bp.bed_id);
                            if (!currentBp) return;
                            const newRot = ((currentBp.rotation_degrees || 0) + 90) % 360;
                            setBedPosition(bp.bed_id, { x_feet: currentBp.x_feet, y_feet: currentBp.y_feet, rotation_degrees: newRot }).then(() => {
                              setBedPositions(prev => prev.map(b => b.bed_id === bp.bed_id ? { ...b, rotation_degrees: newRot } : b));
                            }).catch(() => {
                              setBedPositions(prev => prev.map(b => b.bed_id === bp.bed_id ? { ...b, rotation_degrees: newRot } : b));
                            });
                          }}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-600 shadow-sm"
                        >
                          Rotate
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); router.push(`/planters/${bp.bed_id}`); }}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-600 shadow-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showConfirm({ title: 'Remove Bed', message: 'Remove this bed from the map?', confirmText: 'Remove', destructive: true }).then(confirmed => {
                              if (!confirmed) return;
                              deleteBedPosition(bp.bed_id).then(() => {
                                setBedPositions(prev => prev.filter(b => b.bed_id !== bp.bed_id));
                                setSelectedBedPos(null);
                                toast('Bed removed from map');
                              }).catch(() => {});
                            });
                          }}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 dark:bg-red-900 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800 shadow-sm"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Ground plant markers */}
              {groundPlants.filter(gp => gp.x_feet != null && gp.y_feet != null).map(gp => {
                const isSelected = selectedGroundPlant === gp.id;
                const isDragging = draggingGroundPlant === gp.id;
                // Larger marker with category-based coloring; trees get bigger spread
                const isTree = gp.plant_category === 'tree' || gp.plant_name.toLowerCase().includes('tree') || gp.plant_name.toLowerCase().includes('laurel') || gp.plant_name.toLowerCase().includes('palm');
                const baseSize = isTree ? Math.max(32, zoom * 3) : Math.max(22, zoom * 1.8);
                const markerSize = isDragging ? baseSize * 1.15 : baseSize;
                const canopyColor = isTree ? 'rgba(34,197,94,0.25)' : categoryColor[gp.plant_category] ? `${categoryColor[gp.plant_category].replace('bg-', '')}` : undefined;
                const canopySize = isTree ? markerSize * 1.6 : markerSize * 1.2;
                return (
                  <div
                    key={`gp-${gp.id}`}
                    className={`absolute flex items-center justify-center cursor-move select-none z-20 transition-transform ${
                      isDragging ? 'scale-110 z-30' : ''
                    } ${isSelected ? 'z-30' : ''}`}
                    style={{
                      left: ftToPx(gp.x_feet!) - markerSize / 2,
                      top: ftToPx(gp.y_feet!) - markerSize / 2,
                      width: markerSize,
                      height: markerSize,
                      filter: isDragging ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' : undefined,
                      ...(addingZoneType ? { pointerEvents: 'none' as const } : {}),
                    }}
                    title={`${gp.name || gp.plant_name} (${gp.status})`}
                    onMouseDown={(e) => { if (addingZoneType) return; handleGroundPlantMouseDown(gp.id, e); }}
                    onClick={(e) => {
                      if (addingZoneType) return;
                      e.stopPropagation();
                      if (!editMode) { showViewTooltipForPlant(gp, e); return; }
                      if (handleItemClick('gp', gp.id, e)) return;
                      setSelectedGroundPlant(isSelected ? null : gp.id);
                      setSelectedZone(null);
                      setSelectedBedPos(null);
                    }}
                  >
                    {/* Canopy/spread shadow */}
                    <span
                      className="absolute rounded-full"
                      style={{
                        width: canopySize,
                        height: canopySize,
                        left: (markerSize - canopySize) / 2,
                        top: (markerSize - canopySize) / 2,
                        backgroundColor: isTree ? 'rgba(34,197,94,0.2)' : (categoryBorder[gp.plant_category] || 'border-gray-400').includes('green') ? 'rgba(34,197,94,0.15)' : 'rgba(168,85,247,0.12)',
                        boxShadow: isTree ? '0 0 8px 4px rgba(34,197,94,0.15)' : '0 0 4px 2px rgba(0,0,0,0.08)',
                      }}
                    />
                    {/* Multi-select highlight */}
                    {editMode && selectedItems.has(`gp-${gp.id}`) && (
                      <span className="absolute inset-0 rounded-full ring-2 ring-blue-400 bg-blue-100/20 dark:bg-blue-900/20" />
                    )}
                    {/* Selection ring */}
                    {isSelected && (
                      <span className="absolute inset-0 rounded-full ring-2 ring-garden-400 bg-garden-100/30 dark:bg-garden-900/30" />
                    )}
                    <span className="drop-shadow-sm relative" style={{ fontSize: Math.max(14, zoom * 1.5) }}>
                      {getPlantIcon(gp.plant_name, gp.plant_category)}
                    </span>
                    {/* Label at higher zoom */}
                    {zoom >= 6 && (
                      <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-bold text-earth-700 dark:text-gray-300 bg-white/80 dark:bg-gray-800/80 px-1 rounded">
                        {gp.name || gp.plant_name}
                      </span>
                    )}
                    {/* Popup when selected — edit mode only */}
                    {editMode && isSelected && !isDragging && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 rounded-lg shadow-lg p-2.5 z-40 min-w-[160px]"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span style={{ fontSize: 16 }}>{getPlantIcon(gp.plant_name, gp.plant_category)}</span>
                          <span className="font-bold text-xs text-earth-800 dark:text-gray-100">{gp.name || gp.plant_name}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 text-[10px] text-earth-500 dark:text-gray-400 mb-2">
                          <span>Status: <span className="font-medium text-earth-700 dark:text-gray-300">{gp.status}</span></span>
                          {gp.area_name && <span>Area: <span className="font-medium text-earth-700 dark:text-gray-300">{gp.area_name}</span></span>}
                          {gp.irrigation_zone_name && <span>Irrigation: <span className="font-medium text-earth-700 dark:text-gray-300">{gp.irrigation_zone_name}</span></span>}
                          <span>Position: ({gp.x_feet}, {gp.y_feet})ft</span>
                          {/* Soil info — derive from zone or property default */}
                          {(() => {
                            const zone = gp.zone_id ? zones.find(z => z.id === gp.zone_id) : null;
                            const soilType = zone?.soil_type || property.default_soil_type || 'native-clay';
                            const soilLabel = SOIL_TYPE_LABELS[soilType] || soilType;
                            const ph = zone?.soil_type ? (zone.soil_ph_min && zone.soil_ph_max ? `${zone.soil_ph_min}-${zone.soil_ph_max}` : null) : (property.default_soil_ph ? `~${property.default_soil_ph}` : '~8.0');
                            return (
                              <span>Soil: <span className="font-medium text-amber-700 dark:text-amber-300">{soilLabel}{ph ? ` (pH ${ph})` : ''}</span></span>
                            );
                          })()}
                        </div>
                        <div className="flex gap-1">
                          <Link
                            href="/ground-plants"
                            className="px-1.5 py-0.5 text-[10px] rounded bg-garden-50 dark:bg-garden-900 border border-garden-300 dark:border-garden-700 text-garden-700 dark:text-garden-300 hover:bg-garden-100 dark:hover:bg-garden-800 shadow-sm transition-colors"
                          >
                            View Details
                          </Link>
                          <button
                            onClick={() => handleDeleteGroundPlant(gp.id)}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 dark:bg-red-900 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800 shadow-sm transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Selected polygon zone actions — edit mode only */}
              {editMode && selectedZone !== null && zones.find(z => z.id === selectedZone && z.polygon_points) && (() => {
                const zone = zones.find(z => z.id === selectedZone)!;
                let pts: PolygonPoint[];
                try { pts = JSON.parse(zone.polygon_points!); } catch { return null; }
                const minY = Math.min(...pts.map(p => p.y));
                const minX = Math.min(...pts.map(p => p.x));
                return (
                  <div
                    className="absolute flex gap-1 z-30"
                    style={{ left: ftToPx(minX), top: ftToPx(minY) - 24 }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingZone(zone.id); setRenameValue(zone.name); }}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-white dark:bg-gray-700 border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-600 shadow-sm"
                    >
                      Rename
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteZone(zone.id); }}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 dark:bg-red-900 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800 shadow-sm"
                    >
                      Delete
                    </button>
                  </div>
                );
              })()}

              {/* Polygon edit handles — corner drag + midpoint add + double-click delete */}
              {editMode && selectedZone !== null && !addingZoneType && (() => {
                const zone = zones.find(z => z.id === selectedZone);
                if (!zone?.polygon_points) return null;
                let pts: PolygonPoint[];
                try { pts = JSON.parse(zone.polygon_points); } catch { return null; }
                if (pts.length < 3) return null;
                return (
                  <svg className="absolute inset-0" style={{ width: canvasWidth, height: canvasHeight, pointerEvents: 'none', zIndex: 50 }}>
                    {/* Corner handles */}
                    {pts.map((pt, i) => (
                      <circle
                        key={`edit-pt-${i}`}
                        cx={ftToPx(pt.x)}
                        cy={ftToPx(pt.y)}
                        r={6}
                        fill="#22c55e"
                        stroke="white"
                        strokeWidth={2}
                        style={{ pointerEvents: 'all', cursor: editingPolygonPointIndex === i ? 'grabbing' : 'grab' }}
                        onMouseDown={(e) => startPolygonPointDrag(i, e)}
                        onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); deletePolygonPoint(i); }}
                      />
                    ))}
                    {/* Midpoint handles for adding new points */}
                    {pts.map((pt, i) => {
                      const next = pts[(i + 1) % pts.length];
                      const mx = (pt.x + next.x) / 2;
                      const my = (pt.y + next.y) / 2;
                      return (
                        <circle
                          key={`mid-${i}`}
                          cx={ftToPx(mx)}
                          cy={ftToPx(my)}
                          r={4}
                          fill="#3b82f6"
                          stroke="white"
                          strokeWidth={1.5}
                          style={{ pointerEvents: 'all', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); addPolygonMidpoint(i, mx, my); }}
                        />
                      );
                    })}
                  </svg>
                );
              })()}

              {/* Drawing preview — rectangle */}
              {drawStart && drawCurrent && addingZoneType && drawingMode === 'rectangle' && (() => {
                const colors = ZONE_COLORS[addingZoneType] || ZONE_COLORS.other;
                const useHex = colors.hex && !colors.bg;
                return (
                  <div
                    className={`absolute ${!useHex ? (colors.bg || 'bg-gray-200') : ''} ${!useHex ? (colors.border || 'border-gray-400') : ''} ${!useHex ? 'border-2' : ''} opacity-60 rounded-sm pointer-events-none z-30`}
                    style={{
                      left: ftToPx(Math.min(drawStart.x, drawCurrent.x)),
                      top: ftToPx(Math.min(drawStart.y, drawCurrent.y)),
                      width: ftToPx(Math.abs(drawCurrent.x - drawStart.x)),
                      height: ftToPx(Math.abs(drawCurrent.y - drawStart.y)),
                      ...(useHex ? { backgroundColor: `${colors.hex}66`, border: `2px solid ${colors.hex}` } : {}),
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-earth-700/70 dark:text-gray-300/70">
                        {Math.abs(drawCurrent.x - drawStart.x)}ft x {Math.abs(drawCurrent.y - drawStart.y)}ft
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Drawing preview — polygon/cut points */}
              {addingZoneType && (drawingMode === 'polygon' || drawingMode === 'cut') && (polygonPoints.length > 0 || polygonCursor) && (
                <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 35, width: canvasWidth, height: canvasHeight }}>
                  {/* Lines between placed points */}
                  {polygonPoints.map((pt, i) => {
                    if (i === 0) return null;
                    const prev = polygonPoints[i - 1];
                    return (
                      <line key={`line-${i}`} x1={ftToPx(prev.x)} y1={ftToPx(prev.y)} x2={ftToPx(pt.x)} y2={ftToPx(pt.y)}
                        stroke={drawingMode === 'cut' ? '#ef4444' : (ZONE_HEX_COLORS[addingZoneType] || '#94A3B8')}
                        strokeWidth={2} strokeDasharray={drawingMode === 'cut' ? '4 3' : undefined}
                      />
                    );
                  })}
                  {/* Line to cursor */}
                  {polygonCursor && polygonPoints.length > 0 && (
                    <line
                      x1={ftToPx(polygonPoints[polygonPoints.length - 1].x)} y1={ftToPx(polygonPoints[polygonPoints.length - 1].y)}
                      x2={ftToPx(polygonCursor.x)} y2={ftToPx(polygonCursor.y)}
                      stroke={drawingMode === 'cut' ? '#ef4444' : (ZONE_HEX_COLORS[addingZoneType] || '#94A3B8')}
                      strokeWidth={1.5} strokeDasharray="4 4" opacity={0.6}
                    />
                  )}
                  {/* Closing line preview (cursor to first point) */}
                  {polygonCursor && polygonPoints.length >= 2 && (
                    <line
                      x1={ftToPx(polygonCursor.x)} y1={ftToPx(polygonCursor.y)}
                      x2={ftToPx(polygonPoints[0].x)} y2={ftToPx(polygonPoints[0].y)}
                      stroke={drawingMode === 'cut' ? '#ef4444' : (ZONE_HEX_COLORS[addingZoneType] || '#94A3B8')}
                      strokeWidth={1} strokeDasharray="2 4" opacity={0.3}
                    />
                  )}
                  {/* Snapped cursor grid cell highlight */}
                  {polygonCursor && (
                    <rect
                      x={ftToPx(polygonCursor.x) - ftToPx(0.5)}
                      y={ftToPx(polygonCursor.y) - ftToPx(0.5)}
                      width={ftToPx(1)}
                      height={ftToPx(1)}
                      fill={drawingMode === 'cut' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.2)'}
                      stroke={drawingMode === 'cut' ? '#ef4444' : '#22c55e'}
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                  )}
                  {/* Snapped cursor crosshair dot */}
                  {polygonCursor && (
                    <circle cx={ftToPx(polygonCursor.x)} cy={ftToPx(polygonCursor.y)} r={3}
                      fill={drawingMode === 'cut' ? '#ef4444' : '#22c55e'} opacity={0.7}
                    />
                  )}
                  {/* Point dots */}
                  {polygonPoints.map((pt, i) => (
                    <circle key={`pt-${i}`} cx={ftToPx(pt.x)} cy={ftToPx(pt.y)} r={i === 0 ? 5 : 3.5}
                      fill={i === 0 ? '#22c55e' : (drawingMode === 'cut' ? '#ef4444' : (ZONE_HEX_COLORS[addingZoneType] || '#94A3B8'))}
                      stroke="white" strokeWidth={1.5}
                    />
                  ))}
                  {/* Fill preview */}
                  {polygonPoints.length >= 3 && (
                    <polygon
                      points={polygonPoints.map(p => `${ftToPx(p.x)},${ftToPx(p.y)}`).join(' ')}
                      fill={drawingMode === 'cut' ? 'rgba(255,255,255,0.4)' : (ZONE_HEX_COLORS[addingZoneType] || '#94A3B8')}
                      fillOpacity={0.2}
                      stroke="none"
                    />
                  )}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar drag ghost — bed */}
      {draggingBedFromSidebar !== null && sidebarDragPos && (
        <div
          className="fixed pointer-events-none z-50 bg-green-200/80 dark:bg-green-800/80 border-2 border-green-500 rounded-lg px-2 py-1 shadow-lg"
          style={{ left: sidebarDragPos.x + 10, top: sidebarDragPos.y + 10 }}
        >
          <span className="text-xs font-bold text-green-800 dark:text-green-200">
            {beds.find(b => b.id === draggingBedFromSidebar)?.name || 'Planter'}
          </span>
        </div>
      )}

      {/* View mode info tooltip */}
      {viewTooltip && !editMode && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 rounded-lg shadow-xl p-3 min-w-[160px] max-w-[240px]"
          style={{ left: Math.min(viewTooltip.x + 12, window.innerWidth - 260), top: viewTooltip.y + 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-1">
            {Object.entries(viewTooltip.data).map(([key, val]) => (
              <div key={key} className="text-xs">
                <span className="font-medium text-earth-500 dark:text-gray-400">{key}: </span>
                <span className="text-earth-800 dark:text-gray-200">{val}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2">
            {viewTooltip.link && (
              <button onClick={() => { setViewTooltip(null); router.push(viewTooltip.link!); }} className="text-[10px] font-medium text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300">View Details →</button>
            )}
            <button onClick={() => setViewTooltip(null)} className="text-[10px] text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 ml-auto">Dismiss</button>
          </div>
        </div>
      )}

      {/* Sidebar drag ghost — ground plant */}
      {draggingGPFromSidebar !== null && sidebarGPDragPos && (
        <div
          className="fixed pointer-events-none z-50 bg-amber-200/80 dark:bg-amber-800/80 border-2 border-amber-500 rounded-lg px-2 py-1 shadow-lg"
          style={{ left: sidebarGPDragPos.x + 10, top: sidebarGPDragPos.y + 10 }}
        >
          <span className="text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-1">
            {(() => { const gp = groundPlants.find(g => g.id === draggingGPFromSidebar); return gp ? `${getPlantIcon(gp.plant_name, gp.plant_category)} ${gp.name || gp.plant_name}` : 'Plant'; })()}
          </span>
        </div>
      )}
    </div>
  );
}
