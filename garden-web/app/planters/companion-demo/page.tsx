'use client';

import { useState } from 'react';
import Link from 'next/link';

// ── Static mock data ──────────────────────────────────────────────────

interface CompanionPlant {
  name: string;
  icon: string;
  role: string;
  status: string;
  plantedDate: string;
}

interface CellData {
  primary: {
    name: string;
    icon: string;
    category: string;
    status: string;
    plantedDate: string;
  } | null;
  companions: CompanionPlant[];
}

interface CompanionSuggestion {
  name: string;
  icon: string;
  reason: string;
  rating: number;
}

interface IncompatiblePlant {
  name: string;
  icon: string;
}

const COMPANION_DB: Record<string, { suggestions: CompanionSuggestion[]; avoid: IncompatiblePlant[] }> = {
  Tomato: {
    suggestions: [
      { name: 'Basil', icon: '\uD83C\uDF3F', reason: 'Repels aphids, improves flavor', rating: 5 },
      { name: 'Marigold', icon: '\uD83C\uDF3C', reason: 'Repels nematodes', rating: 4 },
      { name: 'Carrot', icon: '\uD83E\uDD55', reason: 'Loosens soil', rating: 3 },
      { name: 'Parsley', icon: '\uD83C\uDF3F', reason: 'Attracts beneficial insects', rating: 3 },
    ],
    avoid: [
      { name: 'Fennel', icon: '\uD83C\uDF3E' },
      { name: 'Cabbage', icon: '\uD83E\uDD6C' },
      { name: 'Dill', icon: '\uD83C\uDF3F' },
    ],
  },
  Pepper: {
    suggestions: [
      { name: 'Marigold', icon: '\uD83C\uDF3C', reason: 'Repels pests, attracts pollinators', rating: 5 },
      { name: 'Basil', icon: '\uD83C\uDF3F', reason: 'Repels aphids and spider mites', rating: 4 },
      { name: 'Onion', icon: '\uD83E\uDDC5', reason: 'Deters many garden pests', rating: 3 },
    ],
    avoid: [
      { name: 'Fennel', icon: '\uD83C\uDF3E' },
      { name: 'Kohlrabi', icon: '\uD83E\uDD6C' },
    ],
  },
  Zucchini: {
    suggestions: [
      { name: 'Nasturtium', icon: '\uD83C\uDF3B', reason: 'Trap crop for aphids', rating: 4 },
      { name: 'Marigold', icon: '\uD83C\uDF3C', reason: 'Repels squash bugs', rating: 4 },
      { name: 'Bean', icon: '\uD83E\uDED8', reason: 'Fixes nitrogen in soil', rating: 3 },
    ],
    avoid: [
      { name: 'Potato', icon: '\uD83E\uDD54' },
    ],
  },
  Corn: {
    suggestions: [
      { name: 'Bean', icon: '\uD83E\uDED8', reason: 'Nitrogen fixer, uses corn as trellis', rating: 5 },
      { name: 'Squash', icon: '\uD83D\uDFE1', reason: 'Living mulch, shades soil (Three Sisters)', rating: 5 },
      { name: 'Pumpkin', icon: '\uD83C\uDF83', reason: 'Ground cover, reduces weeds', rating: 4 },
    ],
    avoid: [
      { name: 'Tomato', icon: '\uD83C\uDF45' },
    ],
  },
  Squash: {
    suggestions: [
      { name: 'Bean', icon: '\uD83E\uDED8', reason: 'Nitrogen fixer (Three Sisters)', rating: 5 },
      { name: 'Corn', icon: '\uD83C\uDF3D', reason: 'Provides shade and wind protection', rating: 4 },
      { name: 'Marigold', icon: '\uD83C\uDF3C', reason: 'Repels squash vine borers', rating: 4 },
    ],
    avoid: [
      { name: 'Potato', icon: '\uD83E\uDD54' },
    ],
  },
  Bean: {
    suggestions: [
      { name: 'Corn', icon: '\uD83C\uDF3D', reason: 'Natural trellis (Three Sisters)', rating: 5 },
      { name: 'Squash', icon: '\uD83D\uDFE1', reason: 'Ground cover companion', rating: 4 },
      { name: 'Carrot', icon: '\uD83E\uDD55', reason: 'Complementary root depths', rating: 3 },
    ],
    avoid: [
      { name: 'Onion', icon: '\uD83E\uDDC5' },
      { name: 'Garlic', icon: '\uD83E\uDDC4' },
    ],
  },
};

