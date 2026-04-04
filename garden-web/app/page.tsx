'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDashboard, getTasksToday, getTasksSummary, generateTasks, completeTask, getSensorForecast, getSensorWeather, getWeatherInsights, getJournalSuggestions, quickAddJournal, getSuggestions } from './api';
import { useToast } from './toast';
import { CardSkeleton, Skeleton } from './skeleton';
import { taskTypeIcons } from './constants';
import { getGardenToday, formatGardenDate } from './timezone';
import { PullToRefresh } from './components/PullToRefresh';
import CoopSummaryWidget from './components/CoopSummaryWidget';

// ── Types ──

interface DashboardTask {
  id: number;
  task_type: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  plant_name: string | null;
  plant_id: number | null;
  bed_name: string | null;
  bed_id: number | null;
  tray_id: number | null;
  lifecycle_group_id: string | null;
}

interface DashboardTaskSummary {
  overdue: number;
  due_today: number;
  due_this_week: number;
}

interface ForecastDay {
  date: string;
  day_name: string;
  short_day: string;
  condition: string;
  high_f: number | null;
  low_f: number | null;
  precipitation_probability: number;
  icon: string;
}

interface WeatherData {
  condition: string | null;
  temperature: number | null;
  temperature_unit?: string;
  humidity: number | null;
  wind_speed: number | null;
  wind_speed_unit?: string;
  uv_index: number | null;
  rain_today: number | null;
  rain_today_unit?: string;
}

interface PlanterFill {
  id: number;
  name: string;
  total_cells: number;
  occupied: number;
}

interface RecentHarvest {
  harvest_date: string;
  weight_oz: number | null;
  quantity: number | null;
  quality: string | null;
  plant_name: string;
  bed_name: string | null;
}

interface RecentJournal {
  entry_type: string;
  title: string | null;
  content: string | null;
  created_at: string;
  plant_name: string | null;
  bed_name: string | null;
}

interface RecentPlanting {
  planted_date: string;
  status: string;
  plant_name: string;
  bed_name: string | null;
}

interface HealthSummary {
  total: number;
  healthy: number;
  issues: number;
}

interface DashboardData {
  stats: {
    active_plants: number;
    active_in_planters: number;
    active_in_ground: number;
    active_in_trays: number;
    vacant_planter_cells: number;
    vacant_tray_cells: number;
    total_vacant: number;
    next_harvest: {
      plant_name: string;
      days: number;
      date: string;
      bed_name: string | null;
    } | null;
    tasks_due_today: number;
    tasks_overdue: number;
  };
  planter_fill: PlanterFill[];
  recent_harvests: RecentHarvest[];
  recent_journal: RecentJournal[];
  recent_plantings: RecentPlanting[];
  health_summary: HealthSummary | null;
}

interface WeatherInsight {
  type: string;
  action: string;
  reason: string;
}

interface QuickAction {
  label: string;
  entry_type: string;
  content: string;
  severity?: string;
  mood?: string;
  milestone_type?: string;
}

interface JournalSuggestion {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  prompt: string;
  quick_actions: QuickAction[];
  priority: number;
  planting_id?: number;
  ground_plant_id?: number;
  plant_id?: number;
  plant_name?: string;
  category?: string;
  container_type?: string;
}

interface GardenSuggestion {
  id: string;
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  body: string;
  action_label: string;
  action_url: string;
  entity_id: number;
  entity_type: string;
}

const priorityBadge: Record<string, string> = {
  urgent: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  high: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  low: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
};

const activityIcons: Record<string, string> = {
  harvest: '\uD83C\uDF3D',
  planting: '\uD83C\uDF31',
  journal: '\uD83D\uDCD3',
  observation: '\uD83D\uDD0D',
  problem: '\u26A0\uFE0F',
  success: '\u2705',
  photo: '\uD83D\uDCF8',
  pest_issue: '\uD83D\uDC1B',
};

