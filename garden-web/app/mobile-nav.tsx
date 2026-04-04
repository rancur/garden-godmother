'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navGroups, type NavGroup } from './navigation';
import { Logo } from './logo';

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

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const pathname = usePathname();

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Auto-expand the active group when menu opens
  useEffect(() => {
    if (open) {
      const activeGroup = navGroups.find((g) => isGroupActive(g, pathname));
      setExpandedGroup(activeGroup?.label ?? null);
    }
  }, [open, pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const toggleGroup = (label: string) => {
    setExpandedGroup((prev) => (prev === label ? null : label));
  };

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg text-earth-600 dark:text-gray-300 hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
        aria-label="Toggle navigation menu"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Full-screen slide-out panel */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/30 dark:bg-black/50"
          onClick={() => setOpen(false)}
        />

        {/* Panel */}
        <div
          className={`absolute top-0 right-0 h-full w-full max-w-sm bg-white dark:bg-gray-800 shadow-2xl transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-earth-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Logo size={24} />
              <span className="text-lg font-bold text-garden-700 dark:text-garden-400">Garden Godmother</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-2 rounded-lg text-earth-600 dark:text-gray-300 hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
              aria-label="Close navigation menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Nav groups */}
          <div className="overflow-y-auto h-[calc(100%-73px)] py-3 px-3">
            {/* Dashboard - standalone link */}
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold transition-colors min-h-[48px] mb-1 ${
                pathname === '/'
                  ? 'text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/30'
                  : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <span>📊</span>
              <span>Dashboard</span>
            </Link>
            {navGroups.map((group) => {
              const groupActive = isGroupActive(group, pathname);
              const isExpanded = expandedGroup === group.label;

              return (
                <div key={group.label} className="mb-1">
                  {/* Group header / accordion trigger */}
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg font-semibold transition-colors min-h-[48px] ${
                      groupActive
                        ? 'text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/30'
                        : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{group.emoji}</span>
                      <span>{group.label}</span>
                    </div>
                    <svg
                      className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Accordion content */}
                  <div
                    className={`overflow-hidden transition-all duration-200 ${
                      isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="pl-4 py-1">
                      {group.items.map((item) => {
                        const itemActive = isItemActive(item.href, pathname);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors min-h-[48px] ${
                              itemActive
                                ? 'bg-garden-100 dark:bg-garden-900/40 text-garden-700 dark:text-garden-300'
                                : 'text-earth-600 dark:text-gray-400 hover:bg-garden-50 dark:hover:bg-gray-700/50 hover:text-garden-700 dark:hover:text-garden-400'
                            }`}
                          >
                            <span className="text-lg shrink-0">{item.emoji}</span>
                            <div>
                              <div className="font-medium text-sm">{item.label}</div>
                              <div className={`text-xs ${
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
                </div>
              );
            })}

            {/* Co-op link */}
            <Link
              href="/coop"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold transition-colors min-h-[48px] mt-2 border-t border-earth-200 dark:border-gray-700 pt-4 ${
                pathname === '/coop' || pathname.startsWith('/coop/')
                  ? 'text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/30'
                  : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <span className="text-xl">🤝</span>
              <span>Co-op</span>
            </Link>

            {/* Settings link */}
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold transition-colors min-h-[48px] ${
                pathname === '/settings'
                  ? 'text-garden-700 dark:text-garden-400 bg-garden-50 dark:bg-garden-900/30'
                  : 'text-earth-700 dark:text-gray-300 hover:bg-garden-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
