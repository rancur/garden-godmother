'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getSensorWeather, getSensorRachio, getSensorMoisture, getSensorSummary, getSensorHistoryChart, getTempestLocal } from '../api';
import { CardSkeleton } from '../skeleton';
import { formatGardenTimeFromDate } from '../timezone';

/** Returns true if value is null, undefined, "unknown", or "unavailable" */
function isInvalid(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    return s === 'unknown' || s === 'unavailable' || s === '';
  }
  return false;
}

interface WeatherData {
  condition: string | null;
  temperature: number | null;
  temperature_unit?: string;
  humidity: number | null;
  humidity_unit?: string;
  wind_speed: number | null;
  wind_speed_unit?: string;
  wind_gust: number | null;
  wind_direction: number | null;
  uv_index: number | null;
  solar_radiation: number | null;
  solar_radiation_unit?: string;
  rain_today: number | null;
  rain_today_unit?: string;
  rain_yesterday: number | null;
  rain_intensity: number | null;
  pressure: number | null;
  pressure_trend: string | null;
  dew_point: number | null;
  feels_like: number | null;
  brightness: number | null;
  [key: string]: unknown;
}

interface RachioData {
  controller: {
    status: string;
    friendly_name: string;
  } | null;
  next_scheduled_run: {
    active: boolean;
    message: string | null;
    start_time: string | null;
    end_time: string | null;
    description: string | null;
  } | null;
  note: string;
}

interface MoistureSensor {
  location: string;
  soil_moisture: number | null;
  temperature: number | null;
  humidity: number | null;
  battery: number | null;
  available: boolean;
  [key: string]: unknown;
}

interface MoistureData {
  sensors: MoistureSensor[];
}

interface SummaryData {
  weather: {
    condition: string | null;
    temperature_f: number | null;
    humidity_pct: number | null;
    uv_index: number | null;
    wind_speed_mph: number | null;
    rain_today_in: number | null;
    solar_radiation_wm2: number | null;
  };
  rachio: {
    any_zone_running: boolean;
  };
  moisture: {
    location: string;
    soil_moisture: number | null;
    available: boolean;
  }[];
  recommendation: {
    action: string;
    message: string;
    reasons: string[];
  };
}

function conditionIcon(condition: string | null): string {
  const map: Record<string, string> = {
    sunny: '\u2600\uFE0F', clear: '\u2600\uFE0F', 'clear-night': '\uD83C\uDF19',
    partlycloudy: '\u26C5', cloudy: '\u2601\uFE0F',
    rainy: '\uD83C\uDF27\uFE0F', pouring: '\uD83C\uDF27\uFE0F', snowy: '\u2744\uFE0F',
    windy: '\uD83D\uDCA8', fog: '\uD83C\uDF2B\uFE0F', hail: '\uD83C\uDF28\uFE0F',
    lightning: '\u26A1', 'lightning-rainy': '\u26C8\uFE0F',
    exceptional: '\u26A0\uFE0F',
  };
  return map[condition || ''] || '\uD83C\uDF21\uFE0F';
}

function uvLevel(uv: number | null): { label: string; color: string } {
  if (uv === null) return { label: 'N/A', color: 'text-gray-400' };
  if (uv <= 2) return { label: 'Low', color: 'text-green-600' };
  if (uv <= 5) return { label: 'Moderate', color: 'text-yellow-600' };
  if (uv <= 7) return { label: 'High', color: 'text-orange-500' };
  if (uv <= 10) return { label: 'Very High', color: 'text-red-600' };
  return { label: 'Extreme', color: 'text-purple-700' };
}

