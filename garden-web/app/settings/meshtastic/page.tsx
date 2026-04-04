'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  getMeshtasticConfig,
  updateMeshtasticConfig,
  getMeshtasticChannels,
  testMeshtasticConnection,
  getMeshtasticStatus,
} from '../../api';
import { useToast } from '../../toast';

// ─── Types ───

interface MeshtasticConfig {
  enabled: boolean;
  connection_type: 'tcp' | 'serial';
  hostname: string;
  port: number;
  serial_port: string;
  channel_index: number;
  channel_name: string;
}

interface MeshtasticStatus {
  connected: boolean;
  hostname?: string;
  serial_port?: string;
  channel_name?: string;
  node_count?: number;
}

interface MeshtasticChannel {
  index: number;
  name: string;
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
  type = 'button',
}: {
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
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
  };
  return (
    <button
      type={type}
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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 py-3 border-b border-earth-50 dark:border-gray-700/50 last:border-b-0">
      <span className="text-sm font-medium text-earth-600 dark:text-gray-400 sm:w-44 shrink-0 mt-0.5">{label}</span>
      <div className="flex-1">{children}</div>
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

function Input({
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string | number;
  onChange: (val: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: 'text' | 'number';
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

// ─── Page ───

export default function MeshtasticSettingsPage() {
  const { toast } = useToast();

  const [config, setConfig] = useState<MeshtasticConfig>({
    enabled: false,
    connection_type: 'tcp',
    hostname: '',
    port: 4403,
    serial_port: '',
    channel_index: 0,
    channel_name: '',
  });
  const [configLoading, setConfigLoading] = useState(true);

  const [status, setStatus] = useState<MeshtasticStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [channels, setChannels] = useState<MeshtasticChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Debounce refs for text inputs
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Load on mount ───

  const loadStatus = useCallback(() => {
    setStatusLoading(true);
    getMeshtasticStatus()
      .then((data: MeshtasticStatus) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false));
  }, []);

  useEffect(() => {
    getMeshtasticConfig()
      .then((data: MeshtasticConfig) => setConfig(data))
      .catch((err: Error) => {
        if (err.message.includes('403')) {
          toast('Admin required to view Meshtastic settings', 'error');
        } else {
          toast('Could not load Meshtastic config', 'error');
        }
      })
      .finally(() => setConfigLoading(false));

    loadStatus();
  }, [loadStatus]);

  // ─── Save helpers ───

  const saveConfig = useCallback(
    async (patch: Partial<MeshtasticConfig>, key?: string) => {
      if (key) setSavingKey(key);
      try {
        const updated = await updateMeshtasticConfig(patch);
        setConfig((prev) => ({ ...prev, ...updated }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('403')) {
          toast('Admin required', 'error');
        } else {
          toast('Could not save setting', 'error');
        }
      } finally {
        if (key) setSavingKey(null);
      }
    },
    [toast],
  );

  // Immediate save (toggles, selects)
  const saveImmediate = (patch: Partial<MeshtasticConfig>, key: string) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    saveConfig(patch, key);
  };

  // Debounced save (text inputs — fires 800ms after last keystroke)
  const saveDebounced = (patch: Partial<MeshtasticConfig>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveConfig(patch);
    }, 800);
  };

  // On-blur save for text inputs
  const saveOnBlur = (patch: Partial<MeshtasticConfig>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    saveConfig(patch);
  };

  // ─── Connection test ───

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testMeshtasticConnection();
      setTestResult({ ok: true, msg: 'Connected successfully' });
      toast('Meshtastic connection established!', 'success');
      loadStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('403')) {
        toast('Admin required', 'error');
        setTestResult({ ok: false, msg: 'Admin required' });
      } else {
        setTestResult({ ok: false, msg: 'Connection failed — check hostname/port' });
        toast('Connection test failed', 'error');
      }
    } finally {
      setTesting(false);
    }
  };

  // ─── Load channels ───

  const handleLoadChannels = async () => {
    setChannelsLoading(true);
    try {
      const data = await getMeshtasticChannels();
      const list: MeshtasticChannel[] = Array.isArray(data) ? data : data.channels ?? [];
      setChannels(list);
      if (list.length === 0) {
        toast('No channels found on device', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('403')) {
        toast('Admin required', 'error');
      } else {
        toast('Could not load channels — ensure device is connected', 'error');
      }
    } finally {
      setChannelsLoading(false);
    }
  };

  // ─── Channel select ───

  const handleChannelSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    const ch = channels.find((c) => c.index === idx);
    if (!ch) return;
    saveImmediate({ channel_index: ch.index, channel_name: ch.name }, 'channel');
  };

  // ─── Render ───

  if (configLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <LoadingSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/settings"
          className="text-sm text-earth-500 dark:text-gray-400 hover:text-earth-700 dark:hover:text-gray-200 transition"
        >
          &#8592; Settings
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Mesh Network</h1>
        <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
          Connect to a Meshtastic device to send and receive garden alerts over LoRa radio.
        </p>
      </div>

      {/* ─── Status Panel ─── */}
      <Card title="Status" icon="&#x1F4F6;">
        {statusLoading ? (
          <LoadingSkeleton />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    status?.connected
                      ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                      : 'bg-red-400'
                  }`}
                />
                <span className="text-sm font-medium text-earth-800 dark:text-gray-200">
                  {status?.connected ? 'Connected' : 'Disconnected'}
                </span>
                {status?.connected && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                    Online
                  </span>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={loadStatus} loading={statusLoading}>
                Refresh
              </Button>
            </div>

            {status?.connected && (
              <div className="mt-3 space-y-1 divide-y divide-earth-50 dark:divide-gray-700/50">
                {(status.hostname || status.serial_port) && (
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-xs text-earth-500 dark:text-gray-400 w-28 shrink-0">Device</span>
                    <span className="text-sm font-mono text-earth-800 dark:text-gray-200">
                      {status.hostname ?? status.serial_port}
                    </span>
                  </div>
                )}
                {status.channel_name && (
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-xs text-earth-500 dark:text-gray-400 w-28 shrink-0">Channel</span>
                    <span className="inline-flex items-center gap-1.5 text-sm text-earth-800 dark:text-gray-200">
                      {status.channel_name}
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                        Active
                      </span>
                    </span>
                  </div>
                )}
                {status.node_count !== undefined && (
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-xs text-earth-500 dark:text-gray-400 w-28 shrink-0">Nodes seen</span>
                    <span className="text-sm text-earth-800 dark:text-gray-200">{status.node_count}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ─── Connection Setup ─── */}
      <Card title="Connection Setup" icon="&#x1F527;">
        <div className="space-y-0 divide-y divide-earth-50 dark:divide-gray-700/50">
          {/* Enable toggle */}
          <FieldRow label="Enable Meshtastic">
            <div className="flex items-center gap-3">
              <Toggle
                checked={config.enabled}
                onChange={(val) => saveImmediate({ enabled: val }, 'enabled')}
                disabled={savingKey === 'enabled'}
              />
              <span className="text-xs text-earth-500 dark:text-gray-400">
                {config.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </FieldRow>

          {/* Connection type */}
          <FieldRow label="Connection Type">
            <div className="flex gap-3">
              {(['tcp', 'serial'] as const).map((type) => (
                <label key={type} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="connection_type"
                    value={type}
                    checked={config.connection_type === type}
                    onChange={() => saveImmediate({ connection_type: type }, 'connection_type')}
                    className="accent-garden-600"
                  />
                  <span className="text-sm text-earth-800 dark:text-gray-200">
                    {type === 'tcp' ? 'TCP (Network)' : 'Serial (USB)'}
                  </span>
                </label>
              ))}
            </div>
          </FieldRow>

          {/* TCP fields */}
          {config.connection_type === 'tcp' && (
            <>
              <FieldRow label="Node IP Address or Hostname">
                <Input
                  value={config.hostname}
                  placeholder="e.g. 192.168.1.100"
                  onChange={(val) => {
                    setConfig((prev) => ({ ...prev, hostname: val }));
                    saveDebounced({ hostname: val });
                  }}
                  onBlur={() => saveOnBlur({ hostname: config.hostname })}
                />
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                  Enter the IP address of your Meshtastic node on your local network (TCP connection). Port is usually 4403.
                </p>
              </FieldRow>
              <FieldRow label="Port">
                <Input
                  type="number"
                  value={config.port}
                  placeholder="4403"
                  onChange={(val) => {
                    const port = parseInt(val, 10) || 4403;
                    setConfig((prev) => ({ ...prev, port }));
                    saveDebounced({ port });
                  }}
                  onBlur={() => saveOnBlur({ port: config.port })}
                />
              </FieldRow>
            </>
          )}

          {/* Serial fields */}
          {config.connection_type === 'serial' && (
            <FieldRow label="Serial Port">
              <Input
                value={config.serial_port}
                placeholder="/dev/ttyUSB0"
                onChange={(val) => {
                  setConfig((prev) => ({ ...prev, serial_port: val }));
                  saveDebounced({ serial_port: val });
                }}
                onBlur={() => saveOnBlur({ serial_port: config.serial_port })}
              />
            </FieldRow>
          )}

          {/* Test button */}
          <div className="pt-4 flex items-center gap-4 flex-wrap">
            <Button variant="primary" onClick={handleTest} loading={testing}>
              Connect &amp; Test
            </Button>
            {testResult && (
              <span
                className={`text-sm font-medium ${
                  testResult.ok
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {testResult.ok ? '\u2713' : '\u2715'} {testResult.msg}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* ─── Channel Selection ─── */}
      <Card title="Channel Selection" icon="&#x1F4E1;">
        <div className="space-y-4">
          {config.channel_name && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-earth-600 dark:text-gray-400">Active channel:</span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                {config.channel_name}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="secondary" onClick={handleLoadChannels} loading={channelsLoading}>
              Load Channels
            </Button>
            <span className="text-xs text-earth-400 dark:text-gray-500">
              Fetches channel list from the device at the hostname/port above
            </span>
          </div>

          {channels.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">
                Select Channel
              </label>
              <select
                value={config.channel_index}
                onChange={handleChannelSelect}
                disabled={savingKey === 'channel'}
                className="w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {channels.map((ch) => (
                  <option key={ch.index} value={ch.index}>
                    {ch.index}: {ch.name}
                  </option>
                ))}
              </select>
              {savingKey === 'channel' && (
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">Saving...</p>
              )}
            </div>
          )}

          <p className="text-xs text-earth-500 dark:text-gray-400 pt-1">
            💡 Tip: Create a channel called &ldquo;gardening&rdquo; on your node to connect with other Garden Godmother users in your area.
          </p>
        </div>
      </Card>
    </div>
  );
}
