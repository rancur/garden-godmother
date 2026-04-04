'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  getFederationAlerts,
  createFederationAlert,
  deleteFederationAlert,
} from '../../api';
import { useToast } from '../../toast';

// ─── Types ───

interface FederationAlert {
  id: number;
  source: 'local' | string; // 'local' = ours, otherwise peer display_name
  alert_type: string;
  title: string;
  body: string;
  severity: 'urgent' | 'warning' | 'info';
  affects_plants?: string[];
  published: boolean;
  expires_at?: string;
  created_at: string;
}

// ─── Sub-Nav ───

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

// ─── Shared Components ───

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

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition';

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

// ─── New Alert Form ───

interface NewAlertForm {
  alert_type: string;
  title: string;
  body: string;
  severity: string;
  affects_plants: string;
  expires_at: string;
  published: boolean;
}

const ALERT_TYPES = ['pest', 'weather', 'disease', 'general'];
const SEVERITIES = ['info', 'warning', 'urgent'];

function NewAlertFormSection({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewAlertForm>({
    alert_type: 'general',
    title: '',
    body: '',
    severity: 'info',
    affects_plants: '',
    expires_at: '',
    published: false,
  });

  const setField = <K extends keyof NewAlertForm>(key: K, val: NewAlertForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: 'Title and body are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const plants = form.affects_plants
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    try {
      await createFederationAlert({
        alert_type: form.alert_type,
        title: form.title.trim(),
        body: form.body.trim(),
        severity: form.severity,
        affects_plants: plants.length > 0 ? plants : undefined,
        published: form.published,
        expires_at: form.expires_at || undefined,
      });
      toast({ title: 'Alert created!' });
      setForm({
        alert_type: 'general',
        title: '',
        body: '',
        severity: 'info',
        affects_plants: '',
        expires_at: '',
        published: false,
      });
      setOpen(false);
      onCreated();
    } catch {
      toast({ title: 'Could not create alert', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition shadow-sm"
        >
          <span>+</span> New Alert
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 p-4 rounded-lg border border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900/30">
          <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200">New Alert</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">Type</label>
              <select
                value={form.alert_type}
                onChange={(e) => setField('alert_type', e.target.value)}
                className={INPUT_CLASS}
              >
                {ALERT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">Severity</label>
              <select
                value={form.severity}
                onChange={(e) => setField('severity', e.target.value)}
                className={INPUT_CLASS}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Aphid outbreak on north side"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
              Body <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              placeholder="Describe the alert in detail..."
              value={form.body}
              onChange={(e) => setField('body', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
                Affects Plants{' '}
                <span className="text-earth-400 dark:text-gray-500 font-normal">(comma-separated, optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Tomatoes, Peppers"
                value={form.affects_plants}
                onChange={(e) => setField('affects_plants', e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
                Expires At <span className="text-earth-400 dark:text-gray-500 font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setField('expires_at', e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Toggle checked={form.published} onChange={(v) => setField('published', v)} />
              <span className="text-sm text-earth-700 dark:text-gray-300">Share with co-op</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-garden-600 text-white hover:bg-garden-700 transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Create Alert'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Alert Row ───

function AlertRow({
  alert,
  onDeleted,
}: {
  alert: FederationAlert;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const isLocal = alert.source === 'local';

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteFederationAlert(alert.id);
      toast({ title: 'Alert deleted' });
      onDeleted();
    } catch {
      toast({ title: 'Could not delete alert', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className={`p-4 rounded-lg border ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
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
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-earth-100 dark:bg-gray-700 text-earth-500 dark:text-gray-400">
              {isLocal ? 'Local' : alert.source}
            </span>
            {alert.published && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-garden-100 text-garden-800 dark:bg-garden-900/40 dark:text-garden-300">
                Shared
              </span>
            )}
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
            <p className="text-xs text-earth-400 dark:text-gray-500 mt-1.5">
              Expires: {new Date(alert.expires_at).toLocaleDateString()}
            </p>
          )}
        </div>
        {isLocal && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
          >
            {deleting ? '...' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ───

export default function AlertsPage() {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<FederationAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getFederationAlerts()
      .then((data: FederationAlert[]) => setAlerts(data))
      .catch(() => toast({ title: 'Could not load alerts', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Sort: urgent first, then warning, then info; local before peer within same severity
  const sorted = [...alerts].sort((a, b) => {
    const order = { urgent: 0, warning: 1, info: 2 };
    const sev = (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    if (sev !== 0) return sev;
    if (a.source === 'local' && b.source !== 'local') return -1;
    if (a.source !== 'local' && b.source === 'local') return 1;
    return 0;
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Garden Co-op</h1>
        <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
          Connect and share with other gardens in your federation.
        </p>
      </div>

      <CoopSubNav />

      <Card title="Alerts" icon="⚠️">
        <div className="space-y-4">
          <NewAlertFormSection onCreated={load} />

          {loading ? (
            <LoadingSkeleton />
          ) : sorted.length === 0 ? (
            <p className="text-sm text-earth-500 dark:text-gray-400 py-4 text-center">
              No alerts yet. Create one to notify the co-op.
            </p>
          ) : (
            <div className="space-y-3">
              {sorted.map((alert) => (
                <AlertRow key={alert.id} alert={alert} onDeleted={load} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
