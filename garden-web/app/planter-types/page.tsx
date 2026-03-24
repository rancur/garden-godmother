'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getPlanterTypes, getPlanterType } from '../api';

interface PlanterType {
  id: number;
  name: string;
  brand: string;
  form_factor: string;
  tiers: number;
  pockets_per_tier: number;
  total_pockets: number;
  pocket_depth_inches: number;
  pocket_volume_gallons: number;
  footprint_diameter_inches: number;
  footprint_width_inches: number | null;
  footprint_depth_inches: number | null;
  height_inches: number;
  watering_system: string;
  material: string;
  indoor_outdoor: string;
  url: string | null;
  image_url: string | null;
  recommended_plants: string[];
  unsuitable_plants: string[];
  desert_notes: string;
  created_at: string;
}

interface Compatibility {
  id: number;
  plant_id: number;
  plant_name: string;
  plant_category: string;
  form_factor: string;
  compatibility: string;
  notes: string;
}

const FORM_FACTORS = [
  { value: 'all', label: 'All Types' },
  { value: 'vertical_tower', label: 'Vertical Tower' },
  { value: 'raised_bed', label: 'Raised Bed' },
  { value: 'container', label: 'Container' },
  { value: 'vertical_wall', label: 'Vertical Wall' },
  { value: 'ground', label: 'Ground' },
  { value: 'trellis', label: 'Trellis' },
  { value: 'hanging', label: 'Hanging' },
];

