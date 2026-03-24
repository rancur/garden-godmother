'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from './auth-context';

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!user) return null;

  const initials = user.display_name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full bg-garden-100 dark:bg-garden-900/50 text-garden-700 dark:text-garden-300 text-xs font-bold flex items-center justify-center hover:bg-garden-200 dark:hover:bg-garden-800 transition-colors border border-garden-200 dark:border-garden-700"
        title={user.display_name}
      >
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
        ) : (
          initials
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-xl py-1 z-50">
          <div className="px-4 py-2.5 border-b border-earth-100 dark:border-gray-700">
            <div className="font-medium text-sm text-earth-800 dark:text-gray-100">{user.display_name}</div>
            <div className="text-xs text-earth-400 dark:text-gray-500">@{user.username} &middot; {user.role}</div>
          </div>

          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50"
          >
            Profile
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50"
          >
            Settings
          </Link>
          <Link
            href="/settings/notifications"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50"
          >
            Notifications
          </Link>

          {user.role === 'admin' && (
            <>
              <div className="border-t border-earth-100 dark:border-gray-700 my-1" />
              <Link
                href="/admin/users"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50"
              >
                Manage Users
              </Link>
              <Link
                href="/admin/activity"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50"
              >
                Activity Log
              </Link>
              <Link
                href="/settings/integrations"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50"
              >
                Integrations
              </Link>
              <Link
                href="/admin/updates"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50"
              >
                Updates
              </Link>
            </>
          )}

          <div className="border-t border-earth-100 dark:border-gray-700 my-1" />
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
