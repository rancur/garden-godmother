'use client';

import { useEffect } from 'react';

/**
 * Fixes iOS Safari PWA standalone mode navigation.
 * Without this, clicking internal links opens them in a new Safari tab/popup
 * instead of navigating within the standalone app shell.
 */
export function PwaNavigationFix() {
  useEffect(() => {
    // Only activate in standalone PWA mode (iOS home screen app)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;

    if (!isStandalone) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Skip download links and explicitly external links
      if (anchor.hasAttribute('download') || anchor.getAttribute('target') === '_blank') return;

      // Only intercept internal navigation
      if (href.startsWith('/') || href.startsWith(window.location.origin)) {
        e.preventDefault();
        window.location.href = href;
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return null;
}
