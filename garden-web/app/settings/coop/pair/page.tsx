'use client';

import { useState } from 'react';
import Link from 'next/link';
import { API_URL, pairFromQr } from '../../../api';
import { useToast } from '../../../toast';

export default function CoopPairPage() {
  const { toast } = useToast();
  const [pairInput, setPairInput] = useState('');
  const [pairing, setPairing] = useState(false);

  const handlePairFromQr = async () => {
    const raw = pairInput.trim();
    if (!raw) { toast("Paste the JSON from your partner's QR code", 'error'); return; }
    let parsed: { gg_url?: string; instance_name?: string; pubkey?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast('Invalid JSON — copy the text shown below the QR code', 'error');
      return;
    }
    if (!parsed.gg_url || !parsed.pubkey) {
      toast('Missing gg_url or pubkey in QR data', 'error');
      return;
    }
    setPairing(true);
    try {
      await pairFromQr({ gg_url: parsed.gg_url, instance_name: parsed.instance_name ?? '', pubkey: parsed.pubkey });
      setPairInput('');
      toast('Peer added — waiting for them to accept', 'success');
    } catch {
      toast('Could not add peer from QR', 'error');
    } finally {
      setPairing(false);
    }
  };

  return (
    <div className="min-h-screen bg-earth-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-md mx-auto space-y-8">
        {/* Back link */}
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-garden-600 dark:text-garden-400 hover:underline"
        >
          &larr; Back to Settings
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Garden Pairing</h1>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
            Share your QR with a neighbour or scan theirs to connect your gardens.
          </p>
        </div>

        {/* My QR */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6 border border-earth-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-earth-800 dark:text-gray-200 mb-1">My Pairing QR</h2>
          <p className="text-xs text-earth-500 dark:text-gray-400 mb-4">
            Let your partner scan this code or copy the JSON below it.
          </p>
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${API_URL}/api/federation/pairing-qr`}
              alt="My pairing QR code"
              className="w-64 h-64 rounded-xl border border-earth-100 dark:border-gray-700"
            />
          </div>
        </div>

        {/* Partner JSON input */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6 border border-earth-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-earth-800 dark:text-gray-200 mb-1">Add Partner&apos;s Garden</h2>
          <p className="text-xs text-earth-500 dark:text-gray-400 mb-4">
            After scanning their QR code, paste the JSON text here to add them as a peer.
          </p>
          <textarea
            rows={4}
            placeholder={'{"gg_url":"https://their-garden.example.com","instance_name":"Their Garden","pubkey":"..."}'}
            value={pairInput}
            onChange={(e) => setPairInput(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition resize-none"
          />
          <button
            type="button"
            onClick={handlePairFromQr}
            disabled={pairing || !pairInput.trim()}
            className="mt-3 w-full py-2.5 text-sm font-medium rounded-xl bg-garden-600 text-white hover:bg-garden-700 transition disabled:opacity-50"
          >
            {pairing ? 'Adding peer...' : '🤝 Add Peer from QR'}
          </button>
        </div>
      </div>
    </div>
  );
}
