'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { PrivateIconButton } from './PrivateControls';

type ToastTone = 'success' | 'error';
type ToastOptions = { tone?: ToastTone; durationMs?: number };
type QueuedToast = { id: string; message: string; tone: ToastTone };

type PrivateToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void;
};

const PrivateToastContext = createContext<PrivateToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;

export function PrivateToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    const id = `private-toast-${(nextId.current += 1)}`;
    setToasts((current) => [...current, { id, message, tone: options?.tone ?? 'success' }]);
    window.setTimeout(() => dismiss(id), options?.durationMs ?? DEFAULT_DURATION_MS);
  }, [dismiss]);

  return (
    <PrivateToastContext.Provider value={{ showToast }}>
      {children}
      <div className="private-toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`private-toast private-toast--${toast.tone}`} role="status">
            <span>{toast.message}</span>
            <PrivateIconButton label="Cerrar notificación" variant="quiet" className="private-toast__dismiss" onClick={() => dismiss(toast.id)}>×</PrivateIconButton>
          </div>
        ))}
      </div>
    </PrivateToastContext.Provider>
  );
}

export function usePrivateToast(): PrivateToastContextValue {
  const context = useContext(PrivateToastContext);
  if (!context) throw new Error('usePrivateToast must be used within a PrivateToastProvider.');
  return context;
}
