'use client';
import { useState, useCallback, createContext, useContext, useRef } from 'react';

// ─── Confirm Modal ───

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, title, message, confirmText = 'Confirm', cancelText = 'Cancel', destructive = false, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-earth-900 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-sm text-earth-600 dark:text-gray-400 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium rounded-lg border border-earth-300 dark:border-gray-600 text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors">
            {cancelText}
          </button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${
            destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-garden-600 hover:bg-garden-700'
          }`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Prompt Modal ───

interface PromptModalProps {
  open: boolean;
  title: string;
  message: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({ open, title, message, defaultValue = '', confirmText = 'OK', cancelText = 'Cancel', onConfirm, onCancel }: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);

  // Reset value when modal opens with new defaultValue
  const lastDefault = useRef(defaultValue);
  if (open && defaultValue !== lastDefault.current) {
    setValue(defaultValue);
    lastDefault.current = defaultValue;
  }
  if (!open && lastDefault.current !== '') {
    lastDefault.current = '';
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-earth-900 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-sm text-earth-600 dark:text-gray-400 mb-3">{message}</p>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()); if (e.key === 'Escape') onCancel(); }}
          className="w-full px-3 py-2 rounded-lg border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-900 dark:text-gray-100 text-sm mb-4 focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
        />
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium rounded-lg border border-earth-300 dark:border-gray-600 text-earth-700 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors">
            {cancelText}
          </button>
          <button onClick={() => value.trim() && onConfirm(value.trim())} className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-garden-600 hover:bg-garden-700 transition-colors">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Imperative Hook ───

interface ModalState {
  type: 'confirm' | 'prompt';
  title: string;
  message: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

const ModalContext = createContext<{
  showConfirm: (opts: { title: string; message: string; confirmText?: string; cancelText?: string; destructive?: boolean }) => Promise<boolean>;
  showPrompt: (opts: { title: string; message: string; defaultValue?: string }) => Promise<string | null>;
}>({
  showConfirm: () => Promise.resolve(false),
  showPrompt: () => Promise.resolve(null),
});

export function useModal() { return useContext(ModalContext); }

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ModalState | null>(null);
  const resolveRef = useRef<((v: boolean | string | null) => void) | null>(null);

  const showConfirm = useCallback((opts: { title: string; message: string; confirmText?: string; cancelText?: string; destructive?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve as (v: boolean | string | null) => void;
      setState({ type: 'confirm', ...opts });
    });
  }, []);

  const showPrompt = useCallback((opts: { title: string; message: string; defaultValue?: string }) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve as (v: boolean | string | null) => void;
      setState({ type: 'prompt', ...opts });
    });
  }, []);

  const handleClose = useCallback((result: boolean | string | null) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  return (
    <ModalContext.Provider value={{ showConfirm, showPrompt }}>
      {children}
      {state?.type === 'confirm' && (
        <ConfirmModal
          open
          title={state.title}
          message={state.message}
          confirmText={state.confirmText || 'Confirm'}
          cancelText={state.cancelText}
          destructive={state.destructive}
          onConfirm={() => handleClose(true)}
          onCancel={() => handleClose(false)}
        />
      )}
      {state?.type === 'prompt' && (
        <PromptModal
          open
          title={state.title}
          message={state.message}
          defaultValue={state.defaultValue}
          onConfirm={(v) => handleClose(v)}
          onCancel={() => handleClose(null)}
        />
      )}
    </ModalContext.Provider>
  );
}
