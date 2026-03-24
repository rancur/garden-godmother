// Shared constants used across multiple pages

/** Color palette for garden areas — used in planters, trays, ground-plants, and areas pages */
export const AREA_COLORS = [
  '#16a34a', '#2563eb', '#dc2626', '#d97706', '#7c3aed',
  '#0891b2', '#be185d', '#65a30d', '#ea580c', '#6366f1',
];

/** Planting status badge classes for bed/history pages (simple string variant) */
export const plantingStatusColors: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  planted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  growing: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  established: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  dormant: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  removed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

/** History-oriented planting status badge classes (includes seeded/sprouted/flowering/fruiting/harvested/failed) */
export const historyStatusColors: Record<string, string> = {
  planned: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  seeded: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  sprouted: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  growing: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  flowering: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',
  fruiting: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  harvested: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  failed: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  removed: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
};

/** Task status badge classes */
export const taskStatusColors: Record<string, string> = {
  pending: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300',
  completed: 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300',
  skipped: 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
  overdue: 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300',
};

/** Plant category emoji indicators */
export const categoryEmoji: Record<string, string> = {
  vegetable: '\uD83C\uDF45', // tomato
  herb: '\uD83C\uDF3F',       // herb
  flower: '\uD83C\uDF3B',     // sunflower
  fruit: '\uD83C\uDF53',      // strawberry
};

/** Plant category background/border classes for grid cells */
export const categoryBg: Record<string, string> = {
  vegetable: 'bg-green-100 dark:bg-green-900/40 border-green-400 dark:border-green-700',
  herb: 'bg-purple-100 dark:bg-purple-900/40 border-purple-400 dark:border-purple-700',
  flower: 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-400 dark:border-yellow-700',
  fruit: 'bg-red-100 dark:bg-red-900/40 border-red-400 dark:border-red-700',
};

/** Planter detail status labels with color (used in planters/[id]) */
export const planterStatusLabels: Record<string, { label: string; color: string }> = {
  seeded: { label: 'Seeded', color: 'bg-blue-100 text-blue-700' },
  sprouted: { label: 'Sprouted', color: 'bg-emerald-100 text-emerald-700' },
  growing: { label: 'Growing', color: 'bg-green-100 text-green-700' },
  flowering: { label: 'Flowering', color: 'bg-pink-100 text-pink-700' },
  fruiting: { label: 'Fruiting', color: 'bg-orange-100 text-orange-700' },
  harvested: { label: 'Harvested', color: 'bg-amber-100 text-amber-700' },
  established: { label: 'Established', color: 'bg-teal-100 text-teal-700' },
};

/** Journal / planting note type icons */
export const noteTypeIcons: Record<string, string> = {
  observation: '\u{1F50D}',
  problem: '\u{26A0}\u{FE0F}',
  success: '\u{2705}',
  lesson: '\u{1F4A1}',
  weather_impact: '\u{1F326}\u{FE0F}',
  pest_issue: '\u{1F41B}',
  harvest_note: '\u{1F33E}',
};

/** Task type icons */
export const taskTypeIcons: Record<string, string> = {
  purchase_seeds: '\uD83D\uDED2',
  start_seeds: '\uD83C\uDF31',
  transplant: '\uD83E\uDEB4',
  direct_sow: '\uD83C\uDF3E',
  water: '\uD83D\uDCA7',
  fertilize: '\uD83E\uDDEA',
  harvest: '\uD83C\uDF3D',
  pest_check: '\uD83D\uDC1B',
  prune: '\u2702\uFE0F',
  weed: '\uD83C\uDF3F',
  mulch: '\uD83C\uDF42',
  custom: '\uD83D\uDCCB',
};

/** Task type human-readable labels */
export const taskTypeLabels: Record<string, string> = {
  purchase_seeds: 'Purchase Seeds',
  start_seeds: 'Start Seeds',
  transplant: 'Transplant',
  direct_sow: 'Direct Sow',
  water: 'Water',
  fertilize: 'Fertilize',
  harvest: 'Harvest',
  pest_check: 'Pest Check',
  prune: 'Prune',
  weed: 'Weed',
  mulch: 'Mulch',
  custom: 'Custom',
};
