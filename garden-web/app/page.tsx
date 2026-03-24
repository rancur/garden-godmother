'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBeds, getTasksToday, getTasksSummary, generateTasks, completeTask, getDashboardStats, getSensorForecast } from './api';
import { useToast } from './toast';
import { CardSkeleton, Skeleton } from './skeleton';
import { taskTypeIcons } from './constants';
import { getGardenMonth, getGardenToday, formatGardenDate } from './timezone';

interface Bed {
  id: number;
  name: string;
  width_cells: number;
  height_cells: number;
  cell_size_inches: number;
  active_plantings: number;
}

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

interface DashboardStatsData {
  active_plants: number;
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

const priorityBadge: Record<string, string> = {
  urgent: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  high: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  low: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
};

function getSeasonName(): string {
  const month = getGardenMonth();
  if (month >= 3 && month <= 5) return 'Spring';
  if (month >= 6 && month <= 8) return 'Summer';
  if (month >= 9 && month <= 11) return 'Fall';
  return 'Winter';
}

function getSeasonTips(): string[] {
  const season = getSeasonName().toLowerCase();
  const tips: Record<string, string[]> = {
    spring: [
      'Start warm-season crops after your last frost date passes',
      'Mulch heavily to retain moisture as temps rise',
      'Watch for aphids on new growth',
    ],
    summer: [
      'Water deeply in early morning to beat the heat',
      'Use shade cloth for 40-50% sun reduction',
      'Plant monsoon crops in July: black-eyed peas, melons',
    ],
    fall: [
      'Perfect time for cool-season veggies: lettuce, broccoli, peas',
      'Soil temps cooling down - great for root vegetables',
      'Start seeds indoors for transplant in October',
    ],
    winter: [
      'Protect tender plants from rare frost events',
      'Great time for citrus harvest',
      'Plan and prep planters for spring planting',
    ],
  };
  return tips[season] || tips.spring;
}

export default function Dashboard() {
  const { toast } = useToast();
  const [beds, setBeds] = useState<Bed[]>([]);
  const [todayTasks, setTodayTasks] = useState<DashboardTask[]>([]);
  const [taskSummary, setTaskSummary] = useState<DashboardTaskSummary | null>(null);
  const [dashStats, setDashStats] = useState<DashboardStatsData | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
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

  useEffect(() => {
    // Silently generate tasks on dashboard load
    generateTasks().catch(() => {});
    loadTasks();
    getDashboardStats().then((data: DashboardStatsData) => setDashStats(data)).catch(() => {});
    getSensorForecast().then((data: any) => setForecast(data?.forecast || [])).catch(() => {});

    getBeds()
      .then((data) => setBeds(Array.isArray(data) ? data : []))
      .catch(() => setError('Failed to load dashboard data. Is the API running?'))
      .finally(() => setLoading(false));
  }, []);

  const today = formatGardenDate(new Date().toISOString(), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-8">
      {/* Header with Forecast */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex-shrink-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">Garden Dashboard</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1 text-sm sm:text-base">{today}</p>
        </div>

        {/* 7-Day Forecast Strip — right side */}
        {forecast.length > 0 && (
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max">
              {forecast.map((day) => {
                const localDate = getGardenToday();
                const isToday = day.date === localDate;
                return (
                  <div key={day.date} className="flex flex-col items-center text-center">
                    <span className={`text-[11px] font-semibold ${isToday ? 'text-garden-600 dark:text-garden-400' : 'text-earth-400 dark:text-gray-500'}`}>
                      {isToday ? 'Today' : day.short_day}
                    </span>
                    <span className="text-lg">{day.icon}</span>
                    <span className={`text-xs font-bold ${isToday ? 'text-earth-900 dark:text-gray-50' : 'text-earth-700 dark:text-gray-200'}`}>
                      {day.high_f != null ? `${day.high_f}°` : '--'}
                    </span>
                    <span className="text-[10px] text-earth-400 dark:text-gray-500">
                      {day.low_f != null ? `${day.low_f}°` : '--'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Link href="/planters" className="bg-green-600 dark:bg-green-700 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-green-700 dark:hover:bg-green-600 transition-all">
          <div className="text-green-100 text-sm font-medium">Active Plants</div>
          <div className="text-3xl font-bold text-white mt-1">{dashStats?.active_plants ?? 0}</div>
        </Link>
        <Link href="/planters" className="bg-amber-500 dark:bg-amber-600 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-amber-600 dark:hover:bg-amber-500 transition-all">
          <div className="text-amber-100 text-sm font-medium">Vacant Spaces</div>
          <div className="text-3xl font-bold text-white mt-1">{dashStats?.total_vacant ?? 0}</div>
          {dashStats && (
            <div className="text-xs text-amber-100/80 mt-1">{dashStats.vacant_planter_cells} planter &middot; {dashStats.vacant_tray_cells} tray</div>
          )}
        </Link>
        <Link href="/harvest/upcoming" className="bg-orange-500 dark:bg-orange-600 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-orange-600 dark:hover:bg-orange-500 transition-all">
          <div className="text-orange-100 text-sm font-medium">Next Harvest</div>
          {dashStats?.next_harvest ? (
            <>
              <div className="text-3xl font-bold text-white mt-1">{dashStats.next_harvest.days} days</div>
              <div className="text-xs text-orange-100/80 mt-1">{dashStats.next_harvest.plant_name}{dashStats.next_harvest.bed_name ? ` \u00B7 ${dashStats.next_harvest.bed_name}` : ''}</div>
            </>
          ) : (
            <div className="text-xl font-bold text-orange-100 mt-1">None planned</div>
          )}
        </Link>
        <Link href="/tasks" className="bg-garden-600 dark:bg-garden-700 rounded-xl p-5 shadow-sm hover:shadow-md hover:bg-garden-700 dark:hover:bg-garden-600 transition-all">
          <div className="text-garden-100 text-sm font-medium">Tasks Due</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-bold text-white">{dashStats?.tasks_due_today ?? taskSummary?.due_today ?? 0}</span>
            {(dashStats?.tasks_overdue ?? taskSummary?.overdue ?? 0) > 0 && (
              <span className="text-sm font-bold text-red-200">+{dashStats?.tasks_overdue ?? taskSummary?.overdue} overdue</span>
            )}
          </div>
        </Link>
      </div>

      {/* Today's Tasks */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 shadow-sm">
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
        {todayTasks.length === 0 ? (
          <p className="text-earth-400 dark:text-gray-500 text-sm">No tasks due today. You&apos;re all caught up!</p>
        ) : (
          <div className="space-y-2">
            {todayTasks.slice(0, 5).map((task) => (
              <div key={task.id} className={`flex items-center gap-3 p-3 rounded-lg border ${task.status === 'overdue' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-earth-100 dark:border-gray-700 bg-earth-50 dark:bg-gray-750'}`}>
                <button
                  onClick={() => handleCompleteTask(task.id)}
                  className="w-5 h-5 rounded border-2 border-earth-300 dark:border-gray-500 hover:border-green-400 dark:hover:border-green-500 shrink-0 transition-colors"
                  title="Mark complete"
                />
                <span className="text-lg">{taskTypeIcons[task.task_type] || taskTypeIcons.custom}</span>
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
                    {task.lifecycle_group_id && (
                      <Link href="/lifecycle" className="text-earth-400 dark:text-gray-500 text-xs hover:text-garden-600 dark:hover:text-garden-400 hover:underline" onClick={(e) => e.stopPropagation()}>
                        lifecycle
                      </Link>
                    )}
                  </span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityBadge[task.priority] || ''}`}>
                  {task.priority}
                </span>
              </div>
            ))}
            {todayTasks.length > 5 && (
              <Link href="/tasks" className="block text-center text-sm text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 py-2">
                +{todayTasks.length - 5} more tasks...
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Season tips removed */}

      {/* Planters Summary */}
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      ) : beds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100">Your Planters</h2>
            <Link href="/planters" className="text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 text-sm font-medium">
              View all &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {beds.map((bed) => (
              <Link
                key={bed.id}
                href={`/planters/${bed.id}`}
                className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <h3 className="font-bold text-earth-800 dark:text-gray-100">{bed.name}</h3>
                <p className="text-sm text-earth-400 dark:text-gray-500 mt-1">
                  {bed.width_cells} x {bed.height_cells} cells &middot; {bed.cell_size_inches}&quot; spacing
                </p>
                <p className="text-sm text-garden-600 dark:text-garden-400 mt-2 font-medium">
                  {bed.active_plantings || 0} active plantings
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