function Sparkline({ values, color = '#16a34a', width = 80, height = 24 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="inline-block ml-2 align-middle">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function moistureColor(value: number | null): string {
  if (value === null) return 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500';
  if (value < 20) return 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700';
  if (value < 60) return 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700';
  return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700';
}

function moistureLabel(value: number | null): string {
  if (value === null) return 'Unavailable';
  if (value < 20) return 'Dry';
  if (value < 60) return 'Good';
  return 'Wet';
}

function windDirection(deg: number | null): string {
  if (deg === null) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function recommendationStyle(action: string): string {
  switch (action) {
    case 'water': return 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200';
    case 'skip': return 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-700 text-blue-900 dark:text-blue-200';
    case 'none': return 'bg-green-50 dark:bg-green-900/20 border-green-400 dark:border-green-700 text-green-900 dark:text-green-200';
    default: return 'bg-gray-50 dark:bg-gray-800 border-gray-400 dark:border-gray-600 text-gray-900 dark:text-gray-200';
  }
}

function recommendationIcon(action: string): string {
  switch (action) {
    case 'water': return '\uD83D\uDCA7';
    case 'skip': return '\uD83C\uDF27\uFE0F';
    case 'none': return '\u2705';
    default: return '\uD83D\uDC40';
  }
}

export default function SensorsPage() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [rachio, setRachio] = useState<RachioData | null>(null);
  const [moisture, setMoisture] = useState<MoistureData | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [tempestLocal, setTempestLocal] = useState<{ receiving: boolean; observation: Record<string, any> } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [w, r, m, s, tl] = await Promise.all([
        getSensorWeather().catch(() => null),
        getSensorRachio().catch(() => null),
        getSensorMoisture().catch(() => null),
        getSensorSummary().catch(() => null),
        getTempestLocal().catch(() => null),
      ]);
      setWeather(w);
      setRachio(r);
      setMoisture(m);
      setSummary(s);
      setTempestLocal(tl);
      setError(null);
      setLastUpdated(new Date());

      // Fetch sparkline data for key sensors (last 24h)
      const sparklineKeys = ['temperature', 'humidity', 'uv_index', 'wind_speed', 'solar_radiation'];
      const sparkResults = await Promise.all(
        sparklineKeys.map(k => getSensorHistoryChart(k, 24).catch(() => null))
      );
      const newSparklines: Record<string, number[]> = {};
      sparklineKeys.forEach((k, i) => {
        if (sparkResults[i]?.values?.length > 1) {
          newSparklines[k] = sparkResults[i].values;
        }
      });
      setSparklines(newSparklines);
    } catch (err) {
      setError('Failed to fetch sensor data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 min-h-[50vh]">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-earth-900 dark:text-gray-100">Garden Sensors</h1>
        <div className="text-sm text-earth-400 dark:text-gray-500">
          {lastUpdated && `Updated ${formatGardenTimeFromDate(lastUpdated)}`}
          {' '}
          <button onClick={fetchData} className="text-garden-600 hover:text-garden-800 font-medium ml-2">
            Refresh
          </button>
          <Link href="/sensors/history" className="text-garden-600 hover:text-garden-800 font-medium ml-3">
            View History
          </Link>
          <Link href="/sensors/water-usage" className="text-garden-600 hover:text-garden-800 font-medium ml-3">
            Water Usage
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-4 text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Watering Recommendation Banner */}
      {summary?.recommendation && (
        <div className={`border-l-4 rounded-lg p-4 ${recommendationStyle(summary.recommendation.action)}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{recommendationIcon(summary.recommendation.action)}</span>
            <div>
              <p className="font-semibold text-lg">{summary.recommendation.message}</p>
              {summary.recommendation.reasons.length > 0 && (
                <ul className="mt-1 text-sm opacity-80 list-disc list-inside">
                  {summary.recommendation.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== SECTION 1: WEATHER ===== */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 overflow-hidden">
        <div className="bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {conditionIcon(weather?.condition ?? null)}
            Weather Station
          </h2>
          <p className="text-sky-100 text-sm">Tempest Weather Station</p>
        </div>
        <div className="p-6">
          {weather ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {!isInvalid(weather.temperature) && (
                <div className="text-center p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-orange-700 dark:text-orange-300">
                    {weather.temperature}
                    <span className="text-lg">&deg;F</span>
                  </div>
                  <div className="text-sm text-orange-500 dark:text-orange-400 mt-1">Temperature</div>
                  {sparklines.temperature && <Sparkline values={sparklines.temperature} color="#c2410c" />}
                  {!isInvalid(weather.feels_like) && weather.feels_like !== weather.temperature && (
                    <div className="text-xs text-orange-400 dark:text-orange-500">Feels like {weather.feels_like}&deg;F</div>
                  )}
                </div>
              )}
              {!isInvalid(weather.humidity) && (
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                    {weather.humidity}
                    <span className="text-lg">%</span>
                  </div>
                  <div className="text-sm text-blue-500 dark:text-blue-400 mt-1">Humidity</div>
                  {sparklines.humidity && <Sparkline values={sparklines.humidity} color="#1d4ed8" />}
                </div>
              )}
              {!isInvalid(weather.uv_index) && (
                <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className={`text-3xl font-bold ${uvLevel(weather.uv_index).color}`}>
                    {weather.uv_index}
                  </div>
                  <div className="text-sm text-purple-500 dark:text-purple-400 mt-1">UV Index</div>
                  {sparklines.uv_index && <Sparkline values={sparklines.uv_index} color="#7e22ce" />}
                  <div className={`text-xs font-medium ${uvLevel(weather.uv_index).color}`}>
                    {uvLevel(weather.uv_index).label}
                  </div>
                </div>
              )}
              {!isInvalid(weather.wind_speed) && (
                <div className="text-center p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-teal-700 dark:text-teal-300">
                    {weather.wind_speed!.toFixed(1)}
                  </div>
                  <div className="text-sm text-teal-500 dark:text-teal-400 mt-1">
                    Wind (mph) {!isInvalid(weather.wind_direction) ? windDirection(weather.wind_direction) : ''}
                  </div>
                  {sparklines.wind_speed && <Sparkline values={sparklines.wind_speed} color="#0d9488" />}
                  {!isInvalid(weather.wind_gust) && (
                    <div className="text-xs text-teal-400 dark:text-teal-500">Gusts: {weather.wind_gust!.toFixed(1)} mph</div>
                  )}
                </div>
              )}
              {!isInvalid(weather.rain_today) && (
                <div className="text-center p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-indigo-700 dark:text-indigo-300">
                    {weather.rain_today}
                    <span className="text-lg">in</span>
                  </div>
                  <div className="text-sm text-indigo-500 dark:text-indigo-400 mt-1">Rain Today</div>
                  {!isInvalid(weather.rain_yesterday) && weather.rain_yesterday! > 0 && (
                    <div className="text-xs text-indigo-400 dark:text-indigo-500">Yesterday: {weather.rain_yesterday} in</div>
                  )}
                </div>
              )}
              {!isInvalid(weather.solar_radiation) && (
                <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-yellow-700 dark:text-yellow-300">
                    {weather.solar_radiation}
                  </div>
                  <div className="text-sm text-yellow-500 dark:text-yellow-400 mt-1">Solar (W/m2)</div>
                  {sparklines.solar_radiation && <Sparkline values={sparklines.solar_radiation} color="#a16207" />}
                  {!isInvalid(weather.brightness) && (
                    <div className="text-xs text-yellow-400 dark:text-yellow-500">{weather.brightness!.toLocaleString()} lux</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-earth-400 dark:text-gray-500 py-8">Weather data unavailable</div>
          )}
        </div>
      </div>

      {/* ===== LOCAL TEMPEST UDP ===== */}
      {tempestLocal?.receiving && tempestLocal.observation && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              {'\uD83D\uDCE1'} Local Tempest (UDP)
            </h2>
            <p className="text-emerald-100 text-sm">Real-time data from local network — no cloud</p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {tempestLocal.observation.temperature_f != null && (
                <div className="text-center p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-orange-700 dark:text-orange-300">
                    {tempestLocal.observation.temperature_f}<span className="text-lg">&deg;F</span>
                  </div>
                  <div className="text-sm text-orange-500 dark:text-orange-400 mt-1">Temperature</div>
                </div>
              )}
              {tempestLocal.observation.humidity != null && (
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                    {tempestLocal.observation.humidity}<span className="text-lg">%</span>
                  </div>
                  <div className="text-sm text-blue-500 dark:text-blue-400 mt-1">Humidity</div>
                </div>
              )}
              {tempestLocal.observation.uv_index != null && (
                <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className={`text-3xl font-bold ${uvLevel(tempestLocal.observation.uv_index).color}`}>
                    {tempestLocal.observation.uv_index}
                  </div>
                  <div className="text-sm text-purple-500 dark:text-purple-400 mt-1">UV Index</div>
                  <div className={`text-xs font-medium ${uvLevel(tempestLocal.observation.uv_index).color}`}>
                    {uvLevel(tempestLocal.observation.uv_index).label}
                  </div>
                </div>
              )}
              {tempestLocal.observation.wind_avg_mph != null && (
                <div className="text-center p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-teal-700 dark:text-teal-300">
                    {tempestLocal.observation.wind_avg_mph}
                  </div>
                  <div className="text-sm text-teal-500 dark:text-teal-400 mt-1">
                    Wind (mph) {tempestLocal.observation.wind_direction != null ? windDirection(tempestLocal.observation.wind_direction) : ''}
                  </div>
                  {tempestLocal.observation.wind_gust_mph != null && (
                    <div className="text-xs text-teal-400 dark:text-teal-500">Gusts: {tempestLocal.observation.wind_gust_mph} mph</div>
                  )}
                </div>
              )}
              {tempestLocal.observation.daily_rain_in != null && (
                <div className="text-center p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-indigo-700 dark:text-indigo-300">
                    {tempestLocal.observation.daily_rain_in}<span className="text-lg">in</span>
                  </div>
                  <div className="text-sm text-indigo-500 dark:text-indigo-400 mt-1">Rain Today</div>
                </div>
              )}
              {tempestLocal.observation.solar_radiation != null && (
                <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-yellow-700 dark:text-yellow-300">
                    {tempestLocal.observation.solar_radiation}
                  </div>
                  <div className="text-sm text-yellow-500 dark:text-yellow-400 mt-1">Solar (W/m2)</div>
                  {tempestLocal.observation.illuminance != null && (
                    <div className="text-xs text-yellow-400 dark:text-yellow-500">{tempestLocal.observation.illuminance.toLocaleString()} lux</div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-earth-400 dark:text-gray-500">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Receiving via UDP
              {tempestLocal.observation.serial && <span>from {tempestLocal.observation.serial}</span>}
              {tempestLocal.observation.battery_volts != null && <span>| Battery: {tempestLocal.observation.battery_volts}V</span>}
              {tempestLocal.observation.pressure_inhg != null && <span>| Pressure: {tempestLocal.observation.pressure_inhg} inHg</span>}
            </div>
          </div>
        </div>
      )}

      {/* ===== SECTION 2: SOIL MOISTURE ===== */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {'\uD83C\uDF31'} Soil Moisture Sensors
          </h2>
          <p className="text-amber-100 text-sm">Third Reality ZigBee Sensors</p>
        </div>
        <div className="p-6">
          {moisture && moisture.sensors.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {moisture.sensors.map((sensor) => (
                <div
                  key={sensor.location}
                  className={`border rounded-lg p-4 ${sensor.available ? moistureColor(sensor.soil_moisture) : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-lg">{sensor.location}</div>
                    {!sensor.available && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-medium">
                        Offline
                      </span>
                    )}
                  </div>
                  {sensor.available ? (
                    <div className="mt-2 space-y-1">
                      {!isInvalid(sensor.soil_moisture) && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-sm">Soil Moisture</span>
                            <span className="font-bold">{sensor.soil_moisture}%</span>
                          </div>
                          <div className="text-xs font-medium">
                            Status: {moistureLabel(sensor.soil_moisture)}
                          </div>
                        </>
                      )}
                      {!isInvalid(sensor.temperature) && (
                        <div className="flex justify-between text-sm opacity-70">
                          <span>Soil Temp</span>
                          <span>{sensor.temperature}&deg;F</span>
                        </div>
                      )}
                      {!isInvalid(sensor.humidity) && (
                        <div className="flex justify-between text-sm opacity-70">
                          <span>Humidity</span>
                          <span>{sensor.humidity}%</span>
                        </div>
                      )}
                      {!isInvalid(sensor.battery) && (
                        <div className="flex justify-between text-sm opacity-70">
                          <span>Battery</span>
                          <span>{sensor.battery}%</span>
                        </div>
                      )}
                      {isInvalid(sensor.soil_moisture) && isInvalid(sensor.temperature) && isInvalid(sensor.humidity) && (
                        <div className="text-sm text-gray-400 dark:text-gray-500">No readings available</div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-gray-400 dark:text-gray-500">
                      Check battery or connection
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-earth-400 py-8">No moisture sensor data available</div>
          )}
        </div>
      </div>

      {/* ===== SECTION 3: IRRIGATION (link to dedicated page) ===== */}
      <Link
        href="/irrigation"
        className="block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-earth-200 dark:border-gray-700 overflow-hidden hover:border-garden-400 dark:hover:border-garden-600 transition-colors group"
      >
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {'\uD83D\uDCA7'} Irrigation
              </h2>
              <p className="text-green-100 text-sm">Rachio Controller + Hose Timer</p>
            </div>
            {rachio?.controller && !isInvalid(rachio.controller.status) && (
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                rachio.controller.status === 'home'
                  ? 'bg-green-200/80 text-green-900'
                  : 'bg-white/20 text-white'
              }`}>
                {rachio.controller.status === 'home' ? 'Online' : rachio.controller.status}
              </span>
            )}
          </div>
        </div>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {rachio?.next_scheduled_run?.active && (
              <span className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium animate-pulse">
                {'\uD83D\uDCA7'} Currently Watering
              </span>
            )}
            <span className="text-sm text-earth-500 dark:text-gray-400">
              View zones, schedules, and watering adequacy
            </span>
          </div>
          <span className="text-garden-600 dark:text-garden-400 group-hover:translate-x-1 transition-transform font-medium">
            {'\u2192'}
          </span>
        </div>
      </Link>
    </div>
  );
}
