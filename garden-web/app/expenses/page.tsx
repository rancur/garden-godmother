'use client';

import { useEffect, useState } from 'react';
import { getExpenses, createExpense, deleteExpense, getExpenseSummary, getExportUrl, undoAction } from '../api';
import { useModal } from '../confirm-modal';
import { useToast } from '../toast';
import { getGardenToday } from '../timezone';

const EXPENSE_CATEGORIES = [
  'seeds', 'soil', 'fertilizer', 'tools', 'pest_control', 'infrastructure', 'water', 'other',
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  seeds: 'Seeds',
  soil: 'Soil',
  fertilizer: 'Fertilizer',
  tools: 'Tools',
  pest_control: 'Pest Control',
  infrastructure: 'Infrastructure',
  water: 'Water',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, string> = {
  seeds: 'bg-green-500',
  soil: 'bg-amber-700',
  fertilizer: 'bg-yellow-500',
  tools: 'bg-blue-500',
  pest_control: 'bg-red-500',
  infrastructure: 'bg-purple-500',
  water: 'bg-cyan-500',
  other: 'bg-gray-500',
};

interface Expense {
  id: number;
  category: string;
  description: string;
  amount_cents: number;
  purchase_date: string | null;
  notes: string | null;
  created_at: string;
}

interface ExpenseSummary {
  total_cents: number;
  by_category: { category: string; count: number; total_cents: number }[];
  by_month: { month: string; total_cents: number }[];
}

export default function ExpensesPage() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');

  const emptyForm = {
    category: '',
    description: '',
    amount: '',
    purchase_date: getGardenToday(),
    notes: '',
  };
  const [formData, setFormData] = useState(emptyForm);

  const loadData = () => {
    const expensePromise = filterCategory ? getExpenses(filterCategory) : getExpenses();
    Promise.all([expensePromise, getExpenseSummary()])
      .then(([expenseData, summaryData]) => {
        setExpenses(expenseData);
        setSummary(summaryData);
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [filterCategory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category || !formData.description || !formData.amount) return;
    setSubmitting(true);
    try {
      await createExpense({
        category: formData.category,
        description: formData.description,
        amount_cents: Math.round(parseFloat(formData.amount) * 100),
        purchase_date: formData.purchase_date || undefined,
        notes: formData.notes || undefined,
      });
      setFormData(emptyForm);
      setShowForm(false);
      setLoading(true);
      loadData();
    } catch {
      setError('Failed to log expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id: number) => {
    if (!await showConfirm({ title: 'Delete Expense', message: 'Are you sure you want to delete this expense?', confirmText: 'Delete', destructive: true })) return;
    try {
      const res = await deleteExpense(id);
      setLoading(true);
      loadData();
      toast('Expense deleted', 'success', {
        action: { label: 'Undo', onClick: async () => { try { await undoAction(res.undo_id); loadData(); } catch { toast('Undo failed', 'error'); } } },
      });
    } catch {
      setError('Failed to delete expense');
    }
  };

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const maxCategoryCents = summary?.by_category.length
    ? Math.max(...summary.by_category.map(c => c.total_cents))
    : 0;

  if (loading) return <div className="text-center py-12 text-earth-500 dark:text-gray-400">Loading expenses...</div>;
  if (error) return <div className="text-center py-12 text-red-600 dark:text-red-400">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold text-garden-800 dark:text-garden-400">Expense Tracker</h1>
        <div className="flex items-center gap-2">
          <a
            href={getExportUrl('expenses')}
            download
            className="px-3 py-2 bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 rounded-lg hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
          >
            Export CSV
          </a>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-medium"
          >
            {showForm ? 'Cancel' : '+ Log Expense'}
          </button>
        </div>
      </div>

      {/* Log Expense Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 sm:p-6 space-y-4 border border-earth-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-200">Log an Expense</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Category *</label>
              <select
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                required
              >
                <option value="">Select category...</option>
                {EXPENSE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Amount ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                placeholder="e.g. 12.99"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Description *</label>
              <input
                type="text"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                placeholder="e.g. Tomato seeds from Baker Creek"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Purchase Date</label>
              <input
                type="date"
                value={formData.purchase_date}
                onChange={e => setFormData({ ...formData, purchase_date: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full border border-earth-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
                placeholder="Optional notes"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !formData.category || !formData.description || !formData.amount}
            className="px-6 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 disabled:opacity-50 transition-colors font-medium"
          >
            {submitting ? 'Saving...' : 'Save Expense'}
          </button>
        </form>
      )}

      {/* Total Spent Card */}
      {summary && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border border-earth-200 dark:border-gray-700">
          <div className="text-sm text-earth-500 dark:text-gray-400">Total Spent</div>
          <div className="text-2xl font-bold text-garden-700 dark:text-garden-400">
            {formatMoney(summary.total_cents)}
          </div>
        </div>
      )}

      {/* Summary by Category */}
      {summary && summary.by_category.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 sm:p-6 border border-earth-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-200 mb-4">Spending by Category</h2>
          <div className="space-y-3">
            {summary.by_category.map(c => (
              <div key={c.category}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-earth-700 dark:text-gray-300 font-medium">{CATEGORY_LABELS[c.category] || c.category}</span>
                  <span className="text-earth-600 dark:text-gray-400">{formatMoney(c.total_cents)} ({c.count})</span>
                </div>
                <div className="w-full bg-earth-100 dark:bg-gray-700 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${CATEGORY_COLORS[c.category] || 'bg-gray-500'}`}
                    style={{ width: `${maxCategoryCents > 0 ? (c.total_cents / maxCategoryCents) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expense History Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-earth-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between p-4 sm:p-6 pb-0">
          <h2 className="text-lg font-semibold text-earth-800 dark:text-gray-200">Expense History</h2>
          <select
            value={filterCategory}
            onChange={e => { setFilterCategory(e.target.value); setLoading(true); }}
            className="border border-earth-300 dark:border-gray-600 rounded-lg px-2 py-1 text-sm bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100"
          >
            <option value="">All Categories</option>
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        {expenses.length === 0 ? (
          <p className="p-4 sm:p-6 text-earth-500 dark:text-gray-400">No expenses logged yet. Click &quot;+ Log Expense&quot; to start tracking.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-earth-200 dark:border-gray-700 text-earth-600 dark:text-gray-400">
                  <th className="text-left p-3 sm:p-4 font-medium">Date</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Category</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Description</th>
                  <th className="text-right p-3 sm:p-4 font-medium">Amount</th>
                  <th className="text-left p-3 sm:p-4 font-medium">Notes</th>
                  <th className="text-right p-3 sm:p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <tr key={exp.id} className="border-b border-earth-100 dark:border-gray-700/50 hover:bg-earth-50 dark:hover:bg-gray-700/50">
                    <td className="p-3 sm:p-4 text-earth-700 dark:text-gray-300">{exp.purchase_date || '--'}</td>
                    <td className="p-3 sm:p-4">
                      <span className={`inline-block w-2 h-2 rounded-full mr-2 ${CATEGORY_COLORS[exp.category] || 'bg-gray-500'}`} />
                      <span className="text-earth-800 dark:text-gray-200">{CATEGORY_LABELS[exp.category] || exp.category}</span>
                    </td>
                    <td className="p-3 sm:p-4 font-medium text-earth-800 dark:text-gray-200">{exp.description}</td>
                    <td className="p-3 sm:p-4 text-right text-earth-700 dark:text-gray-300">{formatMoney(exp.amount_cents)}</td>
                    <td className="p-3 sm:p-4 text-earth-500 dark:text-gray-400 max-w-[200px] truncate">{exp.notes || ''}</td>
                    <td className="p-3 sm:p-4 text-right">
                      <button
                        onClick={() => handleDeleteExpense(exp.id)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
