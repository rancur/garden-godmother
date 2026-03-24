'use client';

import { useAuth } from './auth-context';
import { usePathname } from 'next/navigation';

const PUBLIC_PATHS = ['/login', '/register', '/setup'];

export function AuthNav({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Hide nav on public pages and while loading
  if (loading || !user || PUBLIC_PATHS.includes(pathname)) {
    return null;
  }

  return <>{children}</>;
}