function conditionIcon(condition: string | null): string {
  if (!condition) return '\u2600\uFE0F';
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('shower')) return '\uD83C\uDF27\uFE0F';
  if (c.includes('cloud') || c.includes('overcast')) return '\u2601\uFE0F';
  if (c.includes('partly')) return '\u26C5';
  if (c.includes('storm') || c.includes('thunder')) return '\u26C8\uFE0F';
  if (c.includes('fog') || c.includes('mist')) return '\uD83C\uDF2B\uFE0F';
  if (c.includes('wind')) return '\uD83D\uDCA8';
  return '\u2600\uFE0F';
}

function uvLabel(uv: number): { text: string; color: string } {
  if (uv <= 2) return { text: 'Low', color: 'text-green-200' };
  if (uv <= 5) return { text: 'Moderate', color: 'text-yellow-200' };
  if (uv <= 7) return { text: 'High', color: 'text-orange-200' };
  if (uv <= 10) return { text: 'Very High', color: 'text-red-200' };
  return { text: 'Extreme', color: 'text-purple-200' };
}

function timeAgo(isoString: string): string {
  const now = new Date();
  const then = new Date(isoString);
  const diff = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return formatGardenDate(isoString, { month: 'short', day: 'numeric' });
}

export default function Dashboard() {
  const { toast } = useToast();
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [todayTasks, setTodayTasks] = useState<DashboardTask[]>([]);
  const [taskSummary, setTaskSummary] = useState<DashboardTaskSummary | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherInsights, setWeatherInsights] = useState<WeatherInsight[]>([]);
  const [journalSuggestions, setJournalSuggestions] = useState<JournalSuggestion[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [gardenSuggestions, setGardenSuggestions] = useState<GardenSuggestion[]>([]);
  const [dismissedGardenSuggestions, setDismissedGardenSuggestions] = useState<Set<string>>(new Set());
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = () => {
    Promise.allSettled([getTasksToday(), getTasksSummary()]).then(([todayResult, summaryResult]) => {
      if (todayResult.status === 'fulfilled') setTodayTasks(Array.isArray(todayResult.value) ? todayResult.value : []);
      if (summaryResult.status === 'fulfilled') setTaskSummary(summaryResult.value);
    });
  };

  const handleCompleteTask = async (id: number) => {
    try { await completeTask(id); loadTasks(); toast('Task completed'); } catch { toast('Failed to complete task', 'error'); }
  };

  const handleSuggestionAction = async (suggestion: JournalSuggestion, action: QuickAction) => {
    const actionId = `${suggestion.id}-${action.label}`;
    setSubmittingActionId(actionId);
    try {
      const data: Record<string, unknown> = { entry_type: action.entry_type, content: action.content };
      if (action.severity) data.severity = action.severity;
      if (action.mood) data.mood = action.mood;
      if (action.milestone_type) data.milestone_type = action.milestone_type;
      if (suggestion.plant_id) data.plant_id = suggestion.plant_id;
      if (suggestion.container_type === 'ground' && suggestion.ground_plant_id) {
        data.ground_plant_id = suggestion.ground_plant_id;
      } else if (suggestion.planting_id) {
        data.planting_id = suggestion.planting_id;
      }
      await quickAddJournal(data as any);
      setDismissedSuggestions(prev => new Set(prev).add(suggestion.id));
      toast('Journal entry saved');
    } catch {
      toast('Failed to save entry', 'error');
    } finally {
      setSubmittingActionId(null);
    }
  };

  const loadAllData = async () => {
    generateTasks().catch(() => {});
    loadTasks();
    getSensorForecast().then((data: any) => setForecast(data?.forecast || [])).catch(() => {});
    getSensorWeather().then((data: WeatherData) => setWeather(data)).catch(() => {});
    getWeatherInsights().then((data: any) => setWeatherInsights(data?.adjustments || [])).catch(() => {});
    getJournalSuggestions().then((data: JournalSuggestion[]) => {
      setJournalSuggestions(Array.isArray(data) ? data : []);
      setDismissedSuggestions(new Set());
    }).catch(() => {});
    getSuggestions().then((data: GardenSuggestion[]) => {
      setGardenSuggestions(Array.isArray(data) ? data : []);
      setDismissedGardenSuggestions(new Set());
    }).catch(() => {});
    try {
      const data = await getDashboard();
      setDashData(data);
    } catch {
      setError('Failed to load dashboard data. Is the API running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const today = formatGardenDate(new Date().toISOString(), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const stats = dashData?.stats;

  // Group tasks by type
  const tasksByType: Record<string, DashboardTask[]> = {};
  todayTasks.forEach((t) => {
    const key = t.task_type;
    if (!tasksByType[key]) tasksByType[key] = [];
    tasksByType[key].push(t);
  });

  // Build unified activity feed from harvests, journal, plantings
  const activityFeed: { icon: string; text: string; time: string; sortDate: string }[] = [];
  if (dashData) {
    dashData.recent_harvests.forEach((h) => {
      const weight = h.weight_oz ? ` \u2014 ${h.weight_oz}oz` : '';
      const qty = h.quantity ? ` (x${h.quantity})` : '';
      activityFeed.push({
        icon: activityIcons.harvest,
        text: `Harvested ${h.plant_name}${h.bed_name ? ` from ${h.bed_name}` : ''}${weight}${qty}`,
        time: timeAgo(h.harvest_date + 'T12:00:00'),
        sortDate: h.harvest_date,
      });
    });
    dashData.recent_plantings.forEach((p) => {
      activityFeed.push({
        icon: activityIcons.planting,
        text: `Planted ${p.plant_name}${p.bed_name ? ` in ${p.bed_name}` : ''}`,
        time: timeAgo(p.planted_date + 'T12:00:00'),
        sortDate: p.planted_date,
      });
    });
    dashData.recent_journal.forEach((j) => {
      const icon = activityIcons[j.entry_type] || '\uD83D\uDCD3';
      const label = j.title || j.content?.slice(0, 60) || j.entry_type;
      activityFeed.push({
        icon,
        text: `${label}${j.plant_name ? ` \u2014 ${j.plant_name}` : ''}`,
        time: timeAgo(j.created_at),
        sortDate: j.created_at,
      });
    });
  }
  activityFeed.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  const topActivity = activityFeed.slice(0, 5);

  return (
    <PullToRefresh onRefresh={loadAllData}>
    <div className="space-y-6">
      {/* ── Weather Banner ── */}
      <div className="bg-gradient-to-r from-sky-600 to-blue-700 dark:from-sky-800 dark:to-blue-900 rounded-xl p-5 shadow-md text-white">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          {/* Current Conditions */}
          <div className="flex items-start gap-4">
            <div className="text-4xl">{conditionIcon(weather?.condition ?? null)}</div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">
                  {weather?.temperature != null ? `${Math.round(weather.temperature)}\u00B0` : '--'}
                </span>
                <span className="text-sm opacity-80">
                  {weather?.condition || 'Loading...'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm opacity-90">
                {weather?.humidity != null && (
                  <span>{'\uD83D\uDCA7'} {Math.round(weather.humidity)}% humidity</span>
                )}
                {weather?.wind_speed != null && (
                  <span>{'\uD83D\uDCA8'} {Math.round(weather.wind_speed)} {weather.wind_speed_unit || 'mph'}</span>
                )}
                {weather?.uv_index != null && (
                  <span className={uvLabel(weather.uv_index).color}>
                    {'\u2600\uFE0F'} UV {weather.uv_index} ({uvLabel(weather.uv_index).text})
                  </span>
                )}
                {weather?.rain_today != null && weather.rain_today > 0 && (
                  <span>{'\uD83C\uDF27\uFE0F'} {weather.rain_today} {weather.rain_today_unit || 'in'} rain today</span>
                )}
              </div>
              <p className="text-xs opacity-60 mt-1">{today}</p>
            </div>
          </div>

          {/* 7-Day Forecast Strip */}
          {forecast.length > 0 && (
            <div className="overflow-x-auto -mx-1">
              <div className="flex gap-3 min-w-max px-1">
                {forecast.map((day) => {
                  const localDate = getGardenToday();
                  const isToday = day.date === localDate;
                  return (
                    <div key={day.date} className={`flex flex-col items-center text-center px-2 py-1.5 rounded-lg ${isToday ? 'bg-white/20' : ''}`}>
                      <span className={`text-[11px] font-semibold ${isToday ? 'text-white' : 'text-white/70'}`}>
                        {isToday ? 'Today' : day.short_day}
                      </span>
                      <span className="text-lg">{day.icon}</span>
                      <span className="text-xs font-bold text-white">
                        {day.high_f != null ? `${day.high_f}\u00B0` : '--'}
                      </span>
                      <span className="text-[10px] text-white/60">
                        {day.low_f != null ? `${day.low_f}\u00B0` : '--'}
                      </span>
                      {day.precipitation_probability > 0 && (
                        <span className="text-[9px] text-blue-200">{day.precipitation_probability}%</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* ── Stats Cards ── */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Link href="/planters" className="bg-green-600 dark:bg-green-700 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-green-700 dark:hover:bg-green-600 transition-all">
            <div className="text-green-100 text-sm font-medium">Active Plants</div>
            <div className="text-3xl font-bold text-white mt-1">{stats?.active_plants ?? 0}</div>
            {stats && (stats.active_in_planters > 0 || stats.active_in_ground > 0 || stats.active_in_trays > 0) && (
              <div className="text-xs text-green-100/80 mt-1">
                {[
                  stats.active_in_planters > 0 ? `${stats.active_in_planters} planters` : null,
                  stats.active_in_ground > 0 ? `${stats.active_in_ground} ground` : null,
                  stats.active_in_trays > 0 ? `${stats.active_in_trays} trays` : null,
                ].filter(Boolean).join(' \u00B7 ')}
              </div>
            )}
          </Link>
          <Link href="/planters" className="bg-amber-500 dark:bg-amber-600 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-amber-600 dark:hover:bg-amber-500 transition-all">
            <div className="text-amber-100 text-sm font-medium">Vacant Spaces</div>
            <div className="text-3xl font-bold text-white mt-1">{stats?.total_vacant ?? 0}</div>
            {stats && (
              <div className="text-xs text-amber-100/80 mt-1">{stats.vacant_planter_cells} planter &middot; {stats.vacant_tray_cells} tray cells</div>
            )}
          </Link>
          <Link href="/harvest/upcoming" className="bg-orange-500 dark:bg-orange-600 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-orange-600 dark:hover:bg-orange-500 transition-all">
            <div className="text-orange-100 text-sm font-medium">Next Harvest</div>
            {stats?.next_harvest ? (
              <>
                <div className="text-3xl font-bold text-white mt-1">{stats.next_harvest.days}d</div>
                <div className="text-xs text-orange-100/80 mt-1">{'\uD83C\uDF3D'} {stats.next_harvest.plant_name}{stats.next_harvest.bed_name ? ` \u00B7 ${stats.next_harvest.bed_name}` : ''}</div>
              </>
            ) : (
              <div className="text-xl font-bold text-orange-100 mt-1">None planned</div>
            )}
          </Link>
          <Link href="/tasks" className="bg-garden-600 dark:bg-garden-700 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-garden-700 dark:hover:bg-garden-600 transition-all">
            <div className="text-garden-100 text-sm font-medium">Tasks Due</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-bold text-white">{stats?.tasks_due_today ?? taskSummary?.due_today ?? 0}</span>
              {(stats?.tasks_overdue ?? taskSummary?.overdue ?? 0) > 0 && (
                <span className="text-sm font-bold text-red-200">+{stats?.tasks_overdue ?? taskSummary?.overdue} overdue</span>
              )}
            </div>
          </Link>
        </div>
      )}

      {/* ── What Needs Attention ── */}
      {(() => {
        const visibleSuggestions = gardenSuggestions.filter(s => !dismissedGardenSuggestions.has(s.id));
        if (visibleSuggestions.length === 0) return null;
        const suggestionIcons: Record<string, string> = {
          watering: '\uD83D\uDCA7',
          harvest: '\uD83E\uDDFA',
          succession: '\uD83C\uDF31',
          seed_start: '\uD83C\uDF3E',
          seed_swap: '\uD83E\uDD1D',
        };
        const priorityStyles: Record<string, string> = {
          high: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20',
          medium: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20',
          low: 'border-earth-100 dark:border-gray-700 bg-earth-50 dark:bg-gray-750',
        };
        const priorityBtnStyles: Record<string, string> = {
          high: 'bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white',
          medium: 'bg-orange-500 hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-500 text-white',
          low: 'bg-garden-600 hover:bg-garden-700 dark:bg-garden-700 dark:hover:bg-garden-600 text-white',
        };
        return (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <h2 className="text-sm font-bold text-earth-800 dark:text-gray-100">What Needs Attention</h2>
                <span className="text-xs text-earth-400 dark:text-gray-500 bg-earth-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{visibleSuggestions.length}</span>
              </div>
            </div>
            <div className="space-y-2">
              {visibleSuggestions.map((s) => (
                <div key={s.id} className={`flex items-start gap-3 rounded-xl border p-3 ${priorityStyles[s.priority] || priorityStyles.low}`}>
                  <span className="text-xl shrink-0 mt-0.5">{suggestionIcons[s.type] || '\uD83D\uDCA1'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-earth-800 dark:text-gray-100 text-sm leading-snug">{s.title}</p>
                    <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5 leading-snug">{s.body}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Link
                      href={s.action_url}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${priorityBtnStyles[s.priority] || priorityBtnStyles.low}`}
                    >
                      {s.action_label}
                    </Link>
                    <button
                      onClick={() => setDismissedGardenSuggestions(prev => new Set(prev).add(s.id))}
                      className="text-[10px] text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 text-center"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Quick Actions Bar ── */}
      <div className="overflow-x-auto -mx-1">
        <div className="flex gap-2 min-w-max px-1">
          <Link href="/journal?new=true" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 hover:border-garden-400 dark:hover:border-garden-500 hover:shadow-sm transition-all text-sm font-medium text-earth-700 dark:text-gray-200">
            <span>{'\uD83D\uDCDD'}</span> Journal
          </Link>
          <Link href="/harvest" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 hover:border-garden-400 dark:hover:border-garden-500 hover:shadow-sm transition-all text-sm font-medium text-earth-700 dark:text-gray-200">
            <span>{'\uD83E\uDDFA'}</span> Harvest
          </Link>
          <Link href="/pests" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 hover:border-garden-400 dark:hover:border-garden-500 hover:shadow-sm transition-all text-sm font-medium text-earth-700 dark:text-gray-200">
            <span>{'\uD83D\uDC1B'}</span> Pest
          </Link>
          <Link href="/planters" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 hover:border-garden-400 dark:hover:border-garden-500 hover:shadow-sm transition-all text-sm font-medium text-earth-700 dark:text-gray-200">
            <span>{'\uD83C\uDF31'}</span> Plant
          </Link>
        </div>
      </div>

      {/* ── Quick Journal Suggestions ── */}
      {(() => {
        const visible = journalSuggestions.filter(s => !dismissedSuggestions.has(s.id)).slice(0, 3);
        if (visible.length === 0) return null;
        const typeIcons: Record<string, string> = {
          weather: '\uD83C\uDF24\uFE0F',
          follow_up: '\uD83D\uDD04',
          time_context: '\u23F0',
          'check-in': '\uD83C\uDF3B',
          'harvest-check': '\uD83C\uDF3D',
        };
        return (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-garden-600 dark:text-garden-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                <h2 className="text-sm font-bold text-earth-800 dark:text-gray-100">Quick Journal</h2>
                <span className="text-xs text-earth-400 dark:text-gray-500 bg-earth-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{visible.length}</span>
              </div>
              <Link href="/journal" className="text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 text-xs font-medium">
                See all &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {visible.map((s) => (
                <div key={s.id} className="rounded-xl border border-earth-100 dark:border-gray-700 p-3 bg-earth-50 dark:bg-gray-750">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-base">{typeIcons[s.type] || '\uD83D\uDCD3'}</span>
                    <span className="font-semibold text-earth-800 dark:text-gray-100 text-xs truncate">{s.title}</span>
                  </div>
                  <p className="text-[11px] text-earth-500 dark:text-gray-400 mb-1">{s.subtitle}</p>
                  <p className="text-xs text-earth-600 dark:text-gray-300 italic mb-2 line-clamp-2">&ldquo;{s.prompt}&rdquo;</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.quick_actions.slice(0, 3).map((action) => {
                      const actionId = `${s.id}-${action.label}`;
                      const isSubmitting = submittingActionId === actionId;
                      return (
                        <button
                          key={action.label}
                          onClick={() => handleSuggestionAction(s, action)}
                          disabled={!!submittingActionId}
                          className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all active:scale-95 disabled:opacity-50 ${
                            action.entry_type === 'problem'
                              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                              : action.entry_type === 'milestone' || action.entry_type === 'harvest'
                              ? 'bg-garden-50 dark:bg-garden-900/20 text-garden-700 dark:text-garden-300 border border-garden-200 dark:border-garden-800'
                              : 'bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-300 border border-earth-200 dark:border-gray-600'
                          }`}
                        >
                          {isSubmitting ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="animate-spin w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full" />
                            </span>
                          ) : action.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Main Content Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Tasks + Planter Fill (spans 2 on desktop) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Today's Tasks */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">Today&apos;s Tasks</h2>
                {taskSummary && taskSummary.overdue > 0 && (
                  <span className="text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">
                    {taskSummary.overdue} overdue
                  </span>
                )}
              </div>
              <Link href="/tasks" className="text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 text-sm font-medium">
                View All &rarr;
              </Link>
            </div>

            {/* Weather context */}
            {weatherInsights.length > 0 && (
              <div className="mb-3 space-y-1">
                {weatherInsights.slice(0, 2).map((insight, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-700 dark:text-blue-300">
                    <span>{insight.type === 'rain_skip' ? '\uD83C\uDF27\uFE0F' : insight.type === 'heat_warning' ? '\uD83C\uDF21\uFE0F' : '\u26A0\uFE0F'}</span>
                    <span>{insight.action}{insight.reason ? ` \u2014 ${insight.reason}` : ''}</span>
                  </div>
                ))}
              </div>
            )}

            {todayTasks.length === 0 ? (
              <p className="text-earth-400 dark:text-gray-500 text-sm">No tasks due today. You&apos;re all caught up!</p>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(tasksByType).map(([type, tasks]) => (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 mb-1 mt-2 first:mt-0">
                      <span className="text-sm">{taskTypeIcons[type] || taskTypeIcons.custom}</span>
                      <span className="text-xs font-semibold text-earth-500 dark:text-gray-400 uppercase tracking-wide">
                        {type.replace(/_/g, ' ')} ({tasks.length})
                      </span>
                    </div>
                    {tasks.slice(0, 3).map((task) => (
                      <div key={task.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${task.status === 'overdue' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-earth-100 dark:border-gray-700 bg-earth-50 dark:bg-gray-750'}`}>
                        <button
                          onClick={() => handleCompleteTask(task.id)}
                          className="w-5 h-5 rounded border-2 border-earth-300 dark:border-gray-500 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 shrink-0 transition-colors"
                          title="Mark complete"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-earth-800 dark:text-gray-100 text-sm">{task.title}</span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            {task.plant_name && task.plant_id && (
                              <Link href={`/plants?highlight=${task.plant_id}`} className="text-earth-400 dark:text-gray-500 text-xs hover:text-garden-600 dark:hover:text-garden-400 hover:underline" onClick={(e) => e.stopPropagation()}>
                                {task.plant_name}
                              </Link>
                            )}
                            {task.plant_name && !task.plant_id && <span className="text-earth-400 dark:text-gray-500 text-xs">{task.plant_name}</span>}
                            {task.bed_name && task.bed_id && (
                              <Link href={`/planters/${task.bed_id}`} className="text-earth-400 dark:text-gray-500 text-xs hover:text-garden-600 dark:hover:text-garden-400 hover:underline" onClick={(e) => e.stopPropagation()}>
                                {task.bed_name}
                              </Link>
                            )}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityBadge[task.priority] || ''}`}>
                          {task.priority}
                        </span>
                      </div>
                    ))}
                    {tasks.length > 3 && (
                      <Link href="/tasks" className="block text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 pl-6 py-1">
                        +{tasks.length - 3} more {type.replace(/_/g, ' ')} tasks
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Garden At-a-Glance — Planter Fill */}
          {dashData && dashData.planter_fill.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">Garden At-a-Glance</h2>
                <Link href="/planters" className="text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 text-sm font-medium">
                  All Planters &rarr;
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {dashData.planter_fill.map((p) => {
                  const pct = p.total_cells > 0 ? Math.round((p.occupied / p.total_cells) * 100) : 0;
                  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : pct > 0 ? 'bg-orange-400' : 'bg-gray-300 dark:bg-gray-600';
                  return (
                    <Link key={p.id} href={`/planters/${p.id}`} className="flex items-center gap-3 p-3 rounded-lg border border-earth-100 dark:border-gray-700 hover:border-garden-300 dark:hover:border-garden-600 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-earth-800 dark:text-gray-100 truncate">{p.name}</span>
                          <span className="text-xs text-earth-500 dark:text-gray-400 ml-2 shrink-0">{p.occupied}/{p.total_cells}</span>
                        </div>
                        <div className="w-full h-2 bg-earth-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Activity Feed + Health */}
        <div className="space-y-6">
          {/* Recent Activity Feed */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
            <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-4">Recent Activity</h2>
            {topActivity.length === 0 ? (
              <p className="text-earth-400 dark:text-gray-500 text-sm">No recent activity yet.</p>
            ) : (
              <div className="space-y-3">
                {topActivity.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-lg mt-0.5">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-earth-700 dark:text-gray-200 leading-snug">{item.text}</p>
                      <p className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Plant Health */}
          {dashData?.health_summary && dashData.health_summary.total > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-3">Plant Health</h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{'\u2705'}</span>
                  <div>
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{dashData.health_summary.healthy}</div>
                    <div className="text-xs text-earth-500 dark:text-gray-400">Healthy</div>
                  </div>
                </div>
                {dashData.health_summary.issues > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{'\u26A0\uFE0F'}</span>
                    <div>
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">{dashData.health_summary.issues}</div>
                      <div className="text-xs text-earth-500 dark:text-gray-400">Issues</div>
                    </div>
                  </div>
                )}
              </div>
              {dashData.health_summary.issues > 0 && (
                <Link href="/pests" className="block text-sm text-garden-600 dark:text-garden-400 hover:text-garden-700 mt-3 font-medium">
                  View pest issues &rarr;
                </Link>
              )}
            </div>
          )}

          {/* Community Summary */}
          <CoopSummaryWidget />
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}
