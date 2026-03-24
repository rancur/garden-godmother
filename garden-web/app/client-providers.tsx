'use client';

import { useEffect } from 'react';
import { ToastProvider } from './toast';
import { ModalProvider } from './confirm-modal';
import { setGardenTimezone } from './timezone';
import { getSettings } from './api';
import { AuthProvider } from './auth-context';

function TimezoneInitializer() {
  useEffect(() => {
    // On first load, fetch property timezone and cache it
    // Only fetch if not already cached
    if (typeof window !== 'undefined' && !localStorage.getItem('garden-timezone')) {
      getSettings()
        .then((data: { property?: { timezone?: string } }) => {
          setGardenTimezone(data?.property?.timezone || 'America/Phoenix');
        })
        .catch(() => {
          // Default is already America/Phoenix in getGardenTimezone()
        });
    }
  }, []);
  return null;
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <ModalProvider>
          <TimezoneInitializer />
          {children}
        </ModalProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
