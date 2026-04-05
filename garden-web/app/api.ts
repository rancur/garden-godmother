// Configure for your domain — set NEXT_PUBLIC_API_URL in .env.local or docker-compose.yml
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3402';

/**
 * Convert cell coordinates to human-readable position labels (e.g. "front-left", "back-right").
 * Works for any grid size.
 */
export function getCellPositionLabel(cellX: number, cellY: number, gridWidth: number, gridHeight: number): string {
  // Row position (front/back or top/middle/bottom)
  let rowLabel: string;
  if (gridHeight <= 1) rowLabel = '';
  else if (gridHeight === 2) rowLabel = cellY === 0 ? 'front' : 'back';
  else {
    const rowThird = gridHeight / 3;
    if (cellY < rowThird) rowLabel = 'front';
    else if (cellY < rowThird * 2) rowLabel = 'middle';
    else rowLabel = 'back';
  }

  // Column position (left/center/right)
  let colLabel: string;
  if (gridWidth <= 1) colLabel = '';
  else if (gridWidth === 2) colLabel = cellX === 0 ? 'left' : 'right';
  else {
    const colThird = gridWidth / 3;
    if (cellX < colThird) colLabel = 'left';
    else if (cellX < colThird * 2) colLabel = 'center';
    else colLabel = 'right';
  }

  if (rowLabel && colLabel) return `${rowLabel}-${colLabel}`;
  return rowLabel || colLabel || '';
}

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Plants
export function getPlants(params?: {
  category?: string;
  season?: string;
  sun?: string;
  water?: string;
  heat_tolerance?: string;
  spacing_max?: number;
  spacing_min?: number;
  search?: string;
  sort?: string;
  companion_of?: string;
  plantable_now?: boolean;
  growth_habit?: string;
  needs_trellis?: boolean;
  needs_cage?: boolean;
  needs_staking?: boolean;
  no_support?: boolean;
  edible?: boolean;
  pollinator?: boolean;
  drought_tolerant?: boolean;
  deer_resistant?: boolean;
  nitrogen_fixer?: boolean;
  maturity_max?: number;
  maturity_min?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.category) qs.set('category', params.category);
  if (params?.season) qs.set('season', params.season);
  if (params?.sun) qs.set('sun', params.sun);
  if (params?.water) qs.set('water', params.water);
  if (params?.heat_tolerance) qs.set('heat_tolerance', params.heat_tolerance);
  if (params?.spacing_max) qs.set('spacing_max', String(params.spacing_max));
  if (params?.spacing_min) qs.set('spacing_min', String(params.spacing_min));
  if (params?.search) qs.set('search', params.search);
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.companion_of) qs.set('companion_of', params.companion_of);
  if (params?.plantable_now) qs.set('plantable_now', 'true');
  if (params?.growth_habit) qs.set('growth_habit', params.growth_habit);
  if (params?.needs_trellis) qs.set('needs_trellis', 'true');
  if (params?.needs_cage) qs.set('needs_cage', 'true');
  if (params?.needs_staking) qs.set('needs_staking', 'true');
  if (params?.no_support) qs.set('no_support', 'true');
  if (params?.edible) qs.set('edible', 'true');
  if (params?.pollinator) qs.set('pollinator', 'true');
  if (params?.drought_tolerant) qs.set('drought_tolerant', 'true');
  if (params?.deer_resistant) qs.set('deer_resistant', 'true');
  if (params?.nitrogen_fixer) qs.set('nitrogen_fixer', 'true');
  if (params?.maturity_max) qs.set('maturity_max', String(params.maturity_max));
  if (params?.maturity_min) qs.set('maturity_min', String(params.maturity_min));
  const query = qs.toString();
  return apiFetch(`/api/plants${query ? `?${query}` : ''}`);
}

export function getPlantStats() {
  return apiFetch('/api/plants/stats');
}

export function getPlant(id: number) {
  return apiFetch(`/api/plants/${id}`);
}

// Companions
export function checkCompanion(plant1: string | number, plant2: string | number) {
  return apiFetch(`/api/companions/check?plant1=${encodeURIComponent(plant1)}&plant2=${encodeURIComponent(plant2)}`);
}

// Calendar
export function getCalendarNow() {
  return apiFetch('/api/calendar/now');
}

export function getPlantCalendar(id: number) {
  return apiFetch(`/api/calendar/plant/${id}`);
}

export function getCalendarMonth(month: number) {
  return apiFetch(`/api/calendar/month/${month}`);
}

export function getPersonalCalendar(months: number = 3) {
  return apiFetch(`/api/calendar/personal?months=${months}`);
}

// Beds
export function getBeds() {
  return apiFetch('/api/beds');
}

