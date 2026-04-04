'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  description: string;
  emoji: string;
}

export interface NavGroup {
  label: string;
  emoji: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: 'Garden',
    emoji: '\u{1F331}',
    items: [
      { href: '/map', label: 'Map', description: 'Visual garden layout', emoji: '\u{1F5FA}' },
      { href: '/planters', label: 'Planters', description: 'Manage planter layouts', emoji: '\u{1FAB4}' },
      { href: '/ground-plants', label: 'Ground', description: 'Trees, shrubs, and vines planted in the ground', emoji: '\u{1F333}' },
      { href: '/trays', label: 'Trays', description: 'Seed starting trays', emoji: '\u{1F33F}' },
      { href: '/areas', label: 'Areas', description: 'Unified area zones', emoji: '\u{1F4CD}' },
    ],
  },
  {
    label: 'Plan',
    emoji: '\u{1F4CB}',
    items: [
      { href: '/tasks', label: 'Tasks', description: 'To-do and maintenance', emoji: '\u2705' },
      { href: '/lifecycle', label: 'Lifecycle Planner', description: 'Planting schedules', emoji: '\u{1F504}' },
      { href: '/calendar', label: 'Calendar', description: 'Monthly garden calendar', emoji: '\u{1F4C5}' },
      { href: '/shopping', label: 'Shopping List', description: 'Supplies to buy', emoji: '\u{1F6D2}' },
    ],
  },
  {
    label: 'Plants',
    emoji: '\u{1F33F}',
    items: [
      { href: '/my-plantings', label: 'My Plantings', description: 'All active plantings in one view', emoji: '\u{1F33B}' },
      { href: '/plants', label: 'Plant Library', description: 'Browse all plant varieties', emoji: '\u{1F4D6}' },
      { href: '/seeds', label: 'Seeds Inventory', description: 'Track your seed collection', emoji: '\u{1FAB4}' },
    ],
  },
  {
    label: 'Monitor',
    emoji: '\u{1F4CA}',
    items: [
      { href: '/sensors', label: 'Sensors', description: 'Live sensor readings', emoji: '\u{1F321}' },
      { href: '/irrigation', label: 'Irrigation', description: 'Watering zones and adequacy', emoji: '\u{1F4A7}' },
      { href: '/sensors/history', label: 'Sensor History', description: 'Historical sensor data', emoji: '\u{1F4C8}' },
      { href: '/alerts', label: 'Alerts', description: 'Notifications and warnings', emoji: '\u{1F514}' },
      { href: '/analytics', label: 'Analytics', description: 'Yield comparison, water & season reviews', emoji: '\u{1F4CA}' },
      { href: '/health', label: 'Plant Health', description: 'AI health monitoring', emoji: '\u{1F3E5}' },
      { href: '/pests', label: 'Pest Tracker', description: 'Pest & disease outbreak tracking', emoji: '\u{1F41B}' },
      { href: '/patterns', label: 'Patterns', description: 'Seasonal pattern recognition', emoji: '\u{1F52C}' },
    ],
  },
  {
    label: 'Track',
    emoji: '\u{1F4DA}',
    items: [
      { href: '/journal', label: 'Journal', description: 'Garden notes and observations', emoji: '\u{1F4DD}' },
      { href: '/harvest', label: 'Harvest', description: 'Log what you pick', emoji: '\u{1F345}' },
      { href: '/expenses', label: 'Expenses', description: 'Track garden spending', emoji: '\u{1F4B0}' },
      { href: '/history', label: 'History', description: 'Past seasons and records', emoji: '\u{1F4C6}' },
    ],
  },
];

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => {
    if (item.href === '/') return pathname === '/';
    return pathname === item.href || pathname.startsWith(item.href + '/');
  });
}

function isItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function DesktopNav() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback((groupLabel: string) => {
    clearCloseTimeout();
    setOpenGroup(groupLabel);
  }, [clearCloseTimeout]);

  const handleMouseLeave = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpenGroup(null);
    }, 150);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on route change
  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

  return (
    <div ref={navRef} className="hidden lg:flex items-center gap-1">
      <Link
        href="/"
        className={`px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
          pathname === '/'
            ? 'text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/30'
            : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50 hover:text-garden-700 dark:hover:text-garden-400'
        }`}
      >
        📊 Dashboard
      </Link>
      {navGroups.map((group) => {
        const active = isGroupActive(group, pathname);
        const isOpen = openGroup === group.label;

        return (
          <div
            key={group.label}
            className="relative"
            onMouseEnter={() => handleMouseEnter(group.label)}
            onMouseLeave={handleMouseLeave}
          >
            <button
              onClick={() => setOpenGroup(isOpen ? null : group.label)}
              className={`px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-1.5 text-sm ${
                active
                  ? 'text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/30'
                  : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50 hover:text-garden-700 dark:hover:text-garden-400'
              }`}
            >
              <span>{group.emoji}</span>
              <span>{group.label}</span>
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown panel */}
            <div
              className={`absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-earth-200 dark:border-gray-700 py-2 transition-all duration-150 origin-top ${
                isOpen
                  ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
                  : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
              }`}
            >
              {group.items.map((item) => {
                const itemActive = isItemActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-start gap-3 px-4 py-2.5 transition-colors ${
                      itemActive
                        ? 'bg-garden-50 dark:bg-garden-900/30 text-garden-700 dark:text-garden-400'
                        : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50 hover:text-garden-700 dark:hover:text-garden-400'
                    }`}
                  >
                    <span className="text-lg mt-0.5 shrink-0">{item.emoji}</span>
                    <div>
                      <div className="font-medium text-sm">{item.label}</div>
                      <div className={`text-xs mt-0.5 ${
                        itemActive
                          ? 'text-garden-600 dark:text-garden-500'
                          : 'text-earth-400 dark:text-gray-500'
                      }`}>
                        {item.description}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
      <Link
        href="/coop"
        className={`px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
          isItemActive('/coop', pathname)
            ? 'text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/30'
            : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50 hover:text-garden-700 dark:hover:text-garden-400'
        }`}
      >
        🤝 Co-op
      </Link>
    </div>
  );
}
