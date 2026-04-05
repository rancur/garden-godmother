'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  getFederationPeers,
  getFederationStats,
  getCoopSummary,
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

interface CoopSummary {
  active_peers: number;
  peer_names: string[];
  harvest_offers: number;
  seed_swaps: number;
  pest_alerts_week: number;
  my_contributions: number;
  recent_alerts: number;
  my_active_offers: number;
}

interface BoardItem {
  id: string | number;
  type: 'harvest' | 'seed_swap' | 'alert' | 'tip';
  peer_name: string;
  title: string;
  created_at: string;
  alert_type?: string;
  is_mine?: boolean;
  view_count?: number;
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

// ─── Co-op Stats Header (collapsible) ───

const STATS_STORAGE_KEY = 'coop-stats-expanded';

function CoopStatsHeader() {
  const [summary, setSummary] = useState<CoopSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STATS_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  useEffect(() => {
    getCoopSummary()
      .then((data) => setSummary(data))
      .catch(() => {/* silently ignore */})
      .finally(() => setLoading(false));
  }, []);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(STATS_STORAGE_KEY, String(next));
  };

  const statItems: { label: string; value: React.ReactNode; alert?: boolean; sub?: string }[] = summary
    ? [
        {
          label: 'Connected Peers',
          value: summary.active_peers,
          sub: summary.peer_names.length > 0 ? summary.peer_names.slice(0, 3).join(', ') + (summary.peer_names.length > 3 ? ` +${summary.peer_names.length - 3}` : '') : undefined,
        },
        { label: 'Harvest Offers', value: summary.harvest_offers },
        { label: 'Seed Swaps', value: summary.seed_swaps },
        {
          label: 'Pest Alerts (7d)',
          value: summary.pest_alerts_week,
          alert: summary.pest_alerts_week > 0,
        },
        { label: 'My Contributions', value: summary.my_contributions },
      ]
    : [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-earth-50 dark:hover:bg-gray-700/40 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xl">📊</span>
          <h2 className="text-base font-semibold text-earth-900 dark:text-gray-100">Co-op Network Stats</h2>
          {!loading && summary && summary.pest_alerts_week > 0 && (
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-full">
              {summary.pest_alerts_week} alert{summary.pest_alerts_week !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-earth-400 dark:text-gray-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-earth-100 dark:border-gray-700 px-5 py-4">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-earth-100 dark:bg-gray-700 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {statItems.map(({ label, value, alert, sub }) => (
                <div
                  key={label}
                  className={`rounded-xl border px-3 py-3 flex flex-col items-center justify-center text-center shadow-sm ${
                    alert
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      : 'bg-earth-50 dark:bg-gray-700/50 border-earth-100 dark:border-gray-600'
                  }`}
                >
                  <span
                    className={`text-2xl font-bold tabular-nums ${
                      alert ? 'text-red-600 dark:text-red-400' : 'text-earth-900 dark:text-gray-100'
                    }`}
                  >
                    {value ?? '—'}
                  </span>
                  <span className={`text-xs font-medium mt-0.5 ${alert ? 'text-red-500 dark:text-red-400' : 'text-earth-500 dark:text-gray-400'}`}>
                    {label}
                  </span>
                  {sub && (
                    <span className="text-xs text-earth-400 dark:text-gray-500 mt-0.5 truncate w-full text-center" title={sub}>
                      {sub}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-earth-500 dark:text-gray-400 text-center py-2">Could not load stats.</p>
          )}
        </div>
      )}
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
    <nav className="flex gap-1 p-1 bg-earth-100 dark:bg-gray-800 rounded-xl overflow-x-auto scrollbar-none">
      {COOP_NAV.map(({ label, href, icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
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

type FeedFilter = 'all' | 'harvest' | 'seed_swap' | 'alert' | 'tip';

const FILTER_TABS: { key: FeedFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: '🌱' },
  { key: 'harvest', label: 'Surplus', icon: '🍅' },
  { key: 'seed_swap', label: 'Swaps', icon: '🌰' },
  { key: 'alert', label: 'Alerts', icon: '⚠️' },
  { key: 'tip', label: 'Tips', icon: '💡' },
];

const FEED_TYPE_META: Record<BoardItem['type'], { icon: string; label: string }> = {
  harvest: { icon: '🍅', label: 'Harvest offer' },
  seed_swap: { icon: '🌱', label: 'Seed swap' },
  alert: { icon: '⚠️', label: 'Alert' },
  tip: { icon: '💡', label: 'Tip' },
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
  const [filter, setFilter] = useState<FeedFilter>('all');

  useEffect(() => {
    fetch('/api/coop/board')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const raw: BoardItem[] = Array.isArray(data)
          ? data
          : [
              ...((data.harvest_offers || []) as Omit<BoardItem, 'type'>[]).map((item) => ({ ...item, type: 'harvest' as const })),
              ...((data.seed_swaps || []) as Omit<BoardItem, 'type'>[]).map((item) => ({ ...item, type: 'seed_swap' as const })),
              ...((data.alerts || []) as (Omit<BoardItem, 'type'> & { alert_type?: string; is_mine?: boolean; view_count?: number })[]).map((item) => ({
                ...item,
                type: (item.alert_type === 'info' || item.alert_type === 'tip') ? 'tip' as const : 'alert' as const,
              })),
            ];
        raw.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setItems(raw);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? items : items.filter((item) => item.type === filter);

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
    <div>
      {/* Filter tabs — horizontally scrollable on mobile */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-3 mb-1 -mx-5 px-5">
        {FILTER_TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] shrink-0 ${
              filter === key
                ? 'bg-garden-600 dark:bg-garden-500 text-white shadow-sm'
                : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600'
            }`}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-earth-500 dark:text-gray-400">No {filter} items in the feed.</p>
        </div>
      ) : (
        <div className="divide-y divide-earth-50 dark:divide-gray-700/50">
          {filtered.map((item, idx) => {
            const meta = FEED_TYPE_META[item.type] ?? { icon: '📌', label: item.type };
            const showViewCount = item.is_mine && (item.type === 'alert' || item.type === 'tip') && item.view_count !== undefined;
            return (
              <div key={`${item.type}-${item.id ?? idx}`} className="flex items-start gap-3 py-3 w-full">
                <span className="text-xl shrink-0 mt-0.5">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-earth-900 dark:text-gray-100 truncate">{item.title}</p>
                  <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5 flex flex-wrap items-center gap-1">
                    <span className="font-medium text-earth-600 dark:text-gray-300">{item.peer_name}</span>
                    <span>&middot;</span>
                    <span>{meta.label}</span>
                    <span>&middot;</span>
                    <span>{timeAgo(item.created_at)}</span>
                    {showViewCount && (
                      <>
                        <span>&middot;</span>
                        <span className="inline-flex items-center gap-0.5 text-earth-400 dark:text-gray-500">
                          <span>👁</span>
                          <span>Seen by {item.view_count} peer{item.view_count !== 1 ? 's' : ''}</span>
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ───

export default function CoopPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4 mb-1">
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

      {/* Collapsible Stats Header */}
      <CoopStatsHeader />

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
            className="text-xs text-garden-600 dark:text-garden-400 hover:underline font-medium min-h-[44px] flex items-center"
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