const CATEGORY_BG: Record<string, string> = {
  vegetable: 'bg-green-100 dark:bg-green-900/40 border-green-400 dark:border-green-700',
  herb: 'bg-purple-100 dark:bg-purple-900/40 border-purple-400 dark:border-purple-700',
  flower: 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-400 dark:border-yellow-700',
};

const GRID: CellData[][] = [
  // Row 0
  [
    {
      primary: { name: 'Tomato', icon: '\uD83C\uDF45', category: 'vegetable', status: 'fruiting', plantedDate: '2026-02-15' },
      companions: [{ name: 'Basil', icon: '\uD83C\uDF3F', role: 'Pest deterrent — repels aphids', status: 'growing', plantedDate: '2026-02-20' }],
    },
    {
      primary: { name: 'Pepper', icon: '\uD83C\uDF36\uFE0F', category: 'vegetable', status: 'flowering', plantedDate: '2026-02-18' },
      companions: [{ name: 'Marigold', icon: '\uD83C\uDF3C', role: 'Pest deterrent — repels nematodes', status: 'flowering', plantedDate: '2026-02-22' }],
    },
    {
      primary: { name: 'Zucchini', icon: '\uD83E\uDD52', category: 'vegetable', status: 'growing', plantedDate: '2026-03-01' },
      companions: [],
    },
    { primary: null, companions: [] },
  ],
  // Row 1
  [
    {
      primary: { name: 'Bean', icon: '\uD83E\uDED8', category: 'vegetable', status: 'growing', plantedDate: '2026-03-05' },
      companions: [],
    },
    {
      primary: { name: 'Corn', icon: '\uD83C\uDF3D', category: 'vegetable', status: 'growing', plantedDate: '2026-03-01' },
      companions: [{ name: 'Bean', icon: '\uD83E\uDED8', role: 'Nitrogen fixer — feeds corn', status: 'sprouted', plantedDate: '2026-03-10' }],
    },
    {
      primary: { name: 'Squash', icon: '\uD83D\uDFE1', category: 'vegetable', status: 'growing', plantedDate: '2026-03-01' },
      companions: [{ name: 'Bean', icon: '\uD83E\uDED8', role: 'Nitrogen fixer (Three Sisters)', status: 'sprouted', plantedDate: '2026-03-10' }],
    },
    {
      primary: { name: 'Tomato', icon: '\uD83C\uDF45', category: 'vegetable', status: 'growing', plantedDate: '2026-02-28' },
      companions: [{ name: 'Basil', icon: '\uD83C\uDF3F', role: 'Flavor enhancer, pest control', status: 'growing', plantedDate: '2026-03-05' }],
    },
  ],
];

const STATUS_COLORS: Record<string, string> = {
  seeded: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  sprouted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  growing: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  flowering: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  fruiting: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
};

// ── Component ─────────────────────────────────────────────────────────

