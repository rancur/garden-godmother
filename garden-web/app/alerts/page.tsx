'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getPestAlerts, getPlants } from '../api';
import { getPlantIcon } from '../plant-icons';
import { formatGardenTimeFromDate } from '../timezone';

interface PestAlert {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  affected_plants: string[];
  prevention_tips: string[];
}

interface AlertConditions {
  temperature_f: number | null;
  humidity_pct: number | null;
  wind_speed_mph: number | null;
  rain_today_in: number | null;
  uv_index: number | null;
  max_soil_moisture_pct: number | null;
}

interface PestAlertData {
  alerts: PestAlert[];
  overall_risk: 'low' | 'medium' | 'high';
  conditions: AlertConditions;
}

const SEVERITY_CONFIG = {
  low: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    badge: 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200',
    icon: 'text-green-600 dark:text-green-400',
  },
  medium: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    badge: 'bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200',
    icon: 'text-yellow-600 dark:text-yellow-400',
  },
  high: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    badge: 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200',
    icon: 'text-red-600 dark:text-red-400',
  },
};

const OVERALL_BANNER = {
  low: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    border: 'border-green-300 dark:border-green-700',
    text: 'text-green-800 dark:text-green-200',
    label: 'Low Risk',
    message: 'Conditions are favorable. No significant pest or disease threats detected.',
  },
  medium: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    border: 'border-yellow-300 dark:border-yellow-700',
    text: 'text-yellow-800 dark:text-yellow-200',
    label: 'Medium Risk',
    message: 'Some pest or disease conditions are present. Review alerts below and take preventive action.',
  },
  high: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    border: 'border-red-300 dark:border-red-700',
    text: 'text-red-800 dark:text-red-200',
    label: 'High Risk',
    message: 'Conditions strongly favor pest or disease activity. Immediate attention recommended.',
  },
};

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function AlertsPage() {
  const [data, setData] = useState<PestAlertData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [plantNameToId, setPlantNameToId] = useState<Record<string, number>>({});

  useEffect(() => {
    getPlants({}).then((plants: { id: number; name: string }[]) => {
      const map: Record<string, number> = {};
      for (const p of plants) map[p.name.toLowerCase()] = p.id;
      setPlantNameToId(map);
    }).catch(() => {});
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const result = await getPestAlerts();
      setData(result);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">Pest & Disease Alerts</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-earth-200 dark:bg-gray-700 rounded-xl" />
          <div className="h-48 bg-earth-200 dark:bg-gray-700 rounded-xl" />
          <div className="h-48 bg-earth-200 dark:bg-gray-700 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">Pest & Disease Alerts</h1>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-red-700 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const banner = OVERALL_BANNER[data.overall_risk];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">Pest & Disease Alerts</h1>
        {lastUpdated && (
          <span className="text-sm text-earth-500 dark:text-gray-400">
            Updated {formatGardenTimeFromDate(lastUpdated)}
          </span>
        )}
      </div>

      {/* Overall risk banner */}
      <div className={`${banner.bg} ${banner.border} border rounded-xl p-4 sm:p-6`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">
            {data.overall_risk === 'high' ? '\u{1F6A8}' : data.overall_risk === 'medium' ? '\u{26A0}\u{FE0F}' : '\u{2705}'}
          </span>
          <div>
            <h2 className={`text-lg font-bold ${banner.text}`}>
              Overall Risk: {banner.label}
            </h2>
            <p className={`text-sm mt-1 ${banner.text} opacity-80`}>{banner.message}</p>
          </div>
        </div>
      </div>

      {/* Current conditions summary */}
      {data.conditions && (
        <div className="bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 rounded-xl p-4 sm:p-6">
          <h3 className="font-semibold text-earth-700 dark:text-gray-200 mb-3">Current Conditions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-sm">
            {data.conditions.temperature_f !== null && (
              <div className="text-center">
                <div className="text-earth-500 dark:text-gray-400">Temp</div>
                <div className="font-bold text-earth-800 dark:text-gray-100">{data.conditions.temperature_f}°F</div>
              </div>
            )}
            {data.conditions.humidity_pct !== null && (
              <div className="text-center">
                <div className="text-earth-500 dark:text-gray-400">Humidity</div>
                <div className="font-bold text-earth-800 dark:text-gray-100">{data.conditions.humidity_pct}%</div>
              </div>
            )}
            {data.conditions.wind_speed_mph !== null && (
              <div className="text-center">
                <div className="text-earth-500 dark:text-gray-400">Wind</div>
                <div className="font-bold text-earth-800 dark:text-gray-100">{data.conditions.wind_speed_mph} mph</div>
              </div>
            )}
            {data.conditions.rain_today_in !== null && (
              <div className="text-center">
                <div className="text-earth-500 dark:text-gray-400">Rain Today</div>
                <div className="font-bold text-earth-800 dark:text-gray-100">{data.conditions.rain_today_in} in</div>
              </div>
            )}
            {data.conditions.uv_index !== null && (
              <div className="text-center">
                <div className="text-earth-500 dark:text-gray-400">UV Index</div>
                <div className="font-bold text-earth-800 dark:text-gray-100">{data.conditions.uv_index}</div>
              </div>
            )}
            {data.conditions.max_soil_moisture_pct !== null && (
              <div className="text-center">
                <div className="text-earth-500 dark:text-gray-400">Max Soil Moisture</div>
                <div className="font-bold text-earth-800 dark:text-gray-100">{data.conditions.max_soil_moisture_pct}%</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alert cards */}
      {data.alerts.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 rounded-xl p-8 text-center">
          <span className="text-4xl block mb-3">{'\u{1F33F}'}</span>
          <p className="text-earth-600 dark:text-gray-300 font-medium">No active pest or disease alerts</p>
          <p className="text-earth-400 dark:text-gray-500 text-sm mt-1">Current conditions are not triggering any risk thresholds.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.alerts.map((alert, i) => {
            const config = SEVERITY_CONFIG[alert.severity];
            return (
              <div
                key={i}
                className={`${config.bg} ${config.border} border rounded-xl p-4 sm:p-6`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                  <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">
                    {alert.type}
                  </h3>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${config.badge} w-fit`}>
                    {alert.severity} risk
                  </span>
                </div>

                <p className="text-earth-700 dark:text-gray-300 text-sm mb-4">{alert.description}</p>

                {alert.affected_plants.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-earth-600 dark:text-gray-400 mb-2">Affected Plants in Your Garden</h4>
                    <div className="flex flex-wrap gap-2">
                      {alert.affected_plants.map((plant) => {
                        const pid = plantNameToId[plant.toLowerCase()];
                        return pid ? (
                          <Link
                            key={plant}
                            href={`/plants?highlight=${pid}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white/70 dark:bg-gray-700/70 rounded-lg text-sm text-earth-700 dark:text-gray-200 border border-earth-200 dark:border-gray-600 hover:border-garden-400 dark:hover:border-garden-600 hover:text-garden-700 dark:hover:text-garden-400 transition-colors"
                          >
                            <span>{getPlantIcon(plant)}</span>
                            {plant}
                          </Link>
                        ) : (
                          <span
                            key={plant}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white/70 dark:bg-gray-700/70 rounded-lg text-sm text-earth-700 dark:text-gray-200 border border-earth-200 dark:border-gray-600"
                          >
                            <span>{getPlantIcon(plant)}</span>
                            {plant}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-semibold text-earth-600 dark:text-gray-400 mb-2">Prevention Tips</h4>
                  <ul className="space-y-1">
                    {alert.prevention_tips.map((tip, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-earth-700 dark:text-gray-300">
                        <span className="text-garden-600 dark:text-garden-400 mt-0.5 flex-shrink-0">{'\u{2022}'}</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
