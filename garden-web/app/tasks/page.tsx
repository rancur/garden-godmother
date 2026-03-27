'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useModal } from '../confirm-modal';
import { useToast } from '../toast';
import {
  getTasks,
  createTask,
  completeTask,
  skipTask,
  deleteTask,
  updateTask,
  generateTasks,
  getTasksSummary,
  getPlants,
  getBeds,
} from '../api';
import { TypeaheadSelect, TypeaheadOption } from '../typeahead-select';
import { getPlantIcon } from '../plant-icons';
import { taskTypeIcons, taskTypeLabels, taskStatusColors as statusColors } from '../constants';
import { getGardenToday, formatGardenDate } from '../timezone';
import { PullToRefresh } from '../components/PullToRefresh';

interface Task {
  id: number;
  task_type: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  completed_date: string | null;
  plant_id: number | null;
  planting_id: number | null;
  bed_id: number | null;
  tray_id: number | null;
  auto_generated: number;
  source: string | null;
  notes: string | null;
  created_at: string;
  plant_name: string | null;
  bed_name: string | null;
  tray_name: string | null;
}

interface TaskSummary {
  total: number;
  by_status: Record<string, number>;
  overdue: number;
  due_today: number;
  due_this_week: number;
}

interface Plant {
  id: number;
  name: string;
}

interface Bed {
  id: number;
  name: string;
}

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700',
  high: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700',
  medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
  low: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
};


