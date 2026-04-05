'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  getSettings,
  updateProperty,
  getExportUrl,
  getCalendarIcalUrl,
  getSensorWeather,
  getSensorRachio,
  getIrrigationZones,
  generateTasks,
  getTasks,
  geocodeAddress,
  getFrostDates,
  getSoilTypes,
  getBackups,
  createBackup,
  restoreBackup,
  getBackupDownloadUrl,
  deleteBackup,
  getUpdateStatus,
  getMeshtasticStatus,
  getFederationIdentity,
  setupFederationIdentity,
  getFederationPrefs,
  updateFederationPrefs,
  getFederationPeers,
  pairFromQr,
  API_URL,
} from '../api';
import { useToast } from '../toast';
import { useModal } from '../confirm-modal';
import { setGardenTimezone, getGardenToday, getGardenYear, formatGardenDateTime } from '../timezone';

// ─── Types ───

interface SettingsData {
  property: {
    id: number;
    name: string;
    width_feet: number;
    height_feet: number;
    orientation_degrees: number;
    latitude: number;
    longitude: number;
    address: string | null;
    default_soil_type: string | null;
    default_soil_ph: number | null;
    default_soil_notes: string | null;
    last_frost_spring: string | null;
    first_frost_fall: string | null;
    frost_free_days: number | null;
    timezone: string | null;
  };
  soil_profile: {
    default_soil: string;
    default_ph: number;
    location: string;
    characteristics: string[];
    challenges: string[];
    notes?: string;
  };
  rachio_status: {
    connected: boolean;
    controller: string | null;
    zones: number;
    valves: number;
  };
  weather_status: {
    connected: boolean;
    station: string | null;
    condition: string | null;
    temperature: number | null;
    humidity: number | null;
  };
  database_stats: {
    plants: number;
    varieties: number;
    enriched: number;
    planters: number;
    ground_plants: number;
    trays: number;
    journal_entries: number;
    harvests: number;
    tasks: number;
    expenses: number;
    photos: number;
  };
  version: string;
}

type ThemeMode = 'light' | 'dark' | 'system';
type FontSize = 'small' | 'medium' | 'large';
type Spacing = 'compact' | 'comfortable';
type TempUnit = 'F' | 'C';

interface IrrigationZone {
  zone_name: string;
  zone_number?: number;
  enabled?: boolean;
  planters?: string[];
  beds?: string[];
}

// ─── USDA Zones ───

const USDA_ZONES = [
  '1a','1b','2a','2b','3a','3b','4a','4b','5a','5b',
  '6a','6b','7a','7b','8a','8b','9a','9b','10a','10b',
  '11a','11b','12a','12b','13a','13b',
];

/** Estimate USDA zone from latitude/longitude (US-centric approximation) */
function estimateUsdaZone(lat: number, lon: number): string {
  // Special-case known metro areas in AZ
  if (lat >= 33.0 && lat <= 34.0 && lon >= -112.5 && lon <= -111.5) return '9b'; // Phoenix
  if (lat >= 32.0 && lat <= 33.0 && lon >= -111.5 && lon <= -110.5) return '9a'; // Tucson
  if (lat >= 34.5 && lat <= 35.5 && lon >= -112.0 && lon <= -111.0) return '6a'; // Flagstaff

  // General US latitude-based approximation
  if (lat >= 48) return '3b';
  if (lat >= 46) return '4a';
  if (lat >= 44) return '4b';
  if (lat >= 42) return '5a';
  if (lat >= 40) return '5b';
  if (lat >= 38) return '6a';
  if (lat >= 36) return '6b';
  if (lat >= 34) return '7a';
  if (lat >= 32) return '8a';
  if (lat >= 30) return '9a';
  if (lat >= 28) return '9b';
  if (lat >= 26) return '10a';
  if (lat >= 24) return '10b';
  return '11a';
}

/** Pick a default soil type based on lat/lon */
function estimateSoilType(lat: number, lon: number): string {
  // Arizona / desert southwest
  if (lat >= 31 && lat <= 37 && lon >= -115 && lon <= -109) return 'native_ground';
  return 'native_ground';
}

/** Format MM-DD as human-readable date string (e.g., "Jan 26") */
function formatFrostDate(mmdd: string): string {
  if (!mmdd) return '--';
  const [mm, dd] = mmdd.split('-').map(Number);
  if (!mm || !dd) return mmdd;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[mm - 1]} ${dd}`;
}

// ─── Reusable Components ───

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
        connected
          ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
          : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
      }`}
      title={connected ? 'Connected' : 'Disconnected'}
    />
  );
}

function SettingsCard({
  id,
  title,
  icon,
  children,
  danger,
}: {
  id?: string;
  title: string;
  icon: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      id={id}
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden scroll-mt-20 transition-all duration-200 ${
        danger
          ? 'border-2 border-red-300 dark:border-red-700'
          : 'border border-earth-200 dark:border-gray-700'
      }`}
    >
      <div
        className={`px-5 py-4 border-b flex items-center gap-2.5 ${
          danger
            ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
            : 'border-earth-100 dark:border-gray-700'
        }`}
      >
        <span className="text-xl">{icon}</span>
        <h2
          className={`text-lg font-semibold ${
            danger ? 'text-red-700 dark:text-red-300' : 'text-earth-900 dark:text-gray-100'
          }`}
        >
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-2.5 border-b border-earth-50 dark:border-gray-700/50 last:border-0">
      <label className="text-sm font-medium text-earth-600 dark:text-gray-400 sm:w-48 shrink-0">
        {label}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function InlineInput({
  value,
  onSave,
  type = 'text',
  placeholder,
  className = '',
}: {
  value: string | number | null;
  onSave: (val: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  const [localVal, setLocalVal] = useState(String(value ?? ''));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLocalVal(String(value ?? ''));
    setDirty(false);
  }, [value]);

  const handleBlur = () => {
    if (dirty && localVal !== String(value ?? '')) {
      onSave(localVal);
      setDirty(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type={type}
      value={localVal}
      onChange={(e) => {
        setLocalVal(e.target.value);
        setDirty(true);
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={`w-full px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition ${className}`}
    />
  );
}

function StatItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center p-3">
      <div className="text-2xl font-bold text-garden-600 dark:text-garden-400">{value}</div>
      <div className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg border transition ${
        active
          ? 'bg-garden-600 text-white border-garden-600 shadow-sm'
          : 'bg-earth-50 dark:bg-gray-700 text-earth-700 dark:text-gray-300 border-earth-200 dark:border-gray-600 hover:bg-earth-100 dark:hover:bg-gray-600'
      }`}
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick,
  variant = 'primary',
  loading,
  disabled,
  children,
}: {
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const base = 'px-4 py-2 text-sm font-medium rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-garden-600 text-white hover:bg-garden-700',
    secondary: 'bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${variants[variant]}`}>
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Working...
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Auto-populated field with override pattern.
 * Shows the auto value with "(auto)" label and an "Override" link.
 * When overriding, shows an input and a "Reset to auto" link.
 */
function AutoField({
  autoValue,
  displayValue,
  customValue,
  onCustomChange,
  onReset,
  type = 'text',
  placeholder,
}: {
  autoValue: string | null;
  displayValue?: string;
  customValue: string | null;
  onCustomChange: (val: string) => void;
  onReset: () => void;
  type?: string;
  placeholder?: string;
}) {
  const [overriding, setOverriding] = useState(!!customValue);
  const isCustom = overriding && customValue !== null && customValue !== '';

  useEffect(() => {
    if (customValue !== null && customValue !== '') {
      setOverriding(true);
    }
  }, [customValue]);

  if (!overriding) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-earth-800 dark:text-gray-200 font-medium">
          {displayValue || autoValue || '--'}
        </span>
        {autoValue && (
          <span className="text-xs text-garden-600 dark:text-garden-400">(auto)</span>
        )}
        <button
          onClick={() => setOverriding(true)}
          className="text-xs text-earth-500 dark:text-gray-400 hover:text-garden-600 dark:hover:text-garden-400 underline underline-offset-2 transition"
        >
          Override
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type={type}
        value={customValue ?? autoValue ?? ''}
        onChange={(e) => onCustomChange(e.target.value)}
        placeholder={placeholder}
        className="px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
      />
      {isCustom && (
        <span className="text-xs text-amber-600 dark:text-amber-400">(custom)</span>
      )}
      <button
        onClick={() => {
          setOverriding(false);
          onReset();
        }}
        className="text-xs text-earth-500 dark:text-gray-400 hover:text-garden-600 dark:hover:text-garden-400 underline underline-offset-2 transition"
      >
        Reset to auto
      </button>
    </div>
  );
}

