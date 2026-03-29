'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SmartJournalRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/journal');
  }, [router]);
  return null;
}
