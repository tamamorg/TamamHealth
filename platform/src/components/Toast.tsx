'use client';

import { useState, useCallback, createContext, useContext, ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { DANGER_STRONG, SUCCESS_STRONG, WHITE } from '@/lib/theme-colors';

/** An inline action rendered as a button in the toast — e.g. Undo. */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, type: 'success' | 'error', opts?: { action?: ToastAction; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error', opts?: { action?: ToastAction; durationMs?: number }) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type, action: opts?.action }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      // A toast carrying an action (Undo) stays up twice as long — it is the
      // recovery window, not just a receipt.
    }, opts?.durationMs ?? (opts?.action ? 8000 : 4000));
  }, []);

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div
        role="region"
        aria-label={t('common.notifications')}
        aria-live="polite"
        aria-atomic="false"
        className="fixed z-[9999] flex flex-col gap-2 items-end"
        style={{ top: 16, right: 16, maxWidth: 'min(420px, calc(100vw - 32px))' }}
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            role="alert"
            className="ehr-toast animate-fadeInUp"
            style={{
              // The STRONG rung, not the base: 13.5px white text sits on this,
              // and the base fills are only rated for 3:1. Success goes from
              // 3.77:1 to 5.36:1, danger from 4.83:1 to 8.35:1.
              background: toast.type === 'success' ? SUCCESS_STRONG : DANGER_STRONG,
              color: WHITE,
            }}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="ehr-toast-icon" aria-hidden="true" />
            ) : (
              <AlertTriangle className="ehr-toast-icon" aria-hidden="true" />
            )}
            <p className="ehr-toast-text">{toast.message}</p>
            {toast.action && (
              <button
                onClick={() => { void toast.action!.onClick(); removeToast(toast.id); }}
                className="ehr-toast-action"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => removeToast(toast.id)}
              aria-label={t('common.dismissNotification')}
              className="ehr-toast-close"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