function Expandable({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-earth-100 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50 transition"
      >
        {title}
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`transition-all duration-200 overflow-hidden ${
          open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pb-3 pt-1">{children}</div>
      </div>
    </div>
  );
}

// ─── Helpers ───

function toC(f: number): number {
  return (f - 32) * 5 / 9;
}

function formatTemp(value: number | null, unit: TempUnit): string {
  if (value === null) return '--';
  const display = unit === 'C' ? toC(value) : value;
  return `${Math.round(display)}`;
}

// ─── Mesh Network Card ───

function MeshNetworkCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{ connected: boolean; hostname?: string; serial_port?: string; channel_name?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMeshtasticStatus()
      .then((data: { connected: boolean; hostname?: string; serial_port?: string; channel_name?: string }) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-earth-600 dark:text-gray-400">
          Connect your Meshtastic LoRa node to broadcast garden data over radio mesh.
        </p>
        <div className="mt-2 flex items-center gap-2">
          {loading ? (
            <span className="inline-block w-20 h-5 bg-earth-100 dark:bg-gray-700 rounded-full animate-pulse" />
          ) : status?.connected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
              {status.channel_name && <span className="ml-1 font-normal opacity-80">&#x2022; {status.channel_name}</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-earth-100 text-earth-600 dark:bg-gray-700 dark:text-gray-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-earth-400 dark:bg-gray-500" />
              Not connected
            </span>
          )}
        </div>
      </div>
      <Link
        href="/settings/meshtastic"
        className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition shadow-sm shrink-0"
      >
        Configure &rarr;
      </Link>
    </div>
  );
}

// ─── Co-op Settings Card ───

interface CoopFederationIdentity {
  configured: boolean;
  display_name?: string;
  instance_url?: string;
  key_fingerprint?: string;
}

interface CoopFederationPrefs {
  share_plant_list: boolean;
  share_harvest_offers: boolean;
  share_seed_swaps: boolean;
  share_journal_public: boolean;
  share_alerts: boolean;
}

const COOP_PREF_LABELS: { key: keyof CoopFederationPrefs; label: string; description: string }[] = [
  { key: 'share_plant_list', label: 'Share my plant list', description: "Let connected gardens see what you're growing" },
  { key: 'share_harvest_offers', label: 'Share harvest offers', description: 'Advertise surplus harvests to connected gardens' },
  { key: 'share_seed_swaps', label: 'Share seed swaps', description: 'Post seeds available for exchange' },
  { key: 'share_journal_public', label: 'Share public journal entries', description: 'Share journal entries marked as public' },
  { key: 'share_alerts', label: 'Share pest/weather alerts', description: 'Broadcast local pest and weather warnings' },
];

function CoopSettingsCard() {
  const { toast } = useToast();

  // Identity state
  const [identity, setIdentity] = useState<CoopFederationIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupForm, setSetupForm] = useState({ display_name: '', instance_url: '' });

  // Peers state
  const [peerCount, setPeerCount] = useState<number | null>(null);

  // QR pairing state
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrScanInput, setQrScanInput] = useState('');
  const [qrPairing, setQrPairing] = useState(false);
  const [qrPairInput, setQrPairInput] = useState('');
  const [qrPairLoading, setQrPairLoading] = useState(false);

  // Sharing prefs state
  const [prefs, setPrefs] = useState<CoopFederationPrefs | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [savingPref, setSavingPref] = useState<keyof CoopFederationPrefs | null>(null);

  useEffect(() => {
    getFederationIdentity()
      .then((data: CoopFederationIdentity) => {
        setIdentity(data);
        if (!data.configured) {
          setSetupForm((f) => ({
            ...f,
            instance_url: typeof window !== 'undefined' ? window.location.origin : '',
          }));
        }
      })
      .catch(() => {/* silently skip — coop may not be configured */})
      .finally(() => setIdentityLoading(false));

    getFederationPeers()
      .then((peers: { id: number }[]) => setPeerCount(Array.isArray(peers) ? peers.length : 0))
      .catch(() => setPeerCount(0));

    getFederationPrefs()
      .then((data: CoopFederationPrefs) => setPrefs(data))
      .catch(() => {/* silently skip */})
      .finally(() => setPrefsLoading(false));
  }, []);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupForm.display_name.trim()) {
      toast('Display name is required', 'error');
      return;
    }
    setSetupSaving(true);
    try {
      const data = await setupFederationIdentity({
        display_name: setupForm.display_name.trim(),
        instance_url: setupForm.instance_url.trim() || undefined,
      });
      setIdentity(data as CoopFederationIdentity);
      setShowSetupForm(false);
      toast('Co-op identity configured!', 'success');
    } catch {
      toast('Setup failed', 'error');
    } finally {
      setSetupSaving(false);
    }
  };

  const handlePrefToggle = async (key: keyof CoopFederationPrefs) => {
    if (!prefs || savingPref) return;
    const newVal = !prefs[key];
    setPrefs((p) => p ? { ...p, [key]: newVal } : p);
    setSavingPref(key);
    try {
      await updateFederationPrefs({ [key]: newVal });
    } catch {
      setPrefs((p) => p ? { ...p, [key]: !newVal } : p);
      toast('Could not update setting', 'error');
    } finally {
      setSavingPref(null);
    }
  };

  const handlePairFromQr = async () => {
    const raw = qrPairInput.trim();
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
    setQrPairLoading(true);
    try {
      await pairFromQr({ gg_url: parsed.gg_url, instance_name: parsed.instance_name ?? '', pubkey: parsed.pubkey });
      setQrPairInput('');
      setPeerCount((c) => (c ?? 0) + 1);
      toast('Peer added — waiting for them to accept', 'success');
    } catch {
      toast('Could not add peer from QR', 'error');
    } finally {
      setQrPairLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div>
        <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200 mb-2">Identity</h3>
        {identityLoading ? (
          <div className="h-8 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        ) : identity?.configured ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                Configured
              </span>
              <span className="text-sm text-earth-800 dark:text-gray-200 font-medium">{identity.display_name}</span>
            </div>
            {identity.key_fingerprint && (
              <p className="text-xs font-mono text-earth-500 dark:text-gray-400 break-all mt-1">
                {identity.key_fingerprint}
              </p>
            )}
            <div className="flex items-center gap-4 flex-wrap mt-1">
              <Link
                href="/coop"
                className="text-xs text-garden-600 dark:text-garden-400 hover:underline"
              >
                View Co-op community &rarr;
              </Link>
              <Link
                href="/garden-profile"
                className="text-xs text-garden-600 dark:text-garden-400 hover:underline"
              >
                View public profile &rarr;
              </Link>
            </div>
          </div>
        ) : showSetupForm ? (
          <form onSubmit={handleSetup} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
                Display Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Sunny Acre Garden"
                value={setupForm.display_name}
                onChange={(e) => setSetupForm((f) => ({ ...f, display_name: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
                Instance URL
              </label>
              <input
                type="url"
                placeholder="https://yourgarden.example.com"
                value={setupForm.instance_url}
                onChange={(e) => setSetupForm((f) => ({ ...f, instance_url: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={setupSaving}
                className="px-4 py-1.5 text-sm font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition disabled:opacity-50"
              >
                {setupSaving ? 'Saving...' : 'Set Up Identity'}
              </button>
              <button
                type="button"
                onClick={() => setShowSetupForm(false)}
                className="px-3 py-1.5 text-sm text-earth-500 dark:text-gray-400 hover:text-earth-700 dark:hover:text-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="text-sm text-earth-500 dark:text-gray-400 mb-2">
              Set up your Co-op identity to connect with other growers.
            </p>
            <button
              type="button"
              onClick={() => setShowSetupForm(true)}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition"
            >
              Set Up Identity
            </button>
          </div>
        )}
      </div>

      {/* Peers */}
      <div>
        <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200 mb-2">Peers</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-earth-700 dark:text-gray-300">
            {peerCount === null ? (
              <span className="inline-block w-16 h-4 bg-earth-100 dark:bg-gray-700 rounded animate-pulse" />
            ) : (
              <><span className="font-semibold text-earth-900 dark:text-gray-100">{peerCount}</span> active peer{peerCount !== 1 ? 's' : ''}</>
            )}
          </span>
          <Link
            href="/coop"
            className="text-xs text-garden-600 dark:text-garden-400 hover:underline"
          >
            Manage peers &rarr;
          </Link>
        </div>
      </div>

      {/* Sharing Preferences */}
      <div>
        <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200 mb-2">Sharing Preferences</h3>
        {prefsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-earth-100 dark:bg-gray-700 rounded animate-pulse" />
            ))}
          </div>
        ) : prefs ? (
          <div className="divide-y divide-earth-50 dark:divide-gray-700/50">
            {COOP_PREF_LABELS.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between gap-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-earth-800 dark:text-gray-200">{label}</p>
                  <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs[key]}
                  disabled={savingPref === key}
                  onClick={() => handlePrefToggle(key)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-garden-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    prefs[key] ? 'bg-garden-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                      prefs[key] ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-earth-500 dark:text-gray-400">Co-op not configured.</p>
        )}
      </div>

      {/* Mesh Network */}
      <div>
        <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200 mb-1">Mesh Network</h3>
        <p className="text-xs text-earth-500 dark:text-gray-400 mb-2">
          Send and receive garden alerts over a local Meshtastic mesh radio network.
        </p>
        <Link
          href="/settings/meshtastic"
          className="text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
        >
          Configure Meshtastic &rarr;
        </Link>
      </div>
    </div>
  );
}

// ─── Section Nav ───

const SECTIONS = [
  { id: 'property', label: 'Property' },
  { id: 'irrigation', label: 'Irrigation' },
  { id: 'weather', label: 'Weather' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'calendar-sync', label: 'Calendar' },
  { id: 'data', label: 'Data' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About' },
  { id: 'backups', label: 'Backups' },
  { id: 'updates', label: 'Updates' },
  { id: 'coop', label: 'Co-op' },
  { id: 'danger', label: 'Danger Zone' },
];

// ─── Calendar Sync Section ───

interface IcalFeed {
  type: string;
  url: string;
  name: string;
  description: string;
}

interface IcalData {
  master: { url: string; name: string };
  feeds: IcalFeed[];
  instructions: Record<string, string>;
}

function FeedCopyRow({ label, description, url }: { label: string; description?: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border border-earth-200 dark:border-gray-700 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-earth-800 dark:text-gray-200 truncate">{label}</p>
        {description && <p className="text-xs text-earth-500 dark:text-gray-400 truncate">{description}</p>}
      </div>
      <button
        onClick={handleCopy}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition whitespace-nowrap ${
          copied ? 'bg-green-600 text-white' : 'bg-garden-600 text-white hover:bg-garden-700'
        }`}
      >
        {copied ? 'Copied!' : 'Copy URL'}
      </button>
    </div>
  );
}

