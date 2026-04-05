'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPublicGardenProfile, getGardenProfile, updateGardenProfile, API_URL } from '../api';
import { useToast } from '../toast';
import { useAuth } from '../auth-context';

interface GrowingSeason {
  active_plantings: number;
  beds_in_use: number;
  plants: string[];
}

interface RecentHarvest {
  plant_name: string | null;
  harvest_date: string;
  weight_oz: number | null;
  quantity: number | null;
}

interface SeedSwap {
  id: number | null;
  plant_name: string;
  variety: string | null;
  quantity_description: string;
  looking_for: string | null;
}

interface HarvestOffer {
  id: number;
  plant_name: string;
  quantity_description: string;
  available_from: string | null;
  available_until: string | null;
}

interface PublicProfile {
  instance_id: string;
  display_name: string;
  coarse_location: string | null;
  instance_url: string | null;
  garden_bio: string | null;
  growing_season: GrowingSeason;
  recent_harvests: RecentHarvest[];
  seed_swaps: SeedSwap[];
  harvest_offers: HarvestOffer[];
}

function formatHarvestAmount(h: RecentHarvest): string {
  const parts: string[] = [];
  if (h.weight_oz) parts.push(`${h.weight_oz} oz`);
  if (h.quantity) parts.push(`${h.quantity} item${h.quantity !== 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(', ') : 'Some';
}

function SectionCard({ icon, title, children, empty, emptyText }: {
  icon: string;
  title: string;
  children?: React.ReactNode;
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-earth-100 dark:border-gray-700 bg-earth-50 dark:bg-gray-800/50">
        <span className="text-lg">{icon}</span>
        <h2 className="font-semibold text-earth-800 dark:text-gray-200">{title}</h2>
      </div>
      <div className="px-5 py-4">
        {empty ? (
          <p className="text-sm text-earth-400 dark:text-gray-500 italic">{emptyText || 'Nothing to show yet.'}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function EditBioModal({
  currentBio,
  currentName,
  onClose,
  onSaved,
}: {
  currentBio: string;
  currentName: string;
  onClose: () => void;
  onSaved: (bio: string, name: string) => void;
}) {
  const { toast } = useToast();
  const [bio, setBio] = useState(currentBio);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateGardenProfile({ garden_bio: bio, instance_name: name });
      toast('Garden profile updated', 'success');
      onSaved(bio, name);
      onClose();
    } catch {
      toast('Failed to save profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-earth-800 dark:text-gray-100">Edit Garden Profile</h3>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">
              Garden Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Garden"
              className="w-full px-3 py-2 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none transition text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-700 dark:text-gray-300 mb-1">
              Garden Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Tell other gardeners about your space — what you grow, your philosophy, your location (coarsely), etc."
              className="w-full px-3 py-2 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none transition text-sm resize-none"
            />
          </div>
          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-earth-600 dark:text-gray-400 hover:text-earth-800 dark:hover:text-gray-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-garden-600 text-white hover:bg-garden-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GardenProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    getPublicGardenProfile()
      .then((data: PublicProfile) => setProfile(data))
      .catch((err: Error) => {
        if (err.message.startsWith('503') || err.message.includes('not configured')) {
          setError('federation-not-configured');
        } else {
          setError('load-error');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleProfileSaved = (bio: string, name: string) => {
    setProfile((p) => p ? { ...p, garden_bio: bio, display_name: name } : p);
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/garden-profile`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Profile link copied!', 'success');
    } catch {
      toast('Could not copy link', 'error');
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-pulse">
        <div className="h-32 bg-earth-100 dark:bg-gray-800 rounded-xl" />
        <div className="h-40 bg-earth-100 dark:bg-gray-800 rounded-xl" />
        <div className="h-40 bg-earth-100 dark:bg-gray-800 rounded-xl" />
      </div>
    );
  }

  if (error === 'federation-not-configured') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="text-5xl">🌱</div>
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Garden Co-op Not Set Up</h1>
        <p className="text-earth-500 dark:text-gray-400">
          Configure your garden&apos;s federation identity to enable the public profile.
        </p>
        {user && (
          <Link
            href="/settings#coop"
            className="inline-block px-5 py-2.5 rounded-lg bg-garden-600 text-white font-medium hover:bg-garden-700 transition text-sm"
          >
            Set Up Co-op Identity
          </Link>
        )}
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="text-5xl">🌿</div>
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Could Not Load Profile</h1>
        <p className="text-earth-500 dark:text-gray-400">Something went wrong loading the garden profile.</p>
      </div>
    );
  }

  const pairUrl = '/settings/coop/pair';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-garden-50 to-earth-50 dark:from-gray-800 dark:to-gray-900 rounded-xl border border-garden-200 dark:border-garden-800 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-3xl">🌻</span>
              <h1 className="text-2xl font-bold text-earth-900 dark:text-gray-100 truncate">
                {profile.display_name || 'My Garden'}
              </h1>
            </div>
            {profile.coarse_location && (
              <p className="text-sm text-earth-500 dark:text-gray-400 mb-2">
                📍 {profile.coarse_location}
              </p>
            )}
            {profile.garden_bio ? (
              <p className="text-sm text-earth-700 dark:text-gray-300 leading-relaxed mt-2">
                {profile.garden_bio}
              </p>
            ) : user ? (
              <p className="text-sm text-earth-400 dark:text-gray-500 italic mt-2">
                No bio yet — add one to tell visitors about your garden.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setShowEditModal(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-earth-300 dark:border-gray-600 text-earth-700 dark:text-gray-300 hover:bg-earth-100 dark:hover:bg-gray-700 transition"
              >
                Edit Profile
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyLink}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-earth-300 dark:border-gray-600 text-earth-700 dark:text-gray-300 hover:bg-earth-100 dark:hover:bg-gray-700 transition"
            >
              Copy Link
            </button>
          </div>
        </div>

        {/* Connect button */}
        <div className="mt-5 pt-4 border-t border-garden-200 dark:border-garden-800 flex flex-wrap items-center gap-3">
          <Link
            href={pairUrl}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-garden-600 text-white text-sm font-medium hover:bg-garden-700 transition"
          >
            <span>🤝</span>
            Connect as Co-op Peer
          </Link>
          {profile.instance_url && (
            <a
              href={`${profile.instance_url}/api/federation/profile`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-earth-400 dark:text-gray-500 hover:text-garden-600 dark:hover:text-garden-400 transition"
            >
              Instance: {profile.instance_url}
            </a>
          )}
        </div>
      </div>

      {/* Growing Now */}
      <SectionCard
        icon="🌱"
        title="Growing Now"
        empty={profile.growing_season.active_plantings === 0}
        emptyText="No active plantings recorded yet."
      >
        <div className="space-y-3">
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-garden-700 dark:text-garden-400">
                {profile.growing_season.active_plantings}
              </div>
              <div className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">active planting{profile.growing_season.active_plantings !== 1 ? 's' : ''}</div>
            </div>
            {profile.growing_season.beds_in_use > 0 && (
              <div className="text-center">
                <div className="text-3xl font-bold text-earth-700 dark:text-gray-300">
                  {profile.growing_season.beds_in_use}
                </div>
                <div className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">bed{profile.growing_season.beds_in_use !== 1 ? 's' : ''} in use</div>
              </div>
            )}
          </div>
          {profile.growing_season.plants.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {profile.growing_season.plants.map((plant) => (
                <span
                  key={plant}
                  className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-garden-100 text-garden-800 dark:bg-garden-900/40 dark:text-garden-300"
                >
                  {plant}
                </span>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Recent Harvests */}
      <SectionCard
        icon="🌾"
        title="Recent Harvests"
        empty={profile.recent_harvests.length === 0}
        emptyText="No harvests recorded yet."
      >
        <ul className="divide-y divide-earth-50 dark:divide-gray-700/50">
          {profile.recent_harvests.map((h, i) => (
            <li key={i} className="py-2.5 flex items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium text-earth-800 dark:text-gray-200">
                  {h.plant_name || 'Unknown plant'}
                </span>
                {h.harvest_date && (
                  <span className="ml-2 text-xs text-earth-400 dark:text-gray-500">
                    {new Date(h.harvest_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </div>
              <span className="text-xs text-earth-600 dark:text-gray-400 shrink-0">
                {formatHarvestAmount(h)}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Seed Swaps */}
      <SectionCard
        icon="🔄"
        title="Available for Swap"
        empty={profile.seed_swaps.length === 0}
        emptyText="No seeds currently available for swap."
      >
        <ul className="divide-y divide-earth-50 dark:divide-gray-700/50">
          {profile.seed_swaps.map((s, i) => (
            <li key={i} className="py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-sm font-medium text-earth-800 dark:text-gray-200">
                    {s.plant_name}
                    {s.variety && <span className="ml-1 text-earth-500 dark:text-gray-400">— {s.variety}</span>}
                  </span>
                  <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{s.quantity_description}</p>
                </div>
                {s.looking_for && (
                  <span className="text-xs text-earth-400 dark:text-gray-500 italic shrink-0">
                    Seeking: {s.looking_for}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Surplus Harvest Offers */}
      <SectionCard
        icon="🎁"
        title="Surplus to Share"
        empty={profile.harvest_offers.length === 0}
        emptyText="No surplus harvest offers right now."
      >
        <ul className="divide-y divide-earth-50 dark:divide-gray-700/50">
          {profile.harvest_offers.map((o) => (
            <li key={o.id} className="py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-sm font-medium text-earth-800 dark:text-gray-200">{o.plant_name}</span>
                  <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{o.quantity_description}</p>
                </div>
                {(o.available_from || o.available_until) && (
                  <span className="text-xs text-earth-400 dark:text-gray-500 shrink-0">
                    {o.available_from && `From ${new Date(o.available_from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                    {o.available_from && o.available_until && ' · '}
                    {o.available_until && `Until ${new Date(o.available_until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Footer */}
      <div className="text-center py-4">
        <p className="text-xs text-earth-400 dark:text-gray-500">
          Powered by{' '}
          <span className="font-medium text-garden-600 dark:text-garden-400">Garden Godmother</span>
          {' · '}
          <Link href="/settings#coop" className="hover:underline">Co-op settings</Link>
        </p>
      </div>

      {/* Edit modal */}
      {showEditModal && (
        <EditBioModal
          currentBio={profile.garden_bio || ''}
          currentName={profile.display_name || ''}
          onClose={() => setShowEditModal(false)}
          onSaved={handleProfileSaved}
        />
      )}
    </div>
  );
}
