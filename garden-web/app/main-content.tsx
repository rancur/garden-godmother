'use client';

import { usePathname } from 'next/navigation';

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMapPage = pathname === '/map';

  return (
    <main
      id="main-content"
      className={isMapPage
        ? 'px-2 py-1'
        : 'max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8'
      }
    >
      {children}
    </main>
  );
}
