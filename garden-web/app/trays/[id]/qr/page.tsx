'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API_URL } from '../../../api';

export default function TrayQRPage() {
  const params = useParams();
  const trayId = Number(params.id);
  const [trayName, setTrayName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qrUrl = `${API_URL}/api/trays/${trayId}/qr`;
  const pageUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/trays/${trayId}`
    : `/trays/${trayId}`;

  useEffect(() => {
    fetch(`${API_URL}/api/trays/${trayId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        setTrayName(data.name || `Tray #${trayId}`);
        setLoading(false);
      })
      .catch(() => {
        setTrayName(`Tray #${trayId}`);
        setLoading(false);
      });
  }, [trayId]);

  useEffect(() => {
    if (!loading && !error) {
      const timer = setTimeout(() => window.print(), 500);
      return () => clearTimeout(timer);
    }
  }, [loading, error]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body > *:not(#qr-print-root) { display: none !important; }
          header, nav, aside, footer, .navigation, [data-navigation] { display: none !important; }
          #qr-print-root { display: flex !important; }
          @page { margin: 1cm; }
        }
      `}</style>
      <div
        id="qr-print-root"
        className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 bg-white text-black"
      >
        <h1 className="text-3xl font-bold text-center">{trayName}</h1>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrUrl}
          alt={`QR code for ${trayName}`}
          width={280}
          height={280}
          className="border-4 border-gray-200 rounded-lg"
        />
        <p className="text-sm text-gray-500 text-center break-all max-w-xs">{pageUrl}</p>
        <button
          onClick={() => window.print()}
          className="mt-4 px-6 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors print:hidden"
        >
          Print
        </button>
      </div>
    </>
  );
}
