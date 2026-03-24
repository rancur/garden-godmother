'use client';

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getPlants, getPlantCalendar, getPlantStats, getPlantVarieties, getPlantTips, getPlantDetails, getBeds, getTrays, getTrayGrid, getBedGrid, getPlantCompatiblePlanters, getGroundPlants, getExportUrl } from '../api';
import { getPlantIcon } from '../plant-icons';
import { TypeaheadSelect } from '../typeahead-select';
import { CardSkeleton } from '../skeleton';
import { formatGardenDate } from '../timezone';

interface Plant {
  id: number;
  name: string;
  category: string;
  subcategory: string;
  days_to_maturity_min: number;
  days_to_maturity_max: number;
  sun: string;
  water: string;
  heat_tolerance: string;
  spacing_inches: number;
  notes: string;
  desert_seasons: string[];
  companions?: string[];
  antagonists?: string[];
}

interface CalendarEvent {
  type: string;
  start: string;
  end: string;
  label: string;
}

interface PlantCalendar {
  plant: string;
  year: number;
  events: CalendarEvent[];
  days_to_maturity: string;
}

function formatCalDate(iso: string): string {
  return formatGardenDate(iso + 'T00:00:00', { month: 'short', day: 'numeric' });
}

const MONTH_LABELS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

function CalendarTimeline({ events }: { events: CalendarEvent[] }) {
  const colorMap: Record<string, string> = {
    start_seeds: 'bg-blue-400',
    direct_sow: 'bg-blue-400',
    transplant: 'bg-green-500',
    harvest: 'bg-orange-400',
    success: 'bg-teal-400',
  };

  function dayOfYear(iso: string): number {
    const d = new Date(iso + 'T00:00:00');
    const start = new Date(d.getFullYear(), 0, 1);
    return Math.floor((d.getTime() - start.getTime()) / 86400000);
  }

  return (
    <div className="mb-2">
      <div className="relative h-6 bg-earth-100 dark:bg-gray-700 rounded overflow-hidden">
        {events.map((event, i) => {
          const startDay = dayOfYear(event.start);
          const endDay = dayOfYear(event.end);
          const left = (startDay / 365) * 100;
          const width = Math.max(((endDay - startDay + 1) / 365) * 100, 1);
          return (
            <div
              key={i}
              className={`absolute top-0 h-full ${colorMap[event.type] || 'bg-earth-300'} opacity-80`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${event.label}: ${formatCalDate(event.start)} \u2192 ${formatCalDate(event.end)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-0.5">
        {MONTH_LABELS.map((m) => (
          <span key={m} className="text-[9px] text-earth-400 dark:text-gray-500">{m}</span>
        ))}
      </div>
      <div className="flex gap-3 mt-1 flex-wrap">
        <span className="flex items-center gap-1 text-[10px] text-earth-500 dark:text-gray-400"><span className="inline-block w-2.5 h-2.5 rounded bg-blue-400" />Sow</span>
        <span className="flex items-center gap-1 text-[10px] text-earth-500 dark:text-gray-400"><span className="inline-block w-2.5 h-2.5 rounded bg-green-500" />Transplant</span>
        <span className="flex items-center gap-1 text-[10px] text-earth-500 dark:text-gray-400"><span className="inline-block w-2.5 h-2.5 rounded bg-orange-400" />Harvest</span>
        {events.some(e => e.type === 'success') && (
          <span className="flex items-center gap-1 text-[10px] text-earth-500 dark:text-gray-400"><span className="inline-block w-2.5 h-2.5 rounded bg-teal-400" />Success</span>
        )}
      </div>
    </div>
  );
}

interface PlantStatsData {
  total: number;
  by_category: Record<string, number>;
  by_season: Record<string, number>;
  by_heat_tolerance: Record<string, number>;
  by_sun: Record<string, number>;
}

interface Variety {
  id: number;
  plant_id: number;
  name: string;
  description: string;
  days_to_maturity_min: number | null;
  days_to_maturity_max: number | null;
  heat_tolerance: string | null;
  disease_resistance: string | null;
  flavor_profile: string | null;
  size: string | null;
  color: string | null;
  growth_habit: string | null;
  desert_rating: number;
  desert_notes: string | null;
  source: string | null;
}

interface PlantDetails {
  plant_id: number;
  enriched: boolean;
  data_quality_score: number;
  is_harvestable?: number;
  success_state?: string;
  success_description?: string;
  scientific_name?: string;
  family?: string;
  genus?: string;
  common_names?: string[];
  usda_zones?: string[];
  min_soil_temp_f?: number;
  max_soil_temp_f?: number;
  ph_min?: number;
  ph_max?: number;
  soil_type?: string;
  mature_height_inches?: number;
  mature_spread_inches?: number;
  growth_rate?: string;
  growth_habit?: string;
  root_depth?: string;
  needs_trellis?: number;
  needs_cage?: number;
  needs_staking?: number;
  support_notes?: string;
  nitrogen_fixer?: number;
  heavy_feeder?: number;
  light_feeder?: number;
  preferred_amendments?: string[];
  soil_prep_notes?: string;
  water_inches_per_week?: number;
  drought_tolerant?: number;
  mulch_recommended?: number;
  edible_parts?: string[];
  culinary_uses?: string[];
  flavor_profile?: string;
  nutritional_highlights?: string;
  common_pests?: string[];
  common_diseases?: string[];
  organic_pest_solutions?: string[];
  disease_resistance?: string;
  pollination_type?: string;
  attracts_pollinators?: number;
  attracts_beneficial_insects?: number;
  deer_resistant?: number;
  succession_planting_interval_days?: number;
  good_cover_crop?: number;
  rotation_group?: string;
  plant_before?: string[];
  plant_after?: string[];
  seed_sources?: { name: string; url: string }[];
}

type VarietySortOption = 'name' | 'desert_rating' | 'maturity';

const categoryColor: Record<string, string> = {
  vegetable: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 hover:border-green-300',
  herb: 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700 hover:border-purple-300',
  flower: 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-700 hover:border-yellow-300',
  fruit: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 hover:border-red-300',
};

type SortOption = 'name' | 'maturity' | 'heat' | 'water';

const sortLabels: Record<SortOption, string> = {
  name: 'Name A-Z',
  maturity: 'Fastest Harvest',
  heat: 'Best for Desert',
  water: 'Least Water',
};

// Collapsible filter section component
function FilterSection({ title, defaultOpen = false, activeCount = 0, children }: { title: string; defaultOpen?: boolean; activeCount?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-earth-200 dark:border-gray-700 pb-3 mb-3 last:border-0 last:pb-0 last:mb-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-left text-sm font-bold text-earth-700 dark:text-gray-300 mb-2"
      >
        <span className="flex items-center gap-1.5">
          {title}
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center bg-garden-600 text-white text-[10px] font-bold rounded-full w-4 h-4 leading-none">
              {activeCount}
            </span>
          )}
        </span>
        <span className={`text-earth-400 dark:text-gray-500 transition-transform text-xs ${open ? 'rotate-180' : ''}`}>&#9660;</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// Checkbox filter item
function FilterCheckbox({ label, checked, onChange, count }: { label: string; checked: boolean; onChange: () => void; count?: number }) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer text-sm text-earth-600 dark:text-gray-400 hover:text-earth-800 dark:hover:text-gray-200 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 rounded border-earth-300 dark:border-gray-600 text-garden-600 focus:ring-garden-500 accent-garden-600"
      />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs text-earth-400 dark:text-gray-500">{count}</span>}
    </label>
  );
}

function PlantsPageInner() {
  const searchParams = useSearchParams();
  const highlightPlantId = searchParams.get('highlight') ? Number(searchParams.get('highlight')) : null;

  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PlantStatsData | null>(null);

  // Cross-reference data: which beds/trays have this plant
  const [plantBeds, setPlantBeds] = useState<{bed_id: number; bed_name: string; count: number}[]>([]);
  const [plantTrays, setPlantTrays] = useState<{tray_id: number; tray_name: string; count: number}[]>([]);
  const [plantGroundPlants, setPlantGroundPlants] = useState<{area_name: string; count: number}[]>([]);
  const [crossRefLoading, setCrossRefLoading] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [seasonFilter, setSeasonFilter] = useState('all');
  const [sunFilter, setSunFilter] = useState('all');
  const [waterFilter, setWaterFilter] = useState('all');
  const [heatFilter, setHeatFilter] = useState('all');
  const [desertHardyOnly, setDesertHardyOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('name');

  // Magic checkbox: plantable now
  const [plantableNow, setPlantableNow] = useState(false);

  // New filters
  const [growthHabitFilter, setGrowthHabitFilter] = useState('all');
  const [needsTrellis, setNeedsTrellis] = useState(false);
  const [needsCage, setNeedsCage] = useState(false);
  const [needsStaking, setNeedsStaking] = useState(false);
  const [noSupport, setNoSupport] = useState(false);
  const [edibleOnly, setEdibleOnly] = useState(false);
  const [pollinatorFriendly, setPollinatorFriendly] = useState(false);
  const [droughtTolerant, setDroughtTolerant] = useState(false);
  const [deerResistant, setDeerResistant] = useState(false);
  const [nitrogenFixer, setNitrogenFixer] = useState(false);
  const [spacingFilter, setSpacingFilter] = useState('all');
  const [maturityFilter, setMaturityFilter] = useState('all');

  // Companion filter (merged from companion finder mode)
  const [companionOfPlant, setCompanionOfPlant] = useState<string>('');

  // Mobile filter sheet
  const [showFilters, setShowFilters] = useState(false);

  // View mode toggle
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // Expanded plant detail
  const [expandedPlant, setExpandedPlant] = useState<number | null>(null);
  const [plantCalendar, setPlantCalendar] = useState<PlantCalendar | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Varieties
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [varietiesLoading, setVarietiesLoading] = useState(false);
  const [showDesertRecommendedOnly, setShowDesertRecommendedOnly] = useState(false);
  const [varietySortBy, setVarietySortBy] = useState<VarietySortOption>('desert_rating');

  // Plant history tips
  const [plantTips, setPlantTips] = useState<string[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  // Plant details
  const [plantDetails, setPlantDetails] = useState<PlantDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'details'>('overview');

  // Planter compatibility
  const [planterCompat, setPlanterCompat] = useState<{ form_factor: string; compatibility: string; notes: string }[]>([]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (categoryFilter !== 'all') count++;
    if (seasonFilter !== 'all') count++;
    if (sunFilter !== 'all') count++;
    if (waterFilter !== 'all') count++;
    if (heatFilter !== 'all') count++;
    if (desertHardyOnly) count++;
    if (debouncedSearch) count++;
    if (sortBy !== 'name') count++;
    if (companionOfPlant) count++;
    if (plantableNow) count++;
    if (growthHabitFilter !== 'all') count++;
    if (needsTrellis) count++;
    if (needsCage) count++;
    if (needsStaking) count++;
    if (noSupport) count++;
    if (edibleOnly) count++;
    if (pollinatorFriendly) count++;
    if (droughtTolerant) count++;
    if (deerResistant) count++;
    if (nitrogenFixer) count++;
    if (spacingFilter !== 'all') count++;
    if (maturityFilter !== 'all') count++;
    return count;
  }, [categoryFilter, seasonFilter, sunFilter, waterFilter, heatFilter, desertHardyOnly, debouncedSearch, sortBy, companionOfPlant, plantableNow, growthHabitFilter, needsTrellis, needsCage, needsStaking, noSupport, edibleOnly, pollinatorFriendly, droughtTolerant, deerResistant, nitrogenFixer, spacingFilter, maturityFilter]);

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setCategoryFilter('all');
    setSeasonFilter('all');
    setSunFilter('all');
    setWaterFilter('all');
    setHeatFilter('all');
    setDesertHardyOnly(false);
    setSortBy('name');
    setCompanionOfPlant('');
    setPlantableNow(false);
    setGrowthHabitFilter('all');
    setNeedsTrellis(false);
    setNeedsCage(false);
    setNeedsStaking(false);
    setNoSupport(false);
    setEdibleOnly(false);
    setPollinatorFriendly(false);
    setDroughtTolerant(false);
    setDeerResistant(false);
    setNitrogenFixer(false);
    setSpacingFilter('all');
    setMaturityFilter('all');
  }, []);

  // Fetch stats on mount
  useEffect(() => {
    getPlantStats().then(setStats).catch(() => {});
  }, []);

  // Fetch plants when filters change
  useEffect(() => {
    const params: Record<string, string | number | boolean> = {};
    if (categoryFilter !== 'all') params.category = categoryFilter;
    if (seasonFilter !== 'all') params.season = seasonFilter;
    if (sunFilter !== 'all') params.sun = sunFilter;
    if (waterFilter !== 'all') params.water = waterFilter;

    const effectiveHeat = desertHardyOnly ? 'high' : heatFilter !== 'all' ? heatFilter : undefined;
    if (effectiveHeat) params.heat_tolerance = effectiveHeat;

    if (debouncedSearch) params.search = debouncedSearch;
    if (sortBy !== 'name') params.sort = sortBy;
    if (companionOfPlant) params.companion_of = companionOfPlant;
    if (plantableNow) params.plantable_now = true;
    if (growthHabitFilter !== 'all') params.growth_habit = growthHabitFilter;
    if (needsTrellis) params.needs_trellis = true;
    if (needsCage) params.needs_cage = true;
    if (needsStaking) params.needs_staking = true;
    if (noSupport) params.no_support = true;
    if (edibleOnly) params.edible = true;
    if (pollinatorFriendly) params.pollinator = true;
    if (droughtTolerant) params.drought_tolerant = true;
    if (deerResistant) params.deer_resistant = true;
    if (nitrogenFixer) params.nitrogen_fixer = true;

    // Spacing filter
    if (spacingFilter === 'compact') { params.spacing_max = 12; }
    else if (spacingFilter === 'medium') { params.spacing_min = 12; params.spacing_max = 24; }
    else if (spacingFilter === 'large') { params.spacing_min = 24; }

    // Maturity filter
    if (maturityFilter === 'quick') { params.maturity_max = 45; }
    else if (maturityFilter === 'medium') { params.maturity_min = 45; params.maturity_max = 75; }
    else if (maturityFilter === 'long') { params.maturity_min = 75; }

    setLoading(true);
    getPlants(params as Parameters<typeof getPlants>[0])
      .then(setPlants)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [categoryFilter, seasonFilter, sunFilter, waterFilter, heatFilter, desertHardyOnly, debouncedSearch, sortBy, companionOfPlant, plantableNow, growthHabitFilter, needsTrellis, needsCage, needsStaking, noSupport, edibleOnly, pollinatorFriendly, droughtTolerant, deerResistant, nitrogenFixer, spacingFilter, maturityFilter]);

  // For companion filter: load all plant names
  const [allPlantNames, setAllPlantNames] = useState<string[]>([]);
  useEffect(() => {
    getPlants({}).then((all: Plant[]) => {
      setAllPlantNames(all.map((p) => p.name).sort());
    }).catch(() => {});
  }, []);

  // Companion data for styling cards
  const [companionData, setCompanionData] = useState<{ companions: string[]; antagonists: string[] } | null>(null);
  useEffect(() => {
    if (companionOfPlant) {
      getPlants({}).then((all: Plant[]) => {
        const p = all.find((pl) => pl.name.toLowerCase() === companionOfPlant.toLowerCase());
        if (p) {
          setCompanionData({ companions: p.companions || [], antagonists: p.antagonists || [] });
        }
      }).catch(() => {});
    } else {
      setCompanionData(null);
    }
  }, [companionOfPlant]);

  const handleExpand = async (plantId: number) => {
    if (expandedPlant === plantId) {
      setExpandedPlant(null);
      return;
    }
    setExpandedPlant(plantId);
    setDetailsTab('overview');
    setCalendarLoading(true);
    setVarietiesLoading(true);
    setDetailsLoading(true);
    try {
      const cal = await getPlantCalendar(plantId);
      setPlantCalendar(cal);
    } catch {
      setPlantCalendar(null);
    } finally {
      setCalendarLoading(false);
    }
    try {
      const data = await getPlantVarieties(plantId);
      setVarieties(data.varieties || []);
    } catch {
      setVarieties([]);
    } finally {
      setVarietiesLoading(false);
    }
    setTipsLoading(true);
    try {
      const tipsData = await getPlantTips(plantId);
      setPlantTips(tipsData.tips || []);
    } catch {
      setPlantTips([]);
    } finally {
      setTipsLoading(false);
    }
    try {
      const det = await getPlantDetails(plantId);
      setPlantDetails(det);
    } catch {
      setPlantDetails(null);
    } finally {
      setDetailsLoading(false);
    }
    try {
      const compat = await getPlantCompatiblePlanters(plantId);
      setPlanterCompat(compat.compatibilities || []);
    } catch {
      setPlanterCompat([]);
    }
  };

  // Auto-expand highlighted plant from URL param
  useEffect(() => {
    if (highlightPlantId && !loading && plants.length > 0) {
      const exists = plants.find((p) => p.id === highlightPlantId);
      if (exists) {
        handleExpand(highlightPlantId);
        setTimeout(() => {
          const el = document.getElementById(`plant-card-${highlightPlantId}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
      }
    }
  }, [highlightPlantId, loading, plants.length]);

  // Load bed/tray cross-references when a plant is expanded
  useEffect(() => {
    if (expandedPlant === null) {
      setPlantBeds([]);
      setPlantTrays([]);
      setPlantGroundPlants([]);
      return;
    }
    setCrossRefLoading(true);
    Promise.allSettled([getBeds(), getTrays(), getGroundPlants()]).then(async ([bedsResult, traysResult, groundResult]) => {
      const bedCrossRefs: {bed_id: number; bed_name: string; count: number}[] = [];
      const trayCrossRefs: {tray_id: number; tray_name: string; count: number}[] = [];
      const groundCrossRefs: {area_name: string; count: number}[] = [];

      if (bedsResult.status === 'fulfilled' && Array.isArray(bedsResult.value)) {
        const bedGridPromises = bedsResult.value.map(async (bed: any) => {
          try {
            const grid = await getBedGrid(bed.id);
            let count = 0;
            const rows = grid.grid || [];
            for (const row of rows) {
              for (const cell of row) {
                if (cell && cell.plant_id === expandedPlant) count++;
              }
            }
            if (count > 0) bedCrossRefs.push({ bed_id: bed.id, bed_name: bed.name, count });
          } catch {}
        });
        await Promise.allSettled(bedGridPromises);
      }

      if (traysResult.status === 'fulfilled' && Array.isArray(traysResult.value)) {
        const trayGridPromises = traysResult.value.map(async (tray: any) => {
          try {
            const grid = await getTrayGrid(tray.id);
            let count = 0;
            const cells = grid.cells || [];
            for (const row of (grid.grid || [])) {
              for (const cell of row) {
                if (cell && cell.plant_id === expandedPlant && cell.status !== 'empty') count++;
              }
            }
            for (const cell of cells) {
              if (cell && cell.plant_id === expandedPlant && cell.status !== 'empty') count++;
            }
            if (count > 0) trayCrossRefs.push({ tray_id: tray.id, tray_name: tray.name, count });
          } catch {}
        });
        await Promise.allSettled(trayGridPromises);
      }

      // Ground plants cross-reference
      if (groundResult.status === 'fulfilled' && Array.isArray(groundResult.value)) {
        const areaCounts: Record<string, number> = {};
        for (const gp of groundResult.value) {
          if (gp.plant_id === expandedPlant && gp.status !== 'removed') {
            const area = gp.area_name || 'Unassigned area';
            areaCounts[area] = (areaCounts[area] || 0) + 1;
          }
        }
        for (const [area_name, count] of Object.entries(areaCounts)) {
          groundCrossRefs.push({ area_name, count });
        }
      }

      setPlantBeds(bedCrossRefs);
      setPlantTrays(trayCrossRefs);
      setPlantGroundPlants(groundCrossRefs);
      setCrossRefLoading(false);
    });
  }, [expandedPlant]);

  const desertRatingDisplay = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? 'opacity-100' : 'opacity-20'}>{'\uD83C\uDF35'}</span>
    ));
  };

  const filteredVarieties = useMemo(() => {
    let result = [...varieties];
    if (showDesertRecommendedOnly) {
      result = result.filter((v) => v.desert_rating >= 4);
    }
    result.sort((a, b) => {
      if (varietySortBy === 'desert_rating') return (b.desert_rating || 0) - (a.desert_rating || 0);
      if (varietySortBy === 'maturity') return (a.days_to_maturity_min || 999) - (b.days_to_maturity_min || 999);
      return a.name.localeCompare(b.name);
    });
    return result;
  }, [varieties, showDesertRecommendedOnly, varietySortBy]);

  // Companion styling for cards
  const getCompanionStyle = (plantName: string) => {
    if (!companionData) return '';
    if (companionData.companions.map((c) => c.toLowerCase()).includes(plantName.toLowerCase())) {
      return 'ring-2 ring-green-400 dark:ring-green-500';
    }
    if (companionData.antagonists.map((a) => a.toLowerCase()).includes(plantName.toLowerCase())) {
      return 'opacity-40 grayscale';
    }
    return '';
  };

  // Compute per-section active counts for badge display
  const supportActiveCount = useMemo(() => {
    let c = 0;
    if (needsTrellis) c++;
    if (needsCage) c++;
    if (needsStaking) c++;
    if (noSupport) c++;
    return c;
  }, [needsTrellis, needsCage, needsStaking, noSupport]);

  const traitActiveCount = useMemo(() => {
    let c = 0;
    if (edibleOnly) c++;
    if (pollinatorFriendly) c++;
    if (droughtTolerant) c++;
    if (deerResistant) c++;
    if (nitrogenFixer) c++;
    return c;
  }, [edibleOnly, pollinatorFriendly, droughtTolerant, deerResistant, nitrogenFixer]);

  // The filter controls, shared between sidebar and mobile sheet
  const filterControls = (
    <>
      {/* Sort By — always visible at top */}
      <div className="border-b border-earth-200 dark:border-gray-700 pb-3 mb-3">
        <label className="block text-sm font-bold text-earth-700 dark:text-gray-300 mb-2">Sort By</label>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none text-sm"
        >
          {(Object.entries(sortLabels) as [SortOption, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Magic checkbox: Good to Plant Now */}
      <div className="px-1 py-3 border-b border-earth-200 dark:border-gray-700">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={plantableNow}
            onChange={() => setPlantableNow(!plantableNow)}
            className="w-4 h-4 rounded border-earth-300 dark:border-gray-600 text-garden-600 focus:ring-garden-500 accent-garden-600"
          />
          <span className="text-sm font-medium text-earth-700 dark:text-gray-300">{'\uD83C\uDF31'} Good to Plant Now</span>
        </label>
      </div>

      <FilterSection title="Category" activeCount={categoryFilter !== 'all' ? 1 : 0}>
        {['vegetable', 'herb', 'flower', 'fruit'].map((cat) => (
          <FilterCheckbox
            key={cat}
            label={cat.charAt(0).toUpperCase() + cat.slice(1)}
            checked={categoryFilter === cat}
            onChange={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
            count={stats?.by_category[cat]}
          />
        ))}
      </FilterSection>

      <FilterSection title="Season" activeCount={seasonFilter !== 'all' ? 1 : 0}>
        {['cool', 'warm', 'monsoon'].map((s) => (
          <FilterCheckbox
            key={s}
            label={`${s.charAt(0).toUpperCase() + s.slice(1)} Season`}
            checked={seasonFilter === s}
            onChange={() => setSeasonFilter(seasonFilter === s ? 'all' : s)}
            count={stats?.by_season[s]}
          />
        ))}
      </FilterSection>

      <FilterSection title="Sun Requirement" activeCount={sunFilter !== 'all' ? 1 : 0}>
        {['full', 'partial', 'shade'].map((s) => (
          <FilterCheckbox
            key={s}
            label={s.charAt(0).toUpperCase() + s.slice(1)}
            checked={sunFilter === s}
            onChange={() => setSunFilter(sunFilter === s ? 'all' : s)}
            count={stats?.by_sun[s]}
          />
        ))}
      </FilterSection>

      <FilterSection title="Water Need" activeCount={waterFilter !== 'all' ? 1 : 0}>
        {['low', 'moderate', 'high'].map((w) => (
          <FilterCheckbox
            key={w}
            label={w.charAt(0).toUpperCase() + w.slice(1)}
            checked={waterFilter === w}
            onChange={() => setWaterFilter(waterFilter === w ? 'all' : w)}
          />
        ))}
      </FilterSection>

      <FilterSection title="Heat Tolerance" activeCount={desertHardyOnly ? 1 : (heatFilter !== 'all' ? 1 : 0)}>
        <label className="flex items-center gap-2 py-1 cursor-pointer text-sm text-earth-600 dark:text-gray-400 hover:text-earth-800 dark:hover:text-gray-200 transition-colors">
          <button
            onClick={() => { setDesertHardyOnly(!desertHardyOnly); if (!desertHardyOnly) setHeatFilter('all'); }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
              desertHardyOnly ? 'bg-orange-500' : 'bg-earth-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                desertHardyOnly ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span>Desert Hardy Only</span>
        </label>
      </FilterSection>

      <FilterSection title="Days to Maturity" activeCount={maturityFilter !== 'all' ? 1 : 0}>
        {[
          { value: 'quick', label: 'Quick (< 45 days)' },
          { value: 'medium', label: 'Medium (45-75 days)' },
          { value: 'long', label: 'Long (75+ days)' },
        ].map((opt) => (
          <FilterCheckbox
            key={opt.value}
            label={opt.label}
            checked={maturityFilter === opt.value}
            onChange={() => setMaturityFilter(maturityFilter === opt.value ? 'all' : opt.value)}
          />
        ))}
      </FilterSection>

      <FilterSection title="Spacing" activeCount={spacingFilter !== 'all' ? 1 : 0}>
        {[
          { value: 'compact', label: 'Compact (< 12")' },
          { value: 'medium', label: 'Medium (12-24")' },
          { value: 'large', label: 'Large (24"+)' },
        ].map((opt) => (
          <FilterCheckbox
            key={opt.value}
            label={opt.label}
            checked={spacingFilter === opt.value}
            onChange={() => setSpacingFilter(spacingFilter === opt.value ? 'all' : opt.value)}
          />
        ))}
      </FilterSection>

      <FilterSection title="Growth Habit" activeCount={growthHabitFilter !== 'all' ? 1 : 0}>
        {['Bush', 'Vine', 'Upright', 'Spreading', 'Climbing', 'Tree'].map((habit) => (
          <FilterCheckbox
            key={habit}
            label={habit}
            checked={growthHabitFilter === habit.toLowerCase()}
            onChange={() => setGrowthHabitFilter(growthHabitFilter === habit.toLowerCase() ? 'all' : habit.toLowerCase())}
          />
        ))}
      </FilterSection>

      <FilterSection title="Support Needed" activeCount={supportActiveCount}>
        <FilterCheckbox label="Needs Trellis" checked={needsTrellis} onChange={() => setNeedsTrellis(!needsTrellis)} />
        <FilterCheckbox label="Needs Cage" checked={needsCage} onChange={() => setNeedsCage(!needsCage)} />
        <FilterCheckbox label="Needs Staking" checked={needsStaking} onChange={() => setNeedsStaking(!needsStaking)} />
        <FilterCheckbox label="No Support Needed" checked={noSupport} onChange={() => setNoSupport(!noSupport)} />
      </FilterSection>

      <FilterSection title="Plant Traits" activeCount={traitActiveCount}>
        <FilterCheckbox label="Edible" checked={edibleOnly} onChange={() => setEdibleOnly(!edibleOnly)} />
        <FilterCheckbox label="Pollinator Friendly" checked={pollinatorFriendly} onChange={() => setPollinatorFriendly(!pollinatorFriendly)} />
        <FilterCheckbox label="Drought Tolerant" checked={droughtTolerant} onChange={() => setDroughtTolerant(!droughtTolerant)} />
        <FilterCheckbox label="Deer Resistant" checked={deerResistant} onChange={() => setDeerResistant(!deerResistant)} />
        <FilterCheckbox label="Nitrogen Fixer" checked={nitrogenFixer} onChange={() => setNitrogenFixer(!nitrogenFixer)} />
      </FilterSection>

      <FilterSection title="Companion With" activeCount={companionOfPlant ? 1 : 0}>
        <TypeaheadSelect
          options={allPlantNames.map((name) => ({
            value: name,
            label: name,
            icon: getPlantIcon(name),
          }))}
          value={companionOfPlant}
          onChange={setCompanionOfPlant}
          placeholder="Type plant name..."
        />
        {companionData && (
          <div className="mt-2 flex gap-3 text-xs">
            <span className="text-green-700 dark:text-green-400">
              {companionData.companions.length} companion{companionData.companions.length !== 1 ? 's' : ''}
            </span>
            <span className="text-red-600 dark:text-red-400">
              {companionData.antagonists.length} to avoid
            </span>
          </div>
        )}
      </FilterSection>

      {activeFilterCount > 0 && (
        <button
          onClick={clearAllFilters}
          className="w-full mt-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          Clear All Filters ({activeFilterCount})
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">Plant Library</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">Browse plants suited for your garden</p>
        </div>
        <a
          href={getExportUrl('plants')}
          download
          className="px-3 py-2 bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 rounded-lg hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
        >
          Export Database
        </a>
      </div>

      {/* Mobile: Search bar + filter button (visible < lg) */}
      <div className="lg:hidden space-y-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search plants..."
          aria-label="Search plants"
          className="w-full px-4 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none min-h-[44px] bg-white dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFilters(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-garden-600 text-white rounded-lg text-sm font-medium hover:bg-garden-700 transition-colors min-h-[44px]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-white text-garden-700 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          <p className="text-sm text-earth-400 dark:text-gray-500">
            {plants.length} plant{plants.length !== 1 ? 's' : ''} found
          </p>
        </div>
      </div>

      {/* Mobile filter bottom sheet */}
      {showFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowFilters(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] bg-white dark:bg-gray-800 rounded-t-2xl overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-white dark:bg-gray-800 p-4 border-b border-earth-200 dark:border-gray-700 flex items-center justify-between z-10">
              <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">Filters</h3>
              <button
                onClick={() => setShowFilters(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-earth-100 dark:hover:bg-gray-700 text-earth-500 dark:text-gray-400 transition-colors"
              >
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>
            <div className="p-4">
              {filterControls}
            </div>
            <div className="sticky bottom-0 p-4 bg-white dark:bg-gray-800 border-t border-earth-200 dark:border-gray-700">
              <button
                onClick={() => setShowFilters(false)}
                className="w-full bg-garden-600 text-white py-3 rounded-lg font-medium hover:bg-garden-700 transition-colors"
              >
                Show Results ({plants.length} plant{plants.length !== 1 ? 's' : ''})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop layout: sidebar + content */}
      <div className="flex gap-6">
        {/* Desktop sidebar (hidden < lg) */}
        <aside className="hidden lg:block w-[280px] flex-shrink-0">
          <div className="sticky top-[64px] h-[calc(100vh-64px)] overflow-y-auto bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 rounded-xl p-4">
            {/* Search in sidebar */}
            <div className="mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search plants..."
                aria-label="Search plants"
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            {filterControls}
          </div>
        </aside>

        {/* Plant list content */}
        <main className="flex-1 min-w-0">
          {/* Desktop: results count + view toggle */}
          <div className="hidden lg:flex items-center justify-between mb-4">
            <p className="text-sm text-earth-400 dark:text-gray-500">
              {plants.length} plant{plants.length !== 1 ? 's' : ''} found
              {companionOfPlant ? ` as companions of ${companionOfPlant}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300' : 'text-earth-400 dark:text-gray-500 hover:text-earth-600'}`}
                title="List view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300' : 'text-earth-400 dark:text-gray-500 hover:text-earth-600'}`}
                title="Grid view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Plant cards */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : plants.length === 0 ? (
            <div className="text-center py-16 text-earth-400 dark:text-gray-500">
              No plants match your filters. Try adjusting your search.
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3' : 'space-y-3'}>
              {plants.map((plant) => (
                <div key={plant.id} id={`plant-card-${plant.id}`} className={getCompanionStyle(plant.name)}>
                  <button
                    onClick={() => handleExpand(plant.id)}
                    className={`w-full text-left rounded-xl border p-5 shadow-sm transition-all ${
                      categoryColor[plant.category] || 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700 hover:border-earth-300 dark:hover:border-gray-600'
                    } ${expandedPlant === plant.id ? 'ring-2 ring-garden-400 dark:ring-garden-600' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{getPlantIcon(plant.name, plant.category)}</span>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">{plant.name}</h3>
                        <p className="text-sm text-earth-500 dark:text-gray-400 line-clamp-1">{plant.notes}</p>
                      </div>
                      {viewMode === 'list' && (
                        <div className="hidden sm:flex gap-4 text-sm text-earth-400 flex-shrink-0">
                          <span title="Days to maturity">{'\u{1F4C5}'} {plant.days_to_maturity_min}-{plant.days_to_maturity_max}d</span>
                          <span title="Sun requirement">{'\u2600\uFE0F'} {plant.sun}</span>
                          <span title="Water">{'\u{1F4A7}'} {plant.water}</span>
                          <span title="Spacing">{'\u{1F4CF}'} {plant.spacing_inches}&quot;</span>
                        </div>
                      )}
                      <span className={`text-earth-400 dark:text-gray-500 transition-transform ${expandedPlant === plant.id ? 'rotate-180' : ''}`}>
                        &#9660;
                      </span>
                    </div>
                    {viewMode === 'grid' && (
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-earth-400">
                        <span>{'\u{1F4C5}'} {plant.days_to_maturity_min}-{plant.days_to_maturity_max}d</span>
                        <span>{'\u2600\uFE0F'} {plant.sun}</span>
                        <span>{'\u{1F4A7}'} {plant.water}</span>
                      </div>
                    )}
                  </button>

                  {/* Expanded detail */}
                  {expandedPlant === plant.id && (
                    <div className="bg-white dark:bg-gray-800 border border-t-0 border-earth-200 dark:border-gray-700 rounded-b-xl p-5 -mt-2 space-y-4">
                      {/* Plant Info + Actions */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {plantDetails?.scientific_name && (
                            <span className="text-xs italic text-earth-400 dark:text-gray-500">{plantDetails.scientific_name}</span>
                          )}
                          {plantDetails && plantDetails.is_harvestable !== undefined && (
                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                              plantDetails.is_harvestable
                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                : 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'
                            }`}>
                              {plantDetails.is_harvestable
                                ? 'Harvestable'
                                : `Success: ${plantDetails.success_state === 'flowering' ? 'Flowering' : plantDetails.success_state === 'established' ? 'Established' : plantDetails.success_state}`}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/lifecycle?plant_id=${plant.id}`}
                            className="px-3 py-1.5 bg-garden-600 text-white rounded-lg text-xs font-medium hover:bg-garden-700 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Plan this Plant
                          </Link>
                        </div>
                      </div>

                      {/* Tab switcher */}
                      <div className="flex bg-earth-100 dark:bg-gray-700 rounded-lg p-1 w-fit">
                        <button
                          onClick={() => setDetailsTab('overview')}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            detailsTab === 'overview' ? 'bg-white dark:bg-gray-800 text-earth-800 dark:text-gray-100 shadow-sm' : 'text-earth-500 dark:text-gray-400'
                          }`}
                        >
                          Overview
                        </button>
                        <button
                          onClick={() => setDetailsTab('details')}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            detailsTab === 'details' ? 'bg-white dark:bg-gray-800 text-earth-800 dark:text-gray-100 shadow-sm' : 'text-earth-500 dark:text-gray-400'
                          }`}
                        >
                          Full Details
                        </button>
                      </div>

                      {/* Stats row visible on mobile only in expanded view */}
                      <div className="flex flex-wrap gap-3 text-sm text-earth-500 dark:text-gray-400 sm:hidden">
                        <span>{'\u{1F4C5}'} {plant.days_to_maturity_min}-{plant.days_to_maturity_max}d</span>
                        <span>{'\u2600\uFE0F'} {plant.sun}</span>
                        <span>{'\u{1F4A7}'} {plant.water}</span>
                        <span>{'\u{1F4CF}'} {plant.spacing_inches}&quot;</span>
                      </div>
                      {plant.notes && (
                        <p className="text-earth-600 dark:text-gray-300">{plant.notes}</p>
                      )}
                      {detailsTab === 'overview' && (<>
                      <div className="flex flex-wrap gap-2">
                        {plant.desert_seasons?.map((s) => (
                          <span key={s} className="text-xs bg-garden-100 dark:bg-garden-900 text-garden-700 dark:text-garden-300 px-2 py-0.5 rounded-full">
                            {s} season
                          </span>
                        ))}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          plant.heat_tolerance === 'high'
                            ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                            : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300'
                        }`}>
                          {'\u{1F321}\uFE0F'} Heat: {plant.heat_tolerance}{plant.heat_tolerance === 'high' ? ' (Desert Hardy)' : ''}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Companions */}
                        <div>
                          <h4 className="text-sm font-bold text-green-700 mb-1">Good Companions</h4>
                          {plant.companions && plant.companions.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {plant.companions.map((c, i) => (
                                <button
                                  key={i}
                                  onClick={() => setCompanionOfPlant(c)}
                                  className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full hover:bg-green-200 transition-colors cursor-pointer"
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-earth-400">None listed</p>
                          )}
                        </div>
                        {/* Antagonists */}
                        <div>
                          <h4 className="text-sm font-bold text-red-700 mb-1">Avoid Planting With</h4>
                          {plant.antagonists && plant.antagonists.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {plant.antagonists.map((a, i) => (
                                <span key={i} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                  {a}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-earth-400">None listed</p>
                          )}
                        </div>
                      </div>

                      {/* Where this plant lives */}
                      {(plantBeds.length > 0 || plantTrays.length > 0 || plantGroundPlants.length > 0) && (
                        <div>
                          <h4 className="text-sm font-bold text-earth-700 dark:text-gray-300 mb-2">Currently Growing</h4>
                          <div className="flex flex-wrap gap-2">
                            {plantBeds.map((b) => (
                              <Link
                                key={`bed-${b.bed_id}`}
                                href={`/planters/${b.bed_id}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg text-xs font-medium hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                              >
                                {b.bed_name} ({b.count} planting{b.count !== 1 ? 's' : ''})
                              </Link>
                            ))}
                            {plantTrays.map((t) => (
                              <Link
                                key={`tray-${t.tray_id}`}
                                href={`/trays/${t.tray_id}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                              >
                                {t.tray_name} ({t.count} cell{t.count !== 1 ? 's' : ''})
                              </Link>
                            ))}
                            {plantGroundPlants.map((g) => (
                              <Link
                                key={`ground-${g.area_name}`}
                                href="/ground-plants"
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                              >
                                In ground: {g.area_name} ({g.count} plant{g.count !== 1 ? 's' : ''})
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                      {crossRefLoading && (
                        <p className="text-xs text-earth-400 dark:text-gray-500">Checking planters, trays, and ground plants...</p>
                      )}

                      {/* Planting calendar */}
                      <div>
                        <h4 className="text-sm font-bold text-earth-700 dark:text-gray-300 mb-2">Planting Calendar</h4>
                        {calendarLoading ? (
                          <p className="text-sm text-earth-400">Loading calendar...</p>
                        ) : !plantCalendar || plantCalendar.events.length === 0 ? (
                          <p className="text-sm text-earth-400">No calendar data available</p>
                        ) : (
                          <div className="space-y-2">
                            <CalendarTimeline events={plantCalendar.events} />
                            {plantCalendar.events.map((event, i) => {
                              const colorMap: Record<string, string> = {
                                start_seeds: 'bg-blue-100 text-blue-700 border-blue-300',
                                direct_sow: 'bg-blue-100 text-blue-700 border-blue-300',
                                transplant: 'bg-green-100 text-green-700 border-green-300',
                                harvest: 'bg-orange-100 text-orange-700 border-orange-300',
                              };
                              return (
                                <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${colorMap[event.type] || 'bg-earth-100 text-earth-700 border-earth-300'}`}>
                                  <span className="font-medium text-sm">{event.label}</span>
                                  <span className="text-xs ml-auto">{formatCalDate(event.start)} {'\u2192'} {formatCalDate(event.end)}</span>
                                </div>
                              );
                            })}
                            <p className="text-xs text-earth-400">Days to maturity: {plantCalendar.days_to_maturity}</p>
                          </div>
                        )}
                      </div>

                      {/* Varieties section */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold text-earth-700 dark:text-gray-300">
                            Varieties {varieties.length > 0 && `(${filteredVarieties.length})`}
                          </h4>
                          {varieties.length > 0 && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setShowDesertRecommendedOnly(!showDesertRecommendedOnly)}
                                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                  showDesertRecommendedOnly
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-earth-100 dark:bg-gray-700 text-earth-500 dark:text-gray-400'
                                }`}
                              >
                                {'\uD83C\uDF35'} Desert recommended
                              </button>
                              <select
                                value={varietySortBy}
                                onChange={(e) => setVarietySortBy(e.target.value as VarietySortOption)}
                                className="text-xs px-2 py-1 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-300"
                              >
                                <option value="desert_rating">By desert rating</option>
                                <option value="name">By name</option>
                                <option value="maturity">By maturity</option>
                              </select>
                            </div>
                          )}
                        </div>
                        {varietiesLoading ? (
                          <p className="text-sm text-earth-400">Loading varieties...</p>
                        ) : varieties.length === 0 ? (
                          <p className="text-sm text-earth-400">No variety data available yet</p>
                        ) : filteredVarieties.length === 0 ? (
                          <p className="text-sm text-earth-400">No varieties match the current filter</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {filteredVarieties.map((v) => (
                              <div
                                key={v.id}
                                className={`rounded-lg border p-3 text-sm ${
                                  v.desert_rating >= 4
                                    ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10'
                                    : 'border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-800'
                                }`}
                              >
                                <div className="flex items-start justify-between mb-1">
                                  <h5 className="font-bold text-earth-800 dark:text-gray-100">{v.name}</h5>
                                  <span className="flex-shrink-0 ml-2" title={`Desert rating: ${v.desert_rating}/5`}>
                                    {desertRatingDisplay(v.desert_rating)}
                                  </span>
                                </div>
                                <p className="text-earth-500 dark:text-gray-400 text-xs mb-2">{v.description}</p>
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {v.days_to_maturity_min && v.days_to_maturity_max && (
                                    <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                      {v.days_to_maturity_min}-{v.days_to_maturity_max}d
                                    </span>
                                  )}
                                  {v.heat_tolerance && (
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                                      v.heat_tolerance === 'excellent'
                                        ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                        : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300'
                                    }`}>
                                      Heat: {v.heat_tolerance}
                                    </span>
                                  )}
                                  {v.growth_habit && (
                                    <span className="text-xs bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 px-1.5 py-0.5 rounded">
                                      {v.growth_habit}
                                    </span>
                                  )}
                                  {v.color && (
                                    <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                                      {v.color}
                                    </span>
                                  )}
                                  {v.disease_resistance && (
                                    <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
                                      {v.disease_resistance}
                                    </span>
                                  )}
                                </div>
                                {v.flavor_profile && (
                                  <p className="text-xs text-earth-500 dark:text-gray-400 mb-1">
                                    <span className="font-semibold">Flavor:</span> {v.flavor_profile}
                                  </p>
                                )}
                                {v.desert_notes && (
                                  <p className="text-xs text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 rounded px-2 py-1">
                                    {v.desert_notes}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Your History section */}
                      <div>
                        <h4 className="text-sm font-bold text-earth-700 dark:text-gray-300 mb-2">Your History</h4>
                        {tipsLoading ? (
                          <p className="text-sm text-earth-400">Loading history...</p>
                        ) : plantTips.length > 0 ? (
                          <div className="space-y-1.5 mb-2">
                            {plantTips.map((tip, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm">
                                <span className="text-amber-500 mt-0.5 flex-shrink-0">{'\u{1F4A1}'}</span>
                                <span className="text-earth-600 dark:text-gray-400">{tip}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-earth-400 dark:text-gray-500 mb-2">No planting history yet.</p>
                        )}
                        <Link
                          href={`/history/plant/${plant.id}`}
                          className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
                        >
                          View Full Plant History &rarr;
                        </Link>
                      </div>

                      {/* Planter Compatibility */}
                      {planterCompat.length > 0 && (
                        <div className="bg-sky-50 dark:bg-sky-900/10 border border-sky-200 dark:border-sky-800 rounded-lg p-3">
                          <h4 className="text-sm font-bold text-sky-800 dark:text-sky-300 mb-2">Planter Compatibility</h4>
                          <div className="space-y-1.5">
                            {planterCompat.filter(c => c.compatibility !== 'unsuitable').slice(0, 6).map((c, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-medium ${
                                  c.compatibility === 'excellent' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                                  c.compatibility === 'good' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                                  c.compatibility === 'possible' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                                  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                }`}>
                                  {c.compatibility}
                                </span>
                                <span className="text-sky-700 dark:text-sky-400 capitalize">{c.form_factor.replace(/_/g, ' ')}</span>
                              </div>
                            ))}
                            {planterCompat.some(c => c.compatibility === 'unsuitable') && (
                              <div className="text-xs text-red-500 dark:text-red-400 mt-1">
                                Avoid: {planterCompat.filter(c => c.compatibility === 'unsuitable').map(c => c.form_factor.replace(/_/g, ' ')).join(', ')}
                              </div>
                            )}
                          </div>
                          <Link
                            href="/planter-types"
                            className="text-xs text-sky-600 dark:text-sky-400 hover:underline font-medium mt-2 inline-block"
                          >
                            Browse Planter Types &rarr;
                          </Link>
                        </div>
                      )}
                      </>)}

                      {/* Full Details Tab */}
                      {detailsTab === 'details' && (
                        <div className="space-y-4">
                          {detailsLoading ? (
                            <p className="text-sm text-earth-400">Loading details...</p>
                          ) : !plantDetails?.enriched ? (
                            <div className="text-center py-8">
                              <p className="text-earth-400 dark:text-gray-500">No detailed data available for this plant yet.</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Growing Requirements */}
                              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                <h5 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-2">Growing Requirements</h5>
                                <div className="space-y-1 text-xs text-blue-700 dark:text-blue-400">
                                  {plantDetails.usda_zones && plantDetails.usda_zones.length > 0 && (
                                    <p><span className="font-semibold">USDA Zones:</span> {plantDetails.usda_zones.join(', ')}</p>
                                  )}
                                  {plantDetails.soil_type && (
                                    <p><span className="font-semibold">Soil:</span> {plantDetails.soil_type}</p>
                                  )}
                                  {(plantDetails.ph_min || plantDetails.ph_max) && (
                                    <p><span className="font-semibold">pH:</span> {plantDetails.ph_min}-{plantDetails.ph_max}</p>
                                  )}
                                  {(plantDetails.ph_min || plantDetails.ph_max) && plantDetails.ph_max && plantDetails.ph_max < 7.5 && (
                                    <p className="text-amber-600 dark:text-amber-400 font-semibold">
                                      Prefers pH {plantDetails.ph_min}-{plantDetails.ph_max} but native soil is pH ~8.0 — add sulfur to lower pH
                                    </p>
                                  )}
                                  {(plantDetails.ph_min || plantDetails.ph_max) && plantDetails.ph_min && plantDetails.ph_min > 8.5 && (
                                    <p className="text-amber-600 dark:text-amber-400 font-semibold">
                                      Prefers pH {plantDetails.ph_min}-{plantDetails.ph_max} — well suited for native alkaline soil
                                    </p>
                                  )}
                                  {(plantDetails.min_soil_temp_f || plantDetails.max_soil_temp_f) && (
                                    <p><span className="font-semibold">Soil Temp:</span> {plantDetails.min_soil_temp_f}-{plantDetails.max_soil_temp_f}F</p>
                                  )}
                                  {plantDetails.water_inches_per_week && (
                                    <p><span className="font-semibold">Water:</span> {plantDetails.water_inches_per_week}&quot;/week</p>
                                  )}
                                  {plantDetails.pollination_type && (
                                    <p><span className="font-semibold">Pollination:</span> {plantDetails.pollination_type}</p>
                                  )}
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {plantDetails.drought_tolerant === 1 && <span className="bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded text-xs">Drought Tolerant</span>}
                                    {plantDetails.mulch_recommended === 1 && <span className="bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded text-xs">Mulch Recommended</span>}
                                    {plantDetails.deer_resistant === 1 && <span className="bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded text-xs">Deer Resistant</span>}
                                    {plantDetails.attracts_pollinators === 1 && <span className="bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded text-xs">Attracts Pollinators</span>}
                                  </div>
                                </div>
                              </div>

                              {/* Physical Characteristics */}
                              <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg p-3">
                                <h5 className="text-sm font-bold text-green-800 dark:text-green-300 mb-2">Physical</h5>
                                <div className="space-y-1 text-xs text-green-700 dark:text-green-400">
                                  {plantDetails.mature_height_inches && (
                                    <p><span className="font-semibold">Height:</span> {plantDetails.mature_height_inches}&quot; ({Math.round(plantDetails.mature_height_inches / 12)}ft)</p>
                                  )}
                                  {plantDetails.mature_spread_inches && (
                                    <p><span className="font-semibold">Spread:</span> {plantDetails.mature_spread_inches}&quot;</p>
                                  )}
                                  {plantDetails.growth_rate && (
                                    <p><span className="font-semibold">Growth Rate:</span> {plantDetails.growth_rate}</p>
                                  )}
                                  {plantDetails.growth_habit && (
                                    <p><span className="font-semibold">Habit:</span> {plantDetails.growth_habit}</p>
                                  )}
                                  {plantDetails.root_depth && (
                                    <p><span className="font-semibold">Root Depth:</span> {plantDetails.root_depth}</p>
                                  )}
                                  {plantDetails.support_notes && (
                                    <p><span className="font-semibold">Support:</span> {plantDetails.support_notes}</p>
                                  )}
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {plantDetails.needs_trellis === 1 && <span className="bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded text-xs">Needs Trellis</span>}
                                    {plantDetails.needs_cage === 1 && <span className="bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded text-xs">Needs Cage</span>}
                                    {plantDetails.needs_staking === 1 && <span className="bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded text-xs">Needs Staking</span>}
                                  </div>
                                </div>
                              </div>

                              {/* Soil & Nutrition */}
                              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <h5 className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-2">Soil & Nutrition</h5>
                                <div className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                                  <div className="flex flex-wrap gap-1 mb-1">
                                    {plantDetails.heavy_feeder === 1 && <span className="bg-amber-200 dark:bg-amber-900/40 px-1.5 py-0.5 rounded text-xs font-semibold">Heavy Feeder</span>}
                                    {plantDetails.light_feeder === 1 && <span className="bg-amber-100 dark:bg-amber-900/20 px-1.5 py-0.5 rounded text-xs">Light Feeder</span>}
                                    {plantDetails.nitrogen_fixer === 1 && <span className="bg-green-200 dark:bg-green-900/40 text-green-800 dark:text-green-300 px-1.5 py-0.5 rounded text-xs font-semibold">Nitrogen Fixer</span>}
                                  </div>
                                  {plantDetails.preferred_amendments && plantDetails.preferred_amendments.length > 0 && (
                                    <div>
                                      <span className="font-semibold">Amendments:</span>
                                      <div className="flex flex-wrap gap-1 mt-0.5">
                                        {plantDetails.preferred_amendments.map((a, i) => (
                                          <span key={i} className="bg-amber-100 dark:bg-amber-900/20 px-1.5 py-0.5 rounded text-xs">{a}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {plantDetails.soil_prep_notes && (
                                    <p className="mt-1"><span className="font-semibold">Notes:</span> {plantDetails.soil_prep_notes}</p>
                                  )}
                                </div>
                              </div>

                              {/* Culinary Uses */}
                              <div className="bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                                <h5 className="text-sm font-bold text-orange-800 dark:text-orange-300 mb-2">Culinary</h5>
                                <div className="space-y-1 text-xs text-orange-700 dark:text-orange-400">
                                  {plantDetails.edible_parts && plantDetails.edible_parts.length > 0 && (
                                    <p><span className="font-semibold">Edible Parts:</span> {plantDetails.edible_parts.join(', ')}</p>
                                  )}
                                  {plantDetails.culinary_uses && plantDetails.culinary_uses.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {plantDetails.culinary_uses.map((u, i) => (
                                        <span key={i} className="bg-orange-100 dark:bg-orange-900/20 px-1.5 py-0.5 rounded text-xs">{u}</span>
                                      ))}
                                    </div>
                                  )}
                                  {plantDetails.flavor_profile && (
                                    <p className="mt-1"><span className="font-semibold">Flavor:</span> {plantDetails.flavor_profile}</p>
                                  )}
                                  {plantDetails.nutritional_highlights && (
                                    <p><span className="font-semibold">Nutrition:</span> {plantDetails.nutritional_highlights}</p>
                                  )}
                                </div>
                              </div>

                              {/* Pests & Disease */}
                              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-3">
                                <h5 className="text-sm font-bold text-red-800 dark:text-red-300 mb-2">Pests & Disease</h5>
                                <div className="space-y-1 text-xs text-red-700 dark:text-red-400">
                                  {plantDetails.common_pests && plantDetails.common_pests.length > 0 && (
                                    <div>
                                      <span className="font-semibold">Common Pests:</span>
                                      <div className="flex flex-wrap gap-1 mt-0.5">
                                        {plantDetails.common_pests.map((p, i) => (
                                          <span key={i} className="bg-red-100 dark:bg-red-900/20 px-1.5 py-0.5 rounded text-xs">{p}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {plantDetails.common_diseases && plantDetails.common_diseases.length > 0 && (
                                    <div className="mt-1">
                                      <span className="font-semibold">Common Diseases:</span>
                                      <div className="flex flex-wrap gap-1 mt-0.5">
                                        {plantDetails.common_diseases.map((d, i) => (
                                          <span key={i} className="bg-red-100 dark:bg-red-900/20 px-1.5 py-0.5 rounded text-xs">{d}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {plantDetails.organic_pest_solutions && plantDetails.organic_pest_solutions.length > 0 && (
                                    <div className="mt-1">
                                      <span className="font-semibold">Organic Solutions:</span>
                                      <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                                        {plantDetails.organic_pest_solutions.map((s, i) => (
                                          <li key={i}>{s}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {plantDetails.disease_resistance && (
                                    <p className="mt-1"><span className="font-semibold">Resistance:</span> {plantDetails.disease_resistance}</p>
                                  )}
                                </div>
                              </div>

                              {/* Succession & Rotation */}
                              <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-lg p-3">
                                <h5 className="text-sm font-bold text-purple-800 dark:text-purple-300 mb-2">Succession & Rotation</h5>
                                <div className="space-y-1 text-xs text-purple-700 dark:text-purple-400">
                                  {plantDetails.succession_planting_interval_days !== undefined && plantDetails.succession_planting_interval_days > 0 && (
                                    <p><span className="font-semibold">Succession Interval:</span> Every {plantDetails.succession_planting_interval_days} days</p>
                                  )}
                                  {plantDetails.rotation_group && (
                                    <p><span className="font-semibold">Rotation Group:</span> {plantDetails.rotation_group}</p>
                                  )}
                                  {plantDetails.plant_after && plantDetails.plant_after.length > 0 && (
                                    <p><span className="font-semibold">Plant After:</span> {plantDetails.plant_after.join(', ')}</p>
                                  )}
                                  {plantDetails.plant_before && plantDetails.plant_before.length > 0 && (
                                    <p><span className="font-semibold">Plant Before:</span> {plantDetails.plant_before.join(', ')}</p>
                                  )}
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {plantDetails.good_cover_crop === 1 && <span className="bg-purple-200 dark:bg-purple-900/40 px-1.5 py-0.5 rounded text-xs font-semibold">Good Cover Crop</span>}
                                    {plantDetails.attracts_beneficial_insects === 1 && <span className="bg-purple-100 dark:bg-purple-900/20 px-1.5 py-0.5 rounded text-xs">Attracts Beneficials</span>}
                                  </div>
                                </div>
                              </div>

                              {/* Where to Buy */}
                              {plantDetails.seed_sources && plantDetails.seed_sources.length > 0 && (
                                <div className="bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800 rounded-lg p-3 md:col-span-2">
                                  <h5 className="text-sm font-bold text-teal-800 dark:text-teal-300 mb-2">Where to Buy Seeds</h5>
                                  <div className="flex flex-wrap gap-2">
                                    {plantDetails.seed_sources.map((s, i) => (
                                      <a
                                        key={i}
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-lg text-xs font-medium hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors"
                                      >
                                        {s.name} &rarr;
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function PlantsPage() {
  return (
    <Suspense fallback={<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>}>
      <PlantsPageInner />
    </Suspense>
  );
}