function CalendarSyncSection() {
  const [icalData, setIcalData] = useState<IcalData | null>(null);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCalendarIcalUrl()
      .then((data: IcalData) => setIcalData(data))
      .catch(() => setIcalData(null))
      .finally(() => setLoading(false));
  }, []);

  const togglePlatform = (platform: string) => {
    setExpandedPlatform(expandedPlatform === platform ? null : platform);
  };

  const platformIcons: Record<string, string> = {
    google: '\uD83D\uDFE2',
    apple: '\uD83C\uDF4E',
    outlook: '\uD83D\uDCE7',
  };

  const platformNames: Record<string, string> = {
    google: 'Google Calendar',
    apple: 'Apple Calendar',
    outlook: 'Outlook',
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        <div className="h-6 w-48 bg-earth-100 dark:bg-gray-700 rounded animate-pulse" />
      </div>
    );
  }

  if (!icalData) {
    return (
      <p className="text-sm text-earth-500 dark:text-gray-400">
        Unable to load calendar subscription URL. Make sure the API is running.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-earth-500 dark:text-gray-400">
        Subscribe to all garden events or pick individual feeds for your calendar app.
      </p>

      {/* Master feed */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-earth-400 dark:text-gray-500 mb-2">All Events</p>
        <FeedCopyRow label={icalData.master.name} url={icalData.master.url} />
      </div>

      {/* Individual feeds */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-earth-400 dark:text-gray-500 mb-2">Individual Feeds</p>
        <div className="space-y-1.5">
          {icalData.feeds.map((feed) => (
            <FeedCopyRow key={feed.type} label={feed.name} description={feed.description} url={feed.url} />
          ))}
        </div>
      </div>

      {/* Platform instructions */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-earth-400 dark:text-gray-500 mb-2">Setup Instructions</p>
        <div className="space-y-1.5">
          {Object.entries(icalData.instructions).map(([platform, instruction]) => (
            <div key={platform} className="border border-earth-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <button
                onClick={() => togglePlatform(platform)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700/50 transition-colors text-left"
              >
                <span>{platformIcons[platform] || ''}</span>
                <span className="flex-1">{platformNames[platform] || platform}</span>
                <span className={`text-earth-400 dark:text-gray-500 transition-transform ${expandedPlatform === platform ? 'rotate-180' : ''}`}>
                  &#9660;
                </span>
              </button>
              {expandedPlatform === platform && (
                <div className="px-3 pb-3 text-sm text-earth-600 dark:text-gray-400 border-t border-earth-100 dark:border-gray-700/50 pt-2">
                  {instruction}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───

export default function SettingsPage() {
  const { toast } = useToast();
  const { showConfirm } = useModal();

  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Preferences (localStorage)
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [defaultCalView, setDefaultCalView] = useState('personal');
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [spacing, setSpacing] = useState<Spacing>('comfortable');
  const [showWeatherOnDash, setShowWeatherOnDash] = useState(true);
  const [tempUnit, setTempUnit] = useState<TempUnit>('F');
  const [autoGenTasks, setAutoGenTasks] = useState(true);
  const [usdaZone, setUsdaZone] = useState('');
  // firstFrost/lastFrost localStorage values are managed via autoPopulateFromCoords
  const [waterRate, setWaterRate] = useState('');

  // Connection test states
  const [rachioTesting, setRachioTesting] = useState(false);
  const [rachioTestResult, setRachioTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [weatherTesting, setWeatherTesting] = useState(false);
  const [weatherTestResult, setWeatherTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Irrigation zones
  const [irrigationZones, setIrrigationZones] = useState<IrrigationZone[]>([]);

  // Weather detail
  const [weatherDetail, setWeatherDetail] = useState<Record<string, unknown> | null>(null);

  // Task generation
  const [generatingTasks, setGeneratingTasks] = useState(false);

  // Danger zone
  const [resetInput, setResetInput] = useState('');
  const [deletingTasks, setDeletingTasks] = useState(false);
  const [deletingJournal, setDeletingJournal] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);

  // Backups
  const [backups, setBackups] = useState<{ filename: string; size: number; created_at: string }[]>([]);
  const [backupRetention, setBackupRetention] = useState(14);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null);
  const [restoreInput, setRestoreInput] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  // Updates
  const [updateStatus, setUpdateStatus] = useState<{
    current_commit: string | null;
    current_date: string | null;
    remote_commit: string | null;
    remote_date: string | null;
    remote_message: string | null;
    commits_behind: number;
    update_available: boolean;
    auto_update_enabled: boolean;
    last_update_at: string | null;
    last_update_result: string | null;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Auto-populated values and override state
  const [autoUsdaZone, setAutoUsdaZone] = useState<string | null>(null);
  const [customUsdaZone, setCustomUsdaZone] = useState<string | null>(null);
  const [autoLastFrost, setAutoLastFrost] = useState<string | null>(null);
  const [autoFirstFrost, setAutoFirstFrost] = useState<string | null>(null);
  const [customLastFrost, setCustomLastFrost] = useState<string | null>(null);
  const [customFirstFrost, setCustomFirstFrost] = useState<string | null>(null);
  const [autoSoilType, setAutoSoilType] = useState<string | null>(null);
  const [customSoilType, setCustomSoilType] = useState<string | null>(null);
  const [autoPopulating, setAutoPopulating] = useState(false);

  // Address autocomplete
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [addressSearching, setAddressSearching] = useState(false);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressDropdownRef = useRef<HTMLDivElement>(null);

  // Soil type options
  const [soilTypeOptions, setSoilTypeOptions] = useState<{ value: string; label: string; description: string }[]>([]);

  // Frost dates
  const [frostData, setFrostData] = useState<{ last_frost_spring: string; first_frost_fall: string; frost_free_days: number; source: string; confidence: string } | null>(null);

  const sectionNavRef = useRef<HTMLDivElement>(null);

  const autoPopulateFromCoords = useCallback(async (lat: number, lon: number, data: SettingsData) => {
    setAutoPopulating(true);
    try {
      // 1. Estimate USDA zone
      const zone = estimateUsdaZone(lat, lon);
      setAutoUsdaZone(zone);
      // Only set localStorage if no custom override exists
      const storedCustomZone = localStorage.getItem('garden-usda-zone-custom');
      if (!storedCustomZone) {
        setUsdaZone(zone);
        localStorage.setItem('garden-usda-zone', zone);
      } else {
        setCustomUsdaZone(storedCustomZone);
        setUsdaZone(storedCustomZone);
      }

      // 2. Estimate soil type
      const soil = estimateSoilType(lat, lon);
      setAutoSoilType(soil);
      const storedCustomSoil = localStorage.getItem('garden-soil-type-custom');
      if (storedCustomSoil) {
        setCustomSoilType(storedCustomSoil);
      } else if (!data.property?.default_soil_type) {
        // Auto-save soil type if not already set
        await updateProperty({ default_soil_type: soil }).catch(() => {});
      }

      // 3. Fetch frost dates if not already present
      const storedCustomLastFrost = localStorage.getItem('garden-frost-custom-last');
      const storedCustomFirstFrost = localStorage.getItem('garden-frost-custom-first');
      if (storedCustomLastFrost) setCustomLastFrost(storedCustomLastFrost);
      if (storedCustomFirstFrost) setCustomFirstFrost(storedCustomFirstFrost);

      if (!data.property?.last_frost_spring || !data.property?.first_frost_fall) {
        // Need to fetch frost dates
        try {
          const frost = await getFrostDates(lat, lon);
          setFrostData(frost);
          setAutoLastFrost(frost.last_frost_spring);
          setAutoFirstFrost(frost.first_frost_fall);
          // Auto-save to property
          if (!storedCustomLastFrost && !storedCustomFirstFrost) {
            await updateProperty({
              last_frost_spring: frost.last_frost_spring,
              first_frost_fall: frost.first_frost_fall,
              frost_free_days: frost.frost_free_days,
            }).catch(() => {});
            const year = getGardenYear();
            localStorage.setItem('garden-last-frost', `${year}-${frost.last_frost_spring}`);
            localStorage.setItem('garden-first-frost', `${year}-${frost.first_frost_fall}`);
          }
        } catch {
          // Frost date fetch failed silently
        }
      } else {
        // Already have frost dates
        setAutoLastFrost(data.property.last_frost_spring);
        setAutoFirstFrost(data.property.first_frost_fall || '');
        setFrostData({
          last_frost_spring: data.property.last_frost_spring,
          first_frost_fall: data.property.first_frost_fall || '',
          frost_free_days: data.property.frost_free_days || 0,
          source: 'Saved',
          confidence: 'high',
        });
      }
    } finally {
      setAutoPopulating(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSettings();
      setSettings(data);
      setGardenTimezone(data.property?.timezone || 'America/Phoenix');
      setAddressQuery(data.property?.address || '');

      // If we have coordinates, auto-populate everything
      if (data.property?.latitude && data.property?.longitude) {
        autoPopulateFromCoords(data.property.latitude, data.property.longitude, data);
      }

      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [autoPopulateFromCoords]);

  useEffect(() => {
    load();

    // Load all localStorage preferences
    const stored = localStorage.getItem('garden-theme');
    if (stored === 'dark') setTheme('dark');
    else if (stored === 'light') setTheme('light');
    else setTheme('system');

    const calView = localStorage.getItem('garden-calendar-view');
    if (calView) setDefaultCalView(calView);

    const fs = localStorage.getItem('garden-font-size');
    if (fs === 'small' || fs === 'medium' || fs === 'large') setFontSize(fs);

    const sp = localStorage.getItem('garden-spacing');
    if (sp === 'compact' || sp === 'comfortable') setSpacing(sp);

    const sw = localStorage.getItem('garden-show-weather');
    if (sw !== null) setShowWeatherOnDash(sw !== 'false');

    const tu = localStorage.getItem('garden-temp-unit');
    if (tu === 'C' || tu === 'F') setTempUnit(tu);

    const ag = localStorage.getItem('garden-auto-gen-tasks');
    if (ag !== null) setAutoGenTasks(ag !== 'false');

    const uz = localStorage.getItem('garden-usda-zone');
    if (uz) setUsdaZone(uz);

    const wr = localStorage.getItem('garden-water-rate');
    if (wr) setWaterRate(wr);

    // Load irrigation zones
    getIrrigationZones()
      .then((z: IrrigationZone[]) => setIrrigationZones(Array.isArray(z) ? z : []))
      .catch(() => {});

    // Load soil type options
    getSoilTypes()
      .then((types: { value: string; label: string; description: string }[]) => setSoilTypeOptions(Array.isArray(types) ? types : []))
      .catch(() => {});

    // Load weather detail
    getSensorWeather()
      .then((w: Record<string, unknown>) => setWeatherDetail(w))
      .catch(() => {});

    // Load backups
    loadBackups();

    // Load update status (admin only — silently fails for non-admin)
    getUpdateStatus()
      .then((s: typeof updateStatus) => { setUpdateStatus(s); setIsAdmin(true); })
      .catch(() => {});

    // Scroll to section anchor on load
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 300);
    }
  }, [load]);

  // ─── Save helpers ───

  const saveProperty = async (field: string, rawValue: string) => {
    const numericFields = [
      'width_feet', 'height_feet', 'orientation_degrees',
      'latitude', 'longitude', 'default_soil_ph',
    ];
    let value: string | number = rawValue;
    if (numericFields.includes(field)) {
      const parsed = parseFloat(rawValue);
      if (isNaN(parsed)) return;
      value = parsed;
    }
    try {
      await updateProperty({ [field]: value });
      toast('Saved');
      load();
    } catch {
      toast('Failed to save', 'error');
    }
  };

  const savePref = (key: string, value: string) => {
    localStorage.setItem(key, value);
    toast('Saved');
  };

  // ─── Address autocomplete ───

  const handleAddressInput = (q: string) => {
    setAddressQuery(q);
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (q.length < 3) {
      setAddressSuggestions([]);
      setShowAddressDropdown(false);
      return;
    }
    addressDebounceRef.current = setTimeout(async () => {
      setAddressSearching(true);
      try {
        const results = await geocodeAddress(q);
        setAddressSuggestions(Array.isArray(results) ? results : []);
        setShowAddressDropdown(results.length > 0);
      } catch {
        setAddressSuggestions([]);
      } finally {
        setAddressSearching(false);
      }
    }, 500);
  };

  const selectAddress = async (suggestion: { display_name: string; lat: string; lon: string }) => {
    setShowAddressDropdown(false);
    setAddressQuery(suggestion.display_name);
    const lat = Math.round(parseFloat(suggestion.lat) * 10000) / 10000;
    const lon = Math.round(parseFloat(suggestion.lon) * 10000) / 10000;
    try {
      await updateProperty({
        address: suggestion.display_name,
        latitude: lat,
        longitude: lon,
      });
      toast('Address saved -- auto-populating location data...');

      // Clear any previous custom overrides on new address
      localStorage.removeItem('garden-usda-zone-custom');
      localStorage.removeItem('garden-frost-custom-last');
      localStorage.removeItem('garden-frost-custom-first');
      localStorage.removeItem('garden-soil-type-custom');
      setCustomUsdaZone(null);
      setCustomLastFrost(null);
      setCustomFirstFrost(null);
      setCustomSoilType(null);

      // Auto-populate everything from coordinates
      const freshData = await getSettings();
      setSettings(freshData);
      setGardenTimezone(freshData.property?.timezone || 'America/Phoenix');
      await autoPopulateFromCoords(lat, lon, freshData);

      toast('Location data auto-populated');
    } catch {
      toast('Failed to save address', 'error');
    }
  };

  // (frost dates are now auto-populated via autoPopulateFromCoords)

  // ─── Theme ───

  const handleThemeChange = (mode: ThemeMode) => {
    setTheme(mode);
    if (mode === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('garden-theme', 'dark');
    } else if (mode === 'light') {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('garden-theme', 'light');
    } else {
      localStorage.removeItem('garden-theme');
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
    toast('Theme updated');
  };

  const handleCalViewChange = (view: string) => {
    setDefaultCalView(view);
    localStorage.setItem('garden-calendar-view', view);
    toast('Saved');
  };

  // (geolocation detect removed -- coordinates auto-set from address selection)

  // ─── Connection tests ───

  const testRachio = async () => {
    setRachioTesting(true);
    setRachioTestResult(null);
    try {
      const data = await getSensorRachio();
      if (data && (data.zones || data.controller || data.devices)) {
        setRachioTestResult({ ok: true, msg: `Connected - ${data.zones?.length || 0} zones found` });
      } else {
        setRachioTestResult({ ok: true, msg: 'Connected (no zone data)' });
      }
    } catch (e: unknown) {
      setRachioTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Connection failed' });
    } finally {
      setRachioTesting(false);
    }
  };

  const testWeather = async () => {
    setWeatherTesting(true);
    setWeatherTestResult(null);
    try {
      const data = await getSensorWeather();
      if (data && data.temperature !== undefined) {
        setWeatherTestResult({ ok: true, msg: `Connected - ${Math.round(data.temperature as number)}F` });
        setWeatherDetail(data);
      } else {
        setWeatherTestResult({ ok: true, msg: 'Connected (limited data)' });
      }
    } catch (e: unknown) {
      setWeatherTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Connection failed' });
    } finally {
      setWeatherTesting(false);
    }
  };

  // ─── Export ───

  const handleExportAll = async () => {
    try {
      const urls = ['harvests', 'expenses', 'journal', 'plantings', 'plants'] as const;
      const allData: Record<string, unknown> = {};
      for (const resource of urls) {
        const url = getExportUrl(resource);
        const res = await fetch(url);
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          allData[resource] = ct.includes('json') ? await res.json() : await res.text();
        }
      }
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `garden-godmother-backup-${getGardenToday()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Export complete');
    } catch {
      toast('Export failed. Check that the API is running.', 'error');
    }
  };

  const handleExportSingle = async (resource: 'harvests' | 'expenses' | 'journal' | 'plantings' | 'plants') => {
    try {
      const url = getExportUrl(resource);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed');
      const ct = res.headers.get('content-type') || '';
      const isJson = ct.includes('json');
      const content = isJson ? JSON.stringify(await res.json(), null, 2) : await res.text();
      const blob = new Blob([content], { type: isJson ? 'application/json' : 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `garden-${resource}-${getGardenToday()}.${isJson ? 'json' : 'csv'}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`${resource} exported`);
    } catch {
      toast(`Failed to export ${resource}`, 'error');
    }
  };

  // ─── Task generation ───

  const handleRegenerateTasks = async () => {
    setGeneratingTasks(true);
    try {
      const result = await generateTasks();
      toast(`Tasks generated: ${result?.created ?? 'done'}`);
      load();
    } catch {
      toast('Failed to generate tasks', 'error');
    } finally {
      setGeneratingTasks(false);
    }
  };

  // ─── Danger zone actions ───

  // ─── Backup handlers ───

  const loadBackups = async () => {
    setBackupsLoading(true);
    try {
      const data = await getBackups();
      setBackups(data.backups || []);
      setBackupRetention(data.retention_days || 14);
    } catch {
      // silent
    } finally {
      setBackupsLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      await createBackup();
      toast('Backup created');
      loadBackups();
    } catch {
      toast('Failed to create backup', 'error');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    if (restoreInput !== 'RESTORE') {
      toast('Type RESTORE to confirm', 'error');
      return;
    }
    setRestoringBackup(filename);
    try {
      await restoreBackup(filename);
      toast('Database restored successfully. Reload the page to see changes.');
      setRestoreTarget(null);
      setRestoreInput('');
      loadBackups();
    } catch {
      toast('Restore failed', 'error');
    } finally {
      setRestoringBackup(null);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    const ok = await showConfirm({
      title: 'Delete Backup',
      message: `Delete backup ${filename}? This cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteBackup(filename);
      toast('Backup deleted');
      loadBackups();
    } catch {
      toast('Failed to delete backup', 'error');
    }
  };

  const handleClearTasks = async () => {
    const ok = await showConfirm({
      title: 'Delete All Tasks',
      message: 'This will permanently delete all tasks. This cannot be undone.',
      confirmText: 'Delete All Tasks',
      destructive: true,
    });
    if (!ok) return;
    setDeletingTasks(true);
    try {
      const tasks = await getTasks();
      const list = Array.isArray(tasks) ? tasks : tasks?.tasks || [];
      let count = 0;
      for (const t of list) {
        try {
          await fetch(`${API_URL}/api/tasks/${t.id}`, { method: 'DELETE' });
          count++;
        } catch { /* skip */ }
      }
      toast(`Deleted ${count} tasks`);
      load();
    } catch {
      toast('Failed to delete tasks', 'error');
    } finally {
      setDeletingTasks(false);
    }
  };

  const handleDeleteJournal = async () => {
    const ok = await showConfirm({
      title: 'Delete All Journal Entries',
      message: 'This will permanently delete all journal entries and their photos. This cannot be undone.',
      confirmText: 'Delete All Journal Entries',
      destructive: true,
    });
    if (!ok) return;
    setDeletingJournal(true);
    try {
      const res = await fetch(`${API_URL}/api/journal?limit=10000`);
      const entries = await res.json();
      const list = Array.isArray(entries) ? entries : entries?.entries || [];
      let count = 0;
      for (const e of list) {
        try {
          await fetch(`${API_URL}/api/journal/${e.id}`, { method: 'DELETE' });
          count++;
        } catch { /* skip */ }
      }
      toast(`Deleted ${count} journal entries`);
      load();
    } catch {
      toast('Failed to delete journal entries', 'error');
    } finally {
      setDeletingJournal(false);
    }
  };

  const handleResetAll = async () => {
    if (resetInput !== 'RESET') {
      toast('Type RESET to confirm', 'error');
      return;
    }
    const ok = await showConfirm({
      title: 'Reset ALL Data',
      message: 'This will delete ALL plantings, tasks, journal entries, harvests, and expenses. Plant definitions will be preserved. This CANNOT be undone.',
      confirmText: 'Reset Everything',
      destructive: true,
    });
    if (!ok) return;
    setResettingAll(true);
    try {
      const endpoints = ['/api/tasks', '/api/journal?limit=10000', '/api/harvests', '/api/expenses'];
      for (const ep of endpoints) {
        try {
          const res = await fetch(`${API_URL}${ep}`);
          const data = await res.json();
          const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
          for (const item of list as { id: number }[]) {
            const base = ep.split('?')[0];
            await fetch(`${API_URL}${base}/${item.id}`, { method: 'DELETE' }).catch(() => {});
          }
        } catch { /* skip */ }
      }
      toast('All data has been reset');
      setResetInput('');
      load();
    } catch {
      toast('Reset failed', 'error');
    } finally {
      setResettingAll(false);
    }
  };

  // ─── Render ───

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100 mb-6">Settings</h1>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-800 rounded-xl h-48 animate-pulse border border-earth-200 dark:border-gray-700"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100 mb-6">Settings</h1>
        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error || 'Failed to load settings'}
        </div>
        <button
          onClick={load}
          className="mt-4 px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  const { property, soil_profile, rachio_status, weather_status, database_stats } = settings;
  const wd = weatherDetail as Record<string, number | string | null | undefined> | null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Settings</h1>
      </div>

      {/* Section quick-nav */}
      <div ref={sectionNavRef} className="hidden sm:flex flex-wrap gap-2 mb-6">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
              window.history.replaceState(null, '', `#${s.id}`);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition hover:bg-earth-100 dark:hover:bg-gray-700 ${
              s.id === 'danger'
                ? 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                : 'text-earth-600 dark:text-gray-400 border-earth-200 dark:border-gray-700'
            }`}
          >
            {s.label}
          </a>
        ))}
      </div>

      <div className="space-y-6">
        {/* ─── 1. Property & Location ─── */}
        <SettingsCard id="property" title="Property & Location" icon="&#x1F3E1;">
          <FieldRow label="Property Name">
            <InlineInput value={property.name} onSave={(v) => saveProperty('name', v)} placeholder="My Garden" />
          </FieldRow>
          <FieldRow label="Address">
            <div className="relative" ref={addressDropdownRef}>
              <div className="relative">
                <input
                  type="text"
                  value={addressQuery}
                  onChange={(e) => handleAddressInput(e.target.value)}
                  onFocus={() => { if (addressSuggestions.length > 0) setShowAddressDropdown(true); }}
                  onBlur={() => { setTimeout(() => setShowAddressDropdown(false), 200); }}
                  placeholder="Search for an address..."
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition pr-8"
                />
                {(addressSearching || autoPopulating) && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-garden-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              {showAddressDropdown && addressSuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {addressSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onMouseDown={(e) => { e.preventDefault(); selectAddress(s); }}
                      className="w-full text-left px-3 py-2 text-sm text-earth-800 dark:text-gray-200 hover:bg-garden-50 dark:hover:bg-gray-700 border-b border-earth-100 dark:border-gray-700 last:border-0 transition"
                    >
                      {s.display_name}
                    </button>
                  ))}
                </div>
              )}
              {property.address && (
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                  Selecting an address auto-fills zone, frost dates, coordinates, and soil type.
                </p>
              )}
            </div>
          </FieldRow>

          {/* Coordinates (auto from address) */}
          <FieldRow label="Coordinates">
            {property.latitude && property.longitude ? (
              <Expandable title={`${property.latitude}, ${property.longitude}`}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1 block">Latitude</label>
                    <InlineInput
                      value={property.latitude}
                      onSave={(v) => saveProperty('latitude', v)}
                      type="number"
                      placeholder="0.0"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1 block">Longitude</label>
                    <InlineInput
                      value={property.longitude}
                      onSave={(v) => saveProperty('longitude', v)}
                      type="number"
                      placeholder="0.0"
                    />
                  </div>
                </div>
              </Expandable>
            ) : (
              <span className="text-sm text-earth-400 dark:text-gray-500">Set an address above to auto-detect</span>
            )}
          </FieldRow>

          {/* USDA Zone (auto from coords) */}
          <FieldRow label="USDA Zone">
            <AutoField
              autoValue={autoUsdaZone ? `Zone ${autoUsdaZone}` : null}
              customValue={customUsdaZone ? `Zone ${customUsdaZone}` : null}
              onCustomChange={(val) => {
                // Strip "Zone " prefix if typed
                const zone = val.replace(/^Zone\s*/i, '');
                if (USDA_ZONES.includes(zone)) {
                  setCustomUsdaZone(zone);
                  setUsdaZone(zone);
                  localStorage.setItem('garden-usda-zone', zone);
                  localStorage.setItem('garden-usda-zone-custom', zone);
                  savePref('garden-usda-zone', zone);
                }
              }}
              onReset={() => {
                setCustomUsdaZone(null);
                localStorage.removeItem('garden-usda-zone-custom');
                if (autoUsdaZone) {
                  setUsdaZone(autoUsdaZone);
                  localStorage.setItem('garden-usda-zone', autoUsdaZone);
                }
                toast('Reset to auto-detected zone');
              }}
            />
            {/* Hidden select for override mode -- shown via AutoField's override */}
            {customUsdaZone !== null && (
              <select
                value={customUsdaZone || usdaZone}
                onChange={(e) => {
                  setCustomUsdaZone(e.target.value);
                  setUsdaZone(e.target.value);
                  localStorage.setItem('garden-usda-zone', e.target.value);
                  localStorage.setItem('garden-usda-zone-custom', e.target.value);
                }}
                className="mt-1 px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none transition"
              >
                {USDA_ZONES.map((z) => (
                  <option key={z} value={z}>Zone {z}</option>
                ))}
              </select>
            )}
          </FieldRow>

          {/* Frost Dates (auto from coords) */}
          <FieldRow label="Last Spring Frost">
            <AutoField
              autoValue={autoLastFrost}
              displayValue={autoLastFrost ? formatFrostDate(autoLastFrost) : undefined}
              customValue={customLastFrost}
              onCustomChange={(val) => {
                setCustomLastFrost(val);
                localStorage.setItem('garden-frost-custom-last', val);
                // Save to property (val should be MM-DD)
                updateProperty({ last_frost_spring: val }).catch(() => {});
                const year = getGardenYear();
                localStorage.setItem('garden-last-frost', `${year}-${val}`);
              }}
              onReset={() => {
                setCustomLastFrost(null);
                localStorage.removeItem('garden-frost-custom-last');
                if (autoLastFrost) {
                  updateProperty({ last_frost_spring: autoLastFrost }).catch(() => {});
                  const year = getGardenYear();
                  localStorage.setItem('garden-last-frost', `${year}-${autoLastFrost}`);
                }
                toast('Reset to auto-detected frost date');
              }}
              placeholder="MM-DD"
            />
          </FieldRow>
          <FieldRow label="First Fall Frost">
            <AutoField
              autoValue={autoFirstFrost}
              displayValue={autoFirstFrost ? formatFrostDate(autoFirstFrost) : undefined}
              customValue={customFirstFrost}
              onCustomChange={(val) => {
                setCustomFirstFrost(val);
                localStorage.setItem('garden-frost-custom-first', val);
                updateProperty({ first_frost_fall: val }).catch(() => {});
                const year = getGardenYear();
                localStorage.setItem('garden-first-frost', `${year}-${val}`);
              }}
              onReset={() => {
                setCustomFirstFrost(null);
                localStorage.removeItem('garden-frost-custom-first');
                if (autoFirstFrost) {
                  updateProperty({ first_frost_fall: autoFirstFrost }).catch(() => {});
                  const year = getGardenYear();
                  localStorage.setItem('garden-first-frost', `${year}-${autoFirstFrost}`);
                }
                toast('Reset to auto-detected frost date');
              }}
              placeholder="MM-DD"
            />
          </FieldRow>
          {frostData && frostData.frost_free_days > 0 && (
            <FieldRow label="Frost-free Days">
              <span className="text-sm text-earth-800 dark:text-gray-200">
                ~{frostData.frost_free_days} days/year
                {frostData.confidence === 'low' && (
                  <span className="text-xs text-earth-400 dark:text-gray-500 ml-1">(estimate)</span>
                )}
              </span>
            </FieldRow>
          )}

          {/* Soil Type (auto from location) */}
          <FieldRow label="Soil Type">
            {customSoilType !== null ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <select
                    value={customSoilType || property.default_soil_type || autoSoilType || ''}
                    onChange={(e) => {
                      setCustomSoilType(e.target.value);
                      localStorage.setItem('garden-soil-type-custom', e.target.value);
                      saveProperty('default_soil_type', e.target.value);
                    }}
                    className="px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none transition"
                  >
                    {soilTypeOptions.length > 0 ? (
                      soilTypeOptions.map((st) => (
                        <option key={st.value} value={st.value}>{st.label}</option>
                      ))
                    ) : (
                      <>
                        <option value="native_ground">Native Ground</option>
                        <option value="amended_native">Amended Native</option>
                        <option value="raised_bed_mix">Raised Bed Mix</option>
                        <option value="potting_mix">Potting Mix</option>
                        <option value="cactus_succulent_mix">Cactus/Succulent Mix</option>
                        <option value="custom_blend">Custom Blend</option>
                      </>
                    )}
                  </select>
                  <span className="text-xs text-amber-600 dark:text-amber-400">(custom)</span>
                  <button
                    onClick={() => {
                      setCustomSoilType(null);
                      localStorage.removeItem('garden-soil-type-custom');
                      if (autoSoilType) {
                        saveProperty('default_soil_type', autoSoilType);
                      }
                      toast('Reset to auto-detected soil type');
                    }}
                    className="text-xs text-earth-500 dark:text-gray-400 hover:text-garden-600 dark:hover:text-garden-400 underline underline-offset-2 transition"
                  >
                    Reset to auto
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-earth-800 dark:text-gray-200 font-medium capitalize">
                  {(property.default_soil_type || autoSoilType || soil_profile.default_soil || '--').replace(/_/g, ' ')}
                </span>
                {(autoSoilType || property.default_soil_type) && (
                  <span className="text-xs text-garden-600 dark:text-garden-400">(auto)</span>
                )}
                <button
                  onClick={() => setCustomSoilType(property.default_soil_type || autoSoilType || '')}
                  className="text-xs text-earth-500 dark:text-gray-400 hover:text-garden-600 dark:hover:text-garden-400 underline underline-offset-2 transition"
                >
                  Override
                </button>
                {soilTypeOptions.length > 0 && (() => {
                  const selected = soilTypeOptions.find(st => st.value === (property.default_soil_type || autoSoilType || soil_profile.default_soil));
                  return selected?.description ? (
                    <p className="text-xs text-earth-400 dark:text-gray-500 w-full mt-0.5">{selected.description}</p>
                  ) : null;
                })()}
              </div>
            )}
          </FieldRow>
          <FieldRow label="Soil pH">
            <InlineInput
              value={property.default_soil_ph || soil_profile.default_ph}
              onSave={(v) => saveProperty('default_soil_ph', v)}
              type="number"
              placeholder="8.0"
            />
          </FieldRow>
          <FieldRow label="Orientation">
            <div className="flex items-center gap-2">
              <InlineInput
                value={property.orientation_degrees}
                onSave={(v) => saveProperty('orientation_degrees', v)}
                type="number"
                placeholder="0"
                className="!w-24"
              />
              <span className="text-xs text-earth-400 dark:text-gray-500">degrees</span>
            </div>
          </FieldRow>
          <FieldRow label="Dimensions">
            <div className="flex items-center gap-2">
              <InlineInput
                value={property.width_feet}
                onSave={(v) => saveProperty('width_feet', v)}
                type="number"
                className="!w-24"
                placeholder="100"
              />
              <span className="text-earth-400 dark:text-gray-500 text-sm">x</span>
              <InlineInput
                value={property.height_feet}
                onSave={(v) => saveProperty('height_feet', v)}
                type="number"
                className="!w-24"
                placeholder="80"
              />
              <span className="text-earth-400 dark:text-gray-500 text-sm">ft</span>
            </div>
          </FieldRow>
          <FieldRow label="Property Map">
            <Link
              href="/map"
              className="text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
            >
              View property map &rarr;
            </Link>
          </FieldRow>
        </SettingsCard>

        {/* ─── 2. Irrigation ─── */}
        <SettingsCard id="irrigation" title="Irrigation" icon="&#x1F4A7;">
          <FieldRow label="Rachio Controller">
            <div className="flex items-center gap-2">
              <StatusDot connected={rachio_status.connected} />
              <span className="text-sm text-earth-800 dark:text-gray-200">
                {rachio_status.connected
                  ? `${rachio_status.controller || 'Rachio'} -- ${rachio_status.zones} zones, ${rachio_status.valves} valve${rachio_status.valves !== 1 ? 's' : ''}`
                  : 'Not connected'}
              </span>
            </div>
          </FieldRow>
          <FieldRow label="Hose Timer">
            <div className="flex items-center gap-2">
              <StatusDot connected={rachio_status.valves > 0} />
              <span className="text-sm text-earth-800 dark:text-gray-200">
                {rachio_status.valves > 0
                  ? `${rachio_status.valves} smart hose timer valve${rachio_status.valves !== 1 ? 's' : ''}`
                  : 'No hose timers detected'}
              </span>
            </div>
          </FieldRow>
          <FieldRow label="Test Connection">
            <div className="flex items-center gap-3 flex-wrap">
              <ActionButton onClick={testRachio} loading={rachioTesting} variant="secondary">
                Test Rachio
              </ActionButton>
              {rachioTestResult && (
                <span
                  className={`text-sm font-medium ${
                    rachioTestResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {rachioTestResult.ok ? '\u2713' : '\u2715'} {rachioTestResult.msg}
                </span>
              )}
            </div>
          </FieldRow>
          <FieldRow label="Water Rate">
            <div className="flex items-center gap-2">
              <span className="text-sm text-earth-500 dark:text-gray-400">$</span>
              <input
                type="number"
                step="0.001"
                value={waterRate}
                onChange={(e) => {
                  setWaterRate(e.target.value);
                  savePref('garden-water-rate', e.target.value);
                }}
                placeholder="0.005"
                className="w-28 px-3 py-1.5 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none transition"
              />
              <span className="text-sm text-earth-500 dark:text-gray-400">/ gallon</span>
            </div>
          </FieldRow>

          {/* Zone summary */}
          {irrigationZones.length > 0 && (
            <div className="mt-3">
              <Expandable title={`Irrigation Zones (${irrigationZones.length})`}>
                <div className="space-y-2">
                  {irrigationZones.map((z, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 text-sm py-1.5 border-b border-earth-50 dark:border-gray-700/50 last:border-0"
                    >
                      <span className="font-medium text-earth-800 dark:text-gray-200 shrink-0 w-32 truncate">
                        {z.zone_name || `Zone ${z.zone_number || i + 1}`}
                      </span>
                      <span className="text-earth-500 dark:text-gray-400">
                        {z.beds && z.beds.length > 0
                          ? z.beds.join(', ')
                          : z.planters && z.planters.length > 0
                          ? z.planters.join(', ')
                          : 'No planters assigned'}
                      </span>
                    </div>
                  ))}
                </div>
              </Expandable>
            </div>
          )}

          <FieldRow label="Manage Zones">
            <Link
              href="/sensors"
              className="text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
            >
              View sensors & irrigation zones &rarr;
            </Link>
          </FieldRow>
        </SettingsCard>

        {/* ─── 3. Weather ─── */}
        <SettingsCard id="weather" title="Weather" icon="&#x1F324;&#xFE0F;">
          <FieldRow label="Tempest Station">
            <div className="flex items-center gap-2">
              <StatusDot connected={weather_status.connected} />
              <span className="text-sm text-earth-800 dark:text-gray-200">
                {weather_status.connected
                  ? weather_status.station || 'Tempest Station'
                  : 'Not connected'}
              </span>
            </div>
          </FieldRow>
          <FieldRow label="Temperature Unit">
            <div className="flex gap-2">
              <ToggleButton active={tempUnit === 'F'} onClick={() => { setTempUnit('F'); savePref('garden-temp-unit', 'F'); }}>
                &deg;F
              </ToggleButton>
              <ToggleButton active={tempUnit === 'C'} onClick={() => { setTempUnit('C'); savePref('garden-temp-unit', 'C'); }}>
                &deg;C
              </ToggleButton>
            </div>
          </FieldRow>
          <FieldRow label="Test Connection">
            <div className="flex items-center gap-3 flex-wrap">
              <ActionButton onClick={testWeather} loading={weatherTesting} variant="secondary">
                Test Weather
              </ActionButton>
              {weatherTestResult && (
                <span
                  className={`text-sm font-medium ${
                    weatherTestResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {weatherTestResult.ok ? '\u2713' : '\u2715'} {weatherTestResult.msg}
                </span>
              )}
            </div>
          </FieldRow>

          {/* Compact sensor dashboard */}
          {weather_status.connected && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                  {formatTemp(weather_status.temperature, tempUnit)}&deg;{tempUnit}
                </div>
                <div className="text-xs text-earth-500 dark:text-gray-400">Temperature</div>
              </div>
              <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                  {weather_status.humidity !== null ? `${Math.round(weather_status.humidity)}%` : '--'}
                </div>
                <div className="text-xs text-earth-500 dark:text-gray-400">Humidity</div>
              </div>
              {wd?.wind_speed !== undefined && wd?.wind_speed !== null && (
                <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                    {Math.round(wd.wind_speed as number)} mph
                  </div>
                  <div className="text-xs text-earth-500 dark:text-gray-400">Wind</div>
                </div>
              )}
              {wd?.solar_radiation !== undefined && wd?.solar_radiation !== null && (
                <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                    {Math.round(wd.solar_radiation as number)}
                  </div>
                  <div className="text-xs text-earth-500 dark:text-gray-400">Solar (W/m2)</div>
                </div>
              )}
              {wd?.uv_index !== undefined && wd?.uv_index !== null && (
                <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                    {wd.uv_index}
                  </div>
                  <div className="text-xs text-earth-500 dark:text-gray-400">UV Index</div>
                </div>
              )}
              {wd?.pressure !== undefined && wd?.pressure !== null && (
                <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                    {Math.round(wd.pressure as number)}
                  </div>
                  <div className="text-xs text-earth-500 dark:text-gray-400">Pressure (mb)</div>
                </div>
              )}
              {wd?.rain_today !== undefined && wd?.rain_today !== null && (
                <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                    {wd.rain_today}&quot;
                  </div>
                  <div className="text-xs text-earth-500 dark:text-gray-400">Rain Today</div>
                </div>
              )}
              {wd?.feels_like !== undefined && wd?.feels_like !== null && (
                <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100">
                    {formatTemp(wd.feels_like as number, tempUnit)}&deg;{tempUnit}
                  </div>
                  <div className="text-xs text-earth-500 dark:text-gray-400">Feels Like</div>
                </div>
              )}
              {weather_status.condition && (
                <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-earth-800 dark:text-gray-100 capitalize">
                    {weather_status.condition}
                  </div>
                  <div className="text-xs text-earth-500 dark:text-gray-400">Conditions</div>
                </div>
              )}
            </div>
          )}

          <FieldRow label="Sensor History">
            <Link
              href="/sensors/history"
              className="text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
            >
              View sensor history &rarr;
            </Link>
          </FieldRow>
        </SettingsCard>

        {/* ─── 4. Tasks & Notifications ─── */}
        <SettingsCard id="tasks" title="Tasks & Notifications" icon="&#x1F514;">
          <FieldRow label="Auto-generate Tasks">
            <div className="flex items-center gap-3 flex-wrap">
              <ToggleButton active={autoGenTasks} onClick={() => { setAutoGenTasks(true); savePref('garden-auto-gen-tasks', 'true'); }}>
                On
              </ToggleButton>
              <ToggleButton active={!autoGenTasks} onClick={() => { setAutoGenTasks(false); savePref('garden-auto-gen-tasks', 'false'); }}>
                Off
              </ToggleButton>
              <span className="text-xs text-earth-400 dark:text-gray-500">Auto-create tasks on dashboard load</span>
            </div>
          </FieldRow>
          <FieldRow label="Regenerate Tasks">
            <ActionButton onClick={handleRegenerateTasks} loading={generatingTasks} variant="secondary">
              Regenerate Tasks Now
            </ActionButton>
          </FieldRow>

          <div className="mt-3">
            <Expandable title="Task Generation Rules">
              <ul className="space-y-2 text-sm text-earth-600 dark:text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="text-garden-500 mt-0.5">&bull;</span>
                  <span><strong>Water tasks:</strong> Only for manual-irrigation planters with active plants, adjusted for rain forecast and Rachio schedules</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-garden-500 mt-0.5">&bull;</span>
                  <span><strong>Harvest tasks:</strong> Only for harvestable plants past estimated maturity date</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-garden-500 mt-0.5">&bull;</span>
                  <span><strong>Fertilize tasks:</strong> Based on plant-specific feeding schedules and soil amendments</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-garden-500 mt-0.5">&bull;</span>
                  <span><strong>Prune tasks:</strong> Triggered by growth stage and plant type requirements</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-garden-500 mt-0.5">&bull;</span>
                  <span><strong>Plant/transplant tasks:</strong> Based on calendar season and lifecycle planner</span>
                </li>
              </ul>
            </Expandable>
          </div>

          <div className="mt-3">
            <Expandable title="Notification Channels (Coming Soon)">
              <div className="space-y-3 text-sm text-earth-500 dark:text-gray-400">
                <div className="flex items-center justify-between py-1">
                  <span>Push Notifications</span>
                  <span className="px-2 py-0.5 text-xs bg-earth-100 dark:bg-gray-700 rounded-full">Planned</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span>Email Digests</span>
                  <span className="px-2 py-0.5 text-xs bg-earth-100 dark:bg-gray-700 rounded-full">Planned</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span>iMessage Alerts</span>
                  <span className="px-2 py-0.5 text-xs bg-earth-100 dark:bg-gray-700 rounded-full">Planned</span>
                </div>
              </div>
            </Expandable>
          </div>

          <FieldRow label="Manage Tasks">
            <Link
              href="/tasks"
              className="text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium"
            >
              View all tasks &rarr;
            </Link>
          </FieldRow>
        </SettingsCard>

        {/* ─── 5. Calendar Sync ─── */}
        <SettingsCard id="calendar-sync" title="Calendar Sync" icon="&#x1F4C5;">
          <CalendarSyncSection />
        </SettingsCard>

        {/* ─── 6. Data & Export ─── */}
        <SettingsCard id="data" title="Data & Export" icon="&#x1F4BE;">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4 bg-earth-50 dark:bg-gray-700/50 rounded-lg p-3">
            <StatItem label="Plants" value={database_stats.plants} />
            <StatItem label="Varieties" value={database_stats.varieties} />
            <StatItem label="Planters" value={database_stats.planters} />
            <StatItem label="Ground Plants" value={database_stats.ground_plants} />
            <StatItem label="Trays" value={database_stats.trays} />
            <StatItem label="Journal" value={database_stats.journal_entries} />
            <StatItem label="Harvests" value={database_stats.harvests} />
            <StatItem label="Tasks" value={database_stats.tasks} />
            <StatItem label="Photos" value={database_stats.photos} />
            <StatItem label="Expenses" value={database_stats.expenses} />
          </div>

          {/* Export buttons */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={handleExportAll} variant="primary">
                Export All Data (JSON)
              </ActionButton>
              <Link
                href="/analytics"
                className="inline-flex items-center px-4 py-2 bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-earth-200 dark:hover:bg-gray-600 transition"
              >
                View Analytics &rarr;
              </Link>
            </div>

            <Expandable title="Export Individual Data Types">
              <div className="flex flex-wrap gap-2">
                {(['plants', 'plantings', 'harvests', 'expenses', 'journal'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => handleExportSingle(r)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-earth-200 dark:border-gray-600 text-earth-700 dark:text-gray-300 hover:bg-earth-100 dark:hover:bg-gray-700 transition capitalize"
                  >
                    Export {r}
                  </button>
                ))}
              </div>
            </Expandable>
          </div>

        </SettingsCard>

        {/* ─── 7. Appearance ─── */}
        <SettingsCard id="appearance" title="Appearance" icon="&#x1F3A8;">
          <FieldRow label="Theme">
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                <ToggleButton key={mode} active={theme === mode} onClick={() => handleThemeChange(mode)}>
                  {mode === 'light' && 'Light'}
                  {mode === 'dark' && 'Dark'}
                  {mode === 'system' && 'System'}
                </ToggleButton>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Font Size">
            <div className="flex gap-2">
              {(['small', 'medium', 'large'] as FontSize[]).map((s) => (
                <ToggleButton
                  key={s}
                  active={fontSize === s}
                  onClick={() => {
                    setFontSize(s);
                    savePref('garden-font-size', s);
                    document.documentElement.style.fontSize =
                      s === 'small' ? '14px' : s === 'large' ? '18px' : '16px';
                  }}
                >
                  {s === 'small' ? 'Small' : s === 'medium' ? 'Medium' : 'Large'}
                </ToggleButton>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Spacing">
            <div className="flex gap-2">
              {(['compact', 'comfortable'] as Spacing[]).map((s) => (
                <ToggleButton
                  key={s}
                  active={spacing === s}
                  onClick={() => {
                    setSpacing(s);
                    savePref('garden-spacing', s);
                  }}
                >
                  {s === 'compact' ? 'Compact' : 'Comfortable'}
                </ToggleButton>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Dashboard Weather">
            <div className="flex gap-2">
              <ToggleButton
                active={showWeatherOnDash}
                onClick={() => {
                  setShowWeatherOnDash(true);
                  savePref('garden-show-weather', 'true');
                }}
              >
                Show
              </ToggleButton>
              <ToggleButton
                active={!showWeatherOnDash}
                onClick={() => {
                  setShowWeatherOnDash(false);
                  savePref('garden-show-weather', 'false');
                }}
              >
                Hide
              </ToggleButton>
            </div>
          </FieldRow>
          <FieldRow label="Default Calendar View">
            <div className="flex gap-2">
              {[
                { value: 'personal', label: 'My Plants' },
                { value: 'all', label: 'All Plants' },
              ].map((opt) => (
                <ToggleButton
                  key={opt.value}
                  active={defaultCalView === opt.value}
                  onClick={() => handleCalViewChange(opt.value)}
                >
                  {opt.label}
                </ToggleButton>
              ))}
            </div>
          </FieldRow>
        </SettingsCard>

        {/* ─── 8. About ─── */}
        <SettingsCard id="about" title="About" icon="&#x2139;&#xFE0F;">
          <FieldRow label="Version">
            <span className="text-sm font-mono text-earth-800 dark:text-gray-200">
              Garden Godmother v{settings.version}
            </span>
          </FieldRow>
          <FieldRow label="Plant Database">
            <span className="text-sm text-earth-800 dark:text-gray-200">
              {database_stats.plants} plants, {database_stats.varieties} varieties
            </span>
          </FieldRow>
          <FieldRow label="API Status">
            <div className="flex items-center gap-2">
              <StatusDot connected={true} />
              <span className="text-sm text-earth-800 dark:text-gray-200">Operational</span>
            </div>
          </FieldRow>
          <FieldRow label="Location">
            <span className="text-sm text-earth-800 dark:text-gray-200">
              {soil_profile.location} (USDA Zone {usdaZone})
            </span>
          </FieldRow>
        </SettingsCard>

        {/* ─── 9. Backups ─── */}
        <SettingsCard id="backups" title="Backups" icon="&#x1F4BE;">
          <div className="space-y-4">
            {/* Status summary */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-sm text-earth-600 dark:text-gray-400">
                {backups.length > 0 ? (
                  <>
                    <span className="font-medium text-earth-800 dark:text-gray-200">
                      {backups.length} backup{backups.length !== 1 ? 's' : ''} stored
                    </span>
                    {' '}&middot; {backupRetention}-day retention &middot; Hourly automatic
                    {backups[0] && (
                      <>
                        {' '}&middot; Last:{' '}
                        {(() => {
                          const ago = Date.now() - new Date(backups[0].created_at).getTime();
                          const mins = Math.floor(ago / 60000);
                          if (mins < 1) return 'just now';
                          if (mins < 60) return `${mins} min ago`;
                          const hrs = Math.floor(mins / 60);
                          if (hrs < 24) return `${hrs}h ago`;
                          return `${Math.floor(hrs / 24)}d ago`;
                        })()}
                      </>
                    )}
                  </>
                ) : (
                  <span>No backups yet. Backups run automatically every hour.</span>
                )}
              </div>
              <ActionButton onClick={handleCreateBackup} variant="primary" loading={creatingBackup}>
                Create Backup Now
              </ActionButton>
            </div>

            {/* Backup list */}
            {backupsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : backups.length > 0 ? (
              <div className="border border-earth-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-y-auto divide-y divide-earth-100 dark:divide-gray-700">
                  {backups.map((b) => (
                    <div
                      key={b.filename}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 hover:bg-earth-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-earth-800 dark:text-gray-200 truncate">
                          {b.filename}
                        </p>
                        <p className="text-xs text-earth-500 dark:text-gray-400">
                          {formatGardenDateTime(b.created_at)} &middot;{' '}
                          {b.size < 1024 * 1024
                            ? `${(b.size / 1024).toFixed(1)} KB`
                            : `${(b.size / (1024 * 1024)).toFixed(1)} MB`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={getBackupDownloadUrl(b.filename)}
                          download
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600 transition"
                        >
                          Download
                        </a>
                        {restoreTarget === b.filename ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={restoreInput}
                              onChange={(e) => setRestoreInput(e.target.value.toUpperCase())}
                              placeholder='Type "RESTORE"'
                              className="w-28 px-2 py-1 text-xs rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 placeholder-red-400 focus:ring-1 focus:ring-red-500 outline-none"
                            />
                            <button
                              onClick={() => handleRestoreBackup(b.filename)}
                              disabled={restoreInput !== 'RESTORE' || restoringBackup === b.filename}
                              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {restoringBackup === b.filename ? 'Restoring...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => { setRestoreTarget(null); setRestoreInput(''); }}
                              className="px-2 py-1.5 text-xs text-earth-500 dark:text-gray-400 hover:text-earth-700 dark:hover:text-gray-200"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setRestoreTarget(b.filename); setRestoreInput(''); }}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition"
                          >
                            Restore
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteBackup(b.filename)}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/40 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Info note */}
            <p className="text-xs text-earth-400 dark:text-gray-500">
              Backups are stored inside the Docker volume alongside the database.
              Automatic backups run every hour with {backupRetention}-day retention.
              Pre-deploy backups are created on each container restart.
            </p>
          </div>
        </SettingsCard>

        {/* ─── Updates ─── */}
        {isAdmin && (
          <SettingsCard id="updates" title="Updates" icon="&#x1F504;">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-earth-800 dark:text-gray-200">Current Version</p>
                  <p className="text-xs text-earth-500 dark:text-gray-400 font-mono">
                    {updateStatus?.current_commit || 'unknown'}
                    {updateStatus?.current_date && (
                      <span className="ml-2">({new Date(updateStatus.current_date).toLocaleDateString()})</span>
                    )}
                  </p>
                </div>
                {updateStatus?.update_available ? (
                  <span className="text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-full">
                    {updateStatus.commits_behind} update{updateStatus.commits_behind !== 1 ? 's' : ''} available
                  </span>
                ) : (
                  <span className="text-xs text-earth-400 dark:text-gray-500">Up to date</span>
                )}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-earth-200 dark:border-gray-700">
                <div>
                  <p className="text-sm text-earth-600 dark:text-gray-300">Auto-Update</p>
                  <p className="text-xs text-earth-400 dark:text-gray-500">
                    {updateStatus?.auto_update_enabled ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
                <Link href="/admin/updates" className="text-sm text-garden-600 dark:text-garden-400 hover:underline font-medium">
                  Manage Updates
                </Link>
              </div>
            </div>
          </SettingsCard>
        )}

        {/* ─── Mesh Network ─── */}
        <SettingsCard id="mesh-network" title="Mesh Network" icon="&#x1F4F6;">
          <MeshNetworkCard />
        </SettingsCard>

        {/* ─── Co-op ─── */}
        <SettingsCard id="coop" title="Garden Co-op" icon="🤝">
          <CoopSettingsCard />
        </SettingsCard>

        {/* ─── 10. Danger Zone ─── */}
        <SettingsCard id="danger" title="Danger Zone" icon="&#x26A0;&#xFE0F;" danger>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">
            These actions are destructive and cannot be undone. Proceed with caution.
          </p>

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 border-b border-red-100 dark:border-red-900/30">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200">Delete All Tasks</h3>
                <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">
                  Remove all generated and manual tasks. You can regenerate them afterward.
                </p>
              </div>
              <ActionButton onClick={handleClearTasks} variant="danger" loading={deletingTasks}>
                Delete All Tasks
              </ActionButton>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 border-b border-red-100 dark:border-red-900/30">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200">
                  Delete All Journal Entries
                </h3>
                <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">
                  Remove all journal entries and attached photos permanently.
                </p>
              </div>
              <ActionButton onClick={handleDeleteJournal} variant="danger" loading={deletingJournal}>
                Delete Journal
              </ActionButton>
            </div>

            <div className="py-3">
              <div className="flex-1 mb-3">
                <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Reset All Data</h3>
                <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">
                  Delete all plantings, tasks, journal entries, harvests, and expenses. Plant definitions
                  are preserved. Type <strong>RESET</strong> below to enable the button.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <input
                  type="text"
                  value={resetInput}
                  onChange={(e) => setResetInput(e.target.value.toUpperCase())}
                  placeholder='Type "RESET" to confirm'
                  className="w-full sm:w-48 px-3 py-1.5 text-sm rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 placeholder-red-400 dark:placeholder-red-500 focus:ring-2 focus:ring-red-500 outline-none transition"
                />
                <ActionButton
                  onClick={handleResetAll}
                  variant="danger"
                  disabled={resetInput !== 'RESET'}
                  loading={resettingAll}
                >
                  Reset Everything
                </ActionButton>
              </div>
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
