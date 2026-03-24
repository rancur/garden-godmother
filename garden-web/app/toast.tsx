'use client';
import { createContext, useContext, useState, useCallback, useRef } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  action?: ToastAction;
  duration?: number;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

const ToastContext = createContext<{ toast: (msg: string, type?: ToastType, options?: ToastOptions) => void }>({ toast: () => {} });

export function useToast() { return useContext(ToastContext); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'success', options?: ToastOptions) => {
    const id = Math.random().toString(36);
    const duration = options?.action ? (options.duration ?? 5000) : (options?.duration ?? 3000);
    setToasts(prev => [...prev, { id, message, type, action: options?.action }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current.delete(id);
    }, duration);
    timersRef.current.set(id, timer);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium animate-slide-up ${
            t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
          }`}>
            <span>
              {t.type === 'success' ? '\u2713' : t.type === 'error' ? '\u2715' : '\u2139'} {t.message}
            </span>
            {t.action && (
              <button
                onClick={() => { t.action!.onClick(); dismissToast(t.id); }}
                className="ml-2 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-xs font-bold uppercase tracking-wide transition-colors"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
