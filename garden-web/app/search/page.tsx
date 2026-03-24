'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { globalSearch } from '../api';

interface SearchResults {
  query: string;
  results: {
    plants: Array<{ id: number; name: string; category: string; scientific_name?: string; match: string }>;
    planters: Array<{ id: number; name: string; location?: string; match: string }>;
    ground_plants: Array<{ id: number; name: string; plant_name?: string; status?: string; match: string }>;
    trays: Array<{ id: number; name: string; location?: string; match: string }>;
    areas: Array<{ id: number; name: string; area_type?: string; color?: string; match: string }>;
    journal: Array<{ id: number; title?: string; entry_type: string; snippet?: string; created_at?: string; match: string }>;
    varieties: Array<{ id: number; name: string; plant_name?: string; match: string }>;
  };
  total: number;
}

const CATEGORY_CONFIG: Record<string, { label: string; emoji: string; href: (id: number) => string }> = {
  plants: { label: 'Plants', emoji: '\uD83C\uDF31', href: (id) => `/plants/${id}` },
  planters: { label: 'Planters', emoji: '\uD83E\uDEB4', href: (id) => `/planters/${id}` },
  ground_plants: { label: 'Ground Plants', emoji: '\uD83C\uDF33', href: (id) => `/ground-plants/${id}` },
  trays: { label: 'Trays', emoji: '\uD83C\uDF3F', href: (id) => `/trays/${id}` },
  areas: { label: 'Areas', emoji: '\uD83D\uDCCD', href: (id) => `/areas/${id}` },
  journal: { label: 'Journal', emoji: '\uD83D\uDCDD', href: (id) => `/journal/${id}` },
  varieties: { label: 'Varieties', emoji: '\uD83C\uDF3E', href: (id) => `/plants?variety=${id}` },
};

function getSubtitle(category: string, item: Record<string, unknown>): string | null {
  switch (category) {
    case 'plants':
      return [item.category, item.scientific_name].filter(Boolean).join(' \u2014 ') || null;
    case 'planters':
      return (item.location as string) || null;
    case 'ground_plants':
      return [item.plant_name, item.status].filter(Boolean).join(' \u2014 ') || null;
    case 'trays':
      return (item.location as string) || null;
    case 'areas':
      return (item.area_type as string) || null;
    case 'journal':
      return (item.snippet as string) || (item.entry_type as string) || null;
    case 'varieties':
      return (item.plant_name as string) || null;
    default:
      return null;
  }
}

function getDisplayName(category: string, item: Record<string, unknown>): string {
  if (category === 'journal') return (item.title as string) || `${item.entry_type} entry`;
  return (item.name as string) || `#${item.id}`;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length === 0) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await globalSearch(q.trim());
      setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasResults = results && results.total > 0;
  const noResults = results && results.total === 0 && query.trim().length > 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100 mb-6">Search Garden</h1>

      <div className="relative mb-8">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <svg className="w-5 h-5 text-earth-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plants, planters, journal entries, varieties..."
          className="w-full pl-12 pr-4 py-3 rounded-xl border border-earth-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-earth-900 dark:text-gray-100 placeholder-earth-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none text-lg"
        />
        {loading && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
            <div className="w-5 h-5 border-2 border-garden-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-4 rounded-xl mb-6">
          {error}
        </div>
      )}

      {noResults && (
        <div className="text-center py-12 text-earth-500 dark:text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-lg font-medium">No results for &quot;{query}&quot;</p>
          <p className="text-sm mt-1">Try a different search term</p>
        </div>
      )}

      {hasResults && (
        <div className="space-y-6">
          <p className="text-sm text-earth-500 dark:text-gray-400">
            {results.total} result{results.total !== 1 ? 's' : ''} for &quot;{results.query}&quot;
          </p>
          {(Object.keys(CATEGORY_CONFIG) as Array<keyof typeof CATEGORY_CONFIG>).map((cat) => {
            const items = results.results[cat as keyof typeof results.results];
            if (!items || items.length === 0) return null;
            const config = CATEGORY_CONFIG[cat];
            return (
              <div key={cat}>
                <h2 className="text-sm font-semibold text-earth-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span>{config.emoji}</span>
                  {config.label}
                  <span className="text-xs font-normal bg-earth-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{items.length}</span>
                </h2>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 divide-y divide-earth-100 dark:divide-gray-700">
                  {items.map((item) => {
                    const subtitle = getSubtitle(cat, item as unknown as Record<string, unknown>);
                    const displayName = getDisplayName(cat, item as unknown as Record<string, unknown>);
                    return (
                      <Link
                        key={item.id}
                        href={config.href(item.id)}
                        className="flex items-center justify-between px-4 py-3 hover:bg-garden-50 dark:hover:bg-gray-700/50 transition-colors first:rounded-t-xl last:rounded-b-xl"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-earth-800 dark:text-gray-200 truncate">{displayName}</div>
                          {subtitle && (
                            <div className="text-sm text-earth-500 dark:text-gray-400 truncate mt-0.5">{subtitle}</div>
                          )}
                        </div>
                        <svg className="w-4 h-4 text-earth-400 dark:text-gray-500 shrink-0 ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!results && !loading && query.trim().length === 0 && (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-lg">Search across your entire garden</p>
          <p className="text-sm mt-2">Plants, planters, trays, areas, journal entries, and varieties</p>
        </div>
      )}
    </div>
  );
}
