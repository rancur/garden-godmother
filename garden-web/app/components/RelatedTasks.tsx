'use client';

import { useEffect, useState, useCallback } from 'react';
import { getTasks, completeTask } from '../api';
import { useToast } from '../toast';
import Link from 'next/link';

interface Task {
  id: number;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  completed_at: string | null;
}

interface RelatedTasksProps {
  entityType: 'bed' | 'ground_plant' | 'tray';
  entityId: number;
  entityName: string;
}

const TASK_TYPE_ICONS: Record<string, string> = {
  watering: '💧',
  fertilize: '🧪',
  prune: '✂️',
  harvest: '🌾',
  weed: '🌿',
  pest_check: '🐛',
  transplant: '🔄',
  general: '📋',
};

export default function RelatedTasks({ entityType, entityId, entityName }: RelatedTasksProps) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    try {
      const params: Record<string, any> = {};
      if (entityType === 'bed') params.bed_id = entityId;
      // For ground_plant and tray, the API doesn't have direct filters,
      // so we fetch all and filter by name match in the title
      const data = await getTasks(params);

      if (entityType === 'bed') {
        setTasks(data.slice(0, 10));
      } else {
        // Filter tasks that match this entity by name in title
        const filtered = data.filter((t: Task) =>
          t.title.toLowerCase().includes(entityName.toLowerCase())
        );
        setTasks(filtered.slice(0, 10));
      }
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, entityName]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleComplete = async (taskId: number) => {
    try {
      await completeTask(taskId);
      loadTasks();
      toast('Task completed');
    } catch {
      toast('Failed to complete task', 'error');
    }
  };

  if (loading) {
    return null;
  }

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
        <span className="text-orange-500">{'✅'}</span> Related Tasks
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center justify-between gap-2 text-sm border border-earth-100 dark:border-gray-700 rounded-lg p-2.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0">{TASK_TYPE_ICONS[task.task_type] || '📋'}</span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  task.status === 'completed'
                    ? 'bg-green-500'
                    : task.status === 'overdue'
                    ? 'bg-red-500'
                    : task.status === 'pending'
                    ? 'bg-amber-500'
                    : 'bg-gray-400'
                }`}
              />
              <span className="text-earth-700 dark:text-gray-200 truncate">{task.title}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs text-earth-400 dark:text-gray-500">
              {task.due_date && <span>{task.due_date}</span>}
              <span
                className={`px-1.5 py-0.5 rounded-full capitalize ${
                  task.status === 'completed'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : task.status === 'overdue'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : 'bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300'
                }`}
              >
                {task.status}
              </span>
              {task.status !== 'completed' && (
                <button
                  onClick={() => handleComplete(task.id)}
                  className="text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 font-medium"
                  title="Complete task"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-center">
        <Link
          href="/tasks"
          className="text-xs text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300"
        >
          View all tasks →
        </Link>
      </div>
    </div>
  );
}
