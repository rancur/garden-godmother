'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  getSensorRachio,
  getIrrigationSummary,
  getIrrigationSchedules,
  getIrrigationScheduleHistory,
  getIrrigationZones,
  getIrrigationZoneTotals,
  getWateringAdequacy,
  getSensorMoisture,
} from '../api';
import { CardSkeleton } from '../skeleton';
import { formatGardenTime, formatGardenDate, formatGardenTimeFromDate, getGardenToday } from '../timezone';

/* ─── Types ─── */

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

interface AdequacyEntry {
  bed_id: number;
  bed_name: string;
  irrigation_type: string | null;
  zone_name: string | null;
  supply_minutes_per_day: number;
  schedule_count: number;
  plant_count: number;
  high_water_plants: number;
  low_water_plants: number;
  status: 'adequate' | 'marginal' | 'insufficient' | 'manual' | 'no_data';
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

/* ─── Helpers ─── */

function formatTime(hour: number | null | undefined, minute: number | null | undefined): string {
  if (hour == null) return '';
  const h = hour % 12 || 12;
  const m = String(minute ?? 0).padStart(2, '0');
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:${m} ${ampm}`;
}

function adequacyBadge(status: string) {
  switch (status) {
    case 'adequate':
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Adequate</span>;
    case 'marginal':
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">Marginal</span>;
    case 'insufficient':
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Insufficient</span>;
    case 'manual':
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">Manual</span>;
    case 'no_data':
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">No Data</span>;
    default:
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500">{status}</span>;
  }
}

/** Build a lookup: zone_name -> { schedules, next_run_time, last_run } from schedule + history data */
function buildZoneScheduleMap(scheduleData: any, wateringHistory: any): Record<string, {
  scheduleDescriptions: string[];
  nextRunISO: string | null;
  lastRunLabel: string | null;
}> {
  const map: Record<string, { scheduleDescriptions: string[]; nextRunISO: string | null; lastRunLabel: string | null }> = {};

  const ensure = (name: string) => {
    if (!map[name]) map[name] = { scheduleDescriptions: [], nextRunISO: null, lastRunLabel: null };
  };

  // Controller schedules
  if (scheduleData?.controller_schedules) {
    for (const sched of scheduleData.controller_schedules) {
      if (!sched.enabled) continue;
      for (const z of sched.zones || []) {
        if (!z.zone_name) continue;
        ensure(z.zone_name);
        const durMin = Math.round(z.duration_seconds / 60);
        map[z.zone_name].scheduleDescriptions.push(
          `${sched.name}: ${durMin} min, ${sched.frequency}`
        );
        if (sched.next_run_iso && (!map[z.zone_name].nextRunISO || sched.next_run_iso < map[z.zone_name].nextRunISO!)) {
          map[z.zone_name].nextRunISO = sched.next_run_iso;
        }
      }
    }
  }

  // Hose timer schedules
  if (scheduleData?.hose_timer_schedules) {
    for (const prog of scheduleData.hose_timer_schedules) {
      for (const run of prog.run_times || []) {
        const name = '__hose_timer__';
        ensure(name);
        map[name].scheduleDescriptions.push(
          `${prog.name}: ${run.duration_minutes} min at ${run.start_time}`
        );
      }
    }
  }

  // Recent run history
  if (wateringHistory?.zone_history) {
    for (const zh of wateringHistory.zone_history) {
      ensure(zh.zone_name);
      if (!map[zh.zone_name].lastRunLabel) {
        map[zh.zone_name].lastRunLabel = `${zh.date} (${zh.duration_minutes} min)`;
      }
    }
  }
  if (wateringHistory?.hose_timer_daily?.length > 0) {
    const latest = wateringHistory.hose_timer_daily[0];
    ensure('__hose_timer__');
    if (!map['__hose_timer__'].lastRunLabel) {
      map['__hose_timer__'].lastRunLabel = `${latest.date} (${latest.total_duration_minutes} min, ${latest.run_count} runs)`;
    }
  }

  return map;
}

function buildUpcomingSchedule(scheduleData: any) {
  const upcoming: { dateStr: string; day: string; runs: { zoneName: string; time: string; durationMin: number }[] }[] = [];
  if (!scheduleData) return upcoming;

  // Controller schedules
  for (const sched of scheduleData.controller_schedules || []) {
    if (!sched.enabled) continue;
    for (const z of sched.zones || []) {
      if (!z.zone_name || !sched.next_run_iso) continue;
      const runDate = new Date(sched.next_run_iso);
      const dateStr = runDate.toISOString().slice(0, 10);
      let dayEntry = upcoming.find(d => d.dateStr === dateStr);
      if (!dayEntry) {
        dayEntry = { dateStr, day: formatGardenDate(runDate.toISOString()), runs: [] };
        upcoming.push(dayEntry);
      }
      dayEntry.runs.push({
        zoneName: z.zone_name,
        time: formatGardenTimeFromDate(runDate),
        durationMin: Math.round(z.duration_seconds / 60),
      });
    }
  }

  // Hose timer schedules
  for (const prog of scheduleData.hose_timer_schedules || []) {
    for (const run of prog.run_times || []) {
      const today = getGardenToday();
      let dayEntry = upcoming.find(d => d.dateStr === today);
      if (!dayEntry) {
        dayEntry = { dateStr: today, day: 'Today', runs: [] };
        upcoming.push(dayEntry);
      }
      dayEntry.runs.push({
        zoneName: 'Seed Trays (Hose Timer)',
        time: run.start_time,
        durationMin: run.duration_minutes,
      });
    }
  }

  upcoming.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  return upcoming.slice(0, 7);
}

/* ─── Component ─── */

export default function IrrigationPage() {
  const [rachio, setRachio] = useState<RachioData | null>(null);
  const [irrigationSummary, setIrrigationSummary] = useState<any>(null);
  const [scheduleData, setScheduleData] = useState<any>(null);
  const [wateringHistory, setWateringHistory] = useState<any>(null);
  const [zonesData, setZonesData] = useState<any>(null);
  const [zoneTotals, setZoneTotals] = useState<any>(null);
  const [adequacy, setAdequacy] = useState<AdequacyEntry[]>([]);
  const [moisture, setMoisture] = useState<{ sensors: MoistureSensor[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [r, irr, sched, hist, zones, zt, adeq, moist] = await Promise.all([
        getSensorRachio().catch(() => null),
        getIrrigationSummary().catch(() => null),
        getIrrigationSchedules().catch(() => null),
        getIrrigationScheduleHistory(7).catch(() => null),
        getIrrigationZones().catch(() => null),
        getIrrigationZoneTotals().catch(() => null),
        getWateringAdequacy().catch(() => []),
        getSensorMoisture().catch(() => null),
      ]);
      setRachio(r);
      setIrrigationSummary(irr);
      setScheduleData(sched);
      setWateringHistory(hist);
      setZonesData(zones);
      setZoneTotals(zt);
      setAdequacy(Array.isArray(adeq) ? adeq : []);
      setMoisture(moist);
      setError(null);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Build zone schedule map for zone cards
  const zoneScheduleMap = buildZoneScheduleMap(scheduleData, wateringHistory);
  const upcomingSchedule = buildUpcomingSchedule(scheduleData);

  // Build zone totals lookup by zone name
  const zoneTotalsMap: Record<string, { total_minutes_per_day: number; schedule_count: number; schedules: any[] }> = {};
  if (zoneTotals?.zones) {
    for (const zt of zoneTotals.zones) {
      zoneTotalsMap[zt.name] = zt;
    }
  }

  // Build zone cards
  const controllerZones: {
    name: string;
    zoneNumber: number | null;
    deviceName: string;
    assignedBeds: string[];
    scheduleDesc: string[];
    nextRun: string;
    lastRun: string | null;
    isRunning: boolean;
    totalMinPerDay: number | null;
    scheduleCount: number;
    adequacyStatus: string | null;
  }[] = [];
  const hoseTimerValves: typeof controllerZones = [];

  if (zonesData) {
    for (const z of zonesData.zones || []) {
      const schedInfo = zoneScheduleMap[z.name] || { scheduleDescriptions: [], nextRunISO: null, lastRunLabel: null };
      const assignedBeds: string[] = [];
      if (irrigationSummary?.beds) {
        for (const b of irrigationSummary.beds) {
          if (b.irrigation_zone_name === z.name) assignedBeds.push(b.name);
        }
      }
      if (irrigationSummary?.ground_plants) {
        for (const gp of irrigationSummary.ground_plants) {
          if (gp.irrigation_zone_name === z.name) assignedBeds.push(gp.name);
        }
      }

      const zt = zoneTotalsMap[z.name];

      // Find worst adequacy status for beds on this zone
      const bedAdequacies = adequacy.filter(a => a.zone_name === z.name);
      let worstStatus: string | null = null;
      const statusPriority: Record<string, number> = { insufficient: 3, marginal: 2, adequate: 1, no_data: 0, manual: -1 };
      for (const ba of bedAdequacies) {
        if (!worstStatus || (statusPriority[ba.status] || 0) > (statusPriority[worstStatus] || 0)) {
          worstStatus = ba.status;
        }
      }

      controllerZones.push({
        name: z.name,
        zoneNumber: z.zone_number ?? null,
        deviceName: zonesData.device || '',
        assignedBeds,
        scheduleDesc: schedInfo.scheduleDescriptions,
        nextRun: schedInfo.nextRunISO ? formatGardenTime(schedInfo.nextRunISO) : 'None',
        lastRun: schedInfo.lastRunLabel || null,
        isRunning: z.running || false,
        totalMinPerDay: zt?.total_minutes_per_day ?? null,
        scheduleCount: zt?.schedule_count ?? 0,
        adequacyStatus: worstStatus,
      });
    }

    // Hose timer
    if (zonesData.hose_timer) {
      const schedInfo = zoneScheduleMap['__hose_timer__'] || { scheduleDescriptions: [], nextRunISO: null, lastRunLabel: null };
      const assignedBeds: string[] = [];
      if (irrigationSummary?.beds) {
        for (const b of irrigationSummary.beds) {
          if (b.irrigation_type === 'rachio_hose_timer') assignedBeds.push(b.name);
        }
      }
      if (irrigationSummary?.trays) {
        for (const t of irrigationSummary.trays) {
          if (t.irrigation_type === 'rachio_hose_timer') assignedBeds.push(`${t.name} (tray)`);
        }
      }
      hoseTimerValves.push({
        name: zonesData.hose_timer.valve_name || 'Hose Timer Valve',
        zoneNumber: null,
        deviceName: 'Hose Timer',
        assignedBeds,
        scheduleDesc: schedInfo.scheduleDescriptions,
        nextRun: schedInfo.nextRunISO ? formatGardenTime(schedInfo.nextRunISO) : 'None',
        lastRun: schedInfo.lastRunLabel || null,
        isRunning: zonesData.hose_timer.is_watering || false,
        totalMinPerDay: null,
        scheduleCount: 0,
        adequacyStatus: null,
      });
    }
  }

  // Detect currently running
  let runningBanner = false;
  if (rachio?.next_scheduled_run?.active && rachio.next_scheduled_run.message) {
    const runningMsg = rachio.next_scheduled_run.message.toLowerCase();
    if (runningMsg.includes('running') || runningMsg.includes('watering')) {
      runningBanner = true;
    }
  }

  // Build moisture lookup by location
  const moistureByLocation: Record<string, MoistureSensor> = {};
  if (moisture?.sensors) {
    for (const s of moisture.sensors) {
      moistureByLocation[s.location] = s;
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-200">{'\uD83D\uDCA7'} Irrigation</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-200 flex items-center gap-2">
            {'\uD83D\uDCA7'} Irrigation
          </h1>
          <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
            Rachio Controller + Hose Timer
            {rachio?.controller && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                rachio.controller.status === 'home'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}>
                {rachio.controller.status === 'home' ? 'Online' : rachio.controller.status}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sensors/water-usage" className="text-sm text-garden-600 hover:text-garden-800 dark:text-garden-400 dark:hover:text-garden-300 font-medium">
            Water Usage {'\u2192'}
          </Link>
          {lastUpdated && (
            <span className="text-xs text-earth-400 dark:text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Currently Running Banner */}
      {rachio?.next_scheduled_run?.active && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl animate-pulse">
          <span className="text-2xl">{'\uD83D\uDCA7'}</span>
          <div>
            <div className="font-semibold text-blue-800 dark:text-blue-300">Currently Watering</div>
            {rachio.next_scheduled_run.message && (
              <div className="text-sm text-blue-600 dark:text-blue-400">{rachio.next_scheduled_run.message}</div>
            )}
          </div>
        </div>
      )}

      {/* Manual Watering Alert */}
      {irrigationSummary?.manual_needing_water_today?.length > 0 && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
          <div className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-1">
            {'\uD83E\uDEA3'} Needs Manual Watering Today
          </div>
          <div className="text-sm text-amber-600 dark:text-amber-400">
            {irrigationSummary.manual_needing_water_today.map((b: any) => b.name).join(', ')}
          </div>
        </div>
      )}

      {/* ===== Zone Overview Cards ===== */}
      <div>
        <h2 className="text-lg font-bold text-earth-800 dark:text-gray-200 mb-3">
          Controller Zones
          {zonesData?.device && (
            <span className="text-sm font-normal text-earth-400 dark:text-gray-500 ml-2">
              &mdash; {zonesData.device}
            </span>
          )}
        </h2>
        {controllerZones.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {controllerZones.map((zone) => (
              <div
                key={zone.name}
                className={`border rounded-xl p-4 ${
                  zone.isRunning
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 ring-2 ring-blue-300 dark:ring-blue-700'
                    : 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-earth-800 dark:text-gray-200 flex items-center gap-2">
                    {'\uD83D\uDCA7'} {zone.name}
                    {zone.zoneNumber != null && (
                      <span className="text-xs font-normal text-earth-400 dark:text-gray-500">(Zone {zone.zoneNumber})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {zone.isRunning && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 animate-pulse">
                        Running
                      </span>
                    )}
                    {zone.adequacyStatus && adequacyBadge(zone.adequacyStatus)}
                  </div>
                </div>

                {/* Daily total */}
                {zone.totalMinPerDay != null && zone.scheduleCount > 0 && (
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2 bg-blue-50 dark:bg-blue-900/20 rounded px-2 py-1">
                    {zone.totalMinPerDay} min/day &middot; {zone.scheduleCount} schedule{zone.scheduleCount !== 1 ? 's' : ''}
                  </div>
                )}

                {zone.assignedBeds.length > 0 && (
                  <div className="text-xs text-earth-500 dark:text-gray-400 mb-2">
                    <span className="font-medium">Waters:</span> {zone.assignedBeds.join(', ')}
                  </div>
                )}

                {zone.scheduleDesc.length > 0 && (
                  <div className="text-xs text-earth-500 dark:text-gray-400 mb-1.5 space-y-0.5">
                    {zone.scheduleDesc.map((desc, i) => (
                      <div key={i} className="flex items-start gap-1">
                        <span className="text-green-500 mt-0.5">{'\u2022'}</span>
                        <span>{desc}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2 pt-2 border-t border-earth-100 dark:border-gray-700 text-xs space-y-0.5">
                  <div className="flex justify-between text-earth-500 dark:text-gray-400">
                    <span>Next run</span>
                    <span className="font-medium text-earth-700 dark:text-gray-300">{zone.nextRun}</span>
                  </div>
                  {zone.lastRun && (
                    <div className="flex justify-between text-earth-500 dark:text-gray-400">
                      <span>Last run</span>
                      <span>{zone.lastRun}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-earth-400 dark:text-gray-500 py-8 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700">
            No controller zones found
          </div>
        )}
      </div>

      {/* ===== Hose Timer ===== */}
      {hoseTimerValves.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-teal-500"></span>
            Hose Timer
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hoseTimerValves.map((valve) => (
              <div
                key={valve.name}
                className="border rounded-xl p-4 bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700"
              >
                <div className="font-semibold text-earth-800 dark:text-gray-200 flex items-center gap-2 mb-2">
                  {'\uD83D\uDCA7'} {valve.name}
                  {valve.isRunning && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 animate-pulse">
                      Running
                    </span>
                  )}
                </div>
                {valve.assignedBeds.length > 0 && (
                  <div className="text-xs text-earth-500 dark:text-gray-400 mb-2">
                    <span className="font-medium">Waters:</span> {valve.assignedBeds.join(', ')}
                  </div>
                )}
                {valve.scheduleDesc.length > 0 && (
                  <div className="text-xs text-earth-500 dark:text-gray-400 mb-1.5 space-y-0.5">
                    {valve.scheduleDesc.map((desc, i) => (
                      <div key={i} className="flex items-start gap-1">
                        <span className="text-teal-500 mt-0.5">{'\u2022'}</span>
                        <span>{desc}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-earth-100 dark:border-gray-700 text-xs space-y-0.5">
                  <div className="flex justify-between text-earth-500 dark:text-gray-400">
                    <span>Next run</span>
                    <span className="font-medium text-earth-700 dark:text-gray-300">{valve.nextRun}</span>
                  </div>
                  {valve.lastRun && (
                    <div className="flex justify-between text-earth-500 dark:text-gray-400">
                      <span>Last run</span>
                      <span>{valve.lastRun}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== Per-Planter Water Status ===== */}
      {adequacy.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-200 mb-3">
            Planter Watering Adequacy
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-earth-50 dark:bg-gray-900/50 text-left text-xs uppercase tracking-wide text-earth-500 dark:text-gray-400">
                    <th className="px-4 py-3 font-semibold">Planter</th>
                    <th className="px-4 py-3 font-semibold">Zone</th>
                    <th className="px-4 py-3 font-semibold text-center">Supply</th>
                    <th className="px-4 py-3 font-semibold text-center">Plants</th>
                    <th className="px-4 py-3 font-semibold text-center">High Water</th>
                    <th className="px-4 py-3 font-semibold text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-earth-100 dark:divide-gray-700">
                  {adequacy.map((a) => (
                    <tr key={a.bed_id} className="hover:bg-earth-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-earth-800 dark:text-gray-200">
                        <Link href={`/planters/${a.bed_id}`} className="hover:text-garden-600 dark:hover:text-garden-400">
                          {a.bed_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-earth-600 dark:text-gray-300">
                        {a.zone_name || (a.irrigation_type === 'manual' ? 'Manual' : '\u2014')}
                      </td>
                      <td className="px-4 py-3 text-center text-earth-600 dark:text-gray-300">
                        {a.supply_minutes_per_day > 0 ? (
                          <span>{a.supply_minutes_per_day} min/day <span className="text-xs text-earth-400">({a.schedule_count})</span></span>
                        ) : (
                          <span className="text-earth-400 dark:text-gray-500">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-earth-600 dark:text-gray-300">{a.plant_count}</td>
                      <td className="px-4 py-3 text-center">
                        {a.high_water_plants > 0 ? (
                          <span className="text-red-600 dark:text-red-400 font-medium">{a.high_water_plants}</span>
                        ) : (
                          <span className="text-earth-400 dark:text-gray-500">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{adequacyBadge(a.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== Upcoming Schedule ===== */}
      {upcomingSchedule.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-200 mb-3">
            Upcoming Schedule (7 days)
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 space-y-4">
            {upcomingSchedule.map((day) => (
              <div key={day.dateStr}>
                <div className="text-xs font-semibold text-earth-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                  {day.day}
                </div>
                <div className="space-y-1">
                  {day.runs.map((run, i) => (
                    <div
                      key={`${day.dateStr}-${i}`}
                      className="flex items-center justify-between text-sm bg-green-50 dark:bg-green-900/10 rounded px-3 py-1.5"
                    >
                      <span className="text-earth-700 dark:text-gray-300">{run.zoneName}</span>
                      <span className="text-earth-500 dark:text-gray-400 text-xs">
                        {run.time} &middot; {run.durationMin} min
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== Moisture Sensors ===== */}
      {moisture?.sensors && moisture.sensors.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-200 mb-3">
            Soil Moisture Sensors
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {moisture.sensors.map((s) => (
              <div
                key={s.location}
                className={`border rounded-xl p-4 ${
                  !s.available
                    ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60'
                    : s.soil_moisture != null && s.soil_moisture < 20
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    : 'bg-white dark:bg-gray-800 border-earth-200 dark:border-gray-700'
                }`}
              >
                <div className="font-semibold text-earth-800 dark:text-gray-200 mb-2">{s.location}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-garden-700 dark:text-garden-400">
                    {s.soil_moisture != null ? `${s.soil_moisture}%` : 'N/A'}
                  </span>
                  {s.soil_moisture != null && (
                    <span className={`text-xs font-medium ${
                      s.soil_moisture < 20 ? 'text-red-600 dark:text-red-400' :
                      s.soil_moisture < 60 ? 'text-green-600 dark:text-green-400' :
                      'text-blue-600 dark:text-blue-400'
                    }`}>
                      {s.soil_moisture < 20 ? 'Dry' : s.soil_moisture < 60 ? 'Good' : 'Wet'}
                    </span>
                  )}
                </div>
                {s.temperature != null && (
                  <div className="text-xs text-earth-500 dark:text-gray-400 mt-1">
                    Soil temp: {s.temperature}&deg;F
                  </div>
                )}
                {s.battery != null && (
                  <div className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
                    Battery: {s.battery}%
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No data fallback */}
      {controllerZones.length === 0 && hoseTimerValves.length === 0 && adequacy.length === 0 && !rachio && (
        <div className="text-center text-earth-400 dark:text-gray-500 py-12 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700">
          <div className="text-4xl mb-3">{'\uD83D\uDCA7'}</div>
          <div className="font-medium">No irrigation data available</div>
          <div className="text-sm mt-1">Configure Rachio integration in Settings to see irrigation data here.</div>
        </div>
      )}
    </div>
  );
}
