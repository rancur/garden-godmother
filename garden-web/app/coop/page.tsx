'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  getFederationIdentity,
  setupFederationIdentity,
  createFederationInvite,
  connectToPeer,
  getFederationPeers,
  updateFederationPeer,
  deleteFederationPeer,
  getFederationPrefs,
  updateFederationPrefs,
  syncFederationPeer,
} from '../api';
import { useToast } from '../toast';

// ─── Types ───

interface FederationIdentity {
  configured: boolean;
  instance_id?: string;
  display_name?: string;
  instance_url?: string;
  key_fingerprint?: string;
}

interface FederationInvite {
  code: string;
  expires_at: string;
  pair_url: string;
}

interface FederationPeer {
  id: number;
  peer_id: string;
  display_name: string;
  peer_url: string;
  status: 'pending' | 'active' | 'blocked';
  last_seen: string | null;
  transport: string;
}

interface FederationPrefs {
  share_plant_list: boolean;
  share_harvest_offers: boolean;
  share_seed_swaps: boolean;
  share_journal_public: boolean;
  share_alerts: boolean;
}

// ─── Reusable Components ───

function Card({
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

function Button({
  onClick,
  variant = 'primary',
  loading,
  disabled,
  children,
  size = 'md',
}: {
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'warning';
  loading?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  const base =
    size === 'sm'
      ? 'px-3 py-1.5 text-xs font-medium rounded-md transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed'
      : 'px-4 py-2 text-sm font-medium rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-garden-600 text-white hover:bg-garden-700',
    secondary:
      'bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    warning: 'bg-yellow-500 text-white hover:bg-yellow-600',
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

function StatusBadge({ status }: { status: FederationPeer['status'] }) {
  const styles = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    active: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    blocked: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-garden-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-garden-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement('input');
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border border-earth-200 dark:border-gray-700 rounded-lg bg-earth-50 dark:bg-gray-900/40">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-earth-500 dark:text-gray-400 mb-0.5">{label}</p>
        <p className="text-sm font-mono text-earth-800 dark:text-gray-200 truncate">{value}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition whitespace-nowrap ${
          copied
            ? 'bg-green-600 text-white'
            : 'bg-garden-600 text-white hover:bg-garden-700'
        }`}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-8 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
      <div className="h-6 w-2/3 bg-earth-100 dark:bg-gray-700 rounded animate-pulse" />
      <div className="h-6 w-1/2 bg-earth-100 dark:bg-gray-700 rounded animate-pulse" />
    </div>
  );
}

function formatLastSeen(ts: string | null): string {
  if (!ts) return 'Never';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ─── Section: Identity ───

function IdentitySection() {
  const { toast } = useToast();
  const [identity, setIdentity] = useState<FederationIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ display_name: '', instance_url: '', coarse_location: '' });

  useEffect(() => {
    getFederationIdentity()
      .then((data: FederationIdentity) => {
        setIdentity(data);
        if (!data.configured) {
          setForm((f) => ({
            ...f,
            instance_url: typeof window !== 'undefined' ? window.location.origin : '',
          }));
        }
      })
      .catch(() => toast({ title: 'Could not load identity', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, []);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.display_name.trim()) {
      toast({ title: 'Display name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const data = await setupFederationIdentity({
        display_name: form.display_name.trim(),
        instance_url: form.instance_url.trim() || undefined,
        coarse_location: form.coarse_location.trim() || undefined,
      });
      setIdentity(data);
      toast({ title: 'Garden identity configured!' });
    } catch {
      toast({ title: 'Setup failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSkeleton />;

  if (!identity?.configured) {
    return (
      <form onSubmit={handleSetup} className="space-y-4">
        <p className="text-sm text-earth-600 dark:text-gray-400">
          Set up your garden identity to share and connect with other gardens.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">
              Display Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Sunny Acre Garden"
              value={form.display_name}
              onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">
              Instance URL
            </label>
            <input
              type="url"
              placeholder="https://yourgarden.example.com"
              value={form.instance_url}
              onChange={(e) => setForm((f) => ({ ...f, instance_url: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">
              Coarse Location <span className="text-earth-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Phoenix, AZ"
              value={form.coarse_location}
              onChange={(e) => setForm((f) => ({ ...f, coarse_location: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" loading={saving}>
            Set Up Identity
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
          Configured
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-2 border-b border-earth-50 dark:border-gray-700/50">
          <span className="text-sm font-medium text-earth-600 dark:text-gray-400 sm:w-40 shrink-0">Display Name</span>
          <span className="text-sm text-earth-900 dark:text-gray-100">{identity.display_name}</span>
        </div>
        {identity.instance_url && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-2 border-b border-earth-50 dark:border-gray-700/50">
            <span className="text-sm font-medium text-earth-600 dark:text-gray-400 sm:w-40 shrink-0">Instance URL</span>
            <span className="text-sm text-earth-900 dark:text-gray-100 break-all">{identity.instance_url}</span>
          </div>
        )}
        {identity.key_fingerprint && (
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 py-2">
            <span className="text-sm font-medium text-earth-600 dark:text-gray-400 sm:w-40 shrink-0 mt-0.5">Key Fingerprint</span>
            <span className="text-xs font-mono text-earth-700 dark:text-gray-300 break-all bg-earth-50 dark:bg-gray-900/40 px-2 py-1 rounded">
              {identity.key_fingerprint}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section: Connections ───

function ConnectionsSection() {
  const { toast } = useToast();
  const [peers, setPeers] = useState<FederationPeer[]>([]);
  const [loadingPeers, setLoadingPeers] = useState(true);
  const [invite, setInvite] = useState<FederationInvite | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [connectForm, setConnectForm] = useState({ peer_url: '', invite_code: '' });
  const [connecting, setConnecting] = useState(false);
  const [peerActions, setPeerActions] = useState<Record<number, string>>({});

  const loadPeers = useCallback(() => {
    setLoadingPeers(true);
    getFederationPeers()
      .then((data: FederationPeer[]) => setPeers(data))
      .catch(() => toast({ title: 'Could not load connections', variant: 'destructive' }))
      .finally(() => setLoadingPeers(false));
  }, []);

  useEffect(() => {
    loadPeers();
  }, [loadPeers]);

  const handleInvite = async () => {
    setInviteLoading(true);
    try {
      const data = await createFederationInvite();
      setInvite(data);
    } catch {
      toast({ title: 'Could not create invite', variant: 'destructive' });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectForm.peer_url.trim() || !connectForm.invite_code.trim()) {
      toast({ title: 'Peer URL and invite code are required', variant: 'destructive' });
      return;
    }
    setConnecting(true);
    try {
      await connectToPeer({ peer_url: connectForm.peer_url.trim(), invite_code: connectForm.invite_code.trim() });
      setConnectForm({ peer_url: '', invite_code: '' });
      toast({ title: 'Connection request sent!' });
      loadPeers();
    } catch {
      toast({ title: 'Could not connect', variant: 'destructive' });
    } finally {
      setConnecting(false);
    }
  };

  const setPeerAction = (id: number, action: string) =>
    setPeerActions((prev) => ({ ...prev, [id]: action }));
  const clearPeerAction = (id: number) =>
    setPeerActions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handlePeerUpdate = async (id: number, data: { status?: string; display_name?: string }) => {
    setPeerAction(id, 'update');
    try {
      await updateFederationPeer(id, data);
      loadPeers();
    } catch {
      toast({ title: 'Update failed', variant: 'destructive' });
    } finally {
      clearPeerAction(id);
    }
  };

  const handlePeerDelete = async (id: number) => {
    setPeerAction(id, 'delete');
    try {
      await deleteFederationPeer(id);
      setPeers((prev) => prev.filter((p) => p.id !== id));
      toast({ title: 'Connection removed' });
    } catch {
      toast({ title: 'Could not remove connection', variant: 'destructive' });
    } finally {
      clearPeerAction(id);
    }
  };

  const handlePeerSync = async (id: number) => {
    setPeerAction(id, 'sync');
    try {
      await syncFederationPeer(id);
      toast({ title: 'Sync initiated' });
      loadPeers();
    } catch {
      toast({ title: 'Sync failed', variant: 'destructive' });
    } finally {
      clearPeerAction(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Invite */}
      <div>
        <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200 mb-2">Invite Someone</h3>
        <Button variant="secondary" onClick={handleInvite} loading={inviteLoading}>
          Generate Invite
        </Button>
        {invite && (
          <div className="mt-3 space-y-2">
            <CopyBox label="Invite Code" value={invite.code} />
            <CopyBox label="Shareable URL" value={invite.pair_url} />
            <p className="text-xs text-earth-500 dark:text-gray-400">
              Expires: {new Date(invite.expires_at).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      {/* Connect */}
      <div>
        <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200 mb-2">Connect to a Garden</h3>
        <form onSubmit={handleConnect} className="space-y-3">
          <input
            type="url"
            placeholder="Peer URL (e.g. https://theirgarden.example.com)"
            value={connectForm.peer_url}
            onChange={(e) => setConnectForm((f) => ({ ...f, peer_url: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
          />
          <input
            type="text"
            placeholder="Invite Code"
            value={connectForm.invite_code}
            onChange={(e) => setConnectForm((f) => ({ ...f, invite_code: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
          />
          <div className="flex justify-end">
            <Button variant="primary" loading={connecting}>
              Connect
            </Button>
          </div>
        </form>
      </div>

      {/* Peer List */}
      <div>
        <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200 mb-2">Connected Gardens</h3>
        {loadingPeers ? (
          <LoadingSkeleton />
        ) : peers.length === 0 ? (
          <p className="text-sm text-earth-500 dark:text-gray-400">No connections yet.</p>
        ) : (
          <div className="space-y-3">
            {peers.map((peer) => {
              const actionKey = peerActions[peer.id];
              return (
                <div
                  key={peer.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border border-earth-200 dark:border-gray-700 rounded-lg bg-earth-50 dark:bg-gray-900/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-earth-900 dark:text-gray-100">
                        {peer.display_name}
                      </span>
                      <StatusBadge status={peer.status} />
                    </div>
                    <p className="text-xs text-earth-500 dark:text-gray-400 truncate mt-0.5">{peer.peer_url}</p>
                    <p className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
                      Last seen: {formatLastSeen(peer.last_seen)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {peer.status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={actionKey === 'update'}
                          onClick={() => handlePeerUpdate(peer.id, { status: 'active' })}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={actionKey === 'update'}
                          onClick={() => handlePeerUpdate(peer.id, { status: 'blocked' })}
                        >
                          Block
                        </Button>
                      </>
                    )}
                    {peer.status === 'active' && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={actionKey === 'sync'}
                          onClick={() => handlePeerSync(peer.id)}
                        >
                          Sync
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={actionKey === 'delete'}
                          onClick={() => handlePeerDelete(peer.id)}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                    {peer.status === 'blocked' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={actionKey === 'delete'}
                        onClick={() => handlePeerDelete(peer.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section: Sharing Settings ───

const PREF_LABELS: { key: keyof FederationPrefs; label: string; description: string }[] = [
  { key: 'share_plant_list', label: 'Share my plant list', description: 'Let connected gardens see what you\'re growing' },
  { key: 'share_harvest_offers', label: 'Share harvest offers', description: 'Advertise surplus harvests to connected gardens' },
  { key: 'share_seed_swaps', label: 'Share seed swaps', description: 'Post seeds available for exchange' },
  { key: 'share_journal_public', label: 'Share public journal entries', description: 'Share journal entries marked as public' },
  { key: 'share_alerts', label: 'Share pest/weather alerts', description: 'Broadcast local pest and weather warnings' },
];

function SharingSection() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<FederationPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<keyof FederationPrefs | null>(null);

  useEffect(() => {
    getFederationPrefs()
      .then((data: FederationPrefs) => setPrefs(data))
      .catch(() => toast({ title: 'Could not load sharing settings', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (key: keyof FederationPrefs) => {
    if (!prefs || saving) return;
    const newVal = !prefs[key];
    setPrefs((p) => p ? { ...p, [key]: newVal } : p);
    setSaving(key);
    try {
      await updateFederationPrefs({ [key]: newVal });
    } catch {
      setPrefs((p) => p ? { ...p, [key]: !newVal } : p);
      toast({ title: 'Could not update setting', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingSkeleton />;

  if (!prefs) {
    return (
      <p className="text-sm text-earth-500 dark:text-gray-400">Could not load sharing preferences.</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 divide-y divide-earth-50 dark:divide-gray-700/50">
        {PREF_LABELS.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between gap-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-earth-800 dark:text-gray-200">{label}</p>
              <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{description}</p>
            </div>
            <Toggle
              checked={prefs[key]}
              onChange={() => handleToggle(key)}
              disabled={saving === key}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 rounded-lg bg-earth-50 dark:bg-gray-900/30 border border-earth-100 dark:border-gray-700">
        <p className="text-xs text-earth-500 dark:text-gray-400 leading-relaxed">
          All sharing is opt-in. Your exact location, photos, sensor data, and passwords are never shared.
        </p>
      </div>
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

// ─── Page ───

export default function CoopPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Garden Co-op</h1>
        <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
          Connect and share with other gardens in your federation.
        </p>
      </div>

      <CoopSubNav />

      <Card title="Your Garden Identity" icon="🌱">
        <IdentitySection />
      </Card>

      <Card title="Connections" icon="🤝">
        <ConnectionsSection />
      </Card>

      <Card title="Sharing Settings" icon="🔗">
        <SharingSection />
      </Card>
    </div>
  );
}
