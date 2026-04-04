'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { connectToPeer } from '../../api';
import { useToast } from '../../toast';

// ─── Helpers ───

function Button({
  onClick,
  variant = 'primary',
  loading,
  disabled,
  children,
}: {
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const base =
    'px-4 py-2 text-sm font-medium rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-garden-600 text-white hover:bg-garden-700',
    secondary:
      'bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]}`}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Working...
        </span>
      ) : (
        children
      )}
    </button>
  );
}

// ─── Display mode: show QR code for others to scan ───

function DisplayMode() {
  const { toast } = useToast();
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string>('');
  const [pairUrl, setPairUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchQR = useCallback(async () => {
    setLoading(true);
    setQrSrc(null);
    setInviteCode('');
    try {
      const resp = await fetch('/api/federation/qr-code', { credentials: 'include' });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const code = resp.headers.get('X-Invite-Code') || '';
      const url = resp.headers.get('X-Pair-URL') || '';
      const blob = await resp.blob();
      setQrSrc(URL.createObjectURL(blob));
      setInviteCode(code);
      setPairUrl(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not load QR code';
      toast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchQR();
  }, [fetchQR]);

  const handleCopyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
    } catch {
      const input = document.createElement('input');
      input.value = inviteCode;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-earth-900 dark:text-gray-100">Your Pairing QR Code</h2>
        <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
          Show this QR code to someone who wants to connect to your garden.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        {loading ? (
          <div className="w-64 h-64 bg-earth-100 dark:bg-gray-700 rounded-xl animate-pulse flex items-center justify-center">
            <span className="text-earth-400 dark:text-gray-500 text-sm">Generating QR code...</span>
          </div>
        ) : qrSrc ? (
          <div className="p-4 bg-white rounded-xl shadow-md border border-earth-200 dark:border-gray-700 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="Pairing QR code" width={256} height={256} className="block" />
          </div>
        ) : (
          <div className="w-64 h-64 bg-earth-50 dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 flex items-center justify-center">
            <span className="text-earth-400 dark:text-gray-500 text-sm">QR code unavailable</span>
          </div>
        )}

        {inviteCode && (
          <div className="w-full max-w-sm space-y-2">
            <p className="text-xs text-earth-500 dark:text-gray-400 text-center">Invite code</p>
            <div className="flex items-center gap-2 px-3 py-2.5 border border-earth-200 dark:border-gray-700 rounded-lg bg-earth-50 dark:bg-gray-900/40">
              <span className="flex-1 text-center text-lg font-mono font-bold tracking-widest text-earth-900 dark:text-gray-100 select-all">
                {inviteCode}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition whitespace-nowrap ${
                  copied
                    ? 'bg-green-600 text-white'
                    : 'bg-garden-600 text-white hover:bg-garden-700'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-earth-400 dark:text-gray-500 text-center">
              Valid for 24 hours. Refresh to generate a new code.
            </p>
          </div>
        )}

        {pairUrl && (
          <p className="text-xs text-earth-400 dark:text-gray-500 text-center max-w-sm break-all">
            {pairUrl}
          </p>
        )}
      </div>

      <div className="flex justify-center">
        <Button variant="secondary" onClick={fetchQR} loading={loading}>
          Refresh Code
        </Button>
      </div>

      <div className="p-3 rounded-lg bg-earth-50 dark:bg-gray-900/30 border border-earth-100 dark:border-gray-700">
        <p className="text-xs text-earth-500 dark:text-gray-400 leading-relaxed">
          The other garden scans this QR code, which opens a pairing page pre-filled with your invite code.
          Once they connect, you will see a pending request in the Connections section.
        </p>
      </div>
    </div>
  );
}

// ─── Accept mode: someone scanned a QR code and landed here ───

function AcceptMode({ code, fromId, prefillUrl }: { code: string; fromId: string; prefillUrl: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [peerUrl, setPeerUrl] = useState(prefillUrl);
  const [connecting, setConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [status, setStatus] = useState<string>('');

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!peerUrl.trim()) {
      toast('Peer URL is required', 'error');
      return;
    }
    setConnecting(true);
    try {
      const result = await connectToPeer({ peer_url: peerUrl.trim(), invite_code: code });
      setSuccess(true);
      setStatus(result?.status || 'pending');
    } catch {
      toast('Could not connect to garden', 'error');
    } finally {
      setConnecting(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-6 text-center">
        <div className="text-5xl">🌱</div>
        <div>
          <h2 className="text-xl font-bold text-earth-900 dark:text-gray-100">Connection Request Sent!</h2>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-2">
            Status:{' '}
            <span className="font-semibold capitalize text-garden-700 dark:text-garden-400">{status}</span>
          </p>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
            The other garden will need to accept your request. You can check the status in the Connections tab.
          </p>
        </div>
        <Button variant="primary" onClick={() => router.push('/coop')}>
          Back to Co-op
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-earth-900 dark:text-gray-100">Connect to a Garden</h2>
        <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
          You scanned a QR code from garden{' '}
          <span className="font-mono font-semibold text-earth-800 dark:text-gray-200">{fromId}</span>.
          Complete the form below to send a connection request.
        </p>
      </div>

      <div className="px-3 py-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <p className="text-xs text-green-700 dark:text-green-400 font-medium">Invite code pre-filled from QR scan</p>
        <p className="text-sm font-mono font-bold text-green-900 dark:text-green-300 tracking-widest mt-0.5">
          {code}
        </p>
      </div>

      <form onSubmit={handleConnect} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">
            Peer URL <span className="text-red-500">*</span>
          </label>
          <input
            type="url"
            required
            placeholder="https://theirgarden.example.com"
            value={peerUrl}
            onChange={(e) => setPeerUrl(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
          />
          {!prefillUrl && (
            <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
              Enter the full URL of the garden you are connecting to (e.g. https://theirgarden.example.com).
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => router.push('/coop')}>
            Cancel
          </Button>
          {prefillUrl ? (
            <Button variant="primary" onClick={() => handleConnect()} loading={connecting}>
              Connect
            </Button>
          ) : (
            <Button variant="primary" loading={connecting}>
              Send Connection Request
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── Inner component that reads search params ───

function PairPageInner() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const fromId = searchParams.get('from') || '';
  const prefillUrl = searchParams.get('url') || '';

  const isAcceptMode = Boolean(code);

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-earth-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-earth-100 dark:border-gray-700 flex items-center gap-2.5">
          <span className="text-xl">{isAcceptMode ? '🤝' : '📷'}</span>
          <h1 className="text-lg font-semibold text-earth-900 dark:text-gray-100">
            {isAcceptMode ? 'Accept Pairing Invite' : 'Pair with a Garden'}
          </h1>
        </div>
        <div className="px-5 py-5">
          {isAcceptMode ? (
            <AcceptMode code={code!} fromId={fromId} prefillUrl={prefillUrl} />
          ) : (
            <DisplayMode />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page export ───

export default function PairPage() {
  return (
    <Suspense fallback={
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 p-8 flex justify-center">
          <span className="inline-block w-6 h-6 border-2 border-garden-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    }>
      <PairPageInner />
    </Suspense>
  );
}
