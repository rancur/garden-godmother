'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  getFederationPeers,
  getFederationStats,
} from '../api';
import { useToast } from '../toast';

// ─── Types ───

interface FederationPeer {
  id: number;
  peer_id: string;
  display_name: string;
  peer_url: string;
  status: 'pending' | 'active' | 'blocked';
  last_seen: string | null;
  transport: string;
}

interface FederationStats {
  active_peers: number;
  mesh_peers: number;
  harvest_offers: number;
  seed_swaps: number;
  active_alerts: number;
}

interface BoardItem {
  id: string | number;
  type: 'harvest' | 'seed_swap' | 'alert';
  peer_name: string;
  title: string;
  created_at: string;
}

// ─── Helpers ───

function syncHealth(lastSeen: string | null): 'ok' | 'stale' | 'error' | 'unknown' {
  if (!lastSeen) return 'unknown';
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age < 60 * 60 * 1000) return 'ok';
  if (age < 24 * 60 * 60 * 1000) return 'stale';
  return 'error';
}

function SyncHealthDot({ lastSeen }: { lastSeen: string | null }) {
  const health = syncHealth(lastSeen);
  const colors = {
    ok: 'bg-green-500',
    stale: 'bg-yellow-400',
    error: 'bg-red-500',
    unknown: 'bg-gray-400',
  };
  const labels = { ok: 'Synced', stale: 'Stale', error: 'Sync error', unknown: 'Unknown' };
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${colors[health]}`}
      title={labels[health]}
    />
  );
}

function formatLastSeen(ts: string | null): string {
  if (!ts) return 'Never';
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

// ─── Stats Bar ───

function StatsBar() {
  const [stats, setStats] = useState<FederationStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFederationStats()
      .then((data) => setStats(data))
      .catch(() => {/* silently ignore — stats are non-critical */})
      .finally(() => setLoading(false));
  }, []);

  const statCards: { label: string; key: keyof FederationStats; alert?: boolean }[] = [
    { label: 'Active Peers', key: 'active_peers' },
    { label: 'Mesh Peers', key: 'mesh_peers' },
    { label: 'Harvest Offers', key: 'harvest_offers' },
    { label: 'Seed Swaps', key: 'seed_swaps' },
    { label: 'Active Alerts', key: 'active_alerts', alert: true },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {statCards.map(({ label, key, alert }) => {
        const value = stats?.[key];
        const isAlertActive = alert && value != null && value > 0;
        return (
          <div
            key={key}
            className={`rounded-xl border px-4 py-3 flex flex-col items-center justify-center text-center shadow-sm ${
              isAlertActive
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700'
            }`}
          >
            {loading ? (
              <div className="h-7 w-10 bg-earth-100 dark:bg-gray-700 rounded animate-pulse mb-1" />
            ) : (
              <span
                className={`text-2xl font-bold tabular-nums ${
                  isAlertActive
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-earth-900 dark:text-gray-100'
                }`}
              >
                {value ?? '—'}
              </span>
            )}
            <span className={`text-xs font-medium mt-0.5 ${
              isAlertActive
                ? 'text-red-500 dark:text-red-400'
                : 'text-earth-500 dark:text-gray-400'
            }`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sub-Nav ───

const COOP_NAV = [
  { label: 'Board', href: '/coop/board', icon: '🌐' },
  { label: 'Harvest', href: '/coop/harvest', icon: '🧺' },
  { label: 'Seeds', href: '/coop/seeds', icon: '🌰' },
  { label: 'Alerts', href: '/coop/alerts', icon: '⚠️' },
  { label: 'Pair', href: '/coop/pair', icon: '📷' },
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

// ─── Peer List (simplified) ───

function PeerList() {
  const { toast } = useToast();
  const [peers, setPeers] = useState<FederationPeer[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPeers = useCallback(() => {
    setLoading(true);
    getFederationPeers()
      .then((data: FederationPeer[]) => setPeers(Array.isArray(data) ? data.filter((p) => p.status === 'active') : []))
      .catch(() => toast('Could not load peers', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    loadPeers();
  }, [loadPeers]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-10 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (peers.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-earth-500 dark:text-gray-400">No active peers yet.</p>
        <Link
          href="/coop/pair"
          className="inline-block mt-2 text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
        >
          Pair with a garden &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="divide-y divide-earth-50 dark:divide-gray-700/50">
      {peers.map((peer) => (
        <div key={peer.id} className="flex items-center gap-3 py-2.5">
          <SyncHealthDot lastSeen={peer.last_seen} />
          <span className="text-sm font-medium text-earth-900 dark:text-gray-100 flex-1 truncate">
            {peer.display_name}
          </span>
          <span className="text-xs text-earth-400 dark:text-gray-500 shrink-0">
            {formatLastSeen(peer.last_seen)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Community Activity Feed ───

const FEED_TYPE_META: Record<BoardItem['type'], { icon: string; label: string }> = {
  harvest: { icon: '🍅', label: 'Harvest offer' },
  seed_swap: { icon: '🌱', label: 'Seed swap' },
  alert: { icon: '⚠️', label: 'Alert' },
};

function timeAgo(ts: string): string {
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

function CommunityFeed() {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/coop/board')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        // Normalise to a flat list and sort by recency
        const raw: BoardItem[] = Array.isArray(data)
          ? data
          : [
              ...((data.harvest_offers || []) as Omit<BoardItem, 'type'>[]).map((item) => ({ ...item, type: 'harvest' as const })),
              ...((data.seed_swaps || []) as Omit<BoardItem, 'type'>[]).map((item) => ({ ...item, type: 'seed_swap' as const })),
              ...((data.alerts || []) as Omit<BoardItem, 'type'>[]).map((item) => ({ ...item, type: 'alert' as const })),
            ];
        raw.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setItems(raw);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || items.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-2xl mb-2">🌱</p>
        <p className="text-sm text-earth-500 dark:text-gray-400">
          No activity yet — connect to some Co-op peers to see their garden news.
        </p>
        <Link
          href="/coop/pair"
          className="inline-block mt-3 text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
        >
          Pair with a garden &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div className="divide-y divide-earth-50 dark:divide-gray-700/50">
      {items.map((item, idx) => {
        const meta = FEED_TYPE_META[item.type] ?? { icon: '📌', label: item.type };
        return (
          <div key={`${item.type}-${item.id ?? idx}`} className="flex items-start gap-3 py-3">
            <span className="text-xl shrink-0 mt-0.5">{meta.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-earth-900 dark:text-gray-100 truncate">{item.title}</p>
              <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">
                <span className="font-medium text-earth-600 dark:text-gray-300">{item.peer_name}</span>
                {' · '}
                {meta.label}
                {' · '}
                {timeAgo(item.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ───

export default function CoopPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Garden Co-op</h1>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
            See what your garden community is up to.
          </p>
        </div>
        <Link
          href="/settings#coop"
          className="shrink-0 text-xs text-earth-500 dark:text-gray-400 hover:text-garden-600 dark:hover:text-garden-400 transition mt-1"
        >
          Co-op settings &rarr;
        </Link>
      </div>

      <StatsBar />

      <CoopSubNav />

      {/* Community Activity Feed */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-earth-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-earth-100 dark:border-gray-700 flex items-center gap-2.5">
          <span className="text-xl">🌱</span>
          <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100">Community Activity</h2>
        </div>
        <div className="px-5 py-4">
          <CommunityFeed />
        </div>
      </div>

      {/* Connected Peers */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-earth-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-earth-100 dark:border-gray-700 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🤝</span>
            <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100">Connected Gardens</h2>
          </div>
          <Link
            href="/coop/pair"
            className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium"
          >
            + Pair
          </Link>
        </div>
        <div className="px-5 py-4">
          <PeerList />
        </div>
      </div>
    </div>
  );
}
