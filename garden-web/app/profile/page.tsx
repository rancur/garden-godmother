'use client';

import { useState } from 'react';
import { useAuth } from '../auth-context';
import { changePassword, updateProfile } from '../api';
import { useToast } from '../toast';

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  if (!user) return null;

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({ display_name: displayName, email: email || undefined });
      await refresh();
      toast('Profile updated');
    } catch { toast('Failed to update profile'); }
    finally { setSaving(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) { toast('Passwords do not match'); return; }
    if (newPw.length < 8) { toast('Password must be at least 8 characters'); return; }
    setChangingPw(true);
    try {
      await changePassword(oldPw, newPw);
      setOldPw(''); setNewPw(''); setConfirmPw('');
      toast('Password changed');
    } catch (err: any) {
      toast(err?.message?.includes('incorrect') ? 'Current password is incorrect' : 'Failed to change password');
    } finally { setChangingPw(false); }
  };

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Profile</h1>

      {/* Profile Info */}
      <form onSubmit={handleUpdateProfile} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
        <h2 className="font-bold text-earth-700 dark:text-gray-200">Account Info</h2>
        <div>
          <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Username</label>
          <input
            value={user.username}
            disabled
            className="w-full px-3 py-2 border border-earth-200 dark:border-gray-700 rounded-lg bg-earth-50 dark:bg-gray-900 text-earth-400 dark:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Display Name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-earth-400 dark:text-gray-500">Role: <span className="font-medium text-earth-600 dark:text-gray-300">{user.role}</span></span>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>

      {/* Change Password */}
      <form onSubmit={handleChangePassword} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
        <h2 className="font-bold text-earth-700 dark:text-gray-200">Change Password</h2>
        <div>
          <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Current Password</label>
          <input
            type="password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">New Password</label>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Confirm New Password</label>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
            autoComplete="new-password"
            required
          />
        </div>
        <button
          type="submit"
          disabled={changingPw || !oldPw || !newPw}
          className="bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition-colors"
        >
          {changingPw ? 'Changing...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}
