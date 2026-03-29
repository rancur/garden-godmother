'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBedGrid, getBeds, getPlants, createPlanting, updatePlanting, deletePlanting, updateBed, deleteBed, resizeBed, checkCompanion, checkRotation, getPlantingPhotos, uploadPlantingPhoto, deletePhoto, getPhotoUrl, getBedSuggestions, analyzePhoto, getPhotoAnalysis, createPlantingNote, getPlantingNotes, deleteNote, getBedHistory, getIrrigationZones, getAreas, getBedSections, createBedSection, updateBedSection, deleteBedSection, getBedIrrigationSchedule, getPlanterTypes, getSoilTypes, getSoilProducts, getPlantHarvestInfo, movePlanting, movePlantingToGround, undoAction, getPlantVarieties, getVarieties, getTemplates, applyTemplate, getCompanionSuggestions, addCompanion, updatePlantingPosition } from '../../api';
import FreeformPlanterView from '../../components/FreeformPlanterView';
import SoilAmendments from '../../components/SoilAmendments';
import SensorReadings from '../../components/SensorReadings';
import PlantTimeline from '../../components/PlantTimeline';
import { getPlantIcon } from '../../plant-icons';
import { useToast } from '../../toast';
import { useModal } from '../../confirm-modal';
import { categoryEmoji, categoryBg, planterStatusLabels as statusLabels } from '../../constants';
import { normalizePlantingGrid } from '../../types';
import type { Planting } from '../../types';
import { getGardenToday, formatGardenDateTime, formatGardenDate } from '../../timezone';

interface Plant {
  id: number;
  name: string;
  category: string;
  days_to_maturity_min: number;
  days_to_maturity_max: number;
  sun: string;
  water: string;
  spacing_inches: number;
}

interface PlantingPhoto {
  id: number;
  planting_id: number;
  filename: string;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
}

interface BedArea {
  id: number;
  name: string;
  color: string | null;
}

interface BedSection {
  id: number;
  bed_id: number;
  name: string;
  start_cell: number;
  end_cell: number;
  irrigation_zone_name?: string;
  notes?: string;
}

interface BedData {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  bed_type?: string;
  description?: string;
  grid: (Planting | null)[][];
  irrigation_type?: string;
  irrigation_zone_name?: string;
  irrigation_schedule?: string;
  area_id?: number | null;
  planter_type_id?: number | null;
  depth_inches?: number | null;
  physical_width_inches?: number | null;
  physical_length_inches?: number | null;
  soil_type?: string | null;
  soil_mix?: string | null;
  soil_product_id?: number | null;
  soil_product_brand?: string | null;
  soil_product_name?: string | null;
}

interface SoilType {
  value: string;
  label: string;
  description: string;
  default_ph_min: number;
  default_ph_max: number;
  has_products: boolean;
}

