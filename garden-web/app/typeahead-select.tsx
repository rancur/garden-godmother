'use client';
import { useState, useRef, useEffect } from 'react';

export interface TypeaheadOption {
  value: string;
  label: string;
  icon?: string;
}

interface TypeaheadSelectProps {
  options: TypeaheadOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  maxResults?: number;
}

export function TypeaheadSelect({
  options,
  value,
  onChange,
  placeholder = 'Type to search...',
  className = '',
  maxResults = 8,
}: TypeaheadSelectProps) {
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = value ? options.find((o) => o.value === value) : null;

  const filteredOptions = search
    ? options
        .filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
        .slice(0, maxResults)
    : [];

  if (selectedOption) {
    return (
      <div className={`relative ${className}`} ref={containerRef}>
        <div className="flex items-center gap-2 px-3 py-2 bg-garden-100 dark:bg-garden-900/40 border border-garden-300 dark:border-garden-700 rounded-lg">
          {selectedOption.icon && <span>{selectedOption.icon}</span>}
          <span className="text-sm text-earth-800 dark:text-gray-100 flex-1">{selectedOption.label}</span>
          <button
            onClick={() => {
              onChange('');
              setSearch('');
            }}
            className="text-earth-400 dark:text-gray-500 hover:text-earth-700 dark:hover:text-gray-200 text-sm font-bold"
            aria-label="Clear selection"
          >
            &#10005;
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setDropdownOpen(true);
        }}
        onFocus={() => setDropdownOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none text-sm"
      />
      {dropdownOpen && search && filteredOptions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setSearch('');
                setDropdownOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-3 min-h-[48px] hover:bg-garden-50 dark:hover:bg-gray-700 text-sm text-earth-700 dark:text-gray-200 text-left"
            >
              {option.icon && <span>{option.icon}</span>}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
