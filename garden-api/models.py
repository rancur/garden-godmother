"""All Pydantic request/response models — extracted from main.py."""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


# ──── Auth Models ────

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str
    invite_code: str
    email: str = ""

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class ProfileUpdate(BaseModel):
    display_name: str = None
    email: str = None

class AdminUserUpdate(BaseModel):
    role: str = None
    is_active: bool = None
    display_name: str = None


# ──── Integration Models ────

class IntegrationUpdate(BaseModel):
    config: dict
    enabled: bool = True


# ──── Area Models ────

class AreaCreate(BaseModel):
    name: str
    area_type: str = "all"
    color: Optional[str] = None
    notes: Optional[str] = None
    default_irrigation_type: Optional[str] = None
    default_irrigation_zone_name: Optional[str] = None
    zone_id: Optional[int] = None

class AreaUpdate(BaseModel):
    name: Optional[str] = None
    area_type: Optional[str] = None
    color: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None
    map_x_feet: Optional[float] = None
    map_y_feet: Optional[float] = None
    map_width_feet: Optional[float] = None
    map_height_feet: Optional[float] = None
    map_polygon_points: Optional[str] = None
    default_irrigation_type: Optional[str] = None
    default_irrigation_zone_name: Optional[str] = None
    zone_id: Optional[int] = None


# ──── Bed Models ────

class BedCreate(BaseModel):
    name: str
    width_cells: int = 4
    height_cells: int = 4
    cell_size_inches: int = 12
    bed_type: str = "grid"
    description: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    planter_type_id: Optional[int] = None
    depth_inches: Optional[float] = None
    physical_width_inches: Optional[float] = None
    physical_length_inches: Optional[float] = None
    soil_type: Optional[str] = None
    soil_mix: Optional[str] = None
    soil_product_id: Optional[int] = None

class BedUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    irrigation_type: Optional[str] = None
    irrigation_zone_name: Optional[str] = None
    irrigation_schedule: Optional[str] = None
    area_id: Optional[int] = None
    sort_order: Optional[int] = None
    bed_type: Optional[str] = None
    width_cells: Optional[int] = None
    height_cells: Optional[int] = None
    cell_size_inches: Optional[int] = None
    planter_type_id: Optional[int] = None
    description: Optional[str] = None
    depth_inches: Optional[float] = None
    physical_width_inches: Optional[float] = None
    physical_length_inches: Optional[float] = None
    soil_type: Optional[str] = None
    soil_mix: Optional[str] = None
    soil_product_id: Optional[int] = None

class ReorderItem(BaseModel):
    id: int
    sort_order: int
    area_id: Optional[int] = None

class ReorderRequest(BaseModel):
    orders: list[ReorderItem]


# ──── Planting Models ────

class PlantingCreate(BaseModel):
    bed_id: Optional[int] = None
    plant_id: int
    variety_id: Optional[int] = None
    cell_x: Optional[int] = None
    cell_y: Optional[int] = None
    planted_date: Optional[str] = None
    season: Optional[str] = None
    year: Optional[int] = None
    notes: Optional[str] = None

class PlantingUpdate(BaseModel):
    status: Optional[str] = None
    actual_harvest_date: Optional[str] = None
    notes: Optional[str] = None

class PlantingMove(BaseModel):
    target_bed_id: int
    target_cell_x: int
    target_cell_y: int

class PlantingMoveToGround(BaseModel):
    name: Optional[str] = None
    x_feet: Optional[float] = None
    y_feet: Optional[float] = None
    area_id: Optional[int] = None

class GroundPlantMoveToPlanter(BaseModel):
    bed_id: int
    cell_x: int
    cell_y: int

class TrayCellMoveToPlanter(BaseModel):
    bed_id: int
    cell_x: int
    cell_y: int


# ──── Tray Models ────

class TrayCreate(BaseModel):
    name: str
    rows: int
    cols: int
    cell_size: str = "standard"
    location: Optional[str] = None
    notes: Optional[str] = None

class TrayCellSeed(BaseModel):
    row: int
    col: int
    plant_id: int
    seed_date: Optional[str] = None

class TrayCellUpdate(BaseModel):
    status: Optional[str] = None
    germination_date: Optional[str] = None
    notes: Optional[str] = None