interface SoilProduct {
  id: number;
  soil_type: string;
  brand: string;
  product_name: string;
  description: string;
  composition: string[] | null;
  ph_range_min: number;
  ph_range_max: number;
  best_for: string[] | null;
  url: string | null;
  notes: string | null;
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

interface CellSuggestion {
  plant_id: number;
  plant_name: string;
  category: string;
  score: number;
  reasons: string[];
}

interface BedSuggestionCell {
  cell: { x: number; y: number };
  suggestions: CellSuggestion[];
}

interface Variety {
  id: number;
  name: string;
  desert_rating: number | null;
  description?: string;
}

const HARVESTABLE_STATUSES = ['seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'harvested'];
const ORNAMENTAL_STATUSES = ['seeded', 'sprouted', 'growing', 'flowering', 'established'];
const ALL_STATUSES = ['seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'harvested', 'established'];

type CompanionState = Record<string, 'good' | 'bad' | 'neutral'>;
type GridCompanionOverlay = Record<string, { good: boolean; bad: boolean }>;

export default function BedDetailPage() {
  const params = useParams();
  const router = useRouter();
  const bedId = Number(params.id);
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useModal();

  const [bed, setBed] = useState<BedData | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [allVarieties, setAllVarieties] = useState<any[]>([]);
  const [bedAreas, setBedAreas] = useState<BedArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Plant picker state
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Variety picker state
  const [plantVarieties, setPlantVarieties] = useState<Variety[]>([]);
  const [varietyPickerPlant, setVarietyPickerPlant] = useState<Plant | null>(null);
  const [varietyPickerCell, setVarietyPickerCell] = useState<{ x: number; y: number } | null>(null);
  const [loadingVarieties, setLoadingVarieties] = useState(false);
  const [companionOverlay, setCompanionOverlay] = useState<CompanionState>({});

  // Source picker state (nursery transplant flow)
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [sourcePickerPlant, setSourcePickerPlant] = useState<Plant | null>(null);
  const [sourcePickerCell, setSourcePickerCell] = useState<{ x: number; y: number } | null>(null);
  const [sourcePickerVarietyId, setSourcePickerVarietyId] = useState<number | undefined>(undefined);
  const [selectedSource, setSelectedSource] = useState<string>('seed');
  const [plantAgeWeeks, setPlantAgeWeeks] = useState<number | null>(null);
  const [customAgeWeeks, setCustomAgeWeeks] = useState('');

  // Grid-wide companion visualization state
  const [showCompanions, setShowCompanions] = useState(false);
  const [gridCompanionOverlay, setGridCompanionOverlay] = useState<GridCompanionOverlay>({});
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [companionCache, setCompanionCache] = useState<Record<string, 'good' | 'bad' | 'neutral'>>({});

  // Cell detail state
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [selectedPlanting, setSelectedPlanting] = useState<Planting | null>(null);

  const [placing, setPlacing] = useState(false);

  // Rotation warning state
  const [rotationWarning, setRotationWarning] = useState<string | null>(null);

  // Suggestion state
  const [suggestions, setSuggestions] = useState<BedSuggestionCell[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [expandedSuggestionCell, setExpandedSuggestionCell] = useState<string | null>(null);

  // Photo state
  const [photos, setPhotos] = useState<PlantingPhoto[]>([]);
  const [photoCaption, setPhotoCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<PlantingPhoto | null>(null);

  // Harvest info cache: plant_id -> { is_harvestable, success_state }
  const [harvestInfoCache, setHarvestInfoCache] = useState<Record<number, { is_harvestable: number; success_state: string }>>({});

  // Analysis state
  const [analyses, setAnalyses] = useState<Record<number, any>>({});
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());
  const [expandedAnalysis, setExpandedAnalysis] = useState<number | null>(null);

  // Planting notes state
  const [plantingNotes, setPlantingNotes] = useState<any[]>([]);
  const [noteType, setNoteType] = useState('observation');
  const [noteContent, setNoteContent] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);

  // Bed history state
  const [bedHistory, setBedHistory] = useState<any>(null);
  const [showBedHistory, setShowBedHistory] = useState(false);

  // Soil section collapsible state
  const [showSoil, setShowSoil] = useState(false);

  // Soil amendments handled by SoilAmendments component

  // Grid keyboard navigation state
  const [focusedCell, setFocusedCell] = useState<{ x: number; y: number } | null>(null);

  // Bed sections state (for linear / multi-zone beds)
  const [sections, setSections] = useState<BedSection[]>([]);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [sectionFormData, setSectionFormData] = useState({ name: '', start_cell: 0, end_cell: 0, irrigation_zone_name: '' });

  // Irrigation settings state
  const [showIrrigation, setShowIrrigation] = useState(false);
  const [irrigationZones, setIrrigationZones] = useState<IrrigationZone[]>([]);
  const [irrigationValves, setIrrigationValves] = useState<IrrigationValve[]>([]);
  const [irrigationLoading, setIrrigationLoading] = useState(false);
  const [irrigationType, setIrrigationType] = useState<string>('manual');
  const [irrigationZoneName, setIrrigationZoneName] = useState<string>('');
  const [irrigationSchedule, setIrrigationSchedule] = useState<string>('');
  const [savingIrrigation, setSavingIrrigation] = useState(false);
  const [bedSchedule, setBedSchedule] = useState<any>(null);
  const [bedScheduleLoading, setBedScheduleLoading] = useState(false);

  // Bed settings state
  const [showBedSettings, setShowBedSettings] = useState(false);
  const [settingsBedType, setSettingsBedType] = useState<string>('grid');
  const [settingsWidth, setSettingsWidth] = useState<number>(1);
  const [settingsHeight, setSettingsHeight] = useState<number>(1);
  const [settingsCellSize, setSettingsCellSize] = useState<number>(12);
  const [settingsPlanterTypeId, setSettingsPlanterTypeId] = useState<number | null>(null);
  const [settingsDescription, setSettingsDescription] = useState<string>('');
  const [planterTypes, setPlanterTypes] = useState<any[]>([]);
  const [settingsDepthInches, setSettingsDepthInches] = useState<number | null>(null);
  const [settingsPhysicalWidth, setSettingsPhysicalWidth] = useState<number | null>(null);
  const [settingsPhysicalLength, setSettingsPhysicalLength] = useState<number | null>(null);
  const [savingBedSettings, setSavingBedSettings] = useState(false);

  // Soil cascading selection state
  const [soilTypes, setSoilTypes] = useState<SoilType[]>([]);
  const [soilProducts, setSoilProducts] = useState<SoilProduct[]>([]);
  const [soilProductsLoading, setSoilProductsLoading] = useState(false);
  const [selectedSoilProduct, setSelectedSoilProduct] = useState<SoilProduct | null>(null);

  // Sidebar visibility state (hidden by default, shown on cell click)
  const [showSidebar, setShowSidebar] = useState(false);

  // Companion planting state
  const [companionSuggestions, setCompanionSuggestions] = useState<any>(null);
  const [loadingCompanionSuggestions, setLoadingCompanionSuggestions] = useState(false);
  const [showCompanionPanel, setShowCompanionPanel] = useState(false);
  const [addingCompanionMode, setAddingCompanionMode] = useState(false);

  // Template state
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string; emoji: string; plants: string[]; min_cells: number }[]>([]);
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  // Single planter: simple plant picker state
  const [singlePlantPickerOpen, setSinglePlantPickerOpen] = useState(false);
  const [singlePlantSearch, setSinglePlantSearch] = useState('');

  // Remove dialog state
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [removeNote, setRemoveNote] = useState('');
  const [yieldWeight, setYieldWeight] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('');
  const [removeStep, setRemoveStep] = useState<'choose' | 'harvest-details' | 'died-details'>('choose');
  const [diedReason, setDiedReason] = useState('');

  // Move dialog state
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveMode, setMoveMode] = useState<'planter' | 'ground' | null>(null);
  const [allBeds, setAllBeds] = useState<{ id: number; name: string; width_cells: number; height_cells: number }[]>([]);
  const [moveTargetBed, setMoveTargetBed] = useState<number | null>(null);
  const [moveCellX, setMoveCellX] = useState(0);
  const [moveCellY, setMoveCellY] = useState(0);
  const [moveGroundName, setMoveGroundName] = useState('');
  const [moveGroundX, setMoveGroundX] = useState('');
  const [moveGroundY, setMoveGroundY] = useState('');
  const [moveGroundAreaId, setMoveGroundAreaId] = useState<number | null>(null);
  const [movingPlant, setMovingPlant] = useState(false);

  // Freeform planting state
  const [freeformPlantings, setFreeformPlantings] = useState<any[]>([]);
  const [freeformTapPos, setFreeformTapPos] = useState<{ x: number; y: number } | null>(null);

  // Fetch harvest info for a plant (cached)
  const fetchHarvestInfo = useCallback(async (plantId: number) => {
    if (harvestInfoCache[plantId]) return harvestInfoCache[plantId];
    try {
      const info = await getPlantHarvestInfo(plantId);
      setHarvestInfoCache(prev => ({ ...prev, [plantId]: info }));
      return info;
    } catch {
      return { is_harvestable: 1, success_state: 'harvested' };
    }
  }, [harvestInfoCache]);

  // Get appropriate status list for a plant
  const getStatusesForPlant = useCallback((plantId: number) => {
    const info = harvestInfoCache[plantId];
    if (info && !info.is_harvestable) return ORNAMENTAL_STATUSES;
    return HARVESTABLE_STATUSES;
  }, [harvestInfoCache]);

  const loadBed = useCallback(() => {
    getBedGrid(bedId)
      .then((bedData) => {
        const grid = normalizePlantingGrid(bedData.grid || []);
        if (bedData.bed) {
          setBed({ ...bedData.bed, grid });
        } else {
          setBed({ ...bedData, grid: grid || [] });
        }
        // Handle freeform plantings
        if (bedData.freeform_plantings) {
          setFreeformPlantings(bedData.freeform_plantings.map((p: any) => ({ ...p, id: p.planting_id ?? p.id })));
        }
        // Refresh selectedPlanting from updated grid (e.g. after adding companion)
        if (selectedCell) {
          const updated = grid[selectedCell.y]?.[selectedCell.x];
          if (updated) {
            setSelectedPlanting(updated);
          }
        }
      })
      .catch(() => setError('Failed to load planter'));
  }, [bedId, selectedCell]);


  useEffect(() => {
    Promise.all([getBedGrid(bedId), getPlants(), getAreas('beds'), getBedSections(bedId), getSoilTypes(), getPlanterTypes(), getVarieties()])
      .then(([bedData, plantsData, areasData, sectionsData, soilTypesData, planterTypesData, varietiesData]) => {
        setAllVarieties(Array.isArray(varietiesData) ? varietiesData : []);
        // API returns { bed: { id, name, ... }, grid: [...] }
        // Flatten into BedData shape
        if (bedData.bed) {
          setBed({ ...bedData.bed, grid: normalizePlantingGrid(bedData.grid || []) });
        } else {
          setBed({ ...bedData, grid: normalizePlantingGrid(bedData.grid || []) });
        }
        // Handle freeform plantings
        if (bedData.freeform_plantings) {
          setFreeformPlantings(bedData.freeform_plantings.map((p: any) => ({ ...p, id: p.planting_id ?? p.id })));
        }
        setPlants(plantsData);
        setBedAreas(areasData);
        setSections(sectionsData);
        setSoilTypes(soilTypesData);
        setPlanterTypes(planterTypesData);
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [bedId]);

  // Fetch harvest info when a planting is selected
  useEffect(() => {
    if (selectedPlanting?.plant_id && !harvestInfoCache[selectedPlanting.plant_id]) {
      fetchHarvestInfo(selectedPlanting.plant_id);
    }
  }, [selectedPlanting?.plant_id]);

  // Pre-fetch harvest info for all plantings when bed loads
  useEffect(() => {
    if (!bed?.grid) return;
    const plantIds = new Set<number>();
    for (const row of bed.grid) {
      for (const cell of row) {
        if (cell?.plant_id) plantIds.add(cell.plant_id);
      }
    }
    plantIds.forEach(pid => {
      if (!harvestInfoCache[pid]) fetchHarvestInfo(pid);
    });
  }, [bed?.grid]);

  // Load soil products when soil type changes
  useEffect(() => {
    if (!bed?.soil_type) {
      setSoilProducts([]);
      setSelectedSoilProduct(null);
      return;
    }
    const soilTypeInfo = soilTypes.find(st => st.value === bed.soil_type);
    if (!soilTypeInfo?.has_products) {
      setSoilProducts([]);
      setSelectedSoilProduct(null);
      return;
    }
    setSoilProductsLoading(true);
    getSoilProducts(bed.soil_type)
      .then((products: SoilProduct[]) => {
        setSoilProducts(products);
        if (bed.soil_product_id) {
          const match = products.find((p: SoilProduct) => p.id === bed.soil_product_id);
          setSelectedSoilProduct(match || null);
        } else {
          setSelectedSoilProduct(null);
        }
      })
      .catch(() => setSoilProducts([]))
      .finally(() => setSoilProductsLoading(false));
  }, [bed?.soil_type, bed?.soil_product_id, soilTypes]);

  // Sync irrigation state when bed data loads
  useEffect(() => {
    if (bed) {
      setIrrigationType(bed.irrigation_type || 'manual');
      setIrrigationZoneName(bed.irrigation_zone_name || '');
      setIrrigationSchedule(bed.irrigation_schedule || '');
    }
  }, [bed?.id, bed?.irrigation_type, bed?.irrigation_zone_name, bed?.irrigation_schedule]);

  // Sync bed settings state when bed data loads
  useEffect(() => {
    if (bed) {
      setSettingsBedType(bed.bed_type || 'grid');
      setSettingsWidth(bed.width_cells);
      setSettingsHeight(bed.height_cells);
      setSettingsCellSize(bed.cell_size_inches);
      setSettingsDescription(bed.description || '');
      setSettingsPlanterTypeId(bed.planter_type_id || null);
      setSettingsDepthInches(bed.depth_inches || null);
      setSettingsPhysicalWidth(bed.physical_width_inches || null);
      setSettingsPhysicalLength(bed.physical_length_inches || null);
    }
  }, [bed?.id, bed?.bed_type, bed?.width_cells, bed?.height_cells, bed?.cell_size_inches]);

  const handleLoadIrrigationZones = useCallback(() => {
    setIrrigationLoading(true);
    getIrrigationZones()
      .then((data: { zones: IrrigationZone[]; valves?: IrrigationValve[] }) => {
        setIrrigationZones(data.zones || []);
        setIrrigationValves(data.valves || []);
      })
      .catch(() => {
        setIrrigationZones([]);
        setIrrigationValves([]);
      })
      .finally(() => setIrrigationLoading(false));
  }, []);

  const loadBedSchedule = useCallback(() => {
    if (!bed) return;
    setBedScheduleLoading(true);
    getBedIrrigationSchedule(bed.id)
      .then(setBedSchedule)
      .catch(() => setBedSchedule(null))
      .finally(() => setBedScheduleLoading(false));
  }, [bed?.id]);

  const handleSaveIrrigation = useCallback(async () => {
    if (!bed) return;
    setSavingIrrigation(true);
    try {
      await updateBed(bed.id, {
        irrigation_type: irrigationType,
        irrigation_zone_name: irrigationZoneName || undefined,
        irrigation_schedule: irrigationSchedule || undefined,
      });
      setBed({ ...bed, irrigation_type: irrigationType, irrigation_zone_name: irrigationZoneName, irrigation_schedule: irrigationSchedule });
    } catch {
      setError('Failed to save irrigation settings');
    } finally {
      setSavingIrrigation(false);
    }
  }, [bed, irrigationType, irrigationZoneName, irrigationSchedule]);

  const handleSaveBedSettings = useCallback(async () => {
    if (!bed) return;

    const dimensionsChanged = settingsBedType !== 'single' && (settingsWidth !== bed.width_cells || settingsHeight !== bed.height_cells);

    // Check if resizing would remove plantings
    if (dimensionsChanged && (settingsWidth < bed.width_cells || settingsHeight < bed.height_cells)) {
      // First ask the API to check for displaced plantings
      try {
        const checkResult = await resizeBed(bed.id, {
          width_cells: settingsWidth,
          height_cells: settingsHeight,
          force: false,
        });
        if (!checkResult.ok && checkResult.displaced) {
          const confirmed = await showConfirm({ title: 'Resize Grid', message: `${checkResult.displaced} active plant(s) would be displaced by this resize. These plantings will be marked as removed. Continue?`, confirmText: 'Resize Anyway', destructive: true });
          if (!confirmed) return;
          // Force the resize
          setSavingBedSettings(true);
          await resizeBed(bed.id, {
            width_cells: settingsWidth,
            height_cells: settingsHeight,
            force: true,
          });
        }
        // If checkResult.ok, dimensions already applied by the API
      } catch {
        setError('Failed to resize planter');
        return;
      }
    } else if (dimensionsChanged) {
      // Expanding or same size — just resize directly
      setSavingBedSettings(true);
      try {
        await resizeBed(bed.id, {
          width_cells: settingsWidth,
          height_cells: settingsHeight,
        });
      } catch {
        setError('Failed to resize planter');
        setSavingBedSettings(false);
        return;
      }
    }

    setSavingBedSettings(true);
    try {
      const payload: any = {};
      if (settingsBedType !== (bed.bed_type || 'grid')) payload.bed_type = settingsBedType;
      if (settingsBedType === 'single') {
        payload.bed_type = 'single';
        payload.width_cells = 1;
        payload.height_cells = 1;
        if (settingsPhysicalWidth !== (bed.physical_width_inches || null)) payload.physical_width_inches = settingsPhysicalWidth;
        if (settingsPhysicalLength !== (bed.physical_length_inches || null)) payload.physical_length_inches = settingsPhysicalLength;
        // Auto-generate description from physical dims
        const parts: string[] = [];
        if (settingsPhysicalWidth) parts.push(`${settingsPhysicalWidth}" W`);
        if (settingsPhysicalLength) parts.push(`${settingsPhysicalLength}" L`);
        if (settingsDepthInches) parts.push(`${settingsDepthInches}" D`);
        payload.description = parts.join(' x ');
      }
      // Don't include width/height in the general update — already handled by resizeBed above
      if (settingsCellSize !== bed.cell_size_inches) payload.cell_size_inches = settingsCellSize;
      if (settingsBedType !== 'single' && settingsDescription !== (bed.description || '')) payload.description = settingsDescription;
      if (settingsPlanterTypeId !== (bed.planter_type_id || null)) payload.planter_type_id = settingsPlanterTypeId || 0;
      if (settingsBedType !== (bed.bed_type || 'grid')) payload.bed_type = settingsBedType;
      if (settingsDepthInches !== (bed.depth_inches || null)) payload.depth_inches = settingsDepthInches;

      if (Object.keys(payload).length > 0) {
        await updateBed(bed.id, payload);
      }
      loadBed();
      toast(dimensionsChanged ? 'Planter resized successfully' : 'Planter settings saved');
    } catch {
      setError('Failed to save planter settings');
    } finally {
      setSavingBedSettings(false);
    }
  }, [bed, settingsBedType, settingsWidth, settingsHeight, settingsCellSize, settingsDescription, settingsPlanterTypeId, settingsDepthInches, settingsPhysicalWidth, settingsPhysicalLength, loadBed, toast, showConfirm]);

  // Load photos and notes when a planting is selected
  useEffect(() => {
    if (selectedPlanting) {
      getPlantingPhotos(selectedPlanting.id)
        .then(setPhotos)
        .catch(() => setPhotos([]));
      getPlantingNotes(selectedPlanting.id)
        .then(setPlantingNotes)
        .catch(() => setPlantingNotes([]));
    } else {
      setPhotos([]);
      setPhotoCaption('');
      setPlantingNotes([]);
      setNoteContent('');
    }
  }, [selectedPlanting]);

  const handleAddNote = async () => {
    if (!selectedPlanting || !noteContent.trim()) return;
    setSubmittingNote(true);
    try {
      await createPlantingNote(selectedPlanting.id, { note_type: noteType, content: noteContent.trim() });
      setNoteContent('');
      const updated = await getPlantingNotes(selectedPlanting.id);
      setPlantingNotes(updated);
    } catch {
      setError('Failed to add note');
    } finally {
      setSubmittingNote(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !selectedPlanting) return;
    const file = e.target.files[0];
    if (file.size > 10 * 1024 * 1024) {
      setError('Photo must be under 10MB');
      return;
    }
    setUploading(true);
    try {
      await uploadPlantingPhoto(selectedPlanting.id, file, photoCaption || undefined);
      setPhotoCaption('');
      const updated = await getPlantingPhotos(selectedPlanting.id);
      setPhotos(updated);
      loadBed(); // refresh photo counts
    } catch {
      setError('Failed to upload photo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    try {
      await deletePhoto(photoId);
      setPhotos(photos.filter((p) => p.id !== photoId));
      if (lightboxPhoto?.id === photoId) setLightboxPhoto(null);
      loadBed();
    } catch {
      setError('Failed to delete photo');
    }
  };

  const handleAnalyzePhoto = async (photoId: number) => {
    setAnalyzingIds((prev) => new Set(prev).add(photoId));
    try {
      const data = await analyzePhoto(photoId);
      setAnalyses((prev) => ({ ...prev, [photoId]: data }));
      setExpandedAnalysis(photoId);
    } catch {
      setError('Failed to analyze photo');
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  };

  const loadCachedAnalysis = async (photoId: number) => {
    if (analyses[photoId]) {
      setExpandedAnalysis(expandedAnalysis === photoId ? null : photoId);
      return;
    }
    try {
      const data = await getPhotoAnalysis(photoId);
      setAnalyses((prev) => ({ ...prev, [photoId]: data }));
      setExpandedAnalysis(photoId);
    } catch {
      // No cached analysis
    }
  };

  const handleLoadSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const data = await getBedSuggestions(bedId);
      setSuggestions(data.suggestions || []);
      setShowSuggestions(true);
    } catch {
      setError('Failed to load suggestions');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handlePlaceFromSuggestion = async (cellX: number, cellY: number, plantId: number) => {
    setPlacing(true);
    try {
      await createPlanting({
        bed_id: bedId,
        plant_id: plantId,
        cell_x: cellX,
        cell_y: cellY,
        planted_date: getGardenToday(),
      });
      loadBed();
      setExpandedSuggestionCell(null);
      // Remove this cell from suggestions
      setSuggestions((prev) => prev.filter((s) => !(s.cell.x === cellX && s.cell.y === cellY)));
      toast('Plant placed!');
    } catch {
      setError('Failed to place plant');
    } finally {
      setPlacing(false);
    }
  };

  const getSuggestionForCell = (x: number, y: number): BedSuggestionCell | undefined => {
    return suggestions.find((s) => s.cell.x === x && s.cell.y === y);
  };

  // Check varieties for a plant before placing. Returns true if variety picker was shown, false if no varieties (place immediately).
  const checkVarietiesBeforePlacing = async (plant: Plant, cellX: number, cellY: number): Promise<boolean> => {
    setLoadingVarieties(true);
    try {
      const res = await getPlantVarieties(plant.id);
      const varieties: Variety[] = res.varieties || [];
      if (varieties.length > 0) {
        // Sort desert-rated varieties first (highest rating on top)
        const sorted = [...varieties].sort((a, b) => (b.desert_rating ?? 0) - (a.desert_rating ?? 0));
        setPlantVarieties(sorted);
        setVarietyPickerPlant(plant);
        setVarietyPickerCell({ x: cellX, y: cellY });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setLoadingVarieties(false);
    }
  };

  const placeWithVariety = (plant: Plant, cellX: number, cellY: number, varietyId?: number) => {
    // Show source picker instead of placing immediately
    setSourcePickerPlant(plant);
    setSourcePickerCell({ x: cellX, y: cellY });
    setSourcePickerVarietyId(varietyId);
    setSelectedSource('seed');
    setPlantAgeWeeks(null);
    setCustomAgeWeeks('');
    setShowSourcePicker(true);
    // Hide variety picker
    setVarietyPickerPlant(null);
    setVarietyPickerCell(null);
    setPlantVarieties([]);
  };

  const cancelSourcePicker = () => {
    setShowSourcePicker(false);
    setSourcePickerPlant(null);
    setSourcePickerCell(null);
    setSourcePickerVarietyId(undefined);
    setSelectedSource('seed');
    setPlantAgeWeeks(null);
    setCustomAgeWeeks('');
  };

  const placeWithSource = async () => {
    if (!sourcePickerPlant || !sourcePickerCell) return;
    setPlacing(true);
    try {
      await createPlanting({
        bed_id: bedId,
        plant_id: sourcePickerPlant.id,
        cell_x: sourcePickerCell.x,
        cell_y: sourcePickerCell.y,
        planted_date: getGardenToday(),
        ...(sourcePickerVarietyId ? { variety_id: sourcePickerVarietyId } : {}),
        source: selectedSource,
        ...(selectedSource === 'nursery' && plantAgeWeeks ? { plant_age_weeks: plantAgeWeeks } : {}),
      });
      loadBed();
      setSelectedPlant(null);
      setSelectedPlanting(null);
      setSelectedCell(null);
      setCompanionOverlay({});
      setRotationWarning(null);
      cancelSourcePicker();
      setSinglePlantPickerOpen(false);
      setSinglePlantSearch('');
      toast(selectedSource === 'nursery' ? 'Transplant placed!' : 'Plant placed!');
    } catch {
      setError('Failed to place plant');
    } finally {
      setPlacing(false);
    }
  };

  // Compute companion overlay when a plant is selected for placement
  useEffect(() => {
    if (!selectedPlant || !bed) {
      setCompanionOverlay({});
      return;
    }

    // Collect unique neighbor plant names (API companion check uses names, not IDs)
    const neighborMap = new Map<string, number>(); // name -> plant_id
    for (let y = 0; y < bed.height_cells; y++) {
      for (let x = 0; x < bed.width_cells; x++) {
        const cell = bed.grid[y]?.[x];
        if (cell) neighborMap.set(cell.plant_name, cell.plant_id);
      }
    }

    const uniqueNeighborNames = Array.from(neighborMap.keys());
    if (uniqueNeighborNames.length === 0) {
      setCompanionOverlay({});
      return;
    }

    // Check all companions in parallel using plant names
    Promise.allSettled(
      uniqueNeighborNames.map((neighborName) =>
        checkCompanion(selectedPlant.name, neighborName).then((r) => ({
          plantId: neighborMap.get(neighborName)!,
          ...r,
        }))
      )
    ).then((results) => {
      const overlay: CompanionState = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { plantId, relationship } = result.value;
          // Map the relationship to cells that contain this plant
          for (let y = 0; y < bed.height_cells; y++) {
            for (let x = 0; x < bed.width_cells; x++) {
              const cell = bed.grid[y]?.[x];
              if (cell && cell.plant_id === plantId) {
                const rel = relationship === 'companion' ? 'good' : relationship === 'antagonist' ? 'bad' : 'neutral';
                overlay[`${x},${y}`] = rel;
              }
            }
          }
        }
      }
      setCompanionOverlay(overlay);
    });
  }, [selectedPlant, bed]);

  // Compute grid-wide companion overlay when "Show Companions" is toggled on
  useEffect(() => {
    if (!showCompanions || !bed) {
      setGridCompanionOverlay({});
      return;
    }

    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1],
    ];

    // Collect unique adjacent plant-name pairs
    const pairsToCheck = new Set<string>();
    const pairKey = (a: string, b: string) => [a, b].sort().join('|||');

    for (let y = 0; y < bed.height_cells; y++) {
      for (let x = 0; x < bed.width_cells; x++) {
        const cell = bed.grid[y]?.[x];
        if (!cell) continue;
        for (const [dy, dx] of directions) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= bed.height_cells || nx < 0 || nx >= bed.width_cells) continue;
          const neighbor = bed.grid[ny]?.[nx];
          if (!neighbor || neighbor.plant_name === cell.plant_name) continue;
          pairsToCheck.add(pairKey(cell.plant_name, neighbor.plant_name));
        }
      }
    }

    if (pairsToCheck.size === 0) {
      setGridCompanionOverlay({});
      return;
    }

    // Filter out already-cached pairs
    const uncachedPairs = Array.from(pairsToCheck).filter(pk => !(pk in companionCache));

    const fetchAndBuild = (newCache: Record<string, 'good' | 'bad' | 'neutral'>) => {
      const mergedCache = { ...companionCache, ...newCache };
      // Build the overlay map
      const overlay: GridCompanionOverlay = {};
      for (let y = 0; y < bed.height_cells; y++) {
        for (let x = 0; x < bed.width_cells; x++) {
          const cell = bed.grid[y]?.[x];
          if (!cell) continue;
          for (const [dy, dx] of directions) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || ny >= bed.height_cells || nx < 0 || nx >= bed.width_cells) continue;
            const neighbor = bed.grid[ny]?.[nx];
            if (!neighbor || neighbor.plant_name === cell.plant_name) continue;
            const pk = pairKey(cell.plant_name, neighbor.plant_name);
            const rel = mergedCache[pk];
            if (!rel || rel === 'neutral') continue;
            const cellKey = `${x},${y}`;
            const neighborKey = `${nx},${ny}`;
            if (!overlay[cellKey]) overlay[cellKey] = { good: false, bad: false };
            if (!overlay[neighborKey]) overlay[neighborKey] = { good: false, bad: false };
            if (rel === 'good') {
              overlay[cellKey].good = true;
              overlay[neighborKey].good = true;
            } else if (rel === 'bad') {
              overlay[cellKey].bad = true;
              overlay[neighborKey].bad = true;
            }
          }
        }
      }
      setGridCompanionOverlay(overlay);
    };

    if (uncachedPairs.length === 0) {
      fetchAndBuild({});
      return;
    }

    setLoadingCompanions(true);
    Promise.allSettled(
      uncachedPairs.map(pk => {
        const [name1, name2] = pk.split('|||');
        return checkCompanion(name1, name2).then((r: { relationship: string }) => ({
          key: pk,
          rel: r.relationship === 'companion' ? 'good' as const : r.relationship === 'antagonist' ? 'bad' as const : 'neutral' as const,
        }));
      })
    ).then(results => {
      const newCache: Record<string, 'good' | 'bad' | 'neutral'> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          newCache[result.value.key] = result.value.rel;
        }
      }
      setCompanionCache(prev => ({ ...prev, ...newCache }));
      fetchAndBuild(newCache);
    }).finally(() => setLoadingCompanions(false));
  }, [showCompanions, bed]);

  // Check crop rotation when a plant is selected for placement
  useEffect(() => {
    if (!selectedPlant) {
      setRotationWarning(null);
      return;
    }
    checkRotation(bedId, selectedPlant.id)
      .then((result: { ok: boolean; warning?: string }) => {
        setRotationWarning(result.ok ? null : result.warning || null);
      })
      .catch(() => setRotationWarning(null));
  }, [selectedPlant, bedId]);

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent, x: number, y: number) => {
    if (!bed) return;
    let nextX = x;
    let nextY = y;
    switch (e.key) {
      case 'ArrowRight': nextX = Math.min(x + 1, bed.width_cells - 1); break;
      case 'ArrowLeft': nextX = Math.max(x - 1, 0); break;
      case 'ArrowDown': nextY = Math.min(y + 1, bed.height_cells - 1); break;
      case 'ArrowUp': nextY = Math.max(y - 1, 0); break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleCellClick(x, y);
        return;
      default: return;
    }
    e.preventDefault();
    setFocusedCell({ x: nextX, y: nextY });
    const nextEl = document.querySelector(`[data-grid-cell="${nextX}-${nextY}"]`) as HTMLElement;
    nextEl?.focus();
  }, [bed]);

  const handleCellClick = async (x: number, y: number) => {
    if (!bed) return;
    const cell = bed.grid[y]?.[x];

    if (cell) {
      // Clicking an occupied cell: show details (grid already normalized at load)
      setSelectedPlanting(cell);
      setSelectedCell({ x, y });
      setSelectedPlant(null);
      setShowCompanionPanel(false);
      setCompanionSuggestions(null);
      setAddingCompanionMode(false);
      setShowSidebar(true);
      return;
    }

    if (selectedPlant) {
      // Check for varieties first, place immediately if none
      const hadVarieties = await checkVarietiesBeforePlacing(selectedPlant, x, y);
      if (!hadVarieties) await placeWithVariety(selectedPlant, x, y);
    } else {
      // Select empty cell to prompt plant picker
      setSelectedCell({ x, y });
      setSelectedPlanting(null);
      setShowSidebar(true);
    }
  };

  const handleShowCompanionSuggestions = async () => {
    if (!selectedPlanting || !selectedCell) return;
    setLoadingCompanionSuggestions(true);
    setShowCompanionPanel(true);
    try {
      const data = await getCompanionSuggestions(bedId, selectedCell.x, selectedCell.y);
      setCompanionSuggestions(data);
    } catch {
      toast('Failed to load companion suggestions', 'error');
    } finally {
      setLoadingCompanionSuggestions(false);
    }
  };

  const handleAddCompanion = async (plantId: number, plantName: string) => {
    if (!selectedPlanting || !selectedCell) return;
    setPlacing(true);
    try {
      await addCompanion(bedId, {
        plant_id: plantId,
        cell_x: selectedCell.x,
        cell_y: selectedCell.y,
        companion_of: selectedPlanting.id,
        planted_date: getGardenToday(),
      });
      loadBed();
      setShowCompanionPanel(false);
      setCompanionSuggestions(null);
      setAddingCompanionMode(false);
      toast(`${plantName} added as companion to ${selectedPlanting.plant_name}`);
    } catch {
      toast('Failed to add companion', 'error');
    } finally {
      setPlacing(false);
    }
  };

  const handleAddCompanionFromPicker = async (plant: Plant) => {
    if (!selectedPlanting || !selectedCell) return;
    setPlacing(true);
    try {
      await addCompanion(bedId, {
        plant_id: plant.id,
        cell_x: selectedCell.x,
        cell_y: selectedCell.y,
        companion_of: selectedPlanting.id,
        planted_date: getGardenToday(),
      });
      loadBed();
      setAddingCompanionMode(false);
      setShowCompanionPanel(false);
      toast(`${plant.name} added as companion to ${selectedPlanting.plant_name}`);
    } catch {
      toast('Failed to add companion', 'error');
    } finally {
      setPlacing(false);
    }
  };

  const handleStatusUpdate = async (plantingId: number, newStatus: string) => {
    try {
      await updatePlanting(plantingId, { status: newStatus });
      loadBed();
      if (selectedPlanting) {
        setSelectedPlanting({ ...selectedPlanting, status: newStatus });
      }
      toast(`Status updated to ${newStatus}`);
    } catch {
      setError('Failed to update status');
    }
  };

  const handleDeleteBed = async () => {
    if (!await showConfirm({ title: 'Delete Planter', message: 'Are you sure you want to delete this planter and all its plantings?', confirmText: 'Delete', destructive: true })) return;
    try {
      const res = await deleteBed(bedId);
      toast('Planter deleted', 'success', {
        action: { label: 'Undo', onClick: async () => { try { await undoAction(res.undo_id); router.push(`/planters/${bedId}`); } catch { toast('Undo failed', 'error'); } } },
      });
      router.push('/planters');
    } catch {
      setError('Failed to delete planter');
    }
  };

  const handleOpenTemplates = async () => {
    try {
      const data = await getTemplates();
      setTemplates(data);
      setShowTemplateModal(true);
    } catch {
      toast('Failed to load templates', 'error');
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    setApplyingTemplate(true);
    try {
      const result = await applyTemplate(bedId, templateId);
      toast(`Applied "${result.template}" - ${result.placed} plants placed`);
      setShowTemplateModal(false);
      loadBed();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to apply template', 'error');
    } finally {
      setApplyingTemplate(false);
    }
  };

  const openRemoveDialog = () => {
    setShowRemoveDialog(true);
    setRemoveStep('choose');
    setRemoveNote('');
    setDiedReason('');
    setYieldWeight('');
    setYieldQuantity('');
  };

  const openMoveDialog = async () => {
    setShowMoveDialog(true);
    setMoveMode(null);
    setMoveTargetBed(null);
    setMoveCellX(0);
    setMoveCellY(0);
    setMoveGroundName(selectedPlanting?.plant_name || '');
    setMoveGroundX('');
    setMoveGroundY('');
    setMoveGroundAreaId(null);
    try {
      const beds = await getBeds();
      setAllBeds(beds.filter((b: any) => b.id !== bedId));
    } catch { /* ignore */ }
  };

  const handleMovePlanting = async () => {
    if (!selectedPlanting) return;
    setMovingPlant(true);
    try {
      if (moveMode === 'planter' && moveTargetBed) {
        await movePlanting(selectedPlanting.id, {
          target_bed_id: moveTargetBed,
          target_cell_x: moveCellX,
          target_cell_y: moveCellY,
        });
        toast('Plant moved to another planter!');
      } else if (moveMode === 'ground') {
        await movePlantingToGround(selectedPlanting.id, {
          name: moveGroundName || undefined,
          x_feet: moveGroundX ? parseFloat(moveGroundX) : undefined,
          y_feet: moveGroundY ? parseFloat(moveGroundY) : undefined,
          area_id: moveGroundAreaId || undefined,
        });
        toast('Plant moved to ground!');
      }
      setShowMoveDialog(false);
      setSelectedPlanting(null);
      setSelectedCell(null);
      setShowSidebar(false);
      loadBed();
    } catch {
      setError('Failed to move plant');
    } finally {
      setMovingPlant(false);
    }
  };

  const handleRemoveAs = async (reason: 'harvested' | 'failed' | 'transplanted' | 'delete') => {
    if (!selectedPlanting) return;
    const plantingId = selectedPlanting.id;
    try {
      let deleteUndoId: string | null = null;
      if (reason === 'delete') {
        const res = await deletePlanting(plantingId);
        deleteUndoId = res.undo_id;
      } else if (reason === 'harvested') {
        if (removeStep !== 'harvest-details') {
          setRemoveStep('harvest-details');
          return;
        }
        const updateData: any = { status: 'harvested' };
        if (removeNote.trim()) updateData.notes = removeNote.trim();
        if (yieldWeight) updateData.yield_weight_oz = parseFloat(yieldWeight);
        if (yieldQuantity) updateData.yield_quantity = parseInt(yieldQuantity, 10);
        await updatePlanting(plantingId, updateData);
      } else if (reason === 'failed') {
        if (removeStep !== 'died-details') {
          setRemoveStep('died-details');
          return;
        }
        const updateData: any = { status: 'failed' };
        const noteParts: string[] = [];
        if (diedReason) noteParts.push(`Cause: ${diedReason}`);
        if (removeNote.trim()) noteParts.push(removeNote.trim());
        if (noteParts.length > 0) updateData.notes = noteParts.join('. ');
        await updatePlanting(plantingId, updateData);
      } else if (reason === 'transplanted') {
        await updatePlanting(plantingId, { status: 'removed', notes: removeNote.trim() || 'Transplanted to another location' });
      }
      loadBed();
      setSelectedPlanting(null);
      setSelectedCell(null);
      setShowRemoveDialog(false);
      if (reason === 'delete' && deleteUndoId) {
        toast('Plant removed', 'success', {
          action: { label: 'Undo', onClick: async () => { try { await undoAction(deleteUndoId!); loadBed(); } catch { toast('Undo failed', 'error'); } } },
        });
      } else {
        toast(reason === 'delete' ? 'Plant removed' : reason === 'harvested' ? 'Plant harvested!' : reason === 'failed' ? 'Plant marked as failed' : 'Plant transplanted');
      }
      setShowSidebar(false);
    } catch {
      setError('Failed to remove planting');
    }
  };

  // Legacy wrapper for single planter remove button
  const handleRemovePlanting = (plantingId: number) => {
    // For single planter, we need to set selectedPlanting first so the dialog works
    if (!selectedPlanting || selectedPlanting.id !== plantingId) {
      const cell = bed?.grid[0]?.[0];
      if (cell) {
        setSelectedPlanting(cell);
      }
    }
    openRemoveDialog();
  };

  const handleDeleteNote = async (noteId: number) => {
    try {
      await deleteNote(noteId);
      if (selectedPlanting) {
        const updated = await getPlantingNotes(selectedPlanting.id);
        setPlantingNotes(updated);
      }
    } catch {
      setError('Failed to delete note');
    }
  };

  const getCellBorderClass = (x: number, y: number): string => {
    const key = `${x},${y}`;
    // Placement-mode companion overlay takes priority
    if (companionOverlay[key] === 'good') return 'ring-2 ring-green-500 ring-inset';
    if (companionOverlay[key] === 'bad') return 'ring-2 ring-red-500 ring-inset';
    // Grid-wide companion visualization
    const gc = gridCompanionOverlay[key];
    if (gc) {
      if (gc.bad && gc.good) return 'ring-2 ring-red-500 ring-inset shadow-[inset_0_0_8px_rgba(239,68,68,0.4),0_0_8px_rgba(34,197,94,0.4)]';
      if (gc.bad) return 'ring-2 ring-red-500 ring-inset shadow-[inset_0_0_8px_rgba(239,68,68,0.4)]';
      if (gc.good) return 'ring-2 ring-green-500 ring-inset shadow-[inset_0_0_8px_rgba(34,197,94,0.4)]';
    }
    return '';
  };

  const filteredPlants = plants.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesName = p.name.toLowerCase().includes(q);
    // Also match variety names so searching "Big Boy" or "Shishito" finds the parent plant
    const matchesVariety = !matchesName && q.length >= 2 && (allVarieties || []).some(
      (v: any) => v.plant_id === p.id && v.name.toLowerCase().includes(q)
    );
    const matchesSearch = matchesName || matchesVariety;
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return <div className="text-center py-16 text-earth-400 dark:text-gray-500">Loading planter...</div>;
  }

  if (error && !bed) {
    return (
      <div className="text-center py-16">
        <div className="text-red-500 mb-4">{error}</div>
        <Link href="/planters" className="text-garden-600 hover:underline">Back to planters</Link>
      </div>
    );
  }

  if (!bed) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        {/* Row 1: Breadcrumb + name */}
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/planters" className="text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 transition-colors shrink-0">
            &larr; Planters
          </Link>
          <span className="text-earth-300 dark:text-gray-600 shrink-0">/</span>
          <h1
            className="text-xl sm:text-2xl font-bold text-earth-800 dark:text-gray-100 cursor-pointer hover:bg-earth-100 dark:hover:bg-gray-700 px-2 py-1 -mx-2 rounded truncate"
            title="Click to rename"
            onClick={async () => {
              const newName = await showPrompt({ title: 'Rename Planter', message: 'Enter a new name for this planter:', defaultValue: bed.name });
              if (newName && newName !== bed.name) {
                updateBed(bed.id, { name: newName }).then(() => {
                  setBed({ ...bed, name: newName });
                  toast('Planter renamed');
                });
              }
            }}
          >
            {bed.name} <span className="text-earth-300 dark:text-gray-600 text-sm">&#9998;</span>
          </h1>
        </div>
        {/* Row 2: Badges + metadata */}
        <div className="flex flex-wrap items-center gap-2">
          {bedAreas.length > 0 && (
            <select
              value={bed.area_id ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                updateBed(bed.id, { area_id: val === '' ? 0 : Number(val) }).then(() => {
                  setBed({ ...bed, area_id: val === '' ? null : Number(val) });
                });
              }}
              className="text-xs px-2 py-1 rounded border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-600 dark:text-gray-300 min-h-[44px] sm:min-h-0"
            >
              <option value="">No Area</option>
              {bedAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setShowBedSettings(true)}
            className="text-sm text-earth-400 dark:text-gray-500 hover:text-garden-600 dark:hover:text-garden-400 transition-colors cursor-pointer inline-flex items-center gap-1"
            title="Click to resize grid"
          >
            {bed.bed_type === 'single' ? (
              <>{[
                bed.physical_width_inches ? `${bed.physical_width_inches}" W` : null,
                bed.physical_length_inches ? `${bed.physical_length_inches}" L` : null,
                bed.depth_inches ? `${bed.depth_inches}" D` : null,
              ].filter(Boolean).join(' x ') || bed.description || 'Single planter'}</>
            ) : (
              <>{bed.width_cells}x{bed.height_cells} &middot; {bed.cell_size_inches}&quot; cells
              {bed.depth_inches ? <> &middot; {bed.depth_inches}&quot; deep</> : null}</>
            )}
            <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
          </button>
          {bed.irrigation_type === 'rachio_controller' || bed.irrigation_type === 'rachio_hose_timer' ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
              {'💧'} Automated{bed.irrigation_zone_name ? ` — ${bed.irrigation_zone_name}` : ''}
            </span>
          ) : bed.irrigation_type === 'none' ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
              {'❌'} No Irrigation
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              {'✋'} Manual
            </span>
          )}
          {bed.planter_type_id && (() => {
            const pt = planterTypes.find((p: any) => p.id === bed.planter_type_id);
            if (!pt) return null;
            return (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300">
                {pt.brand ? `${pt.brand} · ` : ''}{pt.name}
              </span>
            );
          })()}
        </div>
        {/* Row 3: Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleOpenTemplates}
            className="min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 hover:bg-purple-200 dark:hover:bg-purple-900/50"
            title="Use Template"
          >
            <svg className="w-4 h-4 inline-block sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
            <span className="hidden sm:inline">Use Template</span>
          </button>
          <button
            onClick={() => {
              if (showSuggestions) {
                setShowSuggestions(false);
                setSuggestions([]);
                setExpandedSuggestionCell(null);
              } else {
                handleLoadSuggestions();
              }
            }}
            disabled={loadingSuggestions}
            className={`min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              showSuggestions
                ? 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200'
                : 'bg-garden-100 text-garden-700 border border-garden-300 hover:bg-garden-200'
            }`}
            title={showSuggestions ? 'Hide Suggestions' : 'Suggest Plants'}
          >
            <svg className="w-4 h-4 inline-block sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            <span className="hidden sm:inline">{loadingSuggestions ? 'Analyzing...' : showSuggestions ? 'Hide Suggestions' : 'Suggest Plants'}</span>
            <span className="sm:hidden">{loadingSuggestions ? '...' : ''}</span>
          </button>
          <button
            onClick={() => setShowCompanions(prev => !prev)}
            disabled={loadingCompanions}
            className={`min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              showCompanions
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-200 dark:hover:bg-emerald-900/50'
                : 'bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 border border-garden-300 dark:border-garden-700 hover:bg-garden-200 dark:hover:bg-garden-900/50'
            }`}
            title={showCompanions ? 'Hide Companions' : 'Show Companions'}
          >
            <svg className="w-4 h-4 inline-block sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="hidden sm:inline">{loadingCompanions ? 'Checking...' : showCompanions ? 'Hide Companions' : 'Show Companions'}</span>
            <span className="sm:hidden">{loadingCompanions ? '...' : ''}</span>
          </button>
          <button
            onClick={handleDeleteBed}
            className="min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 ml-auto"
            title="Delete this planter"
          >
            <svg className="w-4 h-4 inline-block sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span className="hidden sm:inline">Delete Planter</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}


      {/* Single Planter Card View */}
      {bed.bed_type === 'single' && (
        <div className="space-y-4">
          {/* Dimensions Card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-earth-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Planter Dimensions</h3>
            <div className="flex items-center gap-3 text-2xl font-bold text-earth-800 dark:text-gray-100">
              {[
                bed.physical_width_inches ? `${bed.physical_width_inches}"` : null,
                bed.physical_length_inches ? `${bed.physical_length_inches}"` : null,
                bed.depth_inches ? `${bed.depth_inches}"` : null,
              ].filter(Boolean).map((dim, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-earth-300 dark:text-gray-600 text-lg font-normal mx-1">&times;</span>}
                  {dim}
                </span>
              ))}
              {!bed.physical_width_inches && !bed.physical_length_inches && !bed.depth_inches && (
                <span className="text-earth-400 dark:text-gray-500 text-base font-normal">No dimensions set</span>
              )}
            </div>
            {(bed.physical_width_inches || bed.physical_length_inches || bed.depth_inches) && (
              <div className="flex gap-4 mt-2 text-xs text-earth-400 dark:text-gray-500">
                {bed.physical_width_inches && <span>W: {bed.physical_width_inches}"</span>}
                {bed.physical_length_inches && <span>L: {bed.physical_length_inches}"</span>}
                {bed.depth_inches && <span>D: {bed.depth_inches}"</span>}
              </div>
            )}
          </div>

          {/* Plant Card */}
          {(() => {
            const planting = bed.grid[0]?.[0];
            if (planting) {
              return (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-earth-500 dark:text-gray-400 mb-3 uppercase tracking-wide">Plant</h3>
                  <div className="flex items-center gap-4">
                    <span className="text-4xl">{getPlantIcon(planting.plant_name, planting.category)}</span>
                    <div className="flex-1 min-w-0">
                      <Link href={`/plants?highlight=${planting.plant_id}`} className="text-lg font-bold text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                        {planting.plant_name}
                      </Link>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusLabels[planting.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                          {statusLabels[planting.status]?.label || planting.status}
                        </span>
                        <span className="text-xs text-earth-400 dark:text-gray-500">Planted {planting.planted_date}</span>
                      </div>
                    </div>
                  </div>
                  {/* Status buttons */}
                  <div className="mt-4 pt-4 border-t border-earth-100 dark:border-gray-700">
                    <p className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-2">Update Status:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {getStatusesForPlant(planting.plant_id).map((s) => (
                        <button
                          key={s}
                          onClick={() => handleStatusUpdate(planting.id, s)}
                          disabled={planting.status === s}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            planting.status === s
                              ? 'bg-garden-600 text-white border-garden-600'
                              : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 border-earth-300 dark:border-gray-600 hover:border-garden-400 hover:text-garden-700'
                          }`}
                        >
                          {statusLabels[s]?.label || s}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Photos */}
                  {(() => {
                    const plantingId = planting.id;
                    // Auto-select this planting so photos/notes load
                    if (!selectedPlanting || selectedPlanting.id !== plantingId) {
                      // Trigger selection on first render
                      setTimeout(() => {
                        setSelectedPlanting(planting);
                        setSelectedCell({ x: 0, y: 0 });
                      }, 0);
                    }
                    return null;
                  })()}
                  {selectedPlanting && photos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-earth-100 dark:border-gray-700">
                      <p className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-2">Photos ({photos.length})</p>
                      <div className="grid grid-cols-4 gap-2">
                        {photos.map((photo) => (
                          <button
                            key={photo.id}
                            onClick={() => setLightboxPhoto(photo)}
                            className="aspect-square rounded-lg overflow-hidden bg-earth-100 dark:bg-gray-700 group"
                          >
                            <img
                              src={getPhotoUrl(photo.id)}
                              alt={photo.caption || 'Photo'}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedPlanting && (
                    <div className="mt-4">
                      <label className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed cursor-pointer transition-colors text-xs ${
                        uploading
                          ? 'border-earth-300 bg-earth-50 text-earth-400'
                          : 'border-garden-300 bg-garden-50 text-garden-700 hover:bg-garden-100'
                      }`}>
                        {uploading ? 'Uploading...' : 'Add Photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handlePhotoUpload}
                          disabled={uploading}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                  {/* Notes */}
                  {selectedPlanting && (
                    <div className="mt-4 pt-4 border-t border-earth-100 dark:border-gray-700">
                      <p className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-2">
                        Notes {plantingNotes.length > 0 && `(${plantingNotes.length})`}
                      </p>
                      {plantingNotes.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {plantingNotes.map((n: any) => (
                            <div key={n.id} className="text-xs p-2 rounded bg-earth-50 dark:bg-gray-700/50 flex items-start gap-1">
                              <div className="flex-1 min-w-0">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mr-1 ${
                                  n.note_type === 'problem' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' :
                                  n.note_type === 'success' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
                                  'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                                }`}>{n.note_type}</span>
                                <span className="text-earth-600 dark:text-gray-400">{n.content}</span>
                              </div>
                              <button onClick={() => handleDeleteNote(n.id)} className="text-earth-300 hover:text-red-500 shrink-0">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <select value={noteType} onChange={(e) => setNoteType(e.target.value)} className="px-2 py-1.5 text-xs border border-earth-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-200">
                          <option value="observation">Observation</option>
                          <option value="problem">Problem</option>
                          <option value="success">Success</option>
                          <option value="lesson">Lesson</option>
                        </select>
                        <input
                          type="text" value={noteContent} onChange={(e) => setNoteContent(e.target.value)}
                          placeholder="Add a note..." className="flex-1 px-2 py-1.5 text-xs border border-earth-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-200"
                        />
                        <button onClick={handleAddNote} disabled={submittingNote || !noteContent.trim()}
                          className="px-3 py-1.5 text-xs bg-garden-600 text-white rounded hover:bg-garden-700 disabled:opacity-50">
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Plant Timeline */}
                  <div className="mt-4">
                    <PlantTimeline plantType="planting" plantId={planting.id} plantName={planting.plant_name} />
                  </div>

                  {/* Actions */}
                  <div className="mt-4 pt-4 border-t border-earth-100 dark:border-gray-700 flex items-center gap-3">
                    <Link href={`/plants?highlight=${planting.plant_id}`} className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium">View in Library</Link>
                    <Link href={`/history/plant/${planting.plant_id}`} className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium">View History</Link>
                    <button onClick={() => { handleRemovePlanting(planting.id); setRemoveStep('died-details'); }} className="text-xs text-orange-600 hover:text-orange-800 font-medium ml-auto">Died</button>
                    <button onClick={() => handleRemovePlanting(planting.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove Plant</button>
                  </div>
                </div>
              );
            } else {
              // No plant yet - show picker
              return (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-earth-500 dark:text-gray-400 mb-3 uppercase tracking-wide">Plant</h3>
                  {!singlePlantPickerOpen ? (
                    <button
                      onClick={() => setSinglePlantPickerOpen(true)}
                      className="w-full py-8 rounded-lg border-2 border-dashed border-garden-300 dark:border-garden-700 bg-garden-50 dark:bg-garden-900/20 text-garden-700 dark:text-garden-300 hover:bg-garden-100 dark:hover:bg-garden-900/30 transition-colors flex flex-col items-center gap-2"
                    >
                      <span className="text-3xl">+</span>
                      <span className="text-sm font-medium">No plant yet -- tap to add one</span>
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={singlePlantSearch}
                        onChange={(e) => setSinglePlantSearch(e.target.value)}
                        placeholder="Search plants..."
                        aria-label="Search plants"
                        className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                        autoFocus
                      />
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {plants.filter(p => {
                          const q = singlePlantSearch.toLowerCase();
                          if (!q) return true;
                          if (p.name.toLowerCase().includes(q)) return true;
                          return q.length >= 2 && (allVarieties || []).some((v: any) => v.plant_id === p.id && v.name.toLowerCase().includes(q));
                        }).slice(0, 20).map(plant => (
                          <button
                            key={plant.id}
                            onClick={async () => {
                              const hadVarieties = await checkVarietiesBeforePlacing(plant, 0, 0);
                              if (!hadVarieties) {
                                await placeWithVariety(plant, 0, 0);
                                setSinglePlantPickerOpen(false);
                                setSinglePlantSearch('');
                              }
                            }}
                            disabled={placing || loadingVarieties}
                            className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[48px] rounded-lg text-left hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            <span className="text-xl">{getPlantIcon(plant.name, plant.category)}</span>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-earth-800 dark:text-gray-100 truncate">{plant.name}</div>
                              <div className="text-xs text-earth-400 dark:text-gray-500">{plant.category} &middot; {plant.days_to_maturity_min}-{plant.days_to_maturity_max}d</div>
                            </div>
                          </button>
                        ))}
                      </div>
                      {varietyPickerPlant && varietyPickerCell && (
                        <div className="mt-2 bg-garden-50 dark:bg-gray-750 border border-garden-300 dark:border-garden-700 rounded-lg p-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-earth-800 dark:text-gray-100">
                              {getPlantIcon(varietyPickerPlant.name, varietyPickerPlant.category)} {varietyPickerPlant.name} — Choose variety
                            </span>
                            <button onClick={() => { setVarietyPickerPlant(null); setVarietyPickerCell(null); setPlantVarieties([]); }} className="text-earth-400 text-xs font-bold px-1">&#10005;</button>
                          </div>
                          <div className="relative">
                            <div className="space-y-0.5 max-h-[40vh] overflow-y-auto scrollbar-thin">
                              <button
                                onClick={() => { placeWithVariety(varietyPickerPlant, 0, 0); }}
                                disabled={placing}
                                className="w-full text-left px-2 py-2.5 min-h-[44px] rounded text-xs hover:bg-garden-100 dark:hover:bg-gray-700 text-earth-600 dark:text-gray-300"
                              >
                                Any / No specific variety
                              </button>
                              {plantVarieties.map((v) => (
                                <button
                                  key={v.id}
                                  onClick={() => { placeWithVariety(varietyPickerPlant, 0, 0, v.id); }}
                                  disabled={placing}
                                  className="w-full text-left px-2 py-2.5 min-h-[44px] rounded text-xs hover:bg-garden-100 dark:hover:bg-gray-700 flex items-center justify-between"
                                >
                                  <span className="font-medium text-earth-800 dark:text-gray-100">{v.name}</span>
                                  {v.desert_rating != null && v.desert_rating > 0 && (
                                    <span className="text-[10px] ml-1">{'🌵'.repeat(v.desert_rating)}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                            {plantVarieties.length > 6 && (
                              <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-garden-50 dark:from-gray-750 to-transparent rounded-b-lg" />
                            )}
                          </div>
                        </div>
                      )}
                      {showSourcePicker && sourcePickerPlant && (
                        <div className="mt-2 bg-garden-50 dark:bg-gray-750 border border-garden-300 dark:border-garden-700 rounded-lg p-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-earth-800 dark:text-gray-100">
                              {getPlantIcon(sourcePickerPlant.name, sourcePickerPlant.category)} {sourcePickerPlant.name} — How was it started?
                            </span>
                            <button onClick={cancelSourcePicker} className="text-earth-400 text-xs font-bold px-1">&#10005;</button>
                          </div>
                          <div className="grid grid-cols-2 gap-1 mb-1.5">
                            {([['seed', 'From seed'], ['nursery', 'From nursery'], ['cutting', 'From cutting'], ['division', 'Division']] as const).map(([val, label]) => (
                              <button
                                key={val}
                                onClick={() => { setSelectedSource(val); if (val !== 'nursery') setPlantAgeWeeks(null); }}
                                className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                                  selectedSource === val
                                    ? 'bg-garden-600 text-white'
                                    : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-garden-100 dark:hover:bg-gray-600 border border-earth-200 dark:border-gray-600'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          {selectedSource === 'nursery' && (
                            <div className="mb-1.5">
                              <p className="text-[10px] text-earth-500 dark:text-gray-400 mb-1">How old is this plant?</p>
                              <div className="flex flex-wrap gap-1 mb-1">
                                {[2, 4, 6, 8].map((w) => (
                                  <button
                                    key={w}
                                    onClick={() => { setPlantAgeWeeks(w); setCustomAgeWeeks(''); }}
                                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                      plantAgeWeeks === w && !customAgeWeeks
                                        ? 'bg-garden-600 text-white'
                                        : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-garden-100 dark:hover:bg-gray-600 border border-earth-200 dark:border-gray-600'
                                    }`}
                                  >
                                    ~{w}wk
                                  </button>
                                ))}
                              </div>
                              <input
                                type="number"
                                min="1"
                                max="52"
                                placeholder="Custom weeks..."
                                value={customAgeWeeks}
                                onChange={(e) => { setCustomAgeWeeks(e.target.value); if (e.target.value) setPlantAgeWeeks(parseInt(e.target.value)); else setPlantAgeWeeks(null); }}
                                className="w-full px-2 py-1 text-[10px] rounded border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100 placeholder-earth-400 dark:placeholder-gray-500"
                              />
                            </div>
                          )}
                          <button
                            onClick={placeWithSource}
                            disabled={placing || (selectedSource === 'nursery' && !plantAgeWeeks)}
                            className="w-full py-1.5 rounded text-xs font-semibold transition-colors bg-garden-600 text-white hover:bg-garden-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {placing ? 'Placing...' : selectedSource === 'nursery' ? 'Place transplant' : 'Place plant'}
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => { setSinglePlantPickerOpen(false); setSinglePlantSearch(''); setVarietyPickerPlant(null); setVarietyPickerCell(null); setPlantVarieties([]); cancelSourcePicker(); }}
                        className="text-xs text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            }
          })()}
        </div>
      )}

      {/* Grid/Vertical Layout (non-single planters) */}
      {bed.bed_type !== 'single' && (
      <div className="flex gap-4 sm:gap-6 flex-col lg:flex-row relative">
        {/* Grid */}
        <div className={showSidebar ? 'flex-1 min-w-0' : 'w-full'}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-3 sm:p-4 shadow-sm overflow-x-auto">
            {selectedPlant && (
              <div className="mb-3 flex items-center gap-2 bg-garden-50 border border-garden-200 text-garden-800 px-3 py-2 rounded-lg text-sm">
                <span>Placing: {getPlantIcon(selectedPlant.name, selectedPlant.category)} {selectedPlant.name}</span>
                <span className="text-garden-500">&mdash; click an empty cell</span>
                <button
                  onClick={() => { setSelectedPlant(null); setCompanionOverlay({}); setRotationWarning(null); }}
                  className="ml-auto text-garden-600 hover:text-garden-800 font-bold"
                >
                  &times; Cancel
                </button>
              </div>
            )}
            {/* Rotation warning */}
            {rotationWarning && (
              <div className="mb-3 bg-yellow-50 border border-yellow-300 text-yellow-800 px-3 py-2 rounded-lg text-sm flex items-start gap-2">
                <span className="text-lg leading-none shrink-0">{'\u26A0\uFE0F'}</span>
                <span>{rotationWarning}</span>
              </div>
            )}
            {/* Companion legend */}
            {selectedPlant && Object.keys(companionOverlay).length > 0 && (
              <div className="mb-3 flex items-center gap-4 text-xs text-earth-500">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded border-2 border-green-500 inline-block"></span> Good companion
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded border-2 border-red-500 inline-block"></span> Antagonist
                </span>
              </div>
            )}
            {showCompanions && Object.keys(gridCompanionOverlay).length > 0 && (
              <div className="mb-3 flex items-center gap-4 text-xs text-earth-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded border-2 border-green-500 inline-block shadow-[0_0_4px_rgba(34,197,94,0.5)]"></span> Good companions
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded border-2 border-red-500 inline-block shadow-[0_0_4px_rgba(239,68,68,0.5)]"></span> Avoid together
                </span>
              </div>
            )}
            {/* Vertical tower visualization */}
            {bed.bed_type === 'vertical' && (
              <div className="space-y-2" role="grid" aria-label={`${bed.name} vertical planter grid`}>
                {Array.from({ length: bed.height_cells }).map((_, y) => {
                  const tierNum = bed.height_cells - y;
                  return (
                    <div key={y} className="flex items-center gap-2">
                      <div className="text-xs font-bold text-earth-500 dark:text-gray-400 w-14 text-right shrink-0">
                        Tier {tierNum}
                        {y === bed.height_cells - 1 && <div className="text-[9px] font-normal text-earth-400">(bottom)</div>}
                        {y === 0 && <div className="text-[9px] font-normal text-earth-400">(top)</div>}
                      </div>
                      <div className="flex gap-1 flex-wrap" role="row">
                        {Array.from({ length: bed.width_cells }).map((_, x) => {
                          const cell = bed.grid[y]?.[x];
                          const isSelected = selectedCell?.x === x && selectedCell?.y === y;
                          const isFocused = focusedCell?.x === x && focusedCell?.y === y;
                          return (
                            <button
                              key={`${x}-${y}`}
                              data-grid-cell={`${x}-${y}`}
                              role="gridcell"
                              aria-label={cell ? `${cell.plant_name} at tier ${tierNum}, pocket ${x + 1} - ${cell.status}` : `Empty pocket at tier ${tierNum}, pocket ${x + 1}`}
                              tabIndex={isFocused || (!focusedCell && x === 0 && y === 0) ? 0 : -1}
                              onClick={() => handleCellClick(x, y)}
                              onKeyDown={(e) => handleGridKeyDown(e, x, y)}
                              onFocus={() => setFocusedCell({ x, y })}
                              disabled={placing}
                              className={`
                                w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center text-xs
                                transition-all cursor-pointer relative
                                ${cell
                                  ? `${categoryBg[cell.category] || 'bg-gray-200 border-gray-400'} hover:brightness-95`
                                  : selectedPlant
                                    ? 'bg-garden-50 border-garden-200 hover:bg-garden-100 border-dashed'
                                    : 'bg-earth-50 dark:bg-gray-700 border-earth-200 dark:border-gray-600 hover:bg-earth-100 dark:hover:bg-gray-600'
                                }
                                ${isSelected ? 'ring-2 ring-garden-500 ring-offset-1' : ''}
                              `}
                              title={cell ? `${cell.plant_name}${cell.variety_name ? ` - ${cell.variety_name}` : ''} (${cell.status})` : `Empty pocket (${x}, Tier ${tierNum})`}
                            >
                              {cell ? (
                                <>
                                  <span className="text-base leading-none">{getPlantIcon(cell.plant_name, cell.category)}</span>
                                  <span className="text-[8px] font-medium text-earth-700 truncate max-w-full px-0.5">
                                    {cell.variety_name
                                      ? (cell.variety_name.length > 5 ? cell.variety_name.slice(0, 5) + '..' : cell.variety_name)
                                      : (cell.plant_name.length > 5 ? cell.plant_name.slice(0, 5) + '..' : cell.plant_name)}
                                  </span>
                                  {cell.companions && cell.companions.length > 0 && (
                                    <span className="absolute bottom-0.5 right-0.5 text-[8px] font-bold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 rounded-full px-1 leading-tight">
                                      +{cell.companions.length}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-earth-300 text-lg">+</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-14"></div>
                  <div className="text-xs text-earth-400 dark:text-gray-500 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                    Water flows down from top tier through gravity watering system
                  </div>
                </div>
              </div>
            )}

            {/* Section labels for linear/grid beds */}
            {(bed.bed_type === 'linear' || bed.bed_type === 'grid') && sections.length > 0 && (
              <div className="mb-1 relative" style={{ display: 'grid', gap: '0.25rem', gridTemplateColumns: `repeat(${bed.width_cells}, minmax(70px, 120px))` }}>
                {Array.from({ length: bed.width_cells }).map((_, x) => {
                  const section = sections.find(s => x >= s.start_cell && x <= s.end_cell);
                  const isStart = section && x === section.start_cell;
                  const span = section ? section.end_cell - section.start_cell + 1 : 1;
                  if (section && !isStart) return null;
                  if (!section) return <div key={x} />;
                  return (
                    <div
                      key={x}
                      className="text-center text-[10px] font-bold text-white px-1 py-0.5 rounded-t truncate"
                      style={{ gridColumn: `${x + 1} / span ${span}`, backgroundColor: `hsl(${(section.id * 60) % 360}, 55%, 50%)` }}
                      title={section.irrigation_zone_name ? `Zone: ${section.irrigation_zone_name}` : section.name}
                    >
                      {section.name}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Freeform layout */}
            {bed.bed_type === 'freeform' && (
              <FreeformPlanterView
                bed={bed}
                plantings={freeformPlantings}
                onPlantingClick={(p) => {
                  setSelectedPlanting(p as any);
                  setSelectedCell(null);
                  setFreeformTapPos(null);
                  setSelectedPlant(null);
                  setShowCompanionPanel(false);
                  setCompanionSuggestions(null);
                  setAddingCompanionMode(false);
                  setShowSidebar(true);
                }}
                onEmptyClick={(x, y) => {
                  if (selectedPlant) {
                    // Place selected plant at this position
                    setPlacing(true);
                    createPlanting({
                      bed_id: bedId,
                      plant_id: selectedPlant.id,
                      planted_date: getGardenToday(),
                      position_x_inches: x,
                      position_y_inches: y,
                    }).then(() => {
                      loadBed();
                      setSelectedPlant(null);
                      setFreeformTapPos(null);
                      toast('Plant placed!');
                    }).catch(() => {
                      toast('Failed to place plant', 'error');
                    }).finally(() => setPlacing(false));
                  } else {
                    // Open sidebar with plant picker at this position
                    setFreeformTapPos({ x, y });
                    setSelectedPlanting(null);
                    setSelectedCell(null);
                    setShowSidebar(true);
                  }
                }}
                onRefresh={loadBed}
                toast={toast}
              />
            )}
            {bed.bed_type !== 'vertical' && bed.bed_type !== 'freeform' && (<div
              className="grid gap-1"
              role="grid"
              aria-label={`${bed.name} planting grid, ${bed.width_cells} columns by ${bed.height_cells} rows`}
              style={{
                gridTemplateColumns: `repeat(${bed.width_cells}, minmax(70px, 120px))`,
              }}
            >
              {Array.from({ length: bed.height_cells }).map((_, y) =>
                Array.from({ length: bed.width_cells }).map((_, x) => {
                  const cell = bed.grid[y]?.[x];
                  const isSelected = selectedCell?.x === x && selectedCell?.y === y;
                  const isFocused = focusedCell?.x === x && focusedCell?.y === y;
                  const cellSuggestion = showSuggestions && !cell ? getSuggestionForCell(x, y) : undefined;
                  const topSuggestion = cellSuggestion?.suggestions[0];
                  const statusAbbrev = cell ? (statusLabels[cell.status]?.label?.[0] || cell.status[0]?.toUpperCase()) : '';

                  return (
                    <button
                      key={`${x}-${y}`}
                      data-grid-cell={`${x}-${y}`}
                      role="gridcell"
                      aria-label={cell ? `${cell.plant_name} at row ${y + 1}, column ${x + 1} - ${cell.status}` : topSuggestion ? `Suggested: ${topSuggestion.plant_name} at row ${y + 1}, column ${x + 1}` : `Empty cell at row ${y + 1}, column ${x + 1}`}
                      tabIndex={isFocused || (!focusedCell && x === 0 && y === 0) ? 0 : -1}
                      onClick={() => {
                        if (cellSuggestion && !selectedPlant) {
                          const key = `${x},${y}`;
                          setExpandedSuggestionCell(expandedSuggestionCell === key ? null : key);
                          setSelectedCell({ x, y });
                          setSelectedPlanting(null);
                        } else {
                          handleCellClick(x, y);
                        }
                      }}
                      onKeyDown={(e) => handleGridKeyDown(e, x, y)}
                      onFocus={() => setFocusedCell({ x, y })}
                      disabled={placing}
                      className={`
                        aspect-square rounded-md border-2 flex flex-col items-center justify-center text-sm
                        transition-all cursor-pointer relative
                        ${cell
                          ? `${categoryBg[cell.category] || 'bg-gray-200 border-gray-400'} hover:brightness-95`
                          : topSuggestion
                            ? 'bg-amber-50 border-amber-300 hover:bg-amber-100 border-dashed'
                            : selectedPlant
                              ? 'bg-garden-50 border-garden-200 hover:bg-garden-100 border-dashed'
                              : 'bg-earth-50 dark:bg-gray-700 border-earth-200 dark:border-gray-600 hover:bg-earth-100 dark:hover:bg-gray-600'
                        }
                        ${isSelected ? 'ring-2 ring-garden-500 ring-offset-1' : ''}
                        ${getCellBorderClass(x, y)}
                      `}
                      title={cell ? `${cell.plant_name}${cell.variety_name ? ` - ${cell.variety_name}` : ''} (${cell.status})` : topSuggestion ? `Suggested: ${topSuggestion.plant_name}` : `Empty (${x}, ${y})`}
                    >
                      {cell ? (
                        <>
                          <span className="text-xl leading-none">{getPlantIcon(cell.plant_name, cell.category)}</span>
                          <span className="text-sm font-semibold text-earth-800 dark:text-earth-200 truncate max-w-full px-0.5 mt-0.5 drop-shadow-sm">
                            {cell.plant_name.length > 12 ? cell.plant_name.slice(0, 12) + '..' : cell.plant_name}
                          </span>
                          {cell.variety_name && (
                            <span className="text-[9px] text-earth-500 dark:text-earth-400 truncate max-w-full px-0.5 leading-tight">
                              {cell.variety_name.length > 14 ? cell.variety_name.slice(0, 14) + '..' : cell.variety_name}
                            </span>
                          )}
                          <span className="absolute top-0.5 right-0.5 text-[8px] font-bold text-earth-500 dark:text-earth-300 leading-none" aria-hidden="true">{statusAbbrev}</span>
                          {cell.companions && cell.companions.length > 0 && (
                            <>
                              <span className="absolute bottom-0.5 left-0.5 text-[10px] leading-none">
                                {getPlantIcon(cell.companions[0].plant_name, cell.companions[0].category)}
                              </span>
                              <span className="absolute bottom-0.5 right-0.5 text-[9px] font-bold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 rounded-full px-1 leading-tight">
                                +{cell.companions.length}
                              </span>
                            </>
                          )}
                          {cell.companions && cell.companions.length > 0 && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 rounded-b" />
                          )}
                        </>
                      ) : topSuggestion ? (
                        <>
                          <span className="text-xl leading-none opacity-60">{getPlantIcon(topSuggestion.plant_name, topSuggestion.category)}</span>
                          <span className="text-xs font-medium text-amber-600 truncate max-w-full px-0.5">
                            {topSuggestion.plant_name.length > 12 ? topSuggestion.plant_name.slice(0, 12) + '..' : topSuggestion.plant_name}
                          </span>
                        </>
                      ) : (
                        <span className="text-earth-300 text-xl">+</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>)}
          </div>
        </div>

        {/* Sidebar - hidden by default, shown on cell click */}
        {showSidebar && (
        <>
          {/* Mobile overlay backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden"
            onClick={() => { setShowSidebar(false); setSelectedPlanting(null); setSelectedPlant(null); setSelectedCell(null); setFreeformTapPos(null); setShowCompanionPanel(false); setCompanionSuggestions(null); setAddingCompanionMode(false); }}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl p-4 lg:static lg:max-h-none lg:rounded-xl lg:shadow-sm lg:p-0 lg:bg-transparent lg:dark:bg-transparent lg:z-auto w-full lg:w-80 lg:flex-shrink-0 space-y-4">

          {/* Close button */}
          <div className="flex justify-end mb-1">
            <button
              onClick={() => { setShowSidebar(false); setSelectedPlanting(null); setSelectedPlant(null); setSelectedCell(null); setFreeformTapPos(null); setShowCompanionPanel(false); setCompanionSuggestions(null); setAddingCompanionMode(false); }}
              className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-sm font-bold px-2 py-1 rounded hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors"
              title="Close sidebar"
            >
              &#10005; Close
            </button>
          </div>

          {/* Sections/Zones removed — irrigation zone assignment handled at the planter level */}

          {/* Plant detail / status panel */}
          {selectedPlanting && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">{getPlantIcon(selectedPlanting.plant_name, selectedPlanting.category)}</span>
                <div>
                  <Link href={`/plants?highlight=${selectedPlanting.plant_id}`} className="font-bold text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                    {selectedPlanting.plant_name}
                  </Link>
                  {selectedPlanting.variety_name && (
                    <p className="text-xs font-medium text-garden-700 dark:text-garden-400">
                      {selectedPlanting.variety_name}
                      {selectedPlanting.variety_desert_rating != null && selectedPlanting.variety_desert_rating > 0 && (
                        <span className="ml-1">{'🌵'.repeat(selectedPlanting.variety_desert_rating)}</span>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-earth-400 dark:text-gray-500">
                    {bed.bed_type === 'freeform' && selectedPlanting.position_x_inches != null
                      ? <>Position ({Math.round(selectedPlanting.position_x_inches!)}&quot;, {Math.round(selectedPlanting.position_y_inches!)}&quot;)</>
                      : <>Cell ({selectedPlanting.cell_x}, {selectedPlanting.cell_y})</>
                    }
                    {' '}&middot; Planted {selectedPlanting.planted_date}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mb-3">
                <Link
                  href={`/plants?highlight=${selectedPlanting.plant_id}`}
                  className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
                >
                  View in Library
                </Link>
                <Link
                  href={`/lifecycle?plant_id=${selectedPlanting.plant_id}`}
                  className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
                >
                  Plan Lifecycle
                </Link>
                <Link
                  href={`/history/plant/${selectedPlanting.plant_id}`}
                  className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
                >
                  View History
                </Link>
              </div>
              <div className="mb-3">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusLabels[selectedPlanting.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                  {statusLabels[selectedPlanting.status]?.label || selectedPlanting.status}
                </span>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-earth-500 mb-2">Update Status:</p>
                <div className="flex flex-wrap gap-1.5">
                  {getStatusesForPlant(selectedPlanting.plant_id).map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusUpdate(selectedPlanting.id, s)}
                      disabled={selectedPlanting.status === s}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        selectedPlanting.status === s
                          ? 'bg-garden-600 text-white border-garden-600'
                          : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 border-earth-300 dark:border-gray-600 hover:border-garden-400 hover:text-garden-700'
                      }`}
                    >
                      {statusLabels[s]?.label || s}
                    </button>
                  ))}
                </div>
              </div>
              {/* Companions Section */}
              <div className="mt-4 pt-4 border-t border-earth-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-earth-500 dark:text-gray-400">
                    Companions {selectedPlanting.companions && selectedPlanting.companions.length > 0 && `(${selectedPlanting.companions.length})`}
                  </p>
                  <button
                    onClick={handleShowCompanionSuggestions}
                    disabled={loadingCompanionSuggestions}
                    className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors font-medium"
                  >
                    {loadingCompanionSuggestions ? 'Loading...' : '+ Add Companion'}
                  </button>
                </div>
                {selectedPlanting.companions && selectedPlanting.companions.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {selectedPlanting.companions.map((comp) => (
                      <div key={comp.id} className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-2.5 py-1.5">
                        <span className="text-sm">{getPlantIcon(comp.plant_name, comp.category)}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-earth-700 dark:text-gray-200">{comp.plant_name}</span>
                          {comp.variety_name && (
                            <span className="text-[10px] text-earth-400 dark:text-gray-500 ml-1">{comp.variety_name}</span>
                          )}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusLabels[comp.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                          {statusLabels[comp.status]?.label || comp.status}
                        </span>
                        <button
                          onClick={async () => {
                            if (await showConfirm({ title: 'Remove Companion', message: `Remove ${comp.plant_name} as companion?`, confirmText: 'Remove', destructive: true })) {
                              try {
                                await deletePlanting(comp.id);
                                loadBed();
                                toast(`${comp.plant_name} removed`);
                              } catch { toast('Failed to remove companion', 'error'); }
                            }
                          }}
                          className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 text-xs font-bold"
                          title="Remove companion"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {showCompanionPanel && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-earth-700 dark:text-gray-200">Companion Suggestions</span>
                      <button
                        onClick={() => { setShowCompanionPanel(false); setCompanionSuggestions(null); setAddingCompanionMode(false); }}
                        className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-xs font-bold"
                      >
                        &times;
                      </button>
                    </div>
                    {loadingCompanionSuggestions ? (
                      <p className="text-xs text-earth-400 text-center py-2">Loading suggestions...</p>
                    ) : companionSuggestions ? (
                      <>
                        {companionSuggestions.suggestions?.length > 0 ? (
                          <div className="space-y-1.5 mb-2">
                            {companionSuggestions.suggestions.map((s: any) => (
                              <div key={s.plant_id} className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-2.5 py-1.5 border border-green-200 dark:border-green-800">
                                <span className="text-sm">{getPlantIcon(s.plant_name, s.category)}</span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-medium text-earth-700 dark:text-gray-200">{s.plant_name}</span>
                                  <p className="text-[10px] text-earth-400 dark:text-gray-500">{s.benefit}</p>
                                </div>
                                <button
                                  onClick={() => handleAddCompanion(s.plant_id, s.plant_name)}
                                  disabled={placing}
                                  className="text-[10px] px-2 py-1 rounded-full bg-green-600 text-white hover:bg-green-700 transition-colors font-medium shrink-0"
                                >
                                  Add
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-earth-400 text-center py-1">No specific companions found in database</p>
                        )}
                        {companionSuggestions.avoid?.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800">
                            <p className="text-[10px] font-medium text-red-500 dark:text-red-400 mb-1">Avoid planting with:</p>
                            <div className="flex flex-wrap gap-1">
                              {companionSuggestions.avoid.map((a: any, i: number) => (
                                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                                  {a.plant_name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => setAddingCompanionMode(true)}
                          className="mt-2 w-full text-xs px-3 py-1.5 rounded-lg border border-dashed border-green-400 dark:border-green-600 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                        >
                          Choose any plant as companion...
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
                {addingCompanionMode && (
                  <div className="bg-white dark:bg-gray-800 border border-green-200 dark:border-green-700 rounded-lg p-3 mb-2">
                    <p className="text-xs font-medium text-earth-600 dark:text-gray-300 mb-2">Pick any plant as companion:</p>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search plants..."
                      className="w-full px-2.5 py-1.5 border border-earth-300 dark:border-gray-600 rounded-lg text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none mb-2 bg-white dark:bg-gray-700 dark:text-gray-100"
                    />
                    <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-0.5">
                      {plants.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 20).map((plant) => (
                        <button
                          key={plant.id}
                          onClick={() => handleAddCompanionFromPicker(plant)}
                          disabled={placing}
                          className="w-full text-left px-2.5 py-1.5 rounded text-xs hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors flex items-center gap-2"
                        >
                          <span>{getPlantIcon(plant.name, plant.category)}</span>
                          <span className="font-medium text-earth-700 dark:text-gray-200">{plant.name}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setAddingCompanionMode(false)}
                      className="mt-2 w-full text-xs text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              {/* Photo Section */}
              <div className="mt-4 pt-4 border-t border-earth-200">
                <p className="text-xs font-medium text-earth-500 mb-2">
                  Photos {photos.length > 0 && `(${photos.length})`}
                </p>
                {photos.length > 0 && (
                  <div className="space-y-2 mb-3">
                    <div className="grid grid-cols-3 gap-1.5">
                      {photos.map((photo) => (
                        <div key={photo.id} className="relative">
                          <button
                            onClick={() => setLightboxPhoto(photo)}
                            className="aspect-square rounded-lg overflow-hidden bg-earth-100 relative group w-full"
                          >
                            <img
                              src={getPhotoUrl(photo.id)}
                              alt={photo.caption || 'Photo'}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              loading="lazy"
                            />
                            {analyses[photo.id] && (
                              <div className="absolute top-1 right-1">
                                <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                                  analyses[photo.id].health === 'healthy' ? 'bg-green-400' :
                                  analyses[photo.id].health === 'stressed' ? 'bg-yellow-400' :
                                  'bg-red-400'
                                }`} />
                              </div>
                            )}
                          </button>
                          <button
                            onClick={() => analyses[photo.id] ? loadCachedAnalysis(photo.id) : handleAnalyzePhoto(photo.id)}
                            disabled={analyzingIds.has(photo.id)}
                            className="absolute bottom-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-colors disabled:opacity-50"
                            title={analyses[photo.id] ? 'View analysis' : 'Analyze plant health'}
                          >
                            {analyzingIds.has(photo.id) ? (
                              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                    {/* Inline analysis panel */}
                    {expandedAnalysis && analyses[expandedAnalysis] && (
                      <div className="bg-garden-50 dark:bg-garden-900/20 border border-garden-200 dark:border-garden-700 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
                              analyses[expandedAnalysis].health === 'healthy' ? 'bg-green-100 text-green-700 border-green-300' :
                              analyses[expandedAnalysis].health === 'stressed' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                              analyses[expandedAnalysis].health === 'diseased' ? 'bg-red-100 text-red-700 border-red-300' :
                              'bg-red-200 text-red-800 border-red-400'
                            }`}>
                              {analyses[expandedAnalysis].health}
                            </span>
                            <span className="text-[10px] text-earth-400">{analyses[expandedAnalysis].growth_stage} &middot; {analyses[expandedAnalysis].confidence} confidence</span>
                          </div>
                          <button onClick={() => setExpandedAnalysis(null)} className="text-earth-400 hover:text-earth-600 text-xs font-bold">&times;</button>
                        </div>
                        <p className="text-xs text-earth-600 dark:text-gray-400 mb-2">{analyses[expandedAnalysis].summary}</p>
                        {analyses[expandedAnalysis].issues?.length > 0 && (
                          <div className="mb-2">
                            {analyses[expandedAnalysis].issues.map((issue: any, i: number) => (
                              <p key={i} className="text-[10px] text-earth-500">
                                <span className={issue.severity === 'high' ? 'text-red-600 font-medium' : issue.severity === 'medium' ? 'text-orange-600 font-medium' : 'text-yellow-600 font-medium'}>
                                  [{issue.severity.toUpperCase()}]
                                </span>{' '}
                                {issue.name}: {issue.description}
                              </p>
                            ))}
                          </div>
                        )}
                        {analyses[expandedAnalysis].recommendations?.length > 0 && (
                          <ul className="list-disc list-inside text-[10px] text-earth-500 space-y-0.5">
                            {analyses[expandedAnalysis].recommendations.map((rec: string, i: number) => (
                              <li key={i}>{rec}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <input
                    type="text"
                    value={photoCaption}
                    onChange={(e) => setPhotoCaption(e.target.value)}
                    placeholder="Caption (optional)"
                    aria-label="Photo caption"
                    className="w-full px-2.5 py-1.5 border border-earth-300 rounded-lg text-xs focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
                  />
                  <label className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed cursor-pointer transition-colors text-xs ${
                    uploading
                      ? 'border-earth-300 bg-earth-50 text-earth-400'
                      : 'border-garden-300 bg-garden-50 text-garden-700 hover:bg-garden-100'
                  }`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {uploading ? 'Uploading...' : 'Add Photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Notes Section */}
              <div className="mt-4 pt-4 border-t border-earth-200 dark:border-gray-700">
                <p className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-2">
                  Notes {plantingNotes.length > 0 && `(${plantingNotes.length})`}
                </p>
                {plantingNotes.length > 0 && (
                  <div className="space-y-1.5 mb-3 max-h-32 overflow-y-auto">
                    {plantingNotes.map((n: any) => (
                      <div key={n.id} className="text-xs p-2 rounded bg-earth-50 dark:bg-gray-700/50 flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mr-1 ${
                            n.note_type === 'problem' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' :
                            n.note_type === 'success' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
                            n.note_type === 'lesson' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' :
                            'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                          }`}>{n.note_type.replace('_', ' ')}</span>
                          <span className="text-earth-600 dark:text-gray-400">{n.content}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteNote(n.id)}
                          className="text-earth-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 shrink-0 mt-0.5"
                          title="Delete note"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  <select
                    value={noteType}
                    onChange={(e) => setNoteType(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-earth-300 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200 focus:ring-2 focus:ring-garden-500 outline-none"
                  >
                    <option value="observation">Observation</option>
                    <option value="problem">Problem</option>
                    <option value="success">Success</option>
                    <option value="lesson">Lesson</option>
                    <option value="weather_impact">Weather Impact</option>
                    <option value="pest_issue">Pest Issue</option>
                    <option value="harvest_note">Harvest Note</option>
                  </select>
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="What did you observe?"
                    aria-label="Planting note"
                    rows={2}
                    className="w-full px-2.5 py-1.5 border border-earth-300 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-200 focus:ring-2 focus:ring-garden-500 outline-none resize-none"
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={submittingNote || !noteContent.trim()}
                    className="w-full text-xs px-3 py-1.5 rounded-lg bg-garden-600 text-white hover:bg-garden-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submittingNote ? 'Adding...' : 'Add Note'}
                  </button>
                </div>
              </div>

              {/* Plant Timeline */}
              <div className="mt-3">
                <PlantTimeline plantType="planting" plantId={selectedPlanting.id} plantName={selectedPlanting.plant_name} />
              </div>

              <div className="mt-3 flex items-center gap-3">
                <Link
                  href={`/history/plant/${selectedPlanting.plant_id}`}
                  className="text-xs text-garden-600 dark:text-garden-400 hover:underline"
                >
                  View Plant History
                </Link>
                <button
                  onClick={openMoveDialog}
                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                >
                  Move
                </button>
                <button
                  onClick={() => { openRemoveDialog(); setRemoveStep('died-details'); }}
                  className="text-xs text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300 font-medium"
                >
                  Died
                </button>
                <button
                  onClick={openRemoveDialog}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                >
                  Remove
                </button>
                <button
                  onClick={() => { setShowSidebar(false); setSelectedPlanting(null); setSelectedPlant(null); setSelectedCell(null); setFreeformTapPos(null); setShowCompanionPanel(false); setCompanionSuggestions(null); setAddingCompanionMode(false); }}
                  className="text-xs text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Suggestion detail panel */}
          {expandedSuggestionCell && showSuggestions && selectedCell && (() => {
            const cs = getSuggestionForCell(selectedCell.x, selectedCell.y);
            if (!cs) return null;
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-earth-800 text-sm">
                    Suggestions for ({selectedCell.x}, {selectedCell.y})
                  </h3>
                  <button
                    onClick={() => setExpandedSuggestionCell(null)}
                    className="text-earth-400 hover:text-earth-600 text-sm font-bold"
                  >
                    &times;
                  </button>
                </div>
                <div className="space-y-2.5">
                  {cs.suggestions.map((s, i) => (
                    <div key={s.plant_id} className={`rounded-lg p-3 ${i === 0 ? 'bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800' : 'bg-white/60 dark:bg-gray-800/60 border border-earth-200 dark:border-gray-700'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-lg">{getPlantIcon(s.plant_name, s.category)}</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-earth-800 text-sm">{s.plant_name}</span>
                          <span className="text-xs text-earth-400 ml-1.5">score: {s.score}</span>
                        </div>
                        <button
                          onClick={() => handlePlaceFromSuggestion(selectedCell.x, selectedCell.y, s.plant_id)}
                          disabled={placing}
                          className="text-xs px-2.5 py-1 rounded-full bg-garden-600 text-white hover:bg-garden-700 transition-colors font-medium shrink-0"
                        >
                          Place
                        </button>
                      </div>
                      <ul className="space-y-0.5">
                        {s.reasons.map((r, ri) => (
                          <li key={ri} className="text-xs text-earth-500 flex items-start gap-1">
                            <span className="text-garden-500 mt-0.5 shrink-0">&#10003;</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Empty cell prompt */}
          {selectedCell && !selectedPlanting && !selectedPlant && !expandedSuggestionCell && (
            <div className="bg-garden-50 border border-garden-200 rounded-xl p-4 text-sm text-garden-700">
              Cell ({selectedCell.x}, {selectedCell.y}) is empty. Select a plant below to place it here.
            </div>
          )}

          {/* Freeform tap position prompt */}
          {freeformTapPos && !selectedPlanting && !selectedPlant && bed?.bed_type === 'freeform' && (
            <div className="bg-garden-50 border border-garden-200 rounded-xl p-4 text-sm text-garden-700">
              Position ({Math.round(freeformTapPos.x)}&quot;, {Math.round(freeformTapPos.y)}&quot;) &mdash; select a plant below to place it here.
            </div>
          )}

          {/* Plant picker - only show when no planting is selected (empty cell) */}
          {!selectedPlanting && (
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
                  {cat === 'all' ? 'All' : `${categoryEmoji[cat] || ''} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`}
                </button>
              ))}
            </div>
            <div className="max-h-96 overflow-y-auto scrollbar-thin space-y-0.5">
              {filteredPlants.length === 0 ? (
                <p className="text-earth-400 dark:text-gray-500 text-sm py-4 text-center">No plants found</p>
              ) : (
                filteredPlants.map((plant) => (
                  <button
                    key={plant.id}
                    onClick={async () => {
                      if (selectedPlant?.id === plant.id) {
                        // Deselect
                        setSelectedPlant(null);
                        return;
                      }
                      // Freeform: place at tapped position
                      if (bed?.bed_type === 'freeform' && freeformTapPos) {
                        setPlacing(true);
                        try {
                          await createPlanting({
                            bed_id: bedId,
                            plant_id: plant.id,
                            planted_date: getGardenToday(),
                            position_x_inches: freeformTapPos.x,
                            position_y_inches: freeformTapPos.y,
                          });
                          loadBed();
                          setSelectedPlant(null);
                          setFreeformTapPos(null);
                          setShowSidebar(false);
                          toast('Plant placed!');
                        } catch {
                          toast('Failed to place plant', 'error');
                        } finally {
                          setPlacing(false);
                        }
                        return;
                      }
                      // If an empty cell is already highlighted, check for varieties first
                      if (selectedCell && !bed?.grid[selectedCell.y]?.[selectedCell.x]) {
                        const hadVarieties = await checkVarietiesBeforePlacing(plant, selectedCell.x, selectedCell.y);
                        if (!hadVarieties) await placeWithVariety(plant, selectedCell.x, selectedCell.y);
                      } else {
                        setSelectedPlant(plant);
                        setSelectedPlanting(null);
                      }
                    }}
                    className={`w-full text-left px-3 py-2.5 min-h-[48px] rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      selectedPlant?.id === plant.id
                        ? 'bg-garden-100 dark:bg-garden-900/30 border border-garden-300 dark:border-garden-700'
                        : 'hover:bg-earth-50 dark:hover:bg-gray-700 border border-transparent'
                    }`}
                  >
                    <span>{getPlantIcon(plant.name, plant.category)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-earth-800 dark:text-gray-100 truncate">{plant.name}</div>
                      <div className="text-xs text-earth-400 dark:text-gray-500">
                        {plant.days_to_maturity_min}-{plant.days_to_maturity_max}d &middot; {plant.sun} &middot; {plant.spacing_inches}&quot; spacing
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Source picker overlay */}
            {showSourcePicker && sourcePickerPlant && sourcePickerCell && (
              <div className="mt-3 bg-garden-50 dark:bg-gray-750 border border-garden-300 dark:border-garden-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-earth-800 dark:text-gray-100">
                    {getPlantIcon(sourcePickerPlant.name, sourcePickerPlant.category)} {sourcePickerPlant.name} — How was it started?
                  </span>
                  <button
                    onClick={cancelSourcePicker}
                    className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-xs font-bold px-1"
                  >
                    &#10005;
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {([['seed', 'From seed'], ['nursery', 'From nursery'], ['cutting', 'From cutting'], ['division', 'Division']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => { setSelectedSource(val); if (val !== 'nursery') setPlantAgeWeeks(null); }}
                      className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                        selectedSource === val
                          ? 'bg-garden-600 text-white'
                          : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-garden-100 dark:hover:bg-gray-600 border border-earth-200 dark:border-gray-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selectedSource === 'nursery' && (
                  <div className="mb-2">
                    <p className="text-xs text-earth-500 dark:text-gray-400 mb-1.5">How old is this plant?</p>
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {[2, 4, 6, 8].map((w) => (
                        <button
                          key={w}
                          onClick={() => { setPlantAgeWeeks(w); setCustomAgeWeeks(''); }}
                          className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                            plantAgeWeeks === w && !customAgeWeeks
                              ? 'bg-garden-600 text-white'
                              : 'bg-white dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-garden-100 dark:hover:bg-gray-600 border border-earth-200 dark:border-gray-600'
                          }`}
                        >
                          ~{w} weeks
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="52"
                      placeholder="Custom weeks..."
                      value={customAgeWeeks}
                      onChange={(e) => { setCustomAgeWeeks(e.target.value); if (e.target.value) setPlantAgeWeeks(parseInt(e.target.value)); else setPlantAgeWeeks(null); }}
                      className="w-full px-2 py-1.5 text-xs rounded border border-earth-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100 placeholder-earth-400 dark:placeholder-gray-500"
                    />
                  </div>
                )}
                <button
                  onClick={placeWithSource}
                  disabled={placing || (selectedSource === 'nursery' && !plantAgeWeeks)}
                  className="w-full py-2 rounded text-sm font-semibold transition-colors bg-garden-600 text-white hover:bg-garden-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {placing ? 'Placing...' : selectedSource === 'nursery' ? 'Place transplant' : 'Place plant'}
                </button>
              </div>
            )}

            {/* Variety picker overlay */}
            {varietyPickerPlant && varietyPickerCell && (
              <div className="mt-3 bg-garden-50 dark:bg-gray-750 border border-garden-300 dark:border-garden-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-earth-800 dark:text-gray-100">
                    {getPlantIcon(varietyPickerPlant.name, varietyPickerPlant.category)} {varietyPickerPlant.name} — Choose variety
                  </span>
                  <button
                    onClick={() => { setVarietyPickerPlant(null); setVarietyPickerCell(null); setPlantVarieties([]); }}
                    className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-xs font-bold px-1"
                  >
                    &#10005;
                  </button>
                </div>
                {loadingVarieties ? (
                  <p className="text-xs text-earth-400 py-2 text-center">Loading varieties...</p>
                ) : (
                  <div className="relative">
                    <div className="space-y-0.5 max-h-[40vh] overflow-y-auto scrollbar-thin">
                      <button
                        onClick={() => placeWithVariety(varietyPickerPlant, varietyPickerCell.x, varietyPickerCell.y)}
                        disabled={placing}
                        className="w-full text-left px-3 py-2.5 min-h-[44px] rounded text-sm hover:bg-garden-100 dark:hover:bg-gray-700 transition-colors text-earth-600 dark:text-gray-300"
                      >
                        Any / No specific variety
                      </button>
                      {plantVarieties.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => placeWithVariety(varietyPickerPlant, varietyPickerCell.x, varietyPickerCell.y, v.id)}
                          disabled={placing}
                          className="w-full text-left px-3 py-2.5 min-h-[44px] rounded text-sm hover:bg-garden-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
                        >
                          <span className="font-medium text-earth-800 dark:text-gray-100">{v.name}</span>
                          {v.desert_rating != null && v.desert_rating > 0 && (
                            <span className="text-xs text-earth-400 dark:text-gray-500 ml-2 flex-shrink-0">
                              {'🌵'.repeat(v.desert_rating)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    {plantVarieties.length > 6 && (
                      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-garden-50 dark:from-gray-750 to-transparent rounded-b-lg" />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </div>
        </>
        )}
      </div>
      )}


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
              loadBedSchedule();
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
                <option value="rachio_controller">Rachio Controller</option>
                <option value="rachio_hose_timer">Rachio Hose Timer</option>
                <option value="manual">Manual</option>
                <option value="drip">Drip System</option>
                <option value="sprinkler">Sprinkler</option>
                <option value="bubbler">Bubbler</option>
                <option value="none">None</option>
              </select>
            </div>

            {irrigationType === 'rachio_controller' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Controller Zone</label>
                {irrigationLoading ? (
                  <div className="text-sm text-earth-400">Loading zones...</div>
                ) : irrigationZones.length > 0 ? (
                  <select
                    value={irrigationZoneName}
                    onChange={(e) => setIrrigationZoneName(e.target.value)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  >
                    <option value="">Select a zone...</option>
                    {irrigationZones.map((z) => (
                      <option key={z.id} value={z.name}>
                        Zone {z.zone_number}: {z.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={irrigationZoneName}
                    onChange={(e) => setIrrigationZoneName(e.target.value)}
                    placeholder="e.g., Front Yard Zone 1"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                )}
              </div>
            )}

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
                {'✋'} Manual watering. Water tasks will be auto-generated based on plant needs, temperature, and rainfall.
              </div>
            )}

            {irrigationType === 'none' && (
              <div className="text-sm text-earth-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg px-4 py-3">
                {'❌'} No irrigation configured. Water tasks will not be generated.
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

            {/* Live Schedule Info from Rachio */}
            {bedScheduleLoading && (
              <div className="text-sm text-earth-400 dark:text-gray-500 mt-3">Loading schedule data...</div>
            )}
            {bedSchedule && !bedScheduleLoading && bedSchedule.irrigation_type !== 'manual' && bedSchedule.irrigation_type !== 'none' && (
              <div className="mt-4 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-3">
                <h4 className="text-sm font-semibold text-earth-600 dark:text-gray-300">Rachio Schedule</h4>
                {bedSchedule.watering_summary && (
                  <div className="text-sm text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/20 border border-garden-200 dark:border-garden-800 rounded-lg px-4 py-2">
                    {'💧'} {bedSchedule.watering_summary}
                  </div>
                )}
                {bedSchedule.next_watering && (
                  <div className="text-xs text-blue-600 dark:text-blue-400">
                    {bedSchedule.next_watering.active ? 'Currently running' : 'Next run'}: {bedSchedule.next_watering.start_time ? formatGardenDateTime(bedSchedule.next_watering.start_time) : bedSchedule.next_watering.message || 'Unknown'}
                  </div>
                )}
                {bedSchedule.schedules?.map((s: any, i: number) => (
                  <div key={i} className="text-xs bg-blue-50 dark:bg-blue-900/20 rounded px-3 py-2 border border-blue-100 dark:border-blue-800">
                    <span className="font-medium text-blue-800 dark:text-blue-300">{s.schedule_name}</span>
                    <span className="text-blue-600 dark:text-blue-400 ml-2">{s.duration_minutes} min, {s.frequency}</span>
                  </div>
                ))}
                {bedSchedule.mismatches?.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">{'\u26A0\uFE0F'} Water Mismatch</div>
                    {bedSchedule.mismatches.map((m: string, i: number) => (
                      <div key={i} className="text-xs text-amber-600 dark:text-amber-400">{m}</div>
                    ))}
                  </div>
                )}
                {bedSchedule.history_7d?.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Last 7 days</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {bedSchedule.history_7d.map((evt: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs text-earth-500 dark:text-gray-400 bg-earth-50 dark:bg-gray-700/50 rounded px-2 py-1">
                          <span>{evt.zone_name} &middot; {evt.event_type}</span>
                          <span>{evt.duration_minutes != null ? `${evt.duration_minutes} min` : ''} &middot; {typeof evt.recorded_at === 'string' && evt.recorded_at.length > 10 ? formatGardenDate(evt.recorded_at) : evt.recorded_at}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {bedSchedule.plants?.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Plants in this planter</div>
                    <div className="flex flex-wrap gap-1">
                      {bedSchedule.plants.map((p: any) => (
                        <span key={p.id} className={`text-xs px-2 py-0.5 rounded-full ${p.water === 'high' ? 'bg-blue-100 text-blue-700' : p.water === 'low' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                          {p.name} ({p.water || 'moderate'})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>


      {/* Soil Settings (collapsible) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
          onClick={() => setShowSoil(!showSoil)}
        >
          <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            {'🌱'} Soil Settings
            {bed?.soil_type && (
              <span className="text-xs font-normal text-earth-400 dark:text-gray-500">
                ({soilTypes.find(st => st.value === bed.soil_type)?.label || bed.soil_type})
              </span>
            )}
          </span>
          <svg className={`w-5 h-5 text-earth-400 transition-transform ${showSoil ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showSoil && (
        <div className="px-5 pb-5 space-y-3 border-t border-earth-100 dark:border-gray-700 pt-4">
            {/* Soil Type dropdown */}
            <label className="block">
              <span className="text-xs text-earth-500 dark:text-gray-400">Soil Type</span>
              <select
                value={bed?.soil_type || ''}
                onChange={async (e) => {
                  if (!bed) return;
                  const val = e.target.value || '';
                  // Clear product when changing soil type
                  await updateBed(bed.id, { soil_type: val, soil_product_id: 0 });
                  loadBed();
                }}
                className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
              >
                <option value="">Not set</option>
                {soilTypes.map(st => (
                  <option key={st.value} value={st.value}>{st.label}</option>
                ))}
              </select>
            </label>

            {/* Product/Brand dropdown — only shown when soil type has products */}
            {bed?.soil_type && soilTypes.find(st => st.value === bed.soil_type)?.has_products && (
              <label className="block">
                <span className="text-xs text-earth-500 dark:text-gray-400">Product / Brand</span>
                {soilProductsLoading ? (
                  <div className="mt-1 text-xs text-earth-400 dark:text-gray-500">Loading products...</div>
                ) : (
                  <select
                    value={bed?.soil_product_id || ''}
                    onChange={async (e) => {
                      if (!bed) return;
                      const val = e.target.value ? Number(e.target.value) : 0;
                      await updateBed(bed.id, { soil_product_id: val });
                      loadBed();
                    }}
                    className="w-full mt-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
                  >
                    <option value="">Select a product...</option>
                    {soilProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.brand} - {p.product_name}</option>
                    ))}
                    <option value="custom">Custom / Other</option>
                  </select>
                )}
              </label>
            )}

            {/* Product details */}
            {selectedSoilProduct && (
              <div className="bg-earth-50 dark:bg-gray-750 rounded-lg p-3 space-y-1.5">
                <div className="text-xs font-medium text-earth-700 dark:text-gray-200">
                  {selectedSoilProduct.brand} {selectedSoilProduct.product_name}
                </div>
                <p className="text-[11px] text-earth-500 dark:text-gray-400 leading-relaxed">
                  {selectedSoilProduct.description}
                </p>
                {selectedSoilProduct.composition && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedSoilProduct.composition.map((c, i) => (
                      <span key={i} className="inline-block px-1.5 py-0.5 rounded-full bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 text-[10px]">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-earth-400 dark:text-gray-500">
                  pH {selectedSoilProduct.ph_range_min}–{selectedSoilProduct.ph_range_max}
                  {selectedSoilProduct.url && (
                    <> · <a href={selectedSoilProduct.url} target="_blank" rel="noopener noreferrer" className="text-garden-600 dark:text-garden-400 underline">Website</a></>
                  )}
                </div>
                {selectedSoilProduct.notes && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 italic">{selectedSoilProduct.notes}</p>
                )}
              </div>
            )}

            {/* Soil type description when no product is shown */}
            {!selectedSoilProduct && (
              <p className="text-[10px] text-earth-400 dark:text-gray-500 mt-1">
                {bed?.soil_type
                  ? soilTypes.find(st => st.value === bed.soil_type)?.description || bed.soil_type
                  : 'No soil type set — will inherit from zone or property default (Native Clay pH ~8.0)'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sensors */}
      <SensorReadings targetType="bed" targetId={bed.id} />

      {/* Soil Amendments (collapsible) */}
      <SoilAmendments entityType="bed" entityId={bed.id} entityName={bed.name} />

      {/* Planter Settings (collapsible) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
          onClick={() => {
            setShowBedSettings(!showBedSettings);
          }}
        >
          <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            ⚙️ Planter Settings
          </span>
          <svg className={`w-5 h-5 text-earth-400 transition-transform ${showBedSettings ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showBedSettings && (
          <div className="px-5 pb-5 space-y-4 border-t border-earth-100 dark:border-gray-700 pt-4">
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Planter Type</label>
              <select
                value={settingsBedType}
                onChange={(e) => {
                  const newType = e.target.value;
                  setSettingsBedType(newType);
                  if (newType === 'single') {
                    setSettingsWidth(1);
                    setSettingsHeight(1);
                  }
                }}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
              >
                <option value="grid">Grid</option>
                <option value="single">Single Plant</option>
                <option value="vertical">Vertical</option>
                <option value="freeform">Free-form</option>
              </select>
            </div>

            {settingsBedType === 'single' ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Width (inches)</label>
                  <input
                    type="number"
                    min={1}
                    value={settingsPhysicalWidth || ''}
                    onChange={(e) => setSettingsPhysicalWidth(parseFloat(e.target.value) || null)}
                    placeholder="e.g., 24"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Length (inches)</label>
                  <input
                    type="number"
                    min={1}
                    value={settingsPhysicalLength || ''}
                    onChange={(e) => setSettingsPhysicalLength(parseFloat(e.target.value) || null)}
                    placeholder="e.g., 48"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Depth (inches)</label>
                  <input
                    type="number"
                    min={1}
                    value={settingsDepthInches || ''}
                    onChange={(e) => setSettingsDepthInches(parseFloat(e.target.value) || null)}
                    placeholder="e.g., 18"
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Width (cells)</label>
                  <input
                    type="number"
                    min={1}
                    value={settingsWidth}
                    onChange={(e) => setSettingsWidth(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Height (cells)</label>
                  <input
                    type="number"
                    min={1}
                    value={settingsHeight}
                    onChange={(e) => setSettingsHeight(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Cell Size (in)</label>
                  <input
                    type="number"
                    min={1}
                    value={settingsCellSize}
                    onChange={(e) => setSettingsCellSize(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Planter Model (optional)</label>
              <select
                value={settingsPlanterTypeId || ''}
                onChange={(e) => setSettingsPlanterTypeId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
              >
                <option value="">None / Custom</option>
                {planterTypes.map((pt: any) => (
                  <option key={pt.id} value={pt.id}>{pt.brand ? `${pt.brand} - ` : ''}{pt.name}</option>
                ))}
              </select>
              {settingsPlanterTypeId && (() => {
                const pt = planterTypes.find((p: any) => p.id === settingsPlanterTypeId);
                if (!pt) return null;
                return (
                  <div className="mt-2 p-3 bg-earth-50 dark:bg-gray-700/50 rounded-lg text-xs text-earth-500 dark:text-gray-400 space-y-0.5">
                    {pt.form_factor && <div>Form factor: {pt.form_factor}</div>}
                    {pt.footprint_diameter_inches > 0 && <div>Dimensions: {pt.footprint_diameter_inches}&quot; diameter, {pt.height_inches}&quot; tall</div>}
                    {pt.watering_system && <div>Watering: {pt.watering_system}</div>}
                    {pt.desert_notes && <div>Notes: {pt.desert_notes}</div>}
                  </div>
                );
              })()}
            </div>

            {settingsBedType !== 'single' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Depth (inches)</label>
                <input
                  type="number"
                  min={1}
                  value={settingsDepthInches || ''}
                  onChange={(e) => setSettingsDepthInches(e.target.value ? parseFloat(e.target.value) : null)}
                  placeholder="Optional depth..."
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                />
              </div>
            )}

            {settingsBedType !== 'single' && (
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={settingsDescription}
                  onChange={(e) => setSettingsDescription(e.target.value)}
                  placeholder="Optional description for this planter..."
                  rows={2}
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none resize-none"
                />
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleSaveBedSettings}
                disabled={savingBedSettings}
                className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {savingBedSettings ? 'Saving...' : 'Save Planter Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Planter History (collapsible) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors"
          onClick={() => {
            if (!showBedHistory && !bedHistory) {
              getBedHistory(bedId).then(setBedHistory).catch(() => {});
            }
            setShowBedHistory(!showBedHistory);
          }}
        >
          <span className="font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            {'📋'} Planter History
          </span>
          <svg className={`w-5 h-5 text-earth-400 transition-transform ${showBedHistory ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showBedHistory && bedHistory && (
          <div className="px-5 pb-5 border-t border-earth-100 dark:border-gray-700 pt-4 space-y-4">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-earth-500 dark:text-gray-400">Total yield: <strong className="text-earth-700 dark:text-gray-200">{bedHistory.total_yield_oz > 0 ? `${(bedHistory.total_yield_oz / 16).toFixed(1)} lbs` : '--'}</strong></span>
              <span className="text-earth-500 dark:text-gray-400">Total plantings: <strong className="text-earth-700 dark:text-gray-200">{bedHistory.plantings?.length || 0}</strong></span>
            </div>
            {bedHistory.best_plants?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Best performers in this planter:</p>
                <div className="flex flex-wrap gap-2">
                  {bedHistory.best_plants.map((bp: any, i: number) => (
                    <span key={i} className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-2 py-1 rounded border border-green-200 dark:border-green-800">
                      {bp.plant_name}: {(bp.total_oz / 16).toFixed(1)} lbs
                    </span>
                  ))}
                </div>
              </div>
            )}
            {bedHistory.rotation_timeline?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Crop rotation:</p>
                <div className="space-y-1">
                  {bedHistory.rotation_timeline.map((rt: any, i: number) => (
                    <div key={i} className="text-xs text-earth-600 dark:text-gray-400">
                      <span className="font-medium">{rt.season}:</span> {rt.plants.join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {showBedHistory && !bedHistory && (
          <div className="px-5 pb-5 border-t border-earth-100 dark:border-gray-700 pt-4">
            <p className="text-sm text-earth-400 dark:text-gray-500">Loading...</p>
          </div>
        )}
      </div>

      {/* Photo Lightbox */}
      {/* Move planting dialog */}
      {showMoveDialog && selectedPlanting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowMoveDialog(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-1">
              Move {selectedPlanting.plant_name}
            </h3>
            <p className="text-sm text-earth-500 dark:text-gray-400 mb-4">
              Currently at cell ({selectedPlanting.cell_x}, {selectedPlanting.cell_y})
            </p>

            {!moveMode && (
              <div className="space-y-2">
                <button
                  onClick={() => setMoveMode('planter')}
                  className="w-full text-left px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <span className="font-medium text-earth-800 dark:text-gray-100">Move to Another Planter</span>
                  <span className="block text-xs text-earth-400 dark:text-gray-500 mt-0.5">Transfer to a different bed/cell with all history intact</span>
                </button>
                <button
                  onClick={() => setMoveMode('ground')}
                  className="w-full text-left px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-600 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-300 dark:hover:border-green-700 transition-colors"
                >
                  <span className="font-medium text-earth-800 dark:text-gray-100">Move to Ground</span>
                  <span className="block text-xs text-earth-400 dark:text-gray-500 mt-0.5">Convert to a ground plant, keeping planted date</span>
                </button>
              </div>
            )}

            {moveMode === 'planter' && (
              <div className="space-y-3">
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
                  <div className="grid grid-cols-2 gap-3">
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
                    onClick={handleMovePlanting}
                    disabled={!moveTargetBed || movingPlant}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    {movingPlant ? 'Moving...' : 'Move'}
                  </button>
                  <button onClick={() => setMoveMode(null)} className="flex-1 bg-earth-100 dark:bg-gray-700 hover:bg-earth-200 dark:hover:bg-gray-600 text-earth-700 dark:text-gray-300 px-4 py-2 rounded-lg font-medium transition-colors">
                    Back
                  </button>
                </div>
              </div>
            )}

            {moveMode === 'ground' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Plant Name</label>
                  <input type="text" value={moveGroundName} onChange={(e) => setMoveGroundName(e.target.value)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">X Position (feet)</label>
                    <input type="number" step="0.5" value={moveGroundX} onChange={(e) => setMoveGroundX(e.target.value)} placeholder="Optional"
                      className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Y Position (feet)</label>
                    <input type="number" step="0.5" value={moveGroundY} onChange={(e) => setMoveGroundY(e.target.value)} placeholder="Optional"
                      className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Area (optional)</label>
                  <select value={moveGroundAreaId ?? ''} onChange={(e) => setMoveGroundAreaId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100">
                    <option value="">No area</option>
                    {bedAreas.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleMovePlanting}
                    disabled={movingPlant}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    {movingPlant ? 'Moving...' : 'Move to Ground'}
                  </button>
                  <button onClick={() => setMoveMode(null)} className="flex-1 bg-earth-100 dark:bg-gray-700 hover:bg-earth-200 dark:hover:bg-gray-600 text-earth-700 dark:text-gray-300 px-4 py-2 rounded-lg font-medium transition-colors">
                    Back
                  </button>
                </div>
              </div>
            )}

            {!moveMode && (
              <div className="flex justify-end pt-4">
                <button onClick={() => setShowMoveDialog(false)} className="text-sm text-earth-500 dark:text-gray-400 hover:text-earth-700 dark:hover:text-gray-200">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Remove planting dialog */}
      {showRemoveDialog && selectedPlanting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowRemoveDialog(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-1">
              Remove {selectedPlanting.plant_name}?
            </h3>
            <p className="text-sm text-earth-500 dark:text-gray-400 mb-4">
              Cell ({selectedPlanting.cell_x}, {selectedPlanting.cell_y})
            </p>

            {removeStep === 'choose' && (
              <div className="space-y-2">
                {/* Only show Harvested for harvestable plants */}
                {(!harvestInfoCache[selectedPlanting.plant_id] || harvestInfoCache[selectedPlanting.plant_id].is_harvestable) && (
                  <button
                    onClick={() => handleRemoveAs('harvested')}
                    className="w-full text-left px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-600 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-300 dark:hover:border-green-700 transition-colors"
                  >
                    <span className="font-medium text-earth-800 dark:text-gray-100">Harvested</span>
                    <span className="block text-xs text-earth-400 dark:text-gray-500 mt-0.5">Plant produced and was removed after harvest</span>
                  </button>
                )}
                <button
                  onClick={() => handleRemoveAs('failed')}
                  className="w-full text-left px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 transition-colors"
                >
                  <span className="font-medium text-earth-800 dark:text-gray-100">Died / Failed</span>
                  <span className="block text-xs text-earth-400 dark:text-gray-500 mt-0.5">Plant died, track as failure</span>
                </button>
                <button
                  onClick={() => handleRemoveAs('transplanted')}
                  className="w-full text-left px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <span className="font-medium text-earth-800 dark:text-gray-100">Transplanted</span>
                  <span className="block text-xs text-earth-400 dark:text-gray-500 mt-0.5">Moved to another location</span>
                </button>
                <button
                  onClick={() => handleRemoveAs('delete')}
                  className="w-full text-left px-4 py-3 rounded-lg border border-earth-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 transition-colors"
                >
                  <span className="font-medium text-earth-800 dark:text-gray-100">Delete</span>
                  <span className="block text-xs text-earth-400 dark:text-gray-500 mt-0.5">Mistake — remove all planting data completely</span>
                </button>
              </div>
            )}

            {removeStep === 'harvest-details' && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-earth-700 dark:text-gray-200">Harvest details (optional)</p>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Weight (oz)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={yieldWeight}
                      onChange={(e) => setYieldWeight(e.target.value)}
                      placeholder="e.g. 12.5"
                      className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Quantity</label>
                    <input
                      type="number"
                      value={yieldQuantity}
                      onChange={(e) => setYieldQuantity(e.target.value)}
                      placeholder="e.g. 5"
                      className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-earth-500 dark:text-gray-400 mb-1">Note</label>
                  <textarea
                    value={removeNote}
                    onChange={(e) => setRemoveNote(e.target.value)}
                    placeholder="How was the harvest?"
                    rows={2}
                    className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setRemoveStep('choose')}
                    className="flex-1 px-4 py-2 rounded-lg border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 text-sm hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => handleRemoveAs('harvested')}
                    className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    Mark Harvested
                  </button>
                </div>
              </div>
            )}

            {removeStep === 'died-details' && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-earth-700 dark:text-gray-200">What happened?</p>
                <select
                  value={diedReason}
                  onChange={(e) => setDiedReason(e.target.value)}
                  className="w-full px-3 py-2.5 min-h-[44px] border border-earth-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none"
                >
                  <option value="">Select a reason (optional)</option>
                  <option value="Frost">Frost</option>
                  <option value="Disease">Disease</option>
                  <option value="Pest">Pest</option>
                  <option value="Heat">Heat</option>
                  <option value="Overwatering">Overwatering</option>
                  <option value="Underwatering">Underwatering</option>
                  <option value="Unknown">Unknown</option>
                </select>
                <textarea
                  value={removeNote}
                  onChange={(e) => setRemoveNote(e.target.value)}
                  placeholder="Additional notes (optional)"
                  rows={2}
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setRemoveStep('choose')}
                    className="flex-1 px-4 py-2.5 min-h-[44px] rounded-lg border border-earth-300 dark:border-gray-600 text-earth-600 dark:text-gray-300 text-sm hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => handleRemoveAs('failed')}
                    className="flex-1 px-4 py-2.5 min-h-[44px] rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                  >
                    Mark as Died
                  </button>
                </div>
              </div>
            )}

            {removeStep === 'choose' && (
              <button
                onClick={() => setShowRemoveDialog(false)}
                className="w-full mt-3 px-4 py-2 text-sm text-earth-500 dark:text-gray-400 hover:text-earth-700 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {lightboxPhoto && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="relative max-w-2xl w-full bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-3 right-3 z-10 bg-black/50 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              &times;
            </button>
            <img
              src={getPhotoUrl(lightboxPhoto.id)}
              alt={lightboxPhoto.caption || 'Photo'}
              className="w-full max-h-[70vh] object-contain bg-earth-100"
            />
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  {lightboxPhoto.caption && (
                    <p className="text-sm text-earth-600 mb-1">{lightboxPhoto.caption}</p>
                  )}
                  <p className="text-xs text-earth-400">
                    {formatGardenDate(lightboxPhoto.taken_at || lightboxPhoto.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => analyses[lightboxPhoto.id] ? setExpandedAnalysis(expandedAnalysis === lightboxPhoto.id ? null : lightboxPhoto.id) : handleAnalyzePhoto(lightboxPhoto.id)}
                    disabled={analyzingIds.has(lightboxPhoto.id)}
                    className="text-xs text-garden-600 hover:text-garden-800 px-2 py-1 rounded border border-garden-200 hover:border-garden-400 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {analyzingIds.has(lightboxPhoto.id) ? (
                      <>
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Analyzing...
                      </>
                    ) : analyses[lightboxPhoto.id] ? 'View Analysis' : 'Analyze'}
                  </button>
                  <button
                    onClick={() => handleDeletePhoto(lightboxPhoto.id)}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded border border-red-200 hover:border-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {/* Lightbox analysis display */}
              {analyses[lightboxPhoto.id] && (
                <div className="mt-3 pt-3 border-t border-earth-200 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${
                      analyses[lightboxPhoto.id].health === 'healthy' ? 'bg-green-100 text-green-700 border-green-300' :
                      analyses[lightboxPhoto.id].health === 'stressed' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                      analyses[lightboxPhoto.id].health === 'diseased' ? 'bg-red-100 text-red-700 border-red-300' :
                      'bg-red-200 text-red-800 border-red-400'
                    }`}>
                      {analyses[lightboxPhoto.id].health}
                    </span>
                    <span className="text-xs text-earth-400">
                      {analyses[lightboxPhoto.id].plant_identified} &middot; {analyses[lightboxPhoto.id].growth_stage} &middot; {analyses[lightboxPhoto.id].confidence} confidence
                    </span>
                  </div>
                  <p className="text-sm text-earth-600 dark:text-gray-400 mb-2">{analyses[lightboxPhoto.id].summary}</p>
                  {analyses[lightboxPhoto.id].issues?.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {analyses[lightboxPhoto.id].issues.map((issue: any, i: number) => (
                        <p key={i} className="text-xs text-earth-500">
                          <span className={issue.severity === 'high' ? 'text-red-600 font-medium' : issue.severity === 'medium' ? 'text-orange-600 font-medium' : 'text-yellow-600 font-medium'}>
                            [{issue.severity.toUpperCase()}]
                          </span>{' '}
                          <span className="font-medium">{issue.name}</span> ({issue.type}) &mdash; {issue.description}
                        </p>
                      ))}
                    </div>
                  )}
                  {analyses[lightboxPhoto.id].recommendations?.length > 0 && (
                    <ul className="list-disc list-inside text-xs text-earth-500 space-y-0.5">
                      {analyses[lightboxPhoto.id].recommendations.map((rec: string, i: number) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowTemplateModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-earth-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">Garden Templates</h2>
              <button onClick={() => setShowTemplateModal(false)} className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-xl font-bold">&times;</button>
            </div>
            <div className="p-4 space-y-3">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => handleApplyTemplate(tmpl.id)}
                  disabled={applyingTemplate}
                  className="w-full text-left p-3 rounded-lg border border-earth-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{tmpl.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-earth-800 dark:text-gray-100">{tmpl.name}</div>
                      <div className="text-sm text-earth-500 dark:text-gray-400">{tmpl.description}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tmpl.plants.map((p) => (
                          <span key={p} className="text-xs px-1.5 py-0.5 bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 rounded">{p}</span>
                        ))}
                      </div>
                      <div className="text-xs text-earth-400 dark:text-gray-500 mt-1">Min {tmpl.min_cells} cells</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