export default function CompanionDemoPage() {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionTarget, setSuggestionTarget] = useState<string | null>(null);

  const cell = selectedCell ? GRID[selectedCell.row]?.[selectedCell.col] : null;

  const handleCellClick = (row: number, col: number) => {
    setShowSuggestions(false);
    setSuggestionTarget(null);
    if (selectedCell?.row === row && selectedCell?.col === col) {
      setSelectedCell(null);
    } else {
      setSelectedCell({ row, col });
    }
  };

  const handleAddCompanion = (plantName: string) => {
    setSuggestionTarget(plantName);
    setShowSuggestions(true);
  };

  const suggestions = suggestionTarget ? COMPANION_DB[suggestionTarget] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/planters" className="text-garden-600 dark:text-garden-400 hover:underline text-sm">
            &larr; Planters
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">
          Companion Planting Demo
        </h1>
        <p className="text-earth-500 dark:text-gray-400 mt-1">
          Multi-plant cells: primary plants with companion plantings
        </p>
      </div>

      {/* Prototype notice */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <strong>Prototype</strong> — This is a static mockup for Issue #67. Data is hardcoded to demonstrate the multi-plant cell concept. Click cells to interact.
      </div>

      {/* Main layout: grid + sidebar */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Grid */}
        <div className="flex-1">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
            <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-3">
              Demo Raised Bed — 4x2
            </h2>

            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: 'repeat(4, minmax(70px, 140px))' }}
            >
              {GRID.map((row, y) =>
                row.map((cellData, x) => {
                  const isSelected = selectedCell?.row === y && selectedCell?.col === x;
                  const hasCompanions = cellData.companions.length > 0;
                  const primary = cellData.primary;

                  return (
                    <button
                      key={`${x}-${y}`}
                      onClick={() => handleCellClick(y, x)}
                      className={`
                        aspect-square rounded-md border-2 flex flex-col items-center justify-center text-sm
                        transition-all cursor-pointer relative
                        ${primary
                          ? `${CATEGORY_BG[primary.category] || 'bg-gray-200 border-gray-400'} hover:brightness-95`
                          : 'bg-earth-50 dark:bg-gray-700 border-earth-200 dark:border-gray-600 hover:bg-earth-100 dark:hover:bg-gray-600 border-dashed'
                        }
                        ${isSelected ? 'ring-2 ring-garden-500 ring-offset-1' : ''}
                        ${hasCompanions ? 'border-b-4 border-b-garden-500 dark:border-b-garden-400' : ''}
                      `}
                      title={primary ? `${primary.name}${hasCompanions ? ` + ${cellData.companions.map(c => c.name).join(', ')}` : ''}` : 'Empty cell'}
                    >
                      {primary ? (
                        <>
                          {/* Primary plant */}
                          <span className="text-2xl leading-none">{primary.icon}</span>
                          <span className="text-sm font-semibold text-earth-800 dark:text-earth-200 truncate max-w-full px-0.5 mt-0.5 drop-shadow-sm">
                            {primary.name}
                          </span>

                          {/* Status abbreviation */}
                          <span className="absolute top-0.5 right-0.5 text-[8px] font-bold text-earth-500 dark:text-earth-300 leading-none">
                            {primary.status[0].toUpperCase()}
                          </span>

                          {/* Companion indicator */}
                          {hasCompanions && (
                            <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5">
                              {cellData.companions.map((comp, i) => (
                                <span key={i} className="text-xs leading-none drop-shadow-sm" title={`Companion: ${comp.name}`}>
                                  {comp.icon}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Companion badge */}
                          {hasCompanions && (
                            <span className="absolute top-0.5 left-0.5 bg-garden-500 text-white text-[7px] font-bold px-1 py-0.5 rounded-full leading-none">
                              +{cellData.companions.length}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-earth-300 dark:text-gray-500 text-xl">+</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-earth-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-1 bg-garden-500 rounded" /> Companion planted
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-4 bg-garden-500 text-white text-[7px] font-bold rounded-full flex items-center justify-center">+1</span> Companion count
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-4 border-2 border-dashed border-earth-200 rounded" /> Empty cell
              </span>
            </div>
          </div>

          {/* Three Sisters callout */}
          <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3">
            <h3 className="font-bold text-green-800 dark:text-green-200 text-sm mb-1">Three Sisters Pattern</h3>
            <p className="text-sm text-green-700 dark:text-green-300">
              Corn + Bean + Squash — the classic Native American companion planting trio. Corn provides a trellis for beans, beans fix nitrogen for corn, squash shades the soil as living mulch. See the bottom row for this pattern in action.
            </p>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-80 lg:flex-shrink-0 space-y-4">
          {cell && cell.primary ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm space-y-4 animate-slide-up">
              {/* Close */}
              <div className="flex justify-between items-start">
                <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">Cell Details</h3>
                <button
                  onClick={() => setSelectedCell(null)}
                  className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-sm font-bold px-2 py-1 rounded hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors"
                >
                  &times;
                </button>
              </div>

              {/* Primary plant */}
              <div className="bg-earth-50 dark:bg-gray-750 rounded-lg p-3 border border-earth-200 dark:border-gray-600">
                <div className="text-xs font-semibold text-earth-400 dark:text-gray-500 uppercase tracking-wider mb-2">Primary Plant</div>
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{cell.primary.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-earth-800 dark:text-gray-100">{cell.primary.name}</div>
                    <div className="text-xs text-earth-500 dark:text-gray-400">Planted {cell.primary.plantedDate}</div>
                    <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[cell.primary.status] || 'bg-gray-100 text-gray-600'}`}>
                      {cell.primary.status.charAt(0).toUpperCase() + cell.primary.status.slice(1)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Companions */}
              {cell.companions.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-earth-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                    Companions ({cell.companions.length})
                  </div>
                  <div className="space-y-2">
                    {cell.companions.map((comp, i) => (
                      <div key={i} className="bg-garden-50 dark:bg-garden-900/20 rounded-lg p-3 border border-garden-200 dark:border-garden-700">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{comp.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-earth-800 dark:text-gray-100">{comp.name}</div>
                            <div className="text-xs text-garden-700 dark:text-garden-300 italic">{comp.role}</div>
                            <div className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">Planted {comp.plantedDate}</div>
                            <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[comp.status] || 'bg-gray-100 text-gray-600'}`}>
                              {comp.status.charAt(0).toUpperCase() + comp.status.slice(1)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add companion button */}
              <button
                onClick={() => handleAddCompanion(cell.primary!.name)}
                className="w-full bg-garden-600 hover:bg-garden-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm text-sm"
              >
                + Add Companion Plant
              </button>

              {/* Companion suggestions panel */}
              {showSuggestions && suggestions && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-garden-200 dark:border-garden-600 p-3 space-y-3 animate-slide-up">
                  <div className="text-sm font-bold text-earth-800 dark:text-gray-100">
                    Suggested companions for {suggestionTarget}:
                  </div>

                  <div className="space-y-2">
                    {suggestions.suggestions.map((s, i) => (
                      <button
                        key={i}
                        className="w-full text-left bg-earth-50 dark:bg-gray-750 rounded-lg p-2.5 border border-earth-200 dark:border-gray-600 hover:bg-garden-50 dark:hover:bg-garden-900/20 hover:border-garden-300 dark:hover:border-garden-600 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{s.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-earth-800 dark:text-gray-100 text-sm">{s.name}</div>
                            <div className="text-xs text-earth-500 dark:text-gray-400">{s.reason}</div>
                          </div>
                          <div className="flex-shrink-0 text-garden-500 text-xs font-bold">
                            {'★'.repeat(s.rating)}{'☆'.repeat(5 - s.rating)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Avoid list */}
                  {suggestions.avoid.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5 border border-red-200 dark:border-red-700">
                      <div className="text-xs font-bold text-red-700 dark:text-red-300 mb-1">Don&apos;t plant with:</div>
                      <div className="flex flex-wrap gap-2">
                        {suggestions.avoid.map((a, i) => (
                          <span key={i} className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
                            {a.icon} {a.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => { setShowSuggestions(false); setSuggestionTarget(null); }}
                    className="w-full text-center text-xs text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 py-1"
                  >
                    Close suggestions
                  </button>
                </div>
              )}
            </div>
          ) : cell && !cell.primary ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm animate-slide-up">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">Empty Cell</h3>
                <button
                  onClick={() => setSelectedCell(null)}
                  className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-sm font-bold px-2 py-1 rounded hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors"
                >
                  &times;
                </button>
              </div>
              <p className="text-sm text-earth-500 dark:text-gray-400">
                Select a plant to place here, then optionally add companion plants.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
              <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-2">How It Works</h3>
              <div className="space-y-3 text-sm text-earth-600 dark:text-gray-300">
                <p>
                  Each planter cell can hold a <strong>primary plant</strong> and one or more <strong>companion plants</strong> at its base.
                </p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-garden-500 font-bold mt-0.5">1.</span>
                    <span>Click any cell to see its primary plant and companions</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-garden-500 font-bold mt-0.5">2.</span>
                    <span>Use &ldquo;Add Companion&rdquo; to see compatible suggestions with ratings</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-garden-500 font-bold mt-0.5">3.</span>
                    <span>Incompatible plants are flagged in the suggestions panel</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-earth-200 dark:border-gray-600">
                  <div className="font-semibold text-earth-700 dark:text-gray-200 mb-1">Visual indicators:</div>
                  <ul className="space-y-1 text-xs">
                    <li><span className="inline-block w-3 h-1 bg-garden-500 rounded mr-1" /> Thick green bottom border = has companions</li>
                    <li><span className="inline-block bg-garden-500 text-white text-[7px] font-bold px-1 rounded-full mr-1">+1</span> Badge shows companion count</li>
                    <li>Small icons in bottom-left corner show companion plants</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
