'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { Logo } from '../logo';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      router.push('/');
    } catch (err: any) {
      setError(err?.message?.includes('Invalid') ? 'Invalid username or password' : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-earth-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <Logo size={48} />
          </div>
          <h1 className="text-2xl font-bold text-garden-700 dark:text-garden-400">Garden Godmother</h1>
          <p className="text-earth-400 dark:text-gray-500 text-sm mt-1">Sign in to your garden</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-base"
              autoComplete="current-password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors text-base"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-earth-400 dark:text-gray-500 mt-4">
          Have an invite code? <Link href="/register" className="text-garden-600 dark:text-garden-400 hover:underline">Create account</Link>
        </p>
      </div>
    </div>
  );
}
