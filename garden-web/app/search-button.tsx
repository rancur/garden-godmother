'use client';

import Link from 'next/link';

export function SearchButton() {
  return (
    <Link
      href="/search"
      className="p-2 rounded-lg text-earth-500 dark:text-gray-400 hover:bg-garden-50 dark:hover:bg-gray-700/50 hover:text-garden-700 dark:hover:text-garden-400 transition-colors"
      title="Search"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </Link>
  );
}
