'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  getHarvestOffers,
  createHarvestOffer,
  updateHarvestOffer,
  deleteHarvestOffer,
} from '../../api';
import { useToast } from '../../toast';

// ─── Types ───

interface HarvestOffer {
  id: number;
  plant_name: string;
  quantity_description: string;
  notes?: string;
  available_from?: string;
  available_until?: string;
  status: 'available' | 'claimed' | 'expired';
  published: boolean;
  created_at: string;
}

type FilterTab = 'all' | 'available' | 'shared';

// ─── Sub-Nav ───

const COOP_NAV = [
  { label: 'Board', href: '/coop/board', icon: '🌐' },
  { label: 'Harvest', href: '/coop/harvest', icon: '🧺' },
  { label: 'Seeds', href: '/coop/seeds', icon: '🌰' },
  { label: 'Alerts', href: '/coop/alerts', icon: '⚠️' },
];

function CoopSubNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 p-1 bg-earth-100 dark:bg-gray-800 rounded-xl overflow-x-auto">
      {COOP_NAV.map(({ label, href, icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? 'bg-white dark:bg-gray-700 text-garden-700 dark:text-garden-400 shadow-sm'
                : 'text-earth-600 dark:text-gray-400 hover:text-earth-900 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-gray-700/50'
            }`}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ─── Shared Components ───

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-earth-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-earth-100 dark:border-gray-700 flex items-center gap-2.5">
        <span className="text-xl">{icon}</span>
        <h2 className="text-lg font-semibold text-earth-900 dark:text-gray-100">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-garden-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-garden-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

const STATUS_STYLES: Record<string, string> = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  expired: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.available
      }`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 bg-earth-100 dark:bg-gray-700 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm rounded-lg border border-earth-200 dark:border-gray-600 bg-earth-50 dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 focus:border-transparent outline-none transition';

// ─── New Offer Form ───

interface NewOfferForm {
  plant_name: string;
  quantity_description: string;
  notes: string;
  available_until: string;
  published: boolean;
}

function NewOfferFormSection({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewOfferForm>({
    plant_name: '',
    quantity_description: '',
    notes: '',
    available_until: '',
    published: false,
  });

  const setField = <K extends keyof NewOfferForm>(key: K, val: NewOfferForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.plant_name.trim() || !form.quantity_description.trim()) {
      toast('Plant name and quantity are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await createHarvestOffer({
        plant_name: form.plant_name.trim(),
        quantity_description: form.quantity_description.trim(),
        notes: form.notes.trim() || undefined,
        available_until: form.available_until || undefined,
        published: form.published,
      });
      toast('Harvest offer created!', 'success');
      setForm({ plant_name: '', quantity_description: '', notes: '', available_until: '', published: false });
      setOpen(false);
      onCreated();
    } catch {
      toast('Could not create offer', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition shadow-sm"
        >
          <span>+</span> New Offer
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 p-4 rounded-lg border border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900/30">
          <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-200">New Harvest Offer</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
                Plant Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Tomatoes"
                value={form.plant_name}
                onChange={(e) => setField('plant_name', e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
                Quantity <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. ~5 lbs, a few handfuls"
                value={form.quantity_description}
                onChange={(e) => setField('quantity_description', e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
              Notes <span className="text-earth-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <textarea
              rows={2}
              placeholder="Any details about the produce..."
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">
              Available Until <span className="text-earth-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={form.available_until}
              onChange={(e) => setField('available_until', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Toggle checked={form.published} onChange={(v) => setField('published', v)} />
              <span className="text-sm text-earth-700 dark:text-gray-300">Share with co-op</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-garden-600 text-white hover:bg-garden-700 transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Offer'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Offer Row ───

function OfferRow({
  offer,
  onUpdated,
  onDeleted,
}: {
  offer: HarvestOffer;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editForm, setEditForm] = useState({
    quantity_description: offer.quantity_description,
    notes: offer.notes ?? '',
    available_until: offer.available_until?.slice(0, 10) ?? '',
    status: offer.status,
  });

  const setField = <K extends keyof typeof editForm>(key: K, val: (typeof editForm)[K]) =>
    setEditForm((f) => ({ ...f, [key]: val }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateHarvestOffer(offer.id, {
        quantity_description: editForm.quantity_description.trim(),
        notes: editForm.notes.trim() || undefined,
        available_until: editForm.available_until || undefined,
        status: editForm.status,
      });
      toast('Offer updated', 'success');
      setEditing(false);
      onUpdated();
    } catch {
      toast('Could not update offer', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteHarvestOffer(offer.id);
      toast('Offer deleted', 'success');
      onDeleted();
    } catch {
      toast('Could not delete offer', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleTogglePublished = async () => {
    try {
      await updateHarvestOffer(offer.id, { published: !offer.published });
      onUpdated();
    } catch {
      toast('Could not update sharing', 'error');
    }
  };

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="p-4 rounded-lg border border-garden-300 dark:border-garden-700/50 bg-earth-50 dark:bg-gray-900/30 space-y-3"
      >
        <p className="text-sm font-semibold text-earth-900 dark:text-gray-100">{offer.plant_name}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">Quantity</label>
            <input
              type="text"
              value={editForm.quantity_description}
              onChange={(e) => setField('quantity_description', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">Status</label>
            <select
              value={editForm.status}
              onChange={(e) => setField('status', e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="available">Available</option>
              <option value="claimed">Claimed</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">Notes</label>
          <textarea
            rows={2}
            value={editForm.notes}
            onChange={(e) => setField('notes', e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-earth-700 dark:text-gray-300 mb-1">Available Until</label>
          <input
            type="date"
            value={editForm.available_until}
            onChange={(e) => setField('available_until', e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-garden-600 text-white hover:bg-garden-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 rounded-lg border border-earth-200 dark:border-gray-700 bg-earth-50 dark:bg-gray-900/30">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="text-sm font-semibold text-earth-900 dark:text-gray-100">{offer.plant_name}</p>
          <StatusBadge status={offer.status} />
          {offer.published && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-garden-100 text-garden-800 dark:bg-garden-900/40 dark:text-garden-300">
              Shared
            </span>
          )}
        </div>
        <p className="text-sm text-earth-700 dark:text-gray-300">{offer.quantity_description}</p>
        {offer.notes && (
          <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{offer.notes}</p>
        )}
        {offer.available_until && (
          <p className="text-xs text-earth-400 dark:text-gray-500 mt-0.5">
            Until: {new Date(offer.available_until).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Toggle checked={offer.published} onChange={handleTogglePublished} />
          <span className="text-xs text-earth-600 dark:text-gray-400">Share</span>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-200 hover:bg-earth-200 dark:hover:bg-gray-600 transition"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
        >
          {deleting ? '...' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

// ─── Page ───

export default function HarvestPage() {
  const { toast } = useToast();
  const [offers, setOffers] = useState<HarvestOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');

  const load = useCallback(() => {
    setLoading(true);
    getHarvestOffers()
      .then((data: HarvestOffer[]) => setOffers(data))
      .catch(() => toast('Could not load harvest offers', 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = offers.filter((o) => {
    if (filter === 'available') return o.status === 'available';
    if (filter === 'shared') return o.published;
    return true;
  });

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'available', label: 'Available' },
    { key: 'shared', label: 'Shared' },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100">Garden Co-op</h1>
        <p className="text-sm text-earth-500 dark:text-gray-400 mt-1">
          Connect and share with other gardens in your federation.
        </p>
      </div>

      <CoopSubNav />

      <Card title="My Harvest Offers" icon="🧺">
        <div className="space-y-4">
          <NewOfferFormSection onCreated={load} />

          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-earth-100 dark:border-gray-700 pb-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  filter === key
                    ? 'bg-garden-100 dark:bg-garden-900/40 text-garden-700 dark:text-garden-300'
                    : 'text-earth-600 dark:text-gray-400 hover:bg-earth-100 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <LoadingSkeleton />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-earth-500 dark:text-gray-400 py-4 text-center">
              {filter === 'all' ? 'No harvest offers yet. Create one above!' : `No ${filter} offers.`}
            </p>
          ) : (
            <div className="space-y-3">
              {filtered.map((offer) => (
                <OfferRow key={offer.id} offer={offer} onUpdated={load} onDeleted={load} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
