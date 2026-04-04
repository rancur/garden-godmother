'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getCoopBoard } from '../../api';
import { useToast } from '../../toast';

// ─── Types ───

interface BoardHarvestOffer {
  id: number;
  peer_display_name: string;
  peer_url: string;
  plant_name: string;
  quantity_description: string;
  notes?: string;
  available_until?: string;
}

interface BoardSeedSwap {
  id: number;
  peer_display_name: string;
  peer_url: string;
  plant_name: string;
  variety?: string;
  quantity_description: string;
  looking_for?: string;
  notes?: string;
}

interface BoardAlert {
  id: number;
  peer_display_name: string;
  alert_type: string;
  title: string;
  body: string;
  severity: 'urgent' | 'warning' | 'info';
  affects_plants?: string[];
  expires_at?: string;
}

interface CoopBoard {
  harvest_offers?: BoardHarvestOffer[];
  seed_swaps?: BoardSeedSwap[];
  alerts?: BoardAlert[];
}

// ─── Shared Components ───

const COOP_NAV = [
  { label: 'Board', href: '/coop/board', icon: '🌐' },
  { label: 'Harvest', href: '/coop/harvest', icon: '🧺' },
  { label: 'Seeds', href: '/coop/seeds', icon: '🌰' },
  { label: 'Alerts', href: '/coop/alerts', icon: '⚠️' },
];

function CoopSubNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 p-1 bg-earth-100 dark:bg-gray-800 rounded-xl overflow-x-auto">
      {COOP_NAV.map(({ label, href, icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? 'bg-white dark:bg-gray-700 text-garden-700 dark:text-garden-400 shadow-sm'
                : 'text-earth-600 dark:text-gray-400 hover:text-earth-900 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-gray-700/50'
            }`}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-earth-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-earth-100 dark:border-gray-700 flex items-center gap-2.5">
        <span className="text-xl">{icon}</span>
        <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-earth-500 dark:text-gray-400 py-4 text-center">{message}</p>
  );
}

// ─── Harvest Offers Section ───

function HarvestOffersSection({ offers }: { offers: BoardHarvestOffer[] }) {
  const [copied, setCopied] = useState<number | null>(null);

  const handleInterest = (offer: BoardHarvestOffer) => {
    const text = `${offer.peer_display_name} (${offer.peer_url})`;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(offer.id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (offers.length === 0) {
    return <EmptyState message="No active harvest offers from connected gardens." />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {offers.map((offer) => (
        <div
          key={offer.id}
          className="flex flex-col gap-2 p-4 rounded-lg border border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900/30"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-earth-900 dark:text-gray-100">{offer.plant_name}</p>
              <p className="text-xs text-earth-500 dark:text-gray-400 truncate">{offer.peer_display_name}</p>
            </div>
          </div>
          <p className="text-sm text-earth-700 dark:text-gray-300">{offer.quantity_description}</p>
          {offer.notes && (
            <p className="text-xs text-earth-500 dark:text-gray-400">{offer.notes}</p>
          )}
          {offer.available_until && (
            <p className="text-xs text-earth-400 dark:text-gray-500">
              Available until: {new Date(offer.available_until).toLocaleDateString()}
            </p>
          )}
          <button
            type="button"
            onClick={() => handleInterest(offer)}
            className={`mt-auto self-start px-3 py-1.5 text-xs font-medium rounded-md transition shadow-sm ${
              copied === offer.id
                ? 'bg-green-600 text-white'
                : 'bg-garden-600 text-white hover:bg-garden-700'
            }`}
          >
            {copied === offer.id ? 'Contact copied!' : 'Express Interest'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Seed Swaps Section ───

function SeedSwapsSection({ swaps }: { swaps: BoardSeedSwap[] }) {
  const [copied, setCopied] = useState<number | null>(null);

  const handleRequest = (swap: BoardSeedSwap) => {
    const text = `${swap.peer_display_name} (${swap.peer_url})`;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(swap.id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (swaps.length === 0) {
    return <EmptyState message="No active seed swaps from connected gardens." />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {swaps.map((swap) => (
        <div
          key={swap.id}
          className="flex flex-col gap-2 p-4 rounded-lg border border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900/30"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-earth-900 dark:text-gray-100">
              {swap.plant_name}
              {swap.variety && (
                <span className="ml-1.5 text-xs font-normal text-earth-500 dark:text-gray-400">
                  ({swap.variety})
                </span>
              )}
            </p>
            <p className="text-xs text-earth-500 dark:text-gray-400 truncate">{swap.peer_display_name}</p>
          </div>
          <p className="text-sm text-earth-700 dark:text-gray-300">{swap.quantity_description}</p>
          {swap.looking_for && (
            <p className="text-xs text-earth-600 dark:text-gray-400">
              <span className="font-medium">Looking for:</span> {swap.looking_for}
            </p>
          )}
          {swap.notes && (
            <p className="text-xs text-earth-500 dark:text-gray-400">{swap.notes}</p>
          )}
          <button
            type="button"
            onClick={() => handleRequest(swap)}
            className={`mt-auto self-start px-3 py-1.5 text-xs font-medium rounded-md transition shadow-sm ${
              copied === swap.id
                ? 'bg-green-600 text-white'
                : 'bg-garden-600 text-white hover:bg-garden-700'
            }`}
          >
            {copied === swap.id ? 'Contact copied!' : 'Request Swap'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Alerts Section ───

const SEVERITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700',
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700',
};

const SEVERITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
};

function AlertsSection({ alerts }: { alerts: BoardAlert[] }) {
  const sorted = [...alerts].sort((a, b) => {
    const order = { urgent: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  if (sorted.length === 0) {
    return <EmptyState message="No active alerts from connected gardens." />;
  }

  return (
    <div className="space-y-3">
      {sorted.map((alert) => (
        <div
          key={alert.id}
          className={`p-4 rounded-lg border ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info}`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    SEVERITY_BADGE[alert.severity] ?? SEVERITY_BADGE.info
                  }`}
                >
                  {alert.severity.toUpperCase()}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 capitalize">
                  {alert.alert_type}
                </span>
                <span className="text-xs text-earth-500 dark:text-gray-400">{alert.peer_display_name}</span>
              </div>
              <p className="text-sm font-semibold text-earth-900 dark:text-gray-100">{alert.title}</p>
              <p className="text-sm text-earth-700 dark:text-gray-300 mt-1">{alert.body}</p>
              {alert.affects_plants && alert.affects_plants.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {alert.affects_plants.map((plant) => (
                    <span
                      key={plant}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-400"
                    >
                      {plant}
                    </span>
                  ))}
                </div>
              )}
              {alert.expires_at && (
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-2">
                  Expires: {new Date(alert.expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ───

export default function CoopBoardPage() {
  const { toast } = useToast();
  const [board, setBoard] = useState<CoopBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCoopBoard()
      .then((data: CoopBoard) => setBoard(data))
      .catch(() => toast({ title: 'Could not load co-op board', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, []);

  const hasAnyContent =
    board &&
    ((board.harvest_offers?.length ?? 0) > 0 ||
      (board.seed_swaps?.length ?? 0) > 0 ||
      (board.alerts?.length ?? 0) > 0);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Garden Co-op</h1>
        <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
          Connect and share with other gardens in your federation.
        </p>
      </div>

      <CoopSubNav />

      {loading ? (
        <LoadingSkeleton />
      ) : !hasAnyContent ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 px-6 py-10 text-center">
          <p className="text-3xl mb-3">🌐</p>
          <p className="text-sm font-medium text-earth-700 dark:text-gray-300">No active peers yet</p>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
            Connect with other gardens in the{' '}
            <Link href="/coop" className="text-garden-600 dark:text-garden-400 underline">
              Co-op settings
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          {(board?.alerts?.length ?? 0) > 0 && (
            <SectionCard title="Alerts" icon="⚠️">
              <AlertsSection alerts={board!.alerts!} />
            </SectionCard>
          )}

          <SectionCard title="Harvest Offers" icon="🧺">
            <HarvestOffersSection offers={board?.harvest_offers ?? []} />
          </SectionCard>

          <SectionCard title="Seed Swaps" icon="🌰">
            <SeedSwapsSection swaps={board?.seed_swaps ?? []} />
          </SectionCard>
        </>
      )}
    </div>
  );
}
