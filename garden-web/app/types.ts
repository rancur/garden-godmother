// Shared type definitions used across multiple pages

/** Minimal plant reference (used on many pages for dropdowns, lookups) */
export interface Plant {
  id: number;
  name: string;
  category: string;
}

/** Extended plant with growing details (used in planters/[id], lifecycle) */
export interface PlantDetail extends Plant {
  subcategory?: string;
  days_to_maturity_min: number | null;
  days_to_maturity_max: number | null;
  sun?: string;
  water?: string;
  spacing_inches?: number;
  sow_indoor_weeks_before_transplant?: number | null;
  desert_sow_outdoor?: string[] | null;
  desert_transplant?: string[] | null;
}

/** Minimal bed reference (used in tasks, dashboard) */
export interface Bed {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  active_plantings: number;
}

/** Area (garden zone grouping) */
export interface Area {
  id: number;
  name: string;
  area_type: string;
  sort_order: number;
  color: string | null;
  notes: string | null;
  default_irrigation_type?: string | null;
  default_irrigation_zone_name?: string | null;
  zone_id?: number | null;
  zone_name?: string | null;
  zone_type?: string | null;
}

/** Minimal tray reference */
export interface Tray {
  id: number;
  name: string;
  rows: number;
  cols: number;
  cell_size?: string;
  location?: string | null;
  notes?: string | null;
  created_at?: string;
}

/** Zone (irrigation / physical zone) */
export interface Zone {
  id: number;
  name: string;
  zone_type?: string;
}

/** Ground plant entry */
export interface GroundPlant {
  id: number;
  name: string | null;
  plant_id: number;
  plant_name: string;
  plant_category: string;
  variety_id: number | null;
  x_feet: number | null;
  y_feet: number | null;
  zone_id: number | null;
  zone_name: string | null;
  planted_date: string | null;
  status: string;
  irrigation_type: string;
  irrigation_zone_name: string | null;
  notes: string | null;
  created_at: string;
  area_id: number | null;
  area_name: string | null;
  area_color: string | null;
  sort_order: number;
  effective_irrigation_type: string | null;
  effective_irrigation_zone_name: string | null;
  area_default_irrigation_zone_name: string | null;
  irrigation_inherited: boolean;
  area_auto_assigned?: boolean;
}

/** Planting in a bed grid cell */
export interface Planting {
  id: number;
  planting_id?: number;
  plant_id: number;
  plant_name: string;
  category: string;
  status: string;
  planted_date: string;
  cell_x: number;
  cell_y: number;
  photo_count?: number;
  variety_id?: number | null;
  variety_name?: string | null;
  variety_desert_rating?: number | null;
  cell_role?: string;
  companion_of?: number | null;
  companions?: Planting[];
}

/** Journal feed entry */
export interface JournalEntry {
  id: number | string;
  entry_type: string;
  title: string | null;
  content: string;
  plant_id: number | null;
  plant_name: string | null;
  planting_id: number | null;
  bed_id: number | null;
  bed_name: string | null;
  tray_id: number | null;
  tray_name: string | null;
  ground_plant_id: number | null;
  ground_plant_name: string | null;
}

/** Normalize planting_id into id for grid cells. Call once after loading grid data. */
export function normalizePlantingGrid(grid: (Planting | null)[][]): (Planting | null)[][] {
  return grid.map(row =>
    row.map(cell => {
      if (!cell) return null;
      const normalized: Planting = { ...cell, id: cell.planting_id ?? cell.id };
      if (cell.companions && cell.companions.length > 0) {
        normalized.companions = cell.companions.map(c => ({
          ...c,
          id: c.planting_id ?? c.id,
        }));
      }
      return normalized;
    })
  );
}