function formatDate(d: string | null): string {
  if (!d) return 'No date';
  return formatGardenDate(d + 'T00:00:00', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isOverdue(task: Task): boolean {
  if (task.status === 'completed' || task.status === 'skipped') return false;
  if (!task.due_date) return false;
  return task.due_date < getGardenToday();
}

function isToday(d: string | null): boolean {
  if (!d) return false;
  return d === getGardenToday();
}

function isThisWeek(d: string | null): boolean {
  if (!d) return false;
  const today = new Date();
  const target = new Date(d + 'T00:00:00');
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return target >= today && target <= weekEnd;
}

export default function TasksPage() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [editingDueDate, setEditingDueDate] = useState<number | null>(null);

  // New task form
  const [newType, setNewType] = useState('custom');
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newPlantId, setNewPlantId] = useState<string>('');
  const [newBedId, setNewBedId] = useState<string>('');
  const [newDescription, setNewDescription] = useState('');

  const loadData = useCallback(async () => {
    try {
      const params: Record<string, string | boolean> = {};
      if (filterStatus === 'active') {
        // no status filter, but exclude completed/skipped in display
      } else if (filterStatus) {
        params.status = filterStatus;
      }
      if (filterPriority) params.priority = filterPriority;
      if (filterType) params.task_type = filterType;

      const [tasksData, summaryData] = await Promise.all([
        getTasks(filterStatus === 'active' ? { ...params } : params),
        getTasksSummary(),
      ]);
      let filtered = Array.isArray(tasksData) ? tasksData : [];
      if (filterStatus === 'active') {
        filtered = filtered.filter((t: Task) => !['completed', 'skipped'].includes(t.status));
      }
      setTasks(filtered);
      setSummary(summaryData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority, filterType]);

  useEffect(() => {
    loadData();
    Promise.all([getPlants(), getBeds()]).then(([p, b]) => {
      setPlants(Array.isArray(p) ? p : []);
      setBeds(Array.isArray(b) ? b : []);
    }).catch(() => {});
  }, [loadData]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateTasks();
      await loadData();
      if (result.tasks_created > 0) {
        toast(`Generated ${result.tasks_created} new task(s)`);
      } else {
        toast('No new tasks to generate', 'info');
      }
    } catch {
      toast('Failed to generate tasks', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleComplete = async (id: number) => {
    try {
      await completeTask(id);
      await loadData();
      toast('Task completed');
    } catch { toast('Failed to complete task', 'error'); }
  };

  const handleSkip = async (id: number) => {
    try {
      await skipTask(id);
      await loadData();
      toast('Task skipped');
    } catch { toast('Failed to skip task', 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm({ title: 'Delete Task', message: 'Delete this task?', confirmText: 'Delete', destructive: true })) return;
    try {
      await deleteTask(id);
      await loadData();
      toast('Task deleted');
    } catch { toast('Failed to delete task', 'error'); }
  };

  const handleDueDateChange = async (id: number, newDate: string) => {
    try {
      await updateTask(id, { due_date: newDate });
      setEditingDueDate(null);
      await loadData();
      toast('Due date updated');
    } catch { toast('Failed to update due date', 'error'); }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await createTask({
        task_type: newType,
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        priority: newPriority,
        due_date: newDue || undefined,
        plant_id: newPlantId ? Number(newPlantId) : undefined,
        bed_id: newBedId ? Number(newBedId) : undefined,
      });
      setNewTitle('');
      setNewDue('');
      setNewPriority('medium');
      setNewType('custom');
      setNewPlantId('');
      setNewBedId('');
      setNewDescription('');
      setShowForm(false);
      await loadData();
      toast('Task created');
    } catch {
      toast('Failed to create task', 'error');
    }
  };

  // Group tasks
  const overdueTasks = tasks.filter(t => isOverdue(t) || t.status === 'overdue');
  const todayTasks = tasks.filter(t => isToday(t.due_date) && !isOverdue(t) && t.status !== 'overdue');
  const weekTasks = tasks.filter(t => isThisWeek(t.due_date) && !isToday(t.due_date) && !isOverdue(t) && t.status !== 'overdue');
  const laterTasks = tasks.filter(t => {
    if (t.status === 'completed' || t.status === 'skipped') return false;
    if (isOverdue(t) || t.status === 'overdue') return false;
    if (isToday(t.due_date)) return false;
    if (isThisWeek(t.due_date)) return false;
    return true;
  });
  const completedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'skipped');

  const renderTaskCard = (task: Task) => {
    const overdue = isOverdue(task) || task.status === 'overdue';
    return (
      <div
        key={task.id}
        className={`bg-white dark:bg-gray-800 rounded-lg border p-4 shadow-sm transition-all ${
          overdue ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20' : 'border-earth-200 dark:border-gray-700'
        } ${task.status === 'completed' ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start gap-3">
          {/* Checkbox */}
          <button
            onClick={() => handleComplete(task.id)}
            className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
              task.status === 'completed'
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-earth-300 dark:border-gray-500 hover:border-green-400 dark:hover:border-green-500'
            }`}
            title="Mark complete"
          >
            {task.status === 'completed' && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg" title={taskTypeLabels[task.task_type]}>
                {taskTypeIcons[task.task_type] || taskTypeIcons.custom}
              </span>
              <h3 className={`font-semibold text-earth-800 dark:text-gray-100 ${task.status === 'completed' ? 'line-through' : ''}`}>
                {task.title}
              </h3>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${priorityColors[task.priority]}`}>
                {task.priority}
              </span>
              {task.status === 'overdue' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300">
                  OVERDUE
                </span>
              )}
              {task.auto_generated === 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">
                  auto
                </span>
              )}
            </div>

            {task.description && (
              <p className="text-sm text-earth-500 dark:text-gray-400 mt-1 line-clamp-2">{task.description}</p>
            )}

            <div className="flex items-center gap-3 mt-2 text-xs text-earth-400 dark:text-gray-500 flex-wrap">
              {task.due_date && (
                <span
                  className={`cursor-pointer hover:text-garden-600 dark:hover:text-garden-400 ${overdue ? 'text-red-500 dark:text-red-400 font-medium' : ''}`}
                  onClick={() => setEditingDueDate(editingDueDate === task.id ? null : task.id)}
                >
                  {formatDate(task.due_date)}
                </span>
              )}
              {editingDueDate === task.id && (
                <input
                  type="date"
                  defaultValue={task.due_date || ''}
                  className="text-xs border border-earth-300 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
                  onChange={(e) => handleDueDateChange(task.id, e.target.value)}
                  autoFocus
                />
              )}
              {task.plant_name && task.plant_id && (
                <Link href={`/plants?highlight=${task.plant_id}`} className="flex items-center gap-1 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                  <span className="text-garden-500">{'\uD83C\uDF3F'}</span> {task.plant_name}
                </Link>
              )}
              {task.plant_name && !task.plant_id && (
                <span className="flex items-center gap-1">
                  <span className="text-garden-500">{'\uD83C\uDF3F'}</span> {task.plant_name}
                </span>
              )}
              {task.bed_name && task.bed_id && (
                <Link href={`/planters/${task.bed_id}`} className="flex items-center gap-1 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                  <span className="text-garden-500">{'\uD83D\uDFEB'}</span> {task.bed_name}
                </Link>
              )}
              {task.bed_name && !task.bed_id && (
                <span className="flex items-center gap-1">
                  <span className="text-garden-500">{'\uD83D\uDFEB'}</span> {task.bed_name}
                </span>
              )}
              {task.tray_name && task.tray_id && (
                <Link href={`/trays/${task.tray_id}`} className="flex items-center gap-1 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                  <span className="text-garden-500">{'\uD83E\uDEB4'}</span> {task.tray_name}
                </Link>
              )}
              {task.tray_name && !task.tray_id && (
                <span className="flex items-center gap-1">
                  <span className="text-garden-500">{'\uD83E\uDEB4'}</span> {task.tray_name}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {task.status !== 'completed' && task.status !== 'skipped' && (
              <button
                onClick={() => handleSkip(task.id)}
                className="p-1.5 rounded text-earth-400 dark:text-gray-500 hover:bg-earth-100 dark:hover:bg-gray-700 hover:text-earth-600 dark:hover:text-gray-300 transition-colors"
                title="Skip"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            )}
            <button
              onClick={() => handleDelete(task.id)}
              className="p-1.5 rounded text-earth-400 dark:text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderGroup = (label: string, items: Task[], defaultOpen = true) => {
    if (items.length === 0) return null;
    return (
      <details open={defaultOpen} className="group">
        <summary className="flex items-center gap-2 cursor-pointer mb-3">
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">{label}</h2>
          <span className="text-sm font-medium bg-earth-100 dark:bg-gray-700 text-earth-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        </summary>
        <div className="space-y-2 mb-6">
          {items.map(renderTaskCard)}
        </div>
      </details>
    );
  };

  return (
    <PullToRefresh onRefresh={loadData}>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-earth-800 dark:text-gray-100">Garden Tasks</h1>
          <p className="text-earth-500 dark:text-gray-400 text-sm mt-1">Your daily garden to-do list</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-garden-600 hover:bg-garden-700 text-white rounded-lg font-medium transition-colors text-sm"
          >
            + Add Task
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg font-medium transition-colors text-sm"
          >
            {generating ? 'Generating...' : 'Generate Tasks'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="text-earth-400 dark:text-gray-400 text-xs font-medium">Due Today</div>
            <div className="text-2xl font-bold text-garden-700 dark:text-garden-400 mt-1">{summary.due_today}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="text-earth-400 dark:text-gray-400 text-xs font-medium">This Week</div>
            <div className="text-2xl font-bold text-garden-700 dark:text-garden-400 mt-1">{summary.due_this_week}</div>
          </div>
          <div className={`bg-white dark:bg-gray-800 rounded-xl border p-4 shadow-sm ${summary.overdue > 0 ? 'border-red-300 dark:border-red-700' : 'border-earth-200 dark:border-gray-700'}`}>
            <div className={`text-xs font-medium ${summary.overdue > 0 ? 'text-red-500 dark:text-red-400' : 'text-earth-400 dark:text-gray-400'}`}>Overdue</div>
            <div className={`text-2xl font-bold mt-1 ${summary.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-garden-700 dark:text-garden-400'}`}>{summary.overdue}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="text-earth-400 dark:text-gray-400 text-xs font-medium">Completed</div>
            <div className="text-2xl font-bold text-garden-700 dark:text-garden-400 mt-1">{summary.by_status?.completed || 0}</div>
          </div>
        </div>
      )}

      {/* Add Task Form */}
      {showForm && (
        <form onSubmit={handleCreateTask} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 shadow-sm space-y-4">
          <h3 className="font-bold text-earth-800 dark:text-gray-100">New Task</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Type</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value)}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
              >
                {Object.entries(taskTypeLabels).map(([val, label]) => (
                  <option key={val} value={val}>{taskTypeIcons[val]} {label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-2">
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="What needs to be done?"
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Due Date</label>
              <input
                type="date"
                value={newDue}
                onChange={e => setNewDue(e.target.value)}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Priority</label>
              <select
                value={newPriority}
                onChange={e => setNewPriority(e.target.value)}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Plant (optional)</label>
              <TypeaheadSelect
                options={plants.map((p): TypeaheadOption => ({
                  value: p.id.toString(),
                  label: p.name,
                  icon: getPlantIcon(p.name),
                }))}
                value={newPlantId}
                onChange={setNewPlantId}
                placeholder="Search plants..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Planter (optional)</label>
              <TypeaheadSelect
                options={beds.map((b): TypeaheadOption => ({
                  value: b.id.toString(),
                  label: b.name,
                }))}
                value={newBedId}
                onChange={setNewBedId}
                placeholder="Search planters..."
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-earth-500 dark:text-gray-400 mb-1">Description (optional)</label>
              <input
                type="text"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                placeholder="Additional details..."
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-garden-600 hover:bg-garden-700 text-white rounded-lg font-medium text-sm transition-colors">
              Create Task
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 rounded-lg font-medium text-sm transition-colors hover:bg-earth-200 dark:hover:bg-gray-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
        >
          <option value="active">Active</option>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="skipped">Skipped</option>
        </select>
        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className="border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-100"
        >
          <option value="">All Types</option>
          {Object.entries(taskTypeLabels).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Task Groups */}
      {loading ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-earth-400 dark:text-gray-500 text-lg">No tasks found</p>
          <p className="text-earth-300 dark:text-gray-600 text-sm mt-1">Click &quot;Generate Tasks&quot; to scan your garden data, or add a custom task.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {renderGroup('Overdue', overdueTasks)}
          {renderGroup('Today', todayTasks)}
          {renderGroup('This Week', weekTasks)}
          {renderGroup('Later', laterTasks, false)}
          {filterStatus === '' && renderGroup('Completed / Skipped', completedTasks, false)}
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}
