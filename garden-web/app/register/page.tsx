'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '../api';
import { Logo } from '../logo';

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    invite_code: '',
    username: '',
    display_name: '',
    password: '',
    confirm_password: '',
    email: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (formData.password !== formData.confirm_password) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await register({
        username: formData.username,
        password: formData.password,
        display_name: formData.display_name,
        invite_code: formData.invite_code,
        email: formData.email,
      });
      router.push('/login?registered=1');
    } catch (err: any) {
      setError(err?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  return (
    <div className="min-h-screen flex items-center justify-center bg-earth-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <Logo size={48} />
          </div>
          <h1 className="text-2xl font-bold text-garden-700 dark:text-garden-400">Join the Garden</h1>
          <p className="text-earth-400 dark:text-gray-500 text-sm mt-1">Create your account with an invite code</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Invite Code</label>
            <input
              type="text"
              value={formData.invite_code}
              onChange={(e) => update('invite_code', e.target.value.toUpperCase())}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base font-mono tracking-wider text-center"
              placeholder="XXXXXXXX"
              maxLength={8}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => update('username', e.target.value)}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Display Name</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => update('display_name', e.target.value)}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => update('email', e.target.value)}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => update('password', e.target.value)}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Confirm Password</label>
            <input
              type="password"
              value={formData.confirm_password}
              onChange={(e) => update('confirm_password', e.target.value)}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base"
              autoComplete="new-password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading || !formData.invite_code || !formData.username || !formData.password}
            className="w-full bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors text-base"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-xs text-earth-400 dark:text-gray-500 mt-4">
          Already have an account? <Link href="/login" className="text-garden-600 dark:text-garden-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
