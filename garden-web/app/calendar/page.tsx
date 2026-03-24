'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { getCalendarMonth, getPersonalCalendar, getCalendarIcalUrl } from '../api';
import { getPlantIcon } from '../plant-icons';
import { Skeleton, GridSkeleton } from '../skeleton';
import { getGardenToday, getGardenMonth, getGardenYear, formatGardenDate, getGardenDateOffset } from '../timezone';

// ── Types ──

interface PersonalEvent {
  date: string;
  type: string;
  title: string;
  plant_name?: string;
  plant_id?: number;
  planting_id?: number;
  lifecycle_id?: string;
  bed_name?: string;
  link?: string;
  priority?: string;
}

interface MonthSummary {
  month: number;
  year: number;
  harvests: number;
  plantings: number;
  seed_starts: number;
  transplants: number;
}

interface GenericCalendarEvent {
  plant_id: number;
  plant_name: string;
  event_type: string;
  category: string;
  notes: string;
}

// ── Constants ──

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const eventTypeConfig: Record<string, { dot: string; bg: string; text: string; label: string; icon: string }> = {
  lifecycle_task: { dot: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-300', label: 'Lifecycle', icon: '\u{1F331}' },
  harvest: { dot: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-300', label: 'Harvest', icon: '\u{1F345}' },
  success: { dot: 'bg-teal-500', bg: 'bg-teal-50 dark:bg-teal-900/20', text: 'text-teal-700 dark:text-teal-300', label: 'Success', icon: '\u2728' },
  transplant_ready: { dot: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', label: 'Transplant', icon: '\u{1F504}' },
  seed_opportunity: { dot: 'bg-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-300', label: 'Opportunity', icon: '\u{1F4A1}' },
  planting_window: { dot: 'bg-green-400', bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-300', label: 'Plant Window', icon: '\u{1F331}' },
  task: { dot: 'bg-gray-500', bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', label: 'Task', icon: '\u{1F4CB}' },
};

const genericEventColors: Record<string, { bg: string; text: string; label: string }> = {
  sow_indoors: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Start Indoors' },
  start_seeds: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Start Indoors' },
  sow_outdoors: { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-700 dark:text-sky-300', label: 'Direct Sow' },
  direct_sow: { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-700 dark:text-sky-300', label: 'Direct Sow' },
  transplant: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Transplant' },
  harvest: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', label: 'Harvest' },
  success: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300', label: 'Success' },
};

function getConfig(type: string) {
  return eventTypeConfig[type] || eventTypeConfig.task;
}

// ── Helpers ──

function daysInMonth(month: number, year: number) {
  return new Date(year, month, 0).getDate();
}

function startDayOfWeek(month: number, year: number) {
  return new Date(year, month - 1, 1).getDay();
}

function formatDate(iso: string) {
  return formatGardenDate(iso + 'T00:00:00', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Personal Calendar View ──

function PersonalCalendarView() {
  const [events, setEvents] = useState<PersonalEvent[]>([]);
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);

  const todayStr = getGardenToday();
  const currentMonthNum = getGardenMonth();
  const currentYear = getGardenYear();

  const [viewMonth, setViewMonth] = useState(currentMonthNum);
  const [viewYear, setViewYear] = useState(currentYear);

  const goToPrevMonth = () => {
    setSelectedDay(null);
    if (viewMonth === 1) { setViewMonth(12); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const goToNextMonth = () => {
    setSelectedDay(null);
    if (viewMonth === 12) { setViewMonth(1); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };
  const goToToday = () => {
    setViewMonth(currentMonthNum);
    setViewYear(currentYear);
    setSelectedDay(null);
    setShowMonthPicker(false);
    setShowYearPicker(false);
  };
  const selectMonth = (m: number) => {
    setViewMonth(m);
    setSelectedDay(null);
    setShowMonthPicker(false);
  };
  const adjustYear = (delta: number) => {
    setViewYear(viewYear + delta);
    setSelectedDay(null);
  };

  useEffect(() => {
    setLoading(true);
    // Fetch enough months to cover whichever month we're viewing
    const monthsToFetch = Math.max(3, Math.abs((viewYear - currentYear) * 12 + viewMonth - currentMonthNum) + 2);
    getPersonalCalendar(monthsToFetch)
      .then((data) => {
        setEvents(data?.events || []);
        setSummaries(data?.month_summaries || []);
      })
      .catch(() => {
        setEvents([]);
        setSummaries([]);
      })
      .finally(() => setLoading(false));
  }, [viewMonth, viewYear]);

  // Group events by date string
  const eventsByDate = useMemo(() => {
    const map: Record<string, PersonalEvent[]> = {};
    for (const evt of events) {
      if (!evt.date) continue;
      if (!map[evt.date]) map[evt.date] = [];
      map[evt.date].push(evt);
    }
    return map;
  }, [events]);

  // Events for the currently viewed month
  const eventsForMonth = useMemo(() => {
    return events.filter((e) => {
      if (!e.date) return false;
      const d = new Date(e.date + 'T00:00:00');
      return d.getMonth() + 1 === viewMonth && d.getFullYear() === viewYear;
    });
  }, [events, viewMonth, viewYear]);

  // Upcoming events (next 7 days)
  const upcomingEvents = useMemo(() => {
    const endStr = getGardenDateOffset(7);
    return events.filter((e) => e.date >= todayStr && e.date <= endStr);
  }, [events, todayStr]);

  // Summary for current view month
  const currentSummary = summaries.find((s) => s.month === viewMonth && s.year === viewYear);

  // Days selected
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  // Build calendar grid
  const totalDays = daysInMonth(viewMonth, viewYear);
  const firstDow = startDayOfWeek(viewMonth, viewYear);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48 mx-auto" />
        <GridSkeleton cols={7} rows={5} />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">{'\u{1F4C5}'}</div>
        <h3 className="text-lg font-bold text-earth-700 dark:text-gray-200 mb-2">Your garden calendar is empty</h3>
        <p className="text-earth-400 dark:text-gray-500 mb-6">Start by planning a plant to see personalized events here.</p>
        <Link
          href="/lifecycle"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-medium"
        >
          {'\u{1F331}'} Plan a Plant
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={goToPrevMonth}
          className="px-4 py-2 rounded-lg bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-400 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors min-h-[44px] font-medium"
        >
          &larr; Prev
        </button>
        <div className="flex items-center gap-1 relative">
          {/* Clickable month name */}
          <button
            onClick={() => { setShowMonthPicker(!showMonthPicker); setShowYearPicker(false); }}
            className="text-xl font-bold text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-earth-100 dark:hover:bg-gray-700"
          >
            {monthNames[viewMonth - 1]}
          </button>
          {/* Clickable year */}
          <button
            onClick={() => { setShowYearPicker(!showYearPicker); setShowMonthPicker(false); }}
            className="text-xl font-bold text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-earth-100 dark:hover:bg-gray-700"
          >
            {viewYear}
          </button>
          {(viewMonth !== currentMonthNum || viewYear !== currentYear) && (
            <button
              onClick={goToToday}
              className="text-xs px-2 py-1 rounded bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-400 hover:bg-garden-200 dark:hover:bg-garden-900/50 transition-colors ml-1"
            >
              Today
            </button>
          )}

          {/* Month picker dropdown */}
          {showMonthPicker && (
            <div className="absolute top-full mt-2 left-0 z-50 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 rounded-xl shadow-lg p-3 grid grid-cols-3 gap-1.5 min-w-[220px]">
              {monthNames.map((name, i) => (
                <button
                  key={i}
                  onClick={() => selectMonth(i + 1)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    viewMonth === i + 1
                      ? 'bg-garden-600 text-white'
                      : i + 1 === currentMonthNum && viewYear === currentYear
                        ? 'bg-garden-100 dark:bg-garden-900/30 text-garden-700 dark:text-garden-300 hover:bg-garden-200 dark:hover:bg-garden-900/50'
                        : 'text-earth-600 dark:text-gray-400 hover:bg-earth-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          {/* Year picker dropdown */}
          {showYearPicker && (
            <div className="absolute top-full mt-2 right-0 z-50 bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 rounded-xl shadow-lg p-3 flex items-center gap-3 min-w-[180px]">
              <button
                onClick={() => adjustYear(-1)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-400 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors font-bold"
              >
                &minus;
              </button>
              <span className="text-lg font-bold text-earth-800 dark:text-gray-100 flex-1 text-center">{viewYear}</span>
              <button
                onClick={() => adjustYear(1)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-400 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors font-bold"
              >
                +
              </button>
            </div>
          )}
        </div>
        <button
          onClick={goToNextMonth}
          className="px-4 py-2 rounded-lg bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-400 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors min-h-[44px] font-medium"
        >
          Next &rarr;
        </button>
      </div>

      {/* Summary bar */}
      {currentSummary && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-bold text-earth-800 dark:text-gray-100">{monthNames[viewMonth - 1]}:</span>
            {currentSummary.seed_starts > 0 && (
              <span className="text-green-600 dark:text-green-400">{'\u{1F331}'} {currentSummary.seed_starts} seed start{currentSummary.seed_starts !== 1 ? 's' : ''}</span>
            )}
            {currentSummary.transplants > 0 && (
              <span className="text-blue-600 dark:text-blue-400">{'\u{1F504}'} {currentSummary.transplants} transplant{currentSummary.transplants !== 1 ? 's' : ''}</span>
            )}
            {currentSummary.harvests > 0 && (
              <span className="text-orange-600 dark:text-orange-400">{'\u{1F345}'} {currentSummary.harvests} harvest{currentSummary.harvests !== 1 ? 's' : ''}</span>
            )}
            {currentSummary.plantings > 0 && (
              <span className="text-sky-600 dark:text-sky-400">{'\u{1F331}'} {currentSummary.plantings} planting{currentSummary.plantings !== 1 ? 's' : ''}</span>
            )}
            {currentSummary.seed_starts === 0 && currentSummary.transplants === 0 && currentSummary.harvests === 0 && currentSummary.plantings === 0 && (
              <span className="text-earth-400 dark:text-gray-500">No events this month</span>
            )}
          </div>
          <div className="flex gap-3 mt-3">
            <Link href="/lifecycle" className="text-xs px-3 py-1.5 rounded-full bg-garden-100 dark:bg-garden-900 text-garden-700 dark:text-garden-300 hover:bg-garden-200 dark:hover:bg-garden-800 transition-colors font-medium">
              Plan a Plant
            </Link>
            <Link href="/tasks" className="text-xs px-3 py-1.5 rounded-full bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-400 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors font-medium">
              View Tasks
            </Link>
          </div>
        </div>
      )}

      {/* Calendar grid */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-earth-200 dark:border-gray-700">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="text-center text-xs font-bold text-earth-500 dark:text-gray-400 py-2">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {/* Empty cells before first day */}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-earth-100 dark:border-gray-700/50 bg-earth-50/50 dark:bg-gray-900/30" />
          ))}

          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayEvents = eventsByDate[dateStr] || [];
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDay;
            const isPast = dateStr < todayStr;

            return (
              <button
                key={day}
                onClick={() => { setSelectedDay(isSelected ? null : dateStr); setShowMonthPicker(false); setShowYearPicker(false); }}
                className={`min-h-[80px] p-1.5 border-b border-r border-earth-100 dark:border-gray-700/50 text-left transition-colors relative ${
                  isSelected
                    ? 'bg-garden-50 dark:bg-garden-900/20 ring-2 ring-garden-400 ring-inset'
                    : isToday
                      ? 'bg-garden-50/50 dark:bg-garden-900/10'
                      : isPast
                        ? 'bg-earth-50/30 dark:bg-gray-900/20'
                        : 'hover:bg-earth-50 dark:hover:bg-gray-700/30'
                }`}
              >
                <span className={`text-xs font-medium ${
                  isToday
                    ? 'bg-garden-600 text-white rounded-full w-6 h-6 flex items-center justify-center'
                    : isPast
                      ? 'text-earth-300 dark:text-gray-600'
                      : 'text-earth-700 dark:text-gray-300'
                }`}>
                  {day}
                </span>

                {/* Event dots */}
                {dayEvents.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {dayEvents.slice(0, 5).map((evt, j) => {
                      const cfg = getConfig(evt.type);
                      return (
                        <span
                          key={j}
                          className={`w-2 h-2 rounded-full ${cfg.dot}`}
                          title={evt.title}
                        />
                      );
                    })}
                    {dayEvents.length > 5 && (
                      <span className="text-[9px] text-earth-400 dark:text-gray-500 leading-none">+{dayEvents.length - 5}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-earth-500 dark:text-gray-400">
        {Object.entries(eventTypeConfig).map(([type, cfg]) => (
          <span key={type} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </span>
        ))}
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
          <h3 className="text-sm font-bold text-earth-800 dark:text-gray-100 mb-3">
            {formatDate(selectedDay)}
          </h3>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-earth-400 dark:text-gray-500">No events on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((evt, i) => {
                const cfg = getConfig(evt.type);
                return (
                  <Link
                    key={i}
                    href={evt.link || '/calendar'}
                    className={`flex items-center gap-3 p-3 rounded-lg ${cfg.bg} transition-shadow hover:shadow-sm`}
                  >
                    <span className="text-lg">{evt.plant_name ? getPlantIcon(evt.plant_name) : cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${cfg.text}`}>{evt.title}</p>
                      {evt.plant_name && <p className="text-xs text-earth-400 dark:text-gray-500">{evt.plant_name}</p>}
                    </div>
                    {evt.priority === 'high' || evt.priority === 'urgent' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium">
                        {evt.priority}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Upcoming 7 days */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 sm:p-5 shadow-sm">
        <h3 className="text-sm font-bold text-earth-700 dark:text-gray-300 mb-3">Next 7 Days</h3>
        {upcomingEvents.length === 0 ? (
          <p className="text-sm text-earth-400 dark:text-gray-500">No events in the next week.</p>
        ) : (
          <div className="space-y-2">
            {upcomingEvents.map((evt, i) => {
              const cfg = getConfig(evt.type);
              return (
                <Link
                  key={i}
                  href={evt.link || '/calendar'}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-earth-50 dark:hover:bg-gray-700/40 transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <span className="text-xs text-earth-400 dark:text-gray-500 w-16 flex-shrink-0">
                    {formatDate(evt.date).split(',')[0]}
                  </span>
                  <span className="text-sm flex-1 min-w-0 truncate text-earth-700 dark:text-gray-200">
                    {evt.title}
                  </span>
                  {evt.plant_name && (
                    <span className="text-lg flex-shrink-0">{getPlantIcon(evt.plant_name)}</span>
                  )}
                  {(evt.priority === 'high' || evt.priority === 'urgent') && (
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500" />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── All Plants (Generic) Calendar View ──

function AllPlantsCalendarView() {
  const [currentMonth, setCurrentMonth] = useState(getGardenMonth());
  const [events, setEvents] = useState<GenericCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCalendarMonth(currentMonth)
      .then((data) => {
        const plants = data?.plants || data || [];
        if (!Array.isArray(plants)) {
          setEvents([]);
          return;
        }
        const flattened: GenericCalendarEvent[] = [];
        for (const plant of plants) {
          const eventTypes: string[] = plant.events || [];
          for (const et of eventTypes) {
            flattened.push({
              plant_id: plant.id,
              plant_name: plant.name,
              event_type: et,
              category: plant.category,
              notes: plant.notes || '',
            });
          }
        }
        setEvents(flattened);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [currentMonth]);

  const grouped = events.reduce<Record<string, GenericCalendarEvent[]>>((acc, event) => {
    const key = event.event_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(event);
    return acc;
  }, {});

  const isCurrentMonth = currentMonth === getGardenMonth();

  return (
    <div className="space-y-6">
      {/* Month navigator */}
      <div className="flex items-center gap-2 sm:gap-4">
        <button
          onClick={() => setCurrentMonth((m) => (m === 1 ? 12 : m - 1))}
          className="p-2 rounded-lg border border-earth-300 dark:border-gray-600 hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors text-earth-600 dark:text-gray-400 min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
        >
          &larr;
        </button>

        <div className="flex gap-1 flex-1 justify-center overflow-x-auto pb-1">
          {monthNames.map((name, i) => (
            <button
              key={i}
              onClick={() => setCurrentMonth(i + 1)}
              className={`px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] flex items-center ${
                currentMonth === i + 1
                  ? 'bg-garden-600 text-white'
                  : 'text-earth-500 dark:text-gray-400 hover:bg-earth-100 dark:hover:bg-gray-700'
              }`}
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>

        <button
          onClick={() => setCurrentMonth((m) => (m === 12 ? 1 : m + 1))}
          className="p-2 rounded-lg border border-earth-300 dark:border-gray-600 hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors text-earth-600 dark:text-gray-400 min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
        >
          &rarr;
        </button>
      </div>

      {/* Month heading */}
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-earth-800 dark:text-gray-100">{monthNames[currentMonth - 1]}</h2>
        {isCurrentMonth && (
          <span className="bg-garden-100 dark:bg-garden-900 text-garden-700 dark:text-garden-300 text-xs font-medium px-2.5 py-0.5 rounded-full">
            Current Month
          </span>
        )}
        <span className="text-earth-400 dark:text-gray-500 ml-auto text-sm">
          {events.length} events
        </span>
      </div>

      {/* Events */}
      {loading ? (
        <div className="space-y-4 py-4">
          <Skeleton className="h-8 w-48 mx-auto" />
          <GridSkeleton cols={7} rows={5} />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">{'\u{1F4C5}'}</div>
          <h3 className="text-lg font-bold text-earth-700 dark:text-gray-200 mb-1">Nothing scheduled for {monthNames[currentMonth - 1]}</h3>
          <p className="text-earth-400 dark:text-gray-500">Check other months or add plants to your garden.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {['sow_indoors', 'start_seeds', 'sow_outdoors', 'direct_sow', 'transplant', 'harvest'].map((eventType) => {
            const typeEvents = grouped[eventType];
            if (!typeEvents || typeEvents.length === 0) return null;
            const config = genericEventColors[eventType] || { bg: 'bg-gray-100', text: 'text-gray-700', label: eventType };

            return (
              <div key={eventType}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-3 h-3 rounded-full ${config.bg.replace(/100.*$/, '500')}`} />
                  <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">{config.label}</h3>
                  <span className="text-sm text-earth-400 dark:text-gray-500">({typeEvents.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {typeEvents.map((event, i) => (
                    <div
                      key={`${event.plant_id}-${i}`}
                      className={`${config.bg} border rounded-xl p-4 transition-shadow hover:shadow-sm`}
                      style={{ borderColor: 'transparent' }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{getPlantIcon(event.plant_name, event.category)}</span>
                        <div className="flex-1 min-w-0">
                          <Link href={`/plants?highlight=${event.plant_id}`} className={`font-bold ${config.text} hover:underline`}>
                            {event.plant_name}
                          </Link>
                          <p className="text-xs text-earth-500 dark:text-gray-400 capitalize">{event.category}</p>
                        </div>
                        <Link
                          href={`/lifecycle?plant_id=${event.plant_id}`}
                          className="shrink-0 text-xs px-2 py-1 rounded-full bg-garden-600 text-white hover:bg-garden-700 transition-colors font-medium"
                        >
                          Plan
                        </Link>
                      </div>
                      {event.notes && (
                        <p className="text-sm text-earth-500 dark:text-gray-400 mt-2">{event.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Any other event types */}
          {Object.entries(grouped)
            .filter(([k]) => !['sow_indoors', 'start_seeds', 'sow_outdoors', 'direct_sow', 'transplant', 'harvest'].includes(k))
            .map(([eventType, typeEvents]) => (
              <div key={eventType}>
                <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100 mb-3 capitalize">{eventType.replace(/_/g, ' ')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {typeEvents.map((event, i) => (
                    <div key={`${event.plant_id}-${i}`} className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{getPlantIcon(event.plant_name, event.category)}</span>
                        <Link href={`/plants?highlight=${event.plant_id}`} className="font-bold text-earth-800 dark:text-gray-100 hover:underline flex-1">
                          {event.plant_name}
                        </Link>
                        <Link
                          href={`/lifecycle?plant_id=${event.plant_id}`}
                          className="shrink-0 text-xs px-2 py-1 rounded-full bg-garden-600 text-white hover:bg-garden-700 transition-colors font-medium"
                        >
                          Plan
                        </Link>
                      </div>
                      {event.notes && (
                        <p className="text-sm text-earth-500 dark:text-gray-400 mt-2">{event.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

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

function ModalFeedRow({ label, description, url }: { label: string; description?: string; url: string }) {
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
    <div className="flex items-center gap-2 px-2.5 py-2 border border-earth-200 dark:border-gray-700 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-earth-800 dark:text-gray-200 truncate">{label}</p>
        {description && <p className="text-xs text-earth-500 dark:text-gray-400 truncate">{description}</p>}
      </div>
      <button
        onClick={handleCopy}
        className={`px-2.5 py-1 text-xs font-medium rounded-md transition whitespace-nowrap ${
          copied ? 'bg-green-600 text-white' : 'bg-garden-600 text-white hover:bg-garden-700'
        }`}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

function SubscribeModal({ onClose }: { onClose: () => void }) {
  const [icalData, setIcalData] = useState<IcalData | null>(null);

  useEffect(() => {
    getCalendarIcalUrl()
      .then((data: IcalData) => setIcalData(data))
      .catch(() => setIcalData(null));
  }, []);

  const platformNames: Record<string, string> = {
    google: 'Google Calendar',
    apple: 'Apple Calendar',
    outlook: 'Outlook',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-earth-200 dark:border-gray-700 w-full max-w-md mx-4 p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">{'\uD83D\uDCC5'} Subscribe to Calendar</h3>
          <button onClick={onClose} className="text-earth-400 dark:text-gray-500 hover:text-earth-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        {!icalData ? (
          <div className="py-8 text-center text-sm text-earth-400 dark:text-gray-500">Loading...</div>
        ) : (
          <div className="space-y-4">
            {/* Master feed */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-earth-400 dark:text-gray-500 mb-1.5">All Events</p>
              <ModalFeedRow label={icalData.master.name} url={icalData.master.url} />
            </div>

            {/* Individual feeds */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-earth-400 dark:text-gray-500 mb-1.5">Individual Feeds</p>
              <div className="space-y-1.5">
                {icalData.feeds.map((feed) => (
                  <ModalFeedRow key={feed.type} label={feed.name} description={feed.description} url={feed.url} />
                ))}
              </div>
            </div>

            {/* Instructions */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-earth-400 dark:text-gray-500">Setup Instructions</p>
              {Object.entries(icalData.instructions).map(([platform, instruction]) => (
                <div key={platform} className="text-sm">
                  <span className="font-medium text-earth-700 dark:text-gray-300">{platformNames[platform] || platform}:</span>{' '}
                  <span className="text-earth-500 dark:text-gray-400">{instruction}</span>
                </div>
              ))}
            </div>

            <p className="text-xs text-earth-400 dark:text-gray-500">
              Feeds refresh every hour. Each feed shows as a separate calendar you can toggle on/off. Manage feeds in{' '}
              <Link href="/settings" className="text-garden-600 dark:text-garden-400 hover:underline">Settings</Link>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [view, setView] = useState<'my' | 'all'>('my');
  const [showSubscribe, setShowSubscribe] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">
            {view === 'my' ? 'My Garden Calendar' : 'All Plants Calendar'}
          </h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">
            {view === 'my'
              ? 'Personalized timeline for your active garden'
              : 'Planting windows for all plants in the database'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-earth-300 dark:border-gray-600 overflow-hidden">
            <button
              onClick={() => setView('my')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${
                view === 'my'
                  ? 'bg-garden-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-earth-600 dark:text-gray-400 hover:bg-earth-50 dark:hover:bg-gray-700'
              }`}
            >
              My Plants
            </button>
            <button
              onClick={() => setView('all')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${
                view === 'all'
                  ? 'bg-garden-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-earth-600 dark:text-gray-400 hover:bg-earth-50 dark:hover:bg-gray-700'
              }`}
            >
              All Plants
            </button>
          </div>

          <button
            onClick={() => setShowSubscribe(true)}
            className="flex items-center gap-2 px-4 py-2 bg-garden-100 dark:bg-garden-900/30 hover:bg-garden-200 dark:hover:bg-garden-900/50 text-garden-700 dark:text-garden-300 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[36px]"
          >
            {'\uD83D\uDCC5'} Subscribe
          </button>

          <a
            href="/calendar/print"
            className="flex items-center gap-2 px-4 py-2 bg-earth-100 dark:bg-gray-700 hover:bg-earth-200 dark:hover:bg-gray-600 text-earth-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[36px]"
          >
            {'\u{1F5A8}\uFE0F'} Print
          </a>
        </div>
      </div>

      {/* Subscribe modal */}
      {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}

      {/* View content */}
      {view === 'my' ? <PersonalCalendarView /> : <AllPlantsCalendarView />}
    </div>
  );
}
