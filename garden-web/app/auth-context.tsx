'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { getMe, login as apiLogin, logout as apiLogout, getSetupStatus } from './api';

interface User {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: string;
  avatar_url: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => { throw new Error('Not initialized'); },
  logout: async () => {},
  refresh: async () => {},
});

const PUBLIC_PATHS = ['/login', '/register', '/setup'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me);
      // After successful auth, check if setup is needed
      if (me && me.role === 'admin' && typeof window !== 'undefined' && window.location.pathname !== '/setup') {
        try {
          const setupData = await getSetupStatus();
          if (setupData && !setupData.setup_complete) {
            window.location.href = '/setup';
            return;
          }
        } catch {
          // Setup check failed — don't block normal flow
        }
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const userData = await apiLogin(username, password);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    window.location.href = '/login';
  }, []);

  // Show loading spinner while checking auth (only on non-public paths)
  if (loading && !PUBLIC_PATHS.includes(pathname)) {
    return (
      <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-garden-200 border-t-garden-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-earth-400 dark:text-gray-500 text-sm">Loading...</p>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  // Redirect to login if not authenticated and not on a public path
  if (!loading && !user && !PUBLIC_PATHS.includes(pathname)) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    return (
      <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-earth-400 dark:text-gray-500 text-sm">Redirecting to login...</p>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
