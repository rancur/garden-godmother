'use client';

import { useEffect, useState } from 'react';
import { getSeeds, getPlants, createSeed, updateSeed, deleteSeed, getCoopBoard, toggleSeedSwapAvailable, getSeedWishlist, addSeedWishlistItem, deleteSeedWishlistItem } from '../api';
import { useModal } from '../confirm-modal';
import { useToast } from '../toast';
import { getGardenToday } from '../timezone';
import { TypeaheadSelect } from '../typeahead-select';

interface SeedSwap {
  peer_id: number;
  peer_display_name: string | null;
  plant_name: string;
  variety: string | null;
  looking_for: string | null;
}

interface Seed {
  id: number;
  plant_id: number;
  plant_name: string;
  plant_category: string;
  variety: string | null;
  brand: string | null;
  quantity_seeds: number | null;
  purchase_date: string | null;
  expiration_date: string | null;
  notes: string | null;
  created_at: string;
  coop_swap_available: boolean;
}

interface WishlistItem {
  id: number;
  plant_name: string;
  variety: string | null;
  notes: string | null;
  created_at: string;
}

interface Plant {
  id: number;
  name: string;
  category: string;
}

export default function SeedsPage() {
  const { showConfirm } = useModal();
  const { toast } = useToast();
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [seedSwaps, setSeedSwaps] = useState<SeedSwap[]>([]);
  const [showSeedSwaps, setShowSeedSwaps] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('seeds_community_open') === 'true';
  });
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [showWishlist, setShowWishlist] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [showWishlistForm, setShowWishlistForm] = useState(false);
  const [wishlistForm, setWishlistForm] = useState({ plant_name: '', variety: '', notes: '' });
  const [wishlistSubmitting, setWishlistSubmitting] = useState(false);
  const [togglingSwap, setTogglingSwap] = useState<number | null>(null);

  const emptyForm = {
    plant_id: 0,
    variety: '',
    brand: '',
    quantity_seeds: '',
    purchase_date: '',
    expiration_date: '',
    notes: '',
  };
  const [formData, setFormData] = useState(emptyForm);

  const loadData = () => {
    Promise.all([getSeeds(), getPlants(), getCoopBoard().catch(() => null)])
      .then(([seedsData, plantsData, coopData]) => {
        setSeeds(seedsData);
        setPlants(plantsData);
        if (coopData && Array.isArray(coopData.seed_swaps)) {
          setSeedSwaps(coopData.seed_swaps);
        }
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  };

  const loadWishlist = () => {
    setWishlistLoading(true);
    getSeedWishlist()
      .then((data) => setWishlist(Array.isArray(data) ? data : []))
      .catch(() => toast('Failed to load wishlist', 'error'))
      .finally(() => setWishlistLoading(false));
  };

  const handleToggleSwap = async (seed: Seed) => {
    setTogglingSwap(seed.id);
    try {
      await toggleSeedSwapAvailable(seed.id);
      setSeeds((prev) =>
        prev.map((s) => s.id === seed.id ? { ...s, coop_swap_available: !s.coop_swap_available } : s)
      );
      toast('Swap availability updated', 'success');
    } catch {
      toast('Failed to update swap availability', 'error');
    } finally {
      setTogglingSwap(null);
    }
  };

  const handleAddWishlistItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wishlistForm.plant_name.trim()) return;
    setWishlistSubmitting(true);
    try {
      await addSeedWishlistItem({
        plant_name: wishlistForm.plant_name.trim(),
        variety: wishlistForm.variety.trim() || undefined,
        notes: wishlistForm.notes.trim() || undefined,
      });
      setWishlistForm({ plant_name: '', variety: '', notes: '' });
      setShowWishlistForm(false);
      loadWishlist();
      toast('Added to wishlist', 'success');
    } catch {
      toast('Failed to add to wishlist', 'error');
    } finally {
      setWishlistSubmitting(false);
    }
  };

  const handleDeleteWishlistItem = async (itemId: number) => {
    try {
      await deleteSeedWishlistItem(itemId);
      setWishlist((prev) => prev.filter((item) => item.id !== itemId));
      toast('Removed from wishlist', 'success');
    } catch {
      toast('Failed to remove from wishlist', 'error');
    }
  };

  useEffect(() => { loadData(); loadWishlist(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.plant_id) return;
    setSubmitting(true);
    try {
      const payload = {
        plant_id: formData.plant_id,
        variety: formData.variety || undefined,
        brand: formData.brand || undefined,
        quantity_seeds: formData.quantity_seeds ? parseInt(formData.quantity_seeds) : undefined,
        purchase_date: formData.purchase_date || undefined,
        expiration_date: formData.expiration_date || undefined,
        notes: formData.notes || undefined,
      };

      if (editingId) {
        const { plant_id, ...updatePayload } = payload;
        await updateSeed(editingId, updatePayload);
      } else {
        await createSeed(payload);
      }
      setFormData(emptyForm);
      setShowForm(false);
      setEditingId(null);
      loadData();
      toast(editingId ? 'Seed updated' : 'Seed added');
    } catch {
      toast(editingId ? 'Failed to update seed' : 'Failed to add seed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (seed: Seed) => {
    setFormData({
      plant_id: seed.plant_id,
      variety: seed.variety || '',
      brand: seed.brand || '',
      quantity_seeds: seed.quantity_seeds?.toString() || '',
      purchase_date: seed.purchase_date || '',
      expiration_date: seed.expiration_date || '',
      notes: seed.notes || '',
    });
    setEditingId(seed.id);
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm({ title: 'Remove Seed', message: 'Remove this seed from inventory?', confirmText: 'Remove', destructive: true })) return;
    try {
      await deleteSeed(id);
      loadData();
      toast('Seed removed');
    } catch {
      toast('Failed to delete seed', 'error');
    }
  };

  const isExpired = (expirationDate: string | null) => {
    if (!expirationDate) return false;
    return expirationDate < getGardenToday();
  };

  const isLowQuantity = (qty: number | null) => {
    return qty !== null && qty <= 10;
  };

  // Seeds with quantity > 5 that have no corresponding swap posted
  const swappedPlantNames = new Set(seedSwaps.map(s => s.plant_name.toLowerCase()));
  const extraSeeds = seeds.filter(
    s => s.quantity_seeds !== null && s.quantity_seeds > 5 && !swappedPlantNames.has(s.plant_name.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-earth-800 dark:text-gray-100">Seed Inventory</h1>
          <p className="text-earth-500 dark:text-gray-400 mt-1">Track your seed stock, varieties, and expiration dates</p>
        </div>
        <button
          onClick={() => {
            if (showForm && !editingId) {
              setShowForm(false);
            } else {
              setFormData(emptyForm);
              setEditingId(null);
              setShowForm(true);
            }
          }}
          className="bg-garden-600 hover:bg-garden-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
        >
          {showForm && !editingId ? 'Cancel' : '+ Add Seeds'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-earth-800 dark:text-gray-100">
            {editingId ? 'Edit Seed' : 'Add Seed to Inventory'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Plant</label>
              {editingId ? (
                <div className="px-3 py-2 bg-earth-50 dark:bg-gray-700 border border-earth-300 dark:border-gray-600 rounded-lg text-earth-600 dark:text-gray-300 text-sm">
                  {plants.find(p => p.id === formData.plant_id)?.name || 'Unknown plant'}
                </div>
              ) : (
                <TypeaheadSelect
                  options={plants.map(p => ({ value: String(p.id), label: `${p.name} (${p.category})` }))}
                  value={String(formData.plant_id || '')}
                  onChange={(val) => setFormData({ ...formData, plant_id: Number(val) })}
                  placeholder="Search plants..."
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Variety</label>
              <input
                type="text"
                value={formData.variety}
                onChange={(e) => setFormData({ ...formData, variety: e.target.value })}
                placeholder="e.g., Cherokee Purple"
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Brand</label>
              <input
                type="text"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                placeholder="e.g., Baker Creek"
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Quantity (seeds)</label>
              <input
                type="number"
                min={0}
                value={formData.quantity_seeds}
                onChange={(e) => setFormData({ ...formData, quantity_seeds: e.target.value })}
                placeholder="e.g., 50"
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Purchase Date</label>
              <input
                type="date"
                value={formData.purchase_date}
                onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Expiration Date</label>
              <input
                type="date"
                value={formData.expiration_date}
                onChange={(e) => setFormData({ ...formData, expiration_date: e.target.value })}
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Optional notes"
                className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
            >
              {submitting ? 'Saving...' : editingId ? 'Update Seed' : 'Add Seed'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null); setFormData(emptyForm); }}
                className="bg-earth-100 hover:bg-earth-200 text-earth-700 px-5 py-2.5 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-earth-400 dark:text-gray-500">Loading inventory...</div>
      ) : seeds.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🌱</div>
          <h2 className="text-xl font-bold text-earth-700 dark:text-gray-200 mb-2">No seeds in inventory</h2>
          <p className="text-earth-400 dark:text-gray-500">Add your first seed packet to start tracking!</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-earth-50 dark:bg-gray-900 border-b border-earth-200 dark:border-gray-700">
                  <th className="text-left px-4 py-3 font-medium text-earth-600 dark:text-gray-400">Plant</th>
                  <th className="text-left px-4 py-3 font-medium text-earth-600 dark:text-gray-400">Variety</th>
                  <th className="text-left px-4 py-3 font-medium text-earth-600 dark:text-gray-400">Brand</th>
                  <th className="text-right px-4 py-3 font-medium text-earth-600 dark:text-gray-400">Qty</th>
                  <th className="text-left px-4 py-3 font-medium text-earth-600 dark:text-gray-400">Expires</th>
                  <th className="text-left px-4 py-3 font-medium text-earth-600 dark:text-gray-400">Notes</th>
                  <th className="text-right px-4 py-3 font-medium text-earth-600 dark:text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {seeds.map((seed) => {
                  const expired = isExpired(seed.expiration_date);
                  const low = isLowQuantity(seed.quantity_seeds);
                  return (
                    <tr
                      key={seed.id}
                      className={`border-b border-earth-100 dark:border-gray-700 hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors ${
                        expired ? 'bg-red-50 dark:bg-red-900/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-earth-800 dark:text-gray-100">{seed.plant_name}</span>
                        <span className="text-xs text-earth-400 ml-1">({seed.plant_category})</span>
                      </td>
                      <td className="px-4 py-3 text-earth-600 dark:text-gray-400">{seed.variety || '-'}</td>
                      <td className="px-4 py-3 text-earth-600 dark:text-gray-400">{seed.brand || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        {seed.quantity_seeds !== null ? (
                          <span className={`font-medium ${low ? 'text-amber-600 dark:text-amber-400' : 'text-earth-700 dark:text-gray-300'}`}>
                            {seed.quantity_seeds}
                            {low && (
                              <span className="ml-1 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                                Low
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-earth-400 dark:text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {seed.expiration_date ? (
                          <span className={expired ? 'text-red-600 dark:text-red-400 font-medium' : 'text-earth-600 dark:text-gray-400'}>
                            {seed.expiration_date}
                            {expired && (
                              <span className="ml-1 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                                Expired
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-earth-400 dark:text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-earth-500 dark:text-gray-400 max-w-[200px] truncate">
                        {seed.notes || '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleToggleSwap(seed)}
                          disabled={togglingSwap === seed.id}
                          title={seed.coop_swap_available ? 'Swap available — click to withdraw' : 'Offer this seed for swap'}
                          className={`text-xs font-medium mr-3 px-2 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                            seed.coop_swap_available
                              ? 'bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                              : 'bg-earth-50 dark:bg-gray-700 border-earth-200 dark:border-gray-600 text-earth-500 dark:text-gray-400 hover:border-green-300 dark:hover:border-green-700 hover:text-green-700 dark:hover:text-green-300'
                          }`}
                        >
                          {seed.coop_swap_available ? '✓ Swap available' : '🔄 Offer swap'}
                        </button>
                        <button
                          onClick={() => handleEdit(seed)}
                          className="text-garden-600 dark:text-garden-400 hover:text-garden-800 dark:hover:text-garden-300 text-xs font-medium mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(seed.id)}
                          className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Extra seeds swap suggestions */}
      {!loading && extraSeeds.length > 0 && (
        <div className="space-y-2">
          {extraSeeds.map(seed => (
            <div
              key={seed.id}
              className="flex items-center gap-2 bg-garden-50 dark:bg-garden-900/20 border border-garden-200 dark:border-garden-700 rounded-lg px-4 py-2.5 text-sm text-garden-800 dark:text-garden-200"
            >
              <span>💡 You have extra <strong>{seed.plant_name}</strong> seeds —</span>
              <a
                href="/coop/seeds"
                className="font-semibold underline hover:text-garden-600 dark:hover:text-garden-300"
              >
                offer a swap?
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Community Seed Swaps collapsible section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => setShowSeedSwaps(!showSeedSwaps)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-earth-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            🌱 Community Seed Swaps
            <span className="text-xs font-normal bg-garden-100 dark:bg-garden-900/40 text-garden-700 dark:text-garden-300 px-2 py-0.5 rounded-full">
              {seedSwaps.length}
            </span>
          </h2>
          <svg
            className={`w-4 h-4 text-earth-400 transition-transform ${showSeedSwaps ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showSeedSwaps && (
          <div className="px-4 pb-4 space-y-3">
            {seedSwaps.length === 0 ? (
              <p className="text-xs text-earth-400 dark:text-gray-500 text-center py-4">
                No community seed swaps available right now.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {seedSwaps.map((swap, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-3 bg-earth-50 dark:bg-gray-700/30 rounded-lg px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-earth-800 dark:text-gray-100">
                          {swap.plant_name}
                        </span>
                        {swap.variety && (
                          <span className="text-earth-500 dark:text-gray-400 ml-1 text-xs">
                            ({swap.variety})
                          </span>
                        )}
                        {swap.looking_for && (
                          <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">
                            Looking for: {swap.looking_for}
                          </p>
                        )}
                        <p className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
                          from {swap.peer_display_name || 'a neighbor'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-earth-400 dark:text-gray-500 flex items-center gap-1 pt-1">
                  📬 Contact via your Co-op peers
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Seed Wishlist collapsible section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => {
            if (!showWishlist && wishlist.length === 0) loadWishlist();
            setShowWishlist(!showWishlist);
          }}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-earth-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 flex items-center gap-2">
            ⭐ Seed Wishlist
            <span className="text-xs font-normal bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
              {wishlist.length}
            </span>
          </h2>
          <svg
            className={`w-4 h-4 text-earth-400 transition-transform ${showWishlist ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showWishlist && (
          <div className="px-4 pb-4 space-y-3">
            {wishlistLoading ? (
              <p className="text-xs text-earth-400 dark:text-gray-500 text-center py-4">Loading wishlist...</p>
            ) : (
              <>
                {wishlist.length === 0 ? (
                  <p className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">
                    Your wishlist is empty. Add seeds you&apos;d like to find!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {wishlist.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 bg-earth-50 dark:bg-gray-700/30 rounded-lg px-3 py-2.5 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-earth-800 dark:text-gray-100">
                            {item.plant_name}
                          </span>
                          {item.variety && (
                            <span className="text-earth-500 dark:text-gray-400 ml-1 text-xs">
                              ({item.variety})
                            </span>
                          )}
                          {item.notes && (
                            <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{item.notes}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteWishlistItem(item.id)}
                          className="shrink-0 text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 text-xs font-medium transition-colors"
                          title="Remove from wishlist"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showWishlistForm ? (
                  <form onSubmit={handleAddWishlistItem} className="bg-earth-50 dark:bg-gray-700/30 rounded-lg p-3 space-y-2 mt-2">
                    <div>
                      <label className="block text-xs font-medium text-earth-600 dark:text-gray-300 mb-1">
                        Plant Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={wishlistForm.plant_name}
                        onChange={(e) => setWishlistForm({ ...wishlistForm, plant_name: e.target.value })}
                        placeholder="e.g., Cherokee Purple Tomato"
                        className="w-full px-3 py-1.5 text-sm border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-earth-600 dark:text-gray-300 mb-1">Variety</label>
                      <input
                        type="text"
                        value={wishlistForm.variety}
                        onChange={(e) => setWishlistForm({ ...wishlistForm, variety: e.target.value })}
                        placeholder="Optional"
                        className="w-full px-3 py-1.5 text-sm border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-earth-600 dark:text-gray-300 mb-1">Notes</label>
                      <input
                        type="text"
                        value={wishlistForm.notes}
                        onChange={(e) => setWishlistForm({ ...wishlistForm, notes: e.target.value })}
                        placeholder="Optional notes"
                        className="w-full px-3 py-1.5 text-sm border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="submit"
                        disabled={wishlistSubmitting}
                        className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        {wishlistSubmitting ? 'Adding...' : 'Add to Wishlist'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowWishlistForm(false); setWishlistForm({ plant_name: '', variety: '', notes: '' }); }}
                        className="bg-earth-100 dark:bg-gray-600 hover:bg-earth-200 dark:hover:bg-gray-500 text-earth-700 dark:text-gray-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowWishlistForm(true)}
                    className="w-full text-xs font-medium text-garden-600 dark:text-garden-400 hover:text-garden-700 dark:hover:text-garden-300 py-1.5 border border-dashed border-garden-300 dark:border-garden-700 rounded-lg hover:border-garden-400 dark:hover:border-garden-600 transition-colors"
                  >
                    + Add to wishlist
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