export function createBed(data: { name: string; width_cells?: number; height_cells?: number; cell_size_inches?: number; bed_type?: string; description?: string; planter_type_id?: number | null; depth_inches?: number | null; physical_width_inches?: number | null; physical_length_inches?: number | null }) {
  return apiFetch('/api/beds', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getBedGrid(id: number) {
  return apiFetch(`/api/beds/${id}/grid`);
}

export function updateBed(id: number, data: { name?: string; location?: string; notes?: string; irrigation_type?: string; irrigation_zone_name?: string; irrigation_schedule?: string; area_id?: number; sort_order?: number; bed_type?: string; width_cells?: number; height_cells?: number; cell_size_inches?: number; planter_type_id?: number | null; description?: string; depth_inches?: number | null; physical_width_inches?: number | null; physical_length_inches?: number | null; soil_type?: string; soil_mix?: string; soil_product_id?: number | null }) {
  return apiFetch(`/api/beds/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function resizeBed(bedId: number, data: { width_cells?: number; height_cells?: number; force?: boolean }) {
  return apiFetch(`/api/beds/${bedId}/resize`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteBed(id: number) {
  return apiFetch(`/api/beds/${id}`, { method: 'DELETE' });
}

// Plantings
export function createPlanting(data: { bed_id: number; plant_id: number; cell_x?: number; cell_y?: number; planted_date: string; variety_id?: number; cell_role?: string; companion_of?: number; source?: string; plant_age_weeks?: number; position_x_inches?: number; position_y_inches?: number }) {
  return apiFetch('/api/plantings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updatePlantingPosition(plantingId: number, position_x_inches: number, position_y_inches: number) {
  return apiFetch(`/api/plantings/${plantingId}/position`, {
    method: 'PATCH',
    body: JSON.stringify({ position_x_inches, position_y_inches }),
  });
}

// Companion planting
export function getCompanionSuggestions(bedId: number, x: number, y: number) {
  return apiFetch(`/api/beds/${bedId}/cell/${x}/${y}/companion-suggestions`);
}

export function addCompanion(bedId: number, data: { plant_id: number; cell_x: number; cell_y: number; companion_of: number; planted_date: string; variety_id?: number }) {
  return apiFetch('/api/plantings', {
    method: 'POST',
    body: JSON.stringify({ ...data, bed_id: bedId, cell_role: 'companion' }),
  });
}

export function updatePlanting(id: number, data: { status?: string; notes?: string; yield_weight_oz?: number; yield_quantity?: number }) {
  return apiFetch(`/api/plantings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deletePlanting(id: number) {
  return apiFetch(`/api/plantings/${id}`, { method: 'DELETE' });
}

// Move operations
export function movePlanting(plantingId: number, data: { target_bed_id: number; target_cell_x: number; target_cell_y: number }) {
  return apiFetch(`/api/plantings/${plantingId}/move`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function movePlantingToGround(plantingId: number, data: { name?: string; x_feet?: number; y_feet?: number; area_id?: number }) {
  return apiFetch(`/api/plantings/${plantingId}/move-to-ground`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function moveGroundPlantToPlanter(gpId: number, data: { bed_id: number; cell_x: number; cell_y: number }) {
  return apiFetch(`/api/ground-plants/${gpId}/move-to-planter`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function moveTrayCellToPlanter(trayId: number, cellId: number, data: { bed_id: number; cell_x: number; cell_y: number }) {
  return apiFetch(`/api/trays/${trayId}/cells/${cellId}/move-to-planter`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Recommendations
export function getRecommendations() {
  return apiFetch('/api/recommendations');
}

// Seed Trays
export function getTrays() {
  return apiFetch('/api/trays');
}

export function createTray(data: { name: string; rows: number; cols: number; cell_size?: string; location?: string; watering_type?: string; reservoir_capacity_ml?: number }) {
  return apiFetch('/api/trays', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getTray(id: number) {
  return apiFetch(`/api/trays/${id}`);
}

export function getTrayGrid(id: number) {
  return apiFetch(`/api/trays/${id}/grid`);
}

export function seedTrayCell(trayId: number, data: { row: number; col: number; plant_id: number; seed_date?: string }) {
  return apiFetch(`/api/trays/${trayId}/cells`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTray(id: number, data: { name?: string; location?: string; notes?: string; irrigation_type?: string; irrigation_zone_name?: string; area_id?: number; sort_order?: number; watering_type?: string; reservoir_capacity_ml?: number }) {
  return apiFetch(`/api/trays/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function refillTrayReservoir(trayId: number) {
  return apiFetch(`/api/trays/${trayId}/reservoir-refill`, { method: 'PATCH' });
}

export function deleteTray(id: number) {
  return apiFetch(`/api/trays/${id}`, { method: 'DELETE' });
}

export function updateTrayCell(trayId: number, cellId: number, data: { status?: string; germination_date?: string; notes?: string }) {
  return apiFetch(`/api/trays/${trayId}/cells/${cellId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function clearTrayCell(trayId: number, cellId: number) {
  return apiFetch(`/api/trays/${trayId}/cells/${cellId}`, { method: 'DELETE' });
}

export function transplantTrayCell(trayId: number, cellId: number, data: { bed_id?: number; cell_x?: number; cell_y?: number }) {
  return apiFetch(`/api/trays/${trayId}/cells/${cellId}/transplant`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function duplicateTray(trayId: number, data: { name?: string; copy_cells?: boolean }) {
  return apiFetch(`/api/trays/${trayId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Seed Inventory
export function getSeeds() {
  return apiFetch('/api/seeds');
}

export function createSeed(data: { plant_id: number; variety?: string; brand?: string; quantity_seeds?: number; purchase_date?: string; expiration_date?: string; notes?: string }) {
  return apiFetch('/api/seeds', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateSeed(id: number, data: { variety?: string; brand?: string; quantity_seeds?: number; purchase_date?: string; expiration_date?: string; notes?: string }) {
  return apiFetch(`/api/seeds/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteSeed(id: number) {
  return apiFetch(`/api/seeds/${id}`, {
    method: 'DELETE',
  });
}

export function toggleSeedSwapAvailable(id: number) {
  return apiFetch(`/api/seeds/${id}/swap`, { method: 'PATCH' });
}

// Seed Wishlist
export function getSeedWishlist() {
  return apiFetch('/api/seeds/wishlist');
}

export function addSeedWishlistItem(data: { plant_name: string; variety?: string; notes?: string }) {
  return apiFetch('/api/seeds/wishlist', { method: 'POST', body: JSON.stringify(data) });
}

export function deleteSeedWishlistItem(itemId: number) {
  return apiFetch(`/api/seeds/wishlist/${itemId}`, { method: 'DELETE' });
}

// Planting Photos
export function getPlantingPhotos(plantingId: number) {
  return apiFetch(`/api/plantings/${plantingId}/photos`);
}

export async function uploadPlantingPhoto(plantingId: number, file: File, caption?: string) {
  const formData = new FormData();
  formData.append('file', file);
  if (caption) formData.append('caption', caption);

  const res = await fetch(`${API_URL}/api/plantings/${plantingId}/photos`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function deletePhoto(photoId: number) {
  return apiFetch(`/api/photos/${photoId}`, { method: 'DELETE' });
}

export function getPhotoUrl(photoId: number): string {
  return `${API_URL}/api/photos/${photoId}`;
}

export function getRecentPhotos(limit = 50) {
  return apiFetch(`/api/photos/recent?limit=${limit}`);
}

// Photo AI Analysis
export function analyzePhoto(photoId: number) {
  return apiFetch(`/api/photos/${photoId}/analyze`, { method: 'POST' });
}

export function getPhotoAnalysis(photoId: number) {
  return apiFetch(`/api/photos/${photoId}/analysis`);
}

// Plant Health Monitoring
export function runHealthCheck() {
  return apiFetch('/api/photos/health-check', { method: 'POST' });
}

export function getHealthSummary() {
  return apiFetch('/api/photos/health-summary');
}

// Crop Rotation
export function getRotationHistory(bedId: number) {
  return apiFetch(`/api/rotation/bed/${bedId}`);
}

export function checkRotation(bedId: number, plantId: number) {
  return apiFetch(`/api/rotation/check?bed_id=${bedId}&plant_id=${plantId}`);
}

// Sensors (Home Assistant)
export function getSensorWeather() {
  return apiFetch('/api/sensors/weather');
}

export function getSensorForecast() {
  return apiFetch('/api/sensors/forecast');
}

export function getTempestLocal() {
  return apiFetch('/api/sensors/tempest-local');
}

export function getSensorRachio() {
  return apiFetch('/api/sensors/rachio');
}

export function getSensorMoisture() {
  return apiFetch('/api/sensors/moisture');
}

export function getSensorAvailable() {
  return apiFetch('/api/sensors/available');
}

export function getSensorSummary() {
  return apiFetch('/api/sensors/summary');
}

// Sensor History
export function getSensorHistory(params?: { sensor_type?: string; sensor_name?: string; hours?: number }) {
  const qs = new URLSearchParams();
  if (params?.sensor_type) qs.set('sensor_type', params.sensor_type);
  if (params?.sensor_name) qs.set('sensor_name', params.sensor_name);
  if (params?.hours) qs.set('hours', String(params.hours));
  const query = qs.toString();
  return apiFetch(`/api/sensors/history${query ? `?${query}` : ''}`);
}

export function getSensorHistoryDaily(sensor_name: string, days = 30) {
  return apiFetch(`/api/sensors/history/daily?sensor_name=${encodeURIComponent(sensor_name)}&days=${days}`);
}

export function getSensorHistoryChart(sensor_name: string, hours = 48) {
  return apiFetch(`/api/sensors/history/chart?sensor_name=${encodeURIComponent(sensor_name)}&hours=${hours}`);
}

export function getIrrigationHistory(days = 30) {
  return apiFetch(`/api/irrigation/history?days=${days}`);
}

export function getIrrigationSchedules() {
  return apiFetch('/api/irrigation/schedules');
}

export function getZoneSchedule(zoneName: string) {
  return apiFetch(`/api/irrigation/zone/${encodeURIComponent(zoneName)}/schedule`);
}

export function getIrrigationScheduleHistory(days = 7) {
  return apiFetch(`/api/irrigation/schedules/history?days=${days}`);
}

export function getBedIrrigationSchedule(bedId: number) {
  return apiFetch(`/api/irrigation/bed/${bedId}/schedule`);
}

export function getIrrigationUsage(days = 30) {
  return apiFetch(`/api/irrigation/usage?days=${days}`);
}

export function getIrrigationZoneTotals() {
  return apiFetch('/api/irrigation/zone-totals');
}

export function getWateringAdequacy() {
  return apiFetch('/api/irrigation/adequacy');
}

export function getSensorHistorySummary() {
  return apiFetch('/api/sensors/history/summary');
}

// Shopping List
export function getShoppingList() {
  return apiFetch('/api/shopping-list');
}

export function getSeasonShoppingList(season: string) {
  return apiFetch(`/api/shopping-list/season/${season}`);
}

// Harvests
export function getHarvests(plantingId?: number) {
  const qs = plantingId ? `?planting_id=${plantingId}` : '';
  return apiFetch(`/api/harvests${qs}`);
}

export function createHarvest(data: { planting_id?: number; instance_id?: number; harvest_date: string; weight_oz?: number; quantity?: number; quality?: string; notes?: string; create_journal_entry?: boolean; final_harvest?: boolean }) {
  return apiFetch('/api/harvests', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getUpcomingHarvests() {
  return apiFetch('/api/harvests/upcoming');
}

export function getHarvestSummary() {
  return apiFetch('/api/harvests/summary');
}

export function deleteHarvest(id: number) {
  return apiFetch(`/api/harvests/${id}`, { method: 'DELETE' });
}

// Expenses
export function getExpenses(category?: string) {
  const qs = category ? `?category=${category}` : '';
  return apiFetch(`/api/expenses${qs}`);
}

export function createExpense(data: { category: string; description: string; amount_cents: number; purchase_date?: string; notes?: string }) {
  return apiFetch('/api/expenses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getExpenseSummary() {
  return apiFetch('/api/expenses/summary');
}

export function updateExpense(id: number, data: { category?: string; description?: string; amount_cents?: number; purchase_date?: string; notes?: string }) {
  return apiFetch(`/api/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteExpense(id: number) {
  return apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
}

// Economics
export function getEconomics() {
  return apiFetch('/api/economics');
}

// Plantings (for harvest form dropdown)
export function getPlantings(params?: { bed_id?: number; status?: string }) {
  const qs = new URLSearchParams();
  if (params?.bed_id) qs.set('bed_id', String(params.bed_id));
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString();
  return apiFetch(`/api/plantings${query ? `?${query}` : ''}`);
}

// Varieties
export function getPlantVarieties(plantId: number) {
  return apiFetch(`/api/plants/${plantId}/varieties`);
}

export function getVarieties(params?: { plant_id?: number; desert_rating_min?: number }) {
  const qs = new URLSearchParams();
  if (params?.plant_id) qs.set('plant_id', String(params.plant_id));
  if (params?.desert_rating_min) qs.set('desert_rating_min', String(params.desert_rating_min));
  const query = qs.toString();
  return apiFetch(`/api/varieties${query ? `?${query}` : ''}`);
}

export function getRecommendedVarieties() {
  return apiFetch('/api/varieties/recommended');
}

export function getVariety(id: number) {
  return apiFetch(`/api/varieties/${id}`);
}

export function searchOpenPlantbook(query: string) {
  return apiFetch(`/api/openplantbook/search?q=${encodeURIComponent(query)}`);
}

// Pest & Disease Alerts
export function getPestAlerts() {
  return apiFetch('/api/alerts/pest-disease');
}

// Smart Suggestions
export function getBedSuggestions(bedId: number) {
  return apiFetch(`/api/suggestions/bed/${bedId}`);
}

export function getQuickSuggestions() {
  return apiFetch('/api/suggestions/quick');
}

// Planting Notes
export function createPlantingNote(plantingId: number, data: { note_type: string; content: string; severity?: string }) {
  return apiFetch(`/api/plantings/${plantingId}/notes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getPlantingNotes(plantingId: number) {
  return apiFetch(`/api/plantings/${plantingId}/notes`);
}

export function getRecentNotes(limit = 50) {
  return apiFetch(`/api/notes/recent?limit=${limit}`);
}

export function deleteNote(id: number) {
  return apiFetch(`/api/notes/${id}`, { method: 'DELETE' });
}

// History / Knowledge Base
export function getPlantHistory(plantId: number) {
  return apiFetch(`/api/history/plant/${plantId}`);
}

export function getBedHistory(bedId: number) {
  return apiFetch(`/api/history/bed/${bedId}`);
}

export function getSeasonHistory(year: number, season: string) {
  return apiFetch(`/api/history/season/${year}/${season}`);
}

export function getHistorySummary() {
  return apiFetch('/api/history/summary');
}

export function createSeasonSummary(data: { year: number; season: string; lessons_learned?: string; weather_summary?: string; notes?: string }) {
  return apiFetch('/api/history/season-summary', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getLessons() {
  return apiFetch('/api/history/lessons');
}

export function getPlantTips(plantId: number) {
  return apiFetch(`/api/history/plant/${plantId}/tips`);
}

// Property Layout
export function getProperty() {
  return apiFetch('/api/property');
}

export function updateProperty(data: { name?: string; width_feet?: number; height_feet?: number; orientation_degrees?: number; latitude?: number; longitude?: number; address?: string; default_soil_type?: string; default_soil_ph?: number; default_soil_notes?: string; last_frost_spring?: string; first_frost_fall?: string; frost_free_days?: number }) {
  return apiFetch('/api/property', { method: 'PATCH', body: JSON.stringify(data) });
}

// Geocoding (Nominatim proxy)
export function geocodeAddress(query: string) {
  return apiFetch(`/api/geocode?q=${encodeURIComponent(query)}`);
}

// Frost dates
export function getFrostDates(lat: number, lon: number) {
  return apiFetch(`/api/frost-dates?lat=${lat}&lon=${lon}`);
}

// Zones
export function getZones() {
  return apiFetch('/api/zones');
}

export function createZone(data: { name: string; zone_type: string; x_feet: number; y_feet: number; width_feet: number; height_feet: number; color?: string; notes?: string; rotation_degrees?: number; polygon_points?: string; is_cutout?: number; parent_zone_id?: number; soil_type?: string; soil_ph_min?: number; soil_ph_max?: number; soil_amendments?: string; soil_notes?: string; height_ft?: number }) {
  return apiFetch('/api/zones', { method: 'POST', body: JSON.stringify(data) });
}

export function updateZone(id: number, data: { name?: string; zone_type?: string; x_feet?: number; y_feet?: number; width_feet?: number; height_feet?: number; color?: string; notes?: string; rotation_degrees?: number; polygon_points?: string; is_cutout?: number; parent_zone_id?: number; soil_type?: string; soil_ph_min?: number; soil_ph_max?: number; soil_amendments?: string; soil_notes?: string; height_ft?: number }) {
  return apiFetch(`/api/zones/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteZone(id: number) {
  return apiFetch(`/api/zones/${id}`, { method: 'DELETE' });
}

// Bed Positions
export function getBedPositions() {
  return apiFetch('/api/beds/positions');
}

export function setBedPosition(bedId: number, data: { zone_id?: number; x_feet: number; y_feet: number; rotation_degrees?: number }) {
  return apiFetch(`/api/beds/${bedId}/position`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteBedPosition(bedId: number) {
  return apiFetch(`/api/beds/${bedId}/position`, { method: 'DELETE' });
}

// Sun Tracking
export function getSunPosition(date?: string, time?: string) {
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  if (time) qs.set('time', time);
  const query = qs.toString();
  return apiFetch(`/api/sun/position${query ? `?${query}` : ''}`);
}

export function getSunExposure(bedId: number, date?: string) {
  const qs = new URLSearchParams();
  qs.set('bed_id', String(bedId));
  if (date) qs.set('date', date);
  return apiFetch(`/api/sun/exposure?${qs.toString()}`);
}

export function getSunDaily(date?: string) {
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  const query = qs.toString();
  return apiFetch(`/api/sun/daily${query ? `?${query}` : ''}`);
}

export function getSunShadows(date?: string, time?: string) {
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  if (time) qs.set('time', time);
  const query = qs.toString();
  return apiFetch(`/api/sun/shadows${query ? `?${query}` : ''}`);
}

// Tasks
export function getTasks(params?: {
  status?: string;
  priority?: string;
  task_type?: string;
  due_before?: string;
  due_after?: string;
  overdue?: boolean;
  plant_id?: number;
  bed_id?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.priority) qs.set('priority', params.priority);
  if (params?.task_type) qs.set('task_type', params.task_type);
  if (params?.due_before) qs.set('due_before', params.due_before);
  if (params?.due_after) qs.set('due_after', params.due_after);
  if (params?.overdue) qs.set('overdue', 'true');
  if (params?.plant_id) qs.set('plant_id', String(params.plant_id));
  if (params?.bed_id) qs.set('bed_id', String(params.bed_id));
  const query = qs.toString();
  return apiFetch(`/api/tasks${query ? `?${query}` : ''}`);
}

export function createTask(data: {
  task_type: string;
  title: string;
  description?: string;
  priority?: string;
  due_date?: string;
  plant_id?: number;
  planting_id?: number;
  bed_id?: number;
  tray_id?: number;
  notes?: string;
}) {
  return apiFetch('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTask(id: number, data: {
  status?: string;
  priority?: string;
  due_date?: string;
  notes?: string;
  title?: string;
  description?: string;
}) {
  return apiFetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteTask(id: number) {
  return apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
}

export function completeTask(id: number) {
  return apiFetch(`/api/tasks/${id}/complete`, { method: 'POST' });
}

export function skipTask(id: number) {
  return apiFetch(`/api/tasks/${id}/skip`, { method: 'POST' });
}

export function snoozeTask(id: number, days: number = 1) {
  return apiFetch(`/api/tasks/${id}/snooze`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
}

export function generateTasks() {
  return apiFetch('/api/tasks/generate', { method: 'POST' });
}

export function getWeatherInsights() {
  return apiFetch('/api/tasks/weather-insights');
}

export function getTasksToday() {
  return apiFetch('/api/tasks/today');
}

export function getTasksWeek() {
  return apiFetch('/api/tasks/week');
}

export function getTasksSummary() {
  return apiFetch('/api/tasks/summary');
}

export function failTask(id: number) {
  return apiFetch(`/api/tasks/${id}/fail`, { method: 'POST' });
}

// Lifecycle Planner
export function getLifecycleRecommendation(plantId: number) {
  return apiFetch(`/api/lifecycle/recommend/${plantId}`);
}

export function createLifecyclePlan(data: {
  plant_id: number;
  method: 'seed' | 'direct_sow' | 'transplant';
  target_bed_id?: number;
  target_cell_x?: number;
  target_cell_y?: number;
  tray_id?: number;
  tray_row?: number;
  tray_col?: number;
  start_date?: string;
}) {
  return apiFetch('/api/lifecycle/plan', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getLifecycles() {
  return apiFetch('/api/lifecycle');
}

export function getLifecycleDetail(lifecycleId: string) {
  return apiFetch(`/api/lifecycle/${lifecycleId}`);
}

export function cancelLifecycle(lifecycleId: string) {
  return apiFetch(`/api/lifecycle/${lifecycleId}/cancel`, { method: 'POST' });
}

// Irrigation
export function getIrrigationZones() {
  return apiFetch('/api/irrigation/zones');
}

export function getIrrigationSummary() {
  return apiFetch('/api/irrigation/summary');
}

// Plant Enrichment / Details
export function getPlantDetails(plantId: number) {
  return apiFetch(`/api/plants/${plantId}/details`);
}

export function enrichPlant(plantId: number) {
  return apiFetch(`/api/plants/enrich/${plantId}`, { method: 'POST' });
}

export function enrichAllPlants() {
  return apiFetch('/api/plants/enrich-all', { method: 'POST' });
}

export function updateHarvestFlags() {
  return apiFetch('/api/plants/update-harvest-flags', { method: 'POST' });
}

export function getPlantHarvestInfo(plantId: number) {
  return apiFetch(`/api/plants/${plantId}/harvest-info`);
}

export function getEnrichmentSummary() {
  return apiFetch('/api/enrichment/summary');
}

export function deduplicatePlants() {
  return apiFetch('/api/plants/deduplicate', { method: 'POST' });
}

// Areas
export function getAreas(type?: string) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return apiFetch(`/api/areas${qs}`);
}

export function createArea(data: { name: string; area_type?: string; color?: string; notes?: string; default_irrigation_type?: string; default_irrigation_zone_name?: string; zone_id?: number }) {
  return apiFetch('/api/areas', { method: 'POST', body: JSON.stringify(data) });
}

export function updateArea(id: number, data: { name?: string; color?: string; notes?: string; sort_order?: number; map_x_feet?: number; map_y_feet?: number; map_width_feet?: number; map_height_feet?: number; map_polygon_points?: string; default_irrigation_type?: string; default_irrigation_zone_name?: string; zone_id?: number | null }) {
  return apiFetch(`/api/areas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteArea(id: number) {
  return apiFetch(`/api/areas/${id}`, { method: 'DELETE' });
}

export function getAreaContents(areaId: number) {
  return apiFetch(`/api/areas/${areaId}/contents`);
}

export function reorderBeds(orders: { id: number; sort_order: number; area_id?: number }[]) {
  return apiFetch('/api/beds/reorder', { method: 'POST', body: JSON.stringify({ orders }) });
}

export function reorderTrays(orders: { id: number; sort_order: number; area_id?: number }[]) {
  return apiFetch('/api/trays/reorder', { method: 'POST', body: JSON.stringify({ orders }) });
}

// Bed Sections (multi-zone planters)
export function getBedSections(bedId: number) {
  return apiFetch(`/api/beds/${bedId}/sections`);
}

export function createBedSection(bedId: number, data: { name: string; start_cell: number; end_cell: number; irrigation_zone_name?: string; notes?: string }) {
  return apiFetch(`/api/beds/${bedId}/sections`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateBedSection(bedId: number, sectionId: number, data: { name?: string; start_cell?: number; end_cell?: number; irrigation_zone_name?: string; notes?: string }) {
  return apiFetch(`/api/beds/${bedId}/sections/${sectionId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteBedSection(bedId: number, sectionId: number) {
  return apiFetch(`/api/beds/${bedId}/sections/${sectionId}`, { method: 'DELETE' });
}

// Ground Plants (in-ground individual plants)
export function getGroundPlants() {
  return apiFetch('/api/ground-plants');
}

export function getGroundPlant(id: number) {
  return apiFetch(`/api/ground-plants/${id}`);
}

export function createGroundPlant(data: { plant_id: number; name?: string; variety_id?: number; x_feet?: number; y_feet?: number; zone_id?: number; planted_date?: string; status?: string; irrigation_type?: string; irrigation_zone_name?: string; notes?: string; area_id?: number }) {
  return apiFetch('/api/ground-plants', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateGroundPlant(id: number, data: { name?: string; plant_id?: number; variety_id?: number; x_feet?: number; y_feet?: number; zone_id?: number; planted_date?: string; status?: string; irrigation_type?: string; irrigation_zone_name?: string; notes?: string; area_id?: number }) {
  return apiFetch(`/api/ground-plants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteGroundPlant(id: number) {
  return apiFetch(`/api/ground-plants/${id}`, { method: 'DELETE' });
}

export function reorderGroundPlants(orders: { id: number; sort_order: number; area_id?: number }[]) {
  return apiFetch('/api/ground-plants/reorder', { method: 'POST', body: JSON.stringify({ orders }) });
}

// Planter Types
export function getPlanterTypes(formFactor?: string) {
  const qs = formFactor ? `?form_factor=${encodeURIComponent(formFactor)}` : '';
  return apiFetch(`/api/planter-types${qs}`);
}

export function getPlanterType(id: number) {
  return apiFetch(`/api/planter-types/${id}`);
}

export function getPlanterCompatiblePlants(id: number, minCompat?: string) {
  const qs = minCompat ? `?min_compat=${encodeURIComponent(minCompat)}` : '';
  return apiFetch(`/api/planter-types/${id}/compatible-plants${qs}`);
}

export function getPlantCompatiblePlanters(plantId: number) {
  return apiFetch(`/api/plants/${plantId}/compatible-planters`);
}

export function recommendPlanterType(plantId: number) {
  return apiFetch(`/api/planter-types/recommend?plant_id=${plantId}`);
}

// Soil Intelligence
export function getSoilTypes() {
  return apiFetch('/api/soil/types');
}

export function getSoilProducts(soilType?: string) {
  const qs = soilType ? `?soil_type=${encodeURIComponent(soilType)}` : '';
  return apiFetch(`/api/soil/products${qs}`);
}

export function getSoilProduct(id: number) {
  return apiFetch(`/api/soil/products/${id}`);
}

export function getSoilProfile() {
  return apiFetch('/api/soil/profile');
}

export function getSoilForPlant(groundPlantId: number) {
  return apiFetch(`/api/soil/for-plant/${groundPlantId}`);
}

export function getSoilRecommendations(plantId: number, soilType: string = 'native-clay') {
  return apiFetch(`/api/soil/recommendations?plant_id=${plantId}&soil_type=${encodeURIComponent(soilType)}`);
}

// Journal Suggestions
export function getJournalSuggestions() {
  return apiFetch('/api/journal/suggestions');
}

// Journal
export function getJournalFeed(params?: { limit?: number; entry_type?: string }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.entry_type) qs.set('entry_type', params.entry_type);
  const query = qs.toString();
  return apiFetch(`/api/journal/feed${query ? `?${query}` : ''}`);
}

export function getJournalEntries(params?: { entry_type?: string; plant_id?: number; bed_id?: number; tray_id?: number; ground_plant_id?: number; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.entry_type) qs.set('entry_type', params.entry_type);
  if (params?.plant_id) qs.set('plant_id', String(params.plant_id));
  if (params?.bed_id) qs.set('bed_id', String(params.bed_id));
  if (params?.tray_id) qs.set('tray_id', String(params.tray_id));
  if (params?.ground_plant_id) qs.set('ground_plant_id', String(params.ground_plant_id));
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return apiFetch(`/api/journal${query ? `?${query}` : ''}`);
}

export function createJournalEntry(data: { entry_type: string; title?: string; content: string; plant_id?: number; planting_id?: number; bed_id?: number; tray_id?: number; tray_cell_id?: number; ground_plant_id?: number; photo_id?: number; mood?: string; tags?: string[]; severity?: string; milestone_type?: string; share_with_coop?: boolean }) {
  return apiFetch('/api/journal', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateJournalEntry(id: number, data: { entry_type?: string; title?: string; content?: string; plant_id?: number; planting_id?: number; bed_id?: number; tray_id?: number; tray_cell_id?: number; ground_plant_id?: number; photo_id?: number; mood?: string; tags?: string[]; severity?: string; milestone_type?: string }) {
  return apiFetch(`/api/journal/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteJournalEntry(id: number) {
  return apiFetch(`/api/journal/${id}`, { method: 'DELETE' });
}

export async function uploadJournalPhotos(entryId: number, files: File[]) {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  const res = await fetch(`${API_URL}/api/journal/${entryId}/photos`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function getJournalPhotos(entryId: number) {
  return apiFetch(`/api/journal/${entryId}/photos`);
}

export function deleteJournalPhoto(photoId: number) {
  return apiFetch(`/api/journal/photos/${photoId}`, { method: 'DELETE' });
}

export function getJournalPhotoUrl(photoId: number): string {
  return `${API_URL}/api/journal/photos/${photoId}/file`;
}

// Dashboard Stats
export function getDashboardStats() {
  return apiFetch('/api/dashboard/stats');
}

// Aggregated Dashboard (new)
export function getDashboard() {
  return apiFetch('/api/dashboard');
}

// Proactive suggestions
export function getSuggestions() {
  return apiFetch('/api/suggestions');
}

// Global Search
export function globalSearch(query: string) {
  return apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
}

// Undo
export function undoAction(actionId: string) {
  return apiFetch(`/api/undo/${actionId}`, { method: 'POST' });
}

// Seasonal Patterns
export function getSeasonalPatterns() {
  return apiFetch('/api/patterns/seasonal');
}

export function getAiInsights() {
  return apiFetch('/api/patterns/ai-insights', { method: 'POST' });
}

// Analytics
export function getYieldComparison() {
  return apiFetch('/api/analytics/yield-comparison');
}

export function getSeasonReview(year: number, season: string) {
  return apiFetch(`/api/analytics/season-review?year=${year}&season=${encodeURIComponent(season)}`);
}

// Water Usage Analytics
export function getWaterUsageAnalytics(days = 30) {
  return apiFetch(`/api/analytics/water-usage?days=${days}`);
}

// Soil Amendments
export function getAmendments(params?: { bed_id?: number; ground_plant_id?: number; tray_id?: number; instance_id?: number }) {
  const qs = new URLSearchParams();
  if (params?.bed_id) qs.set('bed_id', String(params.bed_id));
  if (params?.ground_plant_id) qs.set('ground_plant_id', String(params.ground_plant_id));
  if (params?.tray_id) qs.set('tray_id', String(params.tray_id));
  if (params?.instance_id) qs.set('instance_id', String(params.instance_id));
  const query = qs.toString();
  return apiFetch(`/api/amendments${query ? `?${query}` : ''}`);
}

export function createAmendment(data: {
  bed_id?: number;
  ground_plant_id?: number;
  tray_id?: number;
  instance_id?: number;
  amendment_type: string;
  product_name?: string;
  amount?: string;
  applied_date: string;
  next_due_date?: string;
  notes?: string;
}) {
  return apiFetch('/api/amendments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteAmendment(id: number) {
  return apiFetch(`/api/amendments/${id}`, { method: 'DELETE' });
}

export function getAmendmentSchedule() {
  return apiFetch('/api/amendments/schedule');
}

// Settings (aggregated)
export function getSettings() {
  return apiFetch('/api/settings');
}

// Export URLs (for download links)
export function getExportUrl(resource: 'harvests' | 'expenses' | 'journal' | 'plantings' | 'plants') {
  const format = resource === 'plants' ? 'json' : 'csv';
  return `${API_URL}/api/export/${resource}?format=${format}`;
}

// Calendar iCal subscription
export function getCalendarIcalUrl() {
  return apiFetch('/api/calendar/ical/url');
}

// Full JSON export for backup
export async function exportAllData() {
  const res = await fetch(`${API_URL}/api/export/plants?format=json`, { credentials: 'include' });
  if (!res.ok) throw new Error('Export failed');
  return res.json();
}

// ─── Backups ───

export function getBackups() {
  return apiFetch('/api/backups');
}

export function createBackup() {
  return apiFetch('/api/backups/create', { method: 'POST' });
}

export function restoreBackup(filename: string) {
  return apiFetch(`/api/backups/${encodeURIComponent(filename)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ confirmation_token: 'RESTORE' }),
  });
}

export function getBackupDownloadUrl(filename: string) {
  return `${API_URL}/api/backups/${encodeURIComponent(filename)}/download`;
}

export function deleteBackup(filename: string) {
  return apiFetch(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
}

// ── Auth ──
export function login(username: string, password: string) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function getMe() {
  return fetch(`${API_URL}/api/auth/me`, { credentials: 'include' }).then(res => {
    if (!res.ok) return null;
    return res.json();
  }).catch(() => null);
}

export function register(data: { username: string; password: string; display_name: string; invite_code: string; email?: string }) {
  return apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function changePassword(old_password: string, new_password: string) {
  return apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ old_password, new_password }),
  });
}

export function updateProfile(data: { display_name?: string; email?: string }) {
  return apiFetch('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ── Admin ──
export function getUsers() {
  return apiFetch('/api/admin/users');
}

export function updateUser(userId: number, data: { role?: string; is_active?: boolean; display_name?: string }) {
  return apiFetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function createInvite() {
  return apiFetch('/api/admin/invites', { method: 'POST' });
}

export function getInvites() {
  return apiFetch('/api/admin/invites');
}

export function deleteInvite(inviteId: number) {
  return apiFetch(`/api/admin/invites/${inviteId}`, { method: 'DELETE' });
}

// ── Updates ──
export function getUpdateStatus() {
  return apiFetch('/api/admin/update/status');
}

export function getUpdateChangelog() {
  return apiFetch('/api/admin/update/changelog');
}

export function applyUpdate() {
  return apiFetch('/api/admin/update/apply', { method: 'POST' });
}

export function toggleAutoUpdate(enabled: boolean) {
  return apiFetch('/api/admin/update/auto', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

// ── Setup / Onboarding ──
export function getSetupStatus() {
  return fetch(`${API_URL}/api/settings/setup-status`, { credentials: 'include' })
    .then(res => res.json())
    .catch(() => ({ setup_complete: false, step: 'login' }));
}

export function markSetupComplete() {
  return apiFetch('/api/settings/setup-complete', { method: 'POST' });
}

export function getFrostDateSettings() {
  return apiFetch('/api/settings/frost-dates');
}

export function updateFrostDateSettings(lastFrost: string, firstFrost: string) {
  return apiFetch('/api/settings/frost-dates', {
    method: 'PUT',
    body: JSON.stringify({ last_frost: lastFrost, first_frost: firstFrost }),
  });
}

export function updateUsdaZone(zone: string) {
  return apiFetch('/api/settings/usda-zone', {
    method: 'PUT',
    body: JSON.stringify({ zone }),
  });
}

// Journal AI Summary
export function generateJournalSummary(days: number = 7) {
  return apiFetch(`/api/journal/ai-summary?days=${days}`, { method: 'POST' });
}

// Plant Timeline (per-plant journal + harvests + milestones)
export function getPlantTimeline(plantType: string, plantId: number) {
  return apiFetch(`/api/journal/plant-timeline/${plantType}/${plantId}`);
}

// Quick-add journal entry (auto-generates title from planting context)
export function quickAddJournal(data: { planting_id?: number; ground_plant_id?: number; entry_type: string; content: string; severity?: string; milestone_type?: string }) {
  return apiFetch('/api/journal/quick-add', { method: 'POST', body: JSON.stringify(data) });
}

// Voice note journal entry (upload audio, transcribe, create entry)
export async function createVoiceNote(formData: FormData) {
  const res = await fetch(`${API_URL}/api/journal/voice-note`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error: ${res.status} ${text}`);
  }
  return res.json();
}

// Photo-first journal entry (upload photo, optional AI analysis, create entry)
export async function createPhotoJournalEntry(formData: FormData) {
  const res = await fetch(`${API_URL}/api/journal/photo-entry`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error: ${res.status} ${text}`);
  }
  return res.json();
}

// My Plantings (unified view)
export function getMyPlantings(status?: string, includeHistorical?: boolean) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (includeHistorical) params.set('include_historical', 'true');
  const qs = params.toString();
  return apiFetch(`/api/my-plantings${qs ? '?' + qs : ''}`);
}

// Garden Bed Templates
export function getTemplates() {
  return apiFetch('/api/beds/templates');
}

export function applyTemplate(bedId: number, templateId: string) {
  return apiFetch(`/api/beds/${bedId}/apply-template`, {
    method: 'POST',
    body: JSON.stringify({ template_id: templateId }),
  });
}

// ── Sensor Assignments ──
export function getSensorAssignments() {
  return apiFetch('/api/sensors/assignments');
}

export function upsertSensorAssignment(data: {
  entity_id: string;
  entity_friendly_name?: string;
  target_type: string;
  target_id: number;
  sensor_role?: string;
}) {
  return apiFetch('/api/sensors/assignments', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteSensorAssignment(assignmentId: number) {
  return apiFetch(`/api/sensors/assignments/${assignmentId}`, { method: 'DELETE' });
}

export function getSensorReadingsForTarget(targetType: string, targetId: number) {
  return apiFetch(`/api/sensors/readings/${targetType}/${targetId}`);
}

// ── Pest / Disease Tracking ──
export function getPestIncidents(params?: {
  status?: string;
  severity?: string;
  pest_type?: string;
  plant_id?: number;
  bed_id?: number;
  ground_plant_id?: number;
  date_from?: string;
  date_to?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.severity) qs.set('severity', params.severity);
  if (params?.pest_type) qs.set('pest_type', params.pest_type);
  if (params?.plant_id) qs.set('plant_id', String(params.plant_id));
  if (params?.bed_id) qs.set('bed_id', String(params.bed_id));
  if (params?.ground_plant_id) qs.set('ground_plant_id', String(params.ground_plant_id));
  if (params?.date_from) qs.set('date_from', params.date_from);
  if (params?.date_to) qs.set('date_to', params.date_to);
  const query = qs.toString();
  return apiFetch(`/api/pests${query ? `?${query}` : ''}`);
}

export function createPestIncident(data: {
  pest_type: string;
  pest_name: string;
  detected_date: string;
  severity?: string;
  status?: string;
  plant_id?: number | null;
  bed_id?: number | null;
  ground_plant_id?: number | null;
  treatment?: string;
  notes?: string;
}) {
  return apiFetch('/api/pests', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updatePestIncident(id: number, data: Record<string, unknown>) {
  return apiFetch(`/api/pests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deletePestIncident(id: number) {
  return apiFetch(`/api/pests/${id}`, { method: 'DELETE' });
}

export function getPestPatterns() {
  return apiFetch('/api/pests/patterns');
}

// ── Plant Instances ──

export function getPlantInstances(params?: { status?: string; location_type?: string; plant_id?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.location_type) qs.set('location_type', params.location_type);
  if (params?.plant_id) qs.set('plant_id', String(params.plant_id));
  const query = qs.toString();
  return apiFetch(`/api/plant-instances${query ? `?${query}` : ''}`);
}

export function getPlantInstance(id: number) {
  return apiFetch(`/api/plant-instances/${id}`);
}

export function updatePlantInstance(id: number, data: { status?: string; label?: string; notes?: string; planted_date?: string }) {
  return apiFetch(`/api/plant-instances/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function transplantInstance(id: number, data: {
  location_type: string;
  bed_id?: number;
  cell_x?: number;
  cell_y?: number;
  ground_plant_id?: number;
  tray_id?: number;
  tray_row?: number;
  tray_col?: number;
}) {
  return apiFetch(`/api/plant-instances/${id}/transplant`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getPlantInstanceTimeline(id: number) {
  return apiFetch(`/api/plant-instances/${id}/timeline`);
}

// ── FEDERATION / CO-OP ─────────────────────────────────────────────

export function getFederationIdentity() {
  return apiFetch('/api/federation/identity');
}

export function setupFederationIdentity(data: { display_name: string; instance_url?: string; coarse_location?: string }) {
  return apiFetch('/api/federation/setup', { method: 'POST', body: JSON.stringify(data) });
}

export function createFederationInvite() {
  return apiFetch('/api/federation/invite', { method: 'POST', body: '{}' });
}

export function connectToPeer(data: { peer_url: string; invite_code: string }) {
  return apiFetch('/api/federation/connect', { method: 'POST', body: JSON.stringify(data) });
}

export function getFederationPeers() {
  return apiFetch('/api/federation/peers');
}

export function updateFederationPeer(peerId: number, data: { status?: string; display_name?: string }) {
  return apiFetch(`/api/federation/peers/${peerId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteFederationPeer(peerId: number) {
  return apiFetch(`/api/federation/peers/${peerId}`, { method: 'DELETE' });
}

export function getFederationPrefs() {
  return apiFetch('/api/federation/prefs');
}

export function updateFederationPrefs(data: Partial<{
  share_plant_list: boolean;
  share_harvest_offers: boolean;
  share_seed_swaps: boolean;
  share_journal_public: boolean;
  share_alerts: boolean;
}>) {
  return apiFetch('/api/federation/prefs', { method: 'PATCH', body: JSON.stringify(data) });
}

export function syncFederationPeer(peerId: number) {
  return apiFetch(`/api/federation/peers/${peerId}/sync`, { method: 'POST', body: '{}' });
}

export async function getFederationStats() {
  const r = await fetch('/api/federation/stats');
  if (!r.ok) throw new Error('Failed to fetch stats');
  return r.json() as Promise<{
    active_peers: number;
    mesh_peers: number;
    harvest_offers: number;
    seed_swaps: number;
    active_alerts: number;
  }>;
}

// ── CO-OP BOARD & DATA ──────────────────────────────────────────────

export function getCoopBoard() {
  return apiFetch('/api/coop/board');
}

export function getHarvestOffers(params?: { status?: string; published?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.published !== undefined) qs.set('published', String(params.published ? 1 : 0));
  const q = qs.toString();
  return apiFetch(`/api/harvest-offers${q ? `?${q}` : ''}`);
}

export function createHarvestOffer(data: {
  plant_name: string; quantity_description: string;
  notes?: string; available_from?: string; available_until?: string; published?: boolean;
}) {
  return apiFetch('/api/harvest-offers', { method: 'POST', body: JSON.stringify(data) });
}

export function updateHarvestOffer(id: number, data: Partial<{
  quantity_description: string; notes: string; available_until: string;
  status: string; published: boolean;
}>) {
  return apiFetch(`/api/harvest-offers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteHarvestOffer(id: number) {
  return apiFetch(`/api/harvest-offers/${id}`, { method: 'DELETE' });
}

export async function getSurplusSuggestions(): Promise<Array<{
  plant_name: string; reason: string; total_oz: number; total_qty: number;
}>> {
  const r = await fetch(`${API_URL}/api/harvest-offers/suggestions`, { credentials: 'include' });
  if (!r.ok) return [];
  return r.json();
}

export function getSeedSwaps(params?: { status?: string; published?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.published !== undefined) qs.set('published', String(params.published ? 1 : 0));
  const q = qs.toString();
  return apiFetch(`/api/seed-swaps${q ? `?${q}` : ''}`);
}

export function createSeedSwap(data: {
  plant_name: string; quantity_description: string;
  variety?: string; looking_for?: string; notes?: string; published?: boolean;
}) {
  return apiFetch('/api/seed-swaps', { method: 'POST', body: JSON.stringify(data) });
}

export function updateSeedSwap(id: number, data: Partial<{
  quantity_description: string; looking_for: string; notes: string;
  status: string; published: boolean;
}>) {
  return apiFetch(`/api/seed-swaps/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteSeedSwap(id: number) {
  return apiFetch(`/api/seed-swaps/${id}`, { method: 'DELETE' });
}

export function getFederationAlerts() {
  return apiFetch('/api/federation-alerts');
}

export function createFederationAlert(data: {
  alert_type: string; title: string; body: string;
  severity?: string; affects_plants?: string[]; published?: boolean; expires_at?: string;
}) {
  return apiFetch('/api/federation-alerts', { method: 'POST', body: JSON.stringify(data) });
}

export function deleteFederationAlert(id: number) {
  return apiFetch(`/api/federation-alerts/${id}`, { method: 'DELETE' });
}

export async function getCoopSummary() {
  const r = await fetch('/api/coop/summary');
  if (!r.ok) return null;
  return r.json() as Promise<{
    active_peers: number;
    recent_alerts: number;
    harvest_offers: number;
    seed_swaps: number;
    my_active_offers: number;
  }>;
}

export async function getCoopFeed(limit = 20, type?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (type) params.set('type', type);
  const r = await fetch(`/api/coop/feed?${params}`);
  if (!r.ok) return [];
  return r.json() as Promise<Array<Record<string, unknown>>>;
}

// ── MESHTASTIC ──────────────────────────────────────────────────────

export function getMeshtasticConfig() {
  return apiFetch('/api/meshtastic/config');
}

export function updateMeshtasticConfig(data: Partial<{
  enabled: boolean;
  connection_type: string;
  hostname: string;
  port: number;
  serial_port: string;
  channel_index: number;
  channel_name: string;
}>) {
  return apiFetch('/api/meshtastic/config', { method: 'PATCH', body: JSON.stringify(data) });
}

export function getMeshtasticChannels() {
  return apiFetch('/api/meshtastic/channels');
}

export function testMeshtasticConnection() {
  return apiFetch('/api/meshtastic/connect', { method: 'POST', body: '{}' });
}

export function getMeshtasticStatus() {
  return apiFetch('/api/meshtastic/status');
}
