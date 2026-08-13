import type React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';


export type ToastKind = 'error' | 'success' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toastError: (message: string) => void;
  toastSuccess: (message: string) => void;
  toastInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 1;
const MAX_TOASTS = 5;
const TOAST_DURATION_MS = 4500;

const KIND_STYLES: Record<ToastKind, { tint: string; icon: React.ReactNode }> = {
  error: {
    tint: 'text-red-500',
    icon: (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  success: {
    tint: 'text-emerald-500',
    icon: (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  info: {
    tint: 'text-accent',
    icon: (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
};

export const ToastProvider: React.FC<{ children: React.ReactNode; queueSlot?: React.ReactNode }> = ({ children, queueSlot }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextToastId++;
    setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { id, kind, message }]);
    window.setTimeout(() => dismiss(id), TOAST_DURATION_MS);
  }, [dismiss]);

  const value: ToastContextValue = {
    toastError: useCallback((m: string) => push('error', m), [push]),
    toastSuccess: useCallback((m: string) => push('success', m), [push]),
    toastInfo: useCallback((m: string) => push('info', m), [push]),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 top-5 z-[3000] flex w-[360px] flex-col items-stretch gap-2">
        <AnimatePresence initial={false}>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              role="status"
              layout
              initial={{ opacity: 0, x: 16, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-panel p-3 shadow-[0_6px_20px_rgba(0,0,0,0.10)] ${KIND_STYLES[t.kind].tint}`}
            >
            <span className="mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center">
              {KIND_STYLES[t.kind].icon}
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded text-muted transition-colors duration-100 hover:bg-surface hover:text-ink"
              onClick={() => dismiss(t.id)}
            >
              <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {queueSlot}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