class TrayCellTransplant(BaseModel):
    bed_id: Optional[int] = None
    cell_x: Optional[int] = None
    cell_y: Optional[int] = None

class TrayUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    irrigation_type: Optional[str] = None
    irrigation_zone_name: Optional[str] = None
    area_id: Optional[int] = None
    sort_order: Optional[int] = None

class TrayDuplicate(BaseModel):
    name: Optional[str] = None
    copy_cells: bool = True


# ──── Seed Models ────

class SeedCreate(BaseModel):
    plant_id: int
    variety: Optional[str] = None
    brand: Optional[str] = None
    quantity_seeds: Optional[int] = None
    purchase_date: Optional[str] = None
    expiration_date: Optional[str] = None
    notes: Optional[str] = None

class SeedUpdate(BaseModel):
    variety: Optional[str] = None
    brand: Optional[str] = None
    quantity_seeds: Optional[int] = None
    purchase_date: Optional[str] = None
    expiration_date: Optional[str] = None
    notes: Optional[str] = None


# ──── Harvest / Expense Models ────

class HarvestCreate(BaseModel):
    planting_id: int
    harvest_date: str
    weight_oz: Optional[float] = None
    quantity: Optional[int] = None
    quality: Optional[str] = None
    notes: Optional[str] = None
    create_journal_entry: Optional[bool] = None

class ExpenseCreate(BaseModel):
    category: str
    description: str
    amount_cents: int
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


# ──── Planting Note Models ────

class PlantingNoteCreate(BaseModel):
    note_type: str
    content: str
    severity: Optional[str] = "info"


# ──── Season Summary ────

class SeasonSummaryCreate(BaseModel):
    year: int
    season: str
    total_plantings: Optional[int] = None
    total_harvested: Optional[int] = None
    total_failed: Optional[int] = None
    total_harvest_weight_oz: Optional[float] = None
    top_performers: Optional[str] = None
    worst_performers: Optional[str] = None
    lessons_learned: Optional[str] = None
    weather_summary: Optional[str] = None
    notes: Optional[str] = None


# ──── Property / Zone Models ────

class PropertyUpdate(BaseModel):
    name: Optional[str] = None
    width_feet: Optional[int] = None
    height_feet: Optional[int] = None
    orientation_degrees: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    default_soil_type: Optional[str] = None
    default_soil_ph: Optional[float] = None
    default_soil_notes: Optional[str] = None
    last_frost_spring: Optional[str] = None
    first_frost_fall: Optional[str] = None
    frost_free_days: Optional[int] = None
    timezone: Optional[str] = None

class ZoneCreate(BaseModel):
    name: str
    zone_type: str
    x_feet: int = 0
    y_feet: int = 0
    width_feet: int = 1
    height_feet: int = 1
    color: Optional[str] = None
    notes: Optional[str] = None
    rotation_degrees: int = 0
    polygon_points: Optional[str] = None
    is_cutout: int = 0
    parent_zone_id: Optional[int] = None
    soil_type: Optional[str] = None
    soil_ph_min: Optional[float] = None
    soil_ph_max: Optional[float] = None
    soil_amendments: Optional[str] = None
    soil_notes: Optional[str] = None
    height_ft: Optional[float] = None

class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    zone_type: Optional[str] = None
    x_feet: Optional[int] = None
    y_feet: Optional[int] = None
    width_feet: Optional[int] = None
    height_feet: Optional[int] = None
    color: Optional[str] = None
    notes: Optional[str] = None
    rotation_degrees: Optional[int] = None
    polygon_points: Optional[str] = None
    is_cutout: Optional[int] = None
    parent_zone_id: Optional[int] = None
    soil_type: Optional[str] = None
    soil_ph_min: Optional[float] = None
    soil_ph_max: Optional[float] = None
    soil_amendments: Optional[str] = None
    soil_notes: Optional[str] = None
    height_ft: Optional[float] = None

class BedPositionUpdate(BaseModel):
    zone_id: Optional[int] = None
    x_feet: int = 0
    y_feet: int = 0
    rotation_degrees: int = 0


# ──── Task Models ────

class TaskCreate(BaseModel):
    task_type: str
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    due_date: Optional[str] = None
    plant_id: Optional[int] = None
    planting_id: Optional[int] = None
    bed_id: Optional[int] = None
    tray_id: Optional[int] = None
    notes: Optional[str] = None

class TaskUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None


# ──── Lifecycle Models ────

class LifecyclePlanRequest(BaseModel):
    plant_id: int
    method: str  # "seed" | "direct_sow" | "transplant"
    target_bed_id: Optional[int] = None
    target_cell_x: Optional[int] = None
    target_cell_y: Optional[int] = None
    tray_id: Optional[int] = None
    tray_row: Optional[int] = None
    tray_col: Optional[int] = None
    start_date: Optional[str] = None


# ──── Bed Section Models ────

class BedSectionCreate(BaseModel):
    name: str
    start_cell: int
    end_cell: int
    irrigation_zone_name: Optional[str] = None
    notes: Optional[str] = None

class BedSectionUpdate(BaseModel):
    name: Optional[str] = None
    start_cell: Optional[int] = None
    end_cell: Optional[int] = None
    irrigation_zone_name: Optional[str] = None
    notes: Optional[str] = None


# ──── Ground Plant Models ────

class GroundPlantCreate(BaseModel):
    plant_id: int
    name: Optional[str] = None
    variety_id: Optional[int] = None
    x_feet: Optional[float] = None
    y_feet: Optional[float] = None
    zone_id: Optional[int] = None
    planted_date: Optional[str] = None
    status: str = "growing"
    irrigation_type: str = "manual"
    irrigation_zone_name: Optional[str] = None
    notes: Optional[str] = None
    area_id: Optional[int] = None

class GroundPlantUpdate(BaseModel):
    name: Optional[str] = None
    plant_id: Optional[int] = None
    variety_id: Optional[int] = None
    x_feet: Optional[float] = None
    y_feet: Optional[float] = None
    zone_id: Optional[int] = None
    planted_date: Optional[str] = None
    status: Optional[str] = None
    irrigation_type: Optional[str] = None
    irrigation_zone_name: Optional[str] = None
    notes: Optional[str] = None
    area_id: Optional[int] = None

class GroundPlantReorderItem(BaseModel):
    id: int
    sort_order: int
    area_id: Optional[int] = None

class GroundPlantReorder(BaseModel):
    orders: list[GroundPlantReorderItem]


# ──── Journal Models ────

class JournalEntryCreate(BaseModel):
    entry_type: str = "note"
    title: Optional[str] = None
    content: str = ""
    plant_id: Optional[int] = None
    planting_id: Optional[int] = None
    bed_id: Optional[int] = None
    tray_id: Optional[int] = None
    tray_cell_id: Optional[int] = None
    ground_plant_id: Optional[int] = None
    photo_id: Optional[int] = None
    mood: Optional[str] = None
    tags: Optional[list[str]] = None
    severity: Optional[str] = None  # for problem type: low, medium, high, critical
    milestone_type: Optional[str] = None  # sprouted, flowering, fruiting, first_harvest, established

class JournalEntryUpdate(BaseModel):
    entry_type: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    plant_id: Optional[int] = None
    planting_id: Optional[int] = None
    bed_id: Optional[int] = None
    tray_id: Optional[int] = None
    tray_cell_id: Optional[int] = None
    ground_plant_id: Optional[int] = None
    photo_id: Optional[int] = None
    mood: Optional[str] = None
    tags: Optional[list[str]] = None
    severity: Optional[str] = None
    milestone_type: Optional[str] = None


# ──── Amendment Models ────

class AmendmentCreate(BaseModel):
    bed_id: Optional[int] = None
    ground_plant_id: Optional[int] = None
    tray_id: Optional[int] = None
    amendment_type: str
    product_name: Optional[str] = None
    amount: Optional[str] = None
    applied_date: str
    next_due_date: Optional[str] = None
    notes: Optional[str] = None


# ──── Settings Models ────

class FrostDateUpdate(BaseModel):
    last_frost: str
    first_frost: str

class UsdaZoneUpdate(BaseModel):
    zone: str


# ──── Notification Models ────

class NotificationChannelUpdate(BaseModel):
    enabled: bool = True
    config: dict = {}

class NotificationPreferenceUpdate(BaseModel):
    preferences: list

class WebPushSubscription(BaseModel):
    subscription: dict


# ──── Update System Models ────

class AutoUpdateSettings(BaseModel):
    enabled: bool
    schedule: str = "daily"
    time: str = "03:00"