const FORM_FACTOR_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  vertical_tower: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', label: 'Vertical Tower' },
  vertical_wall: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300', label: 'Vertical Wall' },
  raised_bed: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: 'Raised Bed' },
  container: { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-700 dark:text-sky-300', label: 'Container' },
  ground: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Ground' },
  trellis: { bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-700 dark:text-rose-300', label: 'Trellis' },
  hanging: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300', label: 'Hanging' },
};

const compatColor: Record<string, string> = {
  excellent: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  good: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  possible: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  poor: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  unsuitable: 'bg-gray-100 dark:bg-gray-900/30 text-gray-500 dark:text-gray-400',
};

function FormFactorBadge({ formFactor }: { formFactor: string }) {
  const style = FORM_FACTOR_STYLES[formFactor] || { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-300', label: formFactor };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

function SpecRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-earth-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-semibold text-earth-700 dark:text-gray-200">{value}</span>
    </div>
  );
}

export default function PlanterTypesPage() {
  const [planterTypes, setPlanterTypes] = useState<PlanterType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formFactorFilter, setFormFactorFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedData, setExpandedData] = useState<(PlanterType & { compatibilities: Compatibility[] }) | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    const ff = formFactorFilter === 'all' ? undefined : formFactorFilter;
    getPlanterTypes(ff)
      .then(setPlanterTypes)
      .catch(() => setError('Failed to load planter types'))
      .finally(() => setLoading(false));
  }, [formFactorFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedData(null);
      return;
    }
    setExpandedId(id);
    setExpandLoading(true);
    try {
      const data = await getPlanterType(id);
      setExpandedData(data);
    } catch {
      setExpandedData(null);
    } finally {
      setExpandLoading(false);
    }
  };

  // Build dimensions string based on form factor
  const getDimensions = (pt: PlanterType) => {
    const parts: string[] = [];
    if (pt.footprint_width_inches && pt.footprint_depth_inches) {
      parts.push(`${pt.footprint_width_inches}" x ${pt.footprint_depth_inches}"`);
    } else if (pt.footprint_diameter_inches) {
      parts.push(`${pt.footprint_diameter_inches}" diameter`);
    }
    if (pt.height_inches) {
      parts.push(`${pt.height_inches}" tall`);
    }
    return parts.join(' / ');
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Planter Types</h1>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">Browse planters by type and check plant compatibility</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Form factor filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FORM_FACTORS.map(ff => (
          <button
            key={ff.value}
            onClick={() => setFormFactorFilter(ff.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              formFactorFilter === ff.value
                ? 'bg-garden-600 text-white'
                : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600'
            }`}
          >
            {ff.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading planter types...</div>
      ) : planterTypes.length === 0 ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">No planter types found for this filter.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {planterTypes.map(pt => (
            <div key={pt.id} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col">
              <button
                onClick={() => handleExpand(pt.id)}
                className="w-full text-left p-5 hover:bg-earth-50 dark:hover:bg-gray-750 transition-colors flex-1"
              >
                {/* Header with thumbnail */}
                <div className="flex items-start gap-3">
                  {pt.image_url ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-earth-100 dark:bg-gray-700 shrink-0">
                      <img
                        src={pt.image_url}
                        alt={pt.name}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-earth-100 dark:bg-gray-700 shrink-0 flex items-center justify-center text-earth-400 dark:text-gray-500 text-2xl">
                      {pt.form_factor === 'vertical_tower' ? '\u{1F3D7}' : pt.form_factor === 'raised_bed' ? '\u{1F7EB}' : pt.form_factor === 'container' ? '\u{1FAA3}' : '\u{1F331}'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-earth-800 dark:text-gray-100 leading-tight">{pt.name}</h3>
                    <p className="text-sm text-earth-500 dark:text-gray-400">{pt.brand}</p>
                    <div className="mt-1.5">
                      <FormFactorBadge formFactor={pt.form_factor} />
                    </div>
                  </div>
                </div>

                {/* Specs */}
                <div className="mt-3 border-t border-earth-100 dark:border-gray-700 pt-3 space-y-0.5">
                  {pt.form_factor === 'vertical_tower' && pt.tiers > 0 && (
                    <SpecRow label="Configuration" value={`${pt.tiers} tiers x ${pt.pockets_per_tier} pockets = ${pt.total_pockets} total`} />
                  )}
                  {pt.form_factor !== 'vertical_tower' && pt.total_pockets > 0 && (
                    <SpecRow label="Capacity" value={`${pt.total_pockets} planting area${pt.total_pockets > 1 ? 's' : ''}`} />
                  )}
                  {getDimensions(pt) && (
                    <SpecRow label="Dimensions" value={getDimensions(pt)} />
                  )}
                  {pt.pocket_volume_gallons > 0 && (
                    <SpecRow label="Volume" value={`${pt.pocket_volume_gallons} gal${pt.form_factor === 'vertical_tower' ? '/pocket' : ''}`} />
                  )}
                  {pt.pocket_depth_inches > 0 && (
                    <SpecRow label="Soil Depth" value={`${pt.pocket_depth_inches}"`} />
                  )}
                </div>

                {/* Recommended plants preview */}
                {pt.recommended_plants && pt.recommended_plants.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-semibold text-earth-500 dark:text-gray-400 uppercase tracking-wider mb-1">Recommended Plants</div>
                    <div className="flex flex-wrap gap-1">
                      {pt.recommended_plants.slice(0, 6).map((p, i) => (
                        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">
                          {p}
                        </span>
                      ))}
                      {pt.recommended_plants.length > 6 && (
                        <span className="text-[10px] text-earth-400">+{pt.recommended_plants.length - 6} more</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Product link */}
                {pt.url && (
                  <div className="mt-3 pt-2 border-t border-earth-100 dark:border-gray-700">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(pt.url!, '_blank', 'noopener,noreferrer');
                      }}
                      className="text-xs font-medium text-garden-600 dark:text-garden-400 hover:underline cursor-pointer"
                    >
                      View Product &rarr;
                    </span>
                  </div>
                )}
              </button>

              {/* Expanded detail */}
              {expandedId === pt.id && (
                <div className="border-t border-earth-200 dark:border-gray-700 p-5 bg-earth-50/50 dark:bg-gray-750/50">
                  {expandLoading ? (
                    <p className="text-sm text-earth-400">Loading details...</p>
                  ) : expandedData ? (
                    <div className="space-y-4">
                      {/* Watering system */}
                      <div>
                        <h4 className="text-xs font-bold text-earth-600 dark:text-gray-300 uppercase tracking-wider mb-1">Watering System</h4>
                        <p className="text-sm text-earth-700 dark:text-gray-300">{expandedData.watering_system}</p>
                      </div>

                      {/* Material */}
                      <div>
                        <h4 className="text-xs font-bold text-earth-600 dark:text-gray-300 uppercase tracking-wider mb-1">Material</h4>
                        <p className="text-sm text-earth-700 dark:text-gray-300">{expandedData.material}</p>
                      </div>

                      {/* Desert notes */}
                      {expandedData.desert_notes && (
                        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                          <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-1">Desert Growing Notes</h4>
                          <p className="text-sm text-amber-800 dark:text-amber-200">{expandedData.desert_notes}</p>
                        </div>
                      )}

                      {/* Unsuitable plants */}
                      {expandedData.unsuitable_plants && expandedData.unsuitable_plants.length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-1">Unsuitable Plants</h4>
                          <div className="flex flex-wrap gap-1">
                            {expandedData.unsuitable_plants.map((p, i) => (
                              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* URL */}
                      {expandedData.url && (
                        <a
                          href={expandedData.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
                        >
                          View on {expandedData.brand} website &rarr;
                        </a>
                      )}

                      {/* Plant compatibility list */}
                      {expandedData.compatibilities && expandedData.compatibilities.length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold text-earth-600 dark:text-gray-300 uppercase tracking-wider mb-2">Plant Compatibility ({expandedData.compatibilities.length} plants)</h4>
                          <div className="space-y-1.5 max-h-64 overflow-y-auto">
                            {expandedData.compatibilities.map((c, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-medium shrink-0 ${compatColor[c.compatibility] || ''}`}>
                                  {c.compatibility}
                                </span>
                                <div>
                                  <span className="font-medium text-earth-700 dark:text-gray-300">{c.plant_name}</span>
                                  <span className="text-earth-400 dark:text-gray-500 ml-1 capitalize">({c.plant_category})</span>
                                  {c.notes && (
                                    <p className="text-earth-400 dark:text-gray-500 mt-0.5">{c.notes}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-earth-400">Failed to load details.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
