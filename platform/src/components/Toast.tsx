'use client';

import { useState, useCallback, useRef, createContext, useContext, useEffect, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

/** An inline action rendered as a button in the toast — e.g. Undo. */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  title?: string;
  action?: ToastAction;
  leaving?: boolean;
}

export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
  /** A bold first line; the message becomes the detail under it. */
  title?: string;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastId = 0;

/** How long the leave animation runs before the node is removed. Matches
 *  `--motion-base`; reduced-motion zeroes the animation but the node still
 *  waits this long, which is imperceptible. */
const LEAVE_MS = 180;

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  warning: AlertCircle,
  info: Info,
};

/**
 * Transient feedback: the receipt for something that just happened.
 *
 * Four tones. `success` and `info` are polite (`role="status"`); `error`
 * and `warning` interrupt (`role="alert"`). A toast carrying an action
 * (Undo) stays up twice as long — it is the recovery window, not just a
 * receipt. Each toast leaves with a short fade rather than vanishing, so a
 * user who glanced up at the right moment sees it go instead of wondering
 * whether it was ever there.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    const held = timers.current.get(id);
    if (held !== undefined) { window.clearTimeout(held); timers.current.delete(id); }
    setToasts(prev => prev.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast)));
    window.setTimeout(() => setToasts(prev => prev.filter(toast => toast.id !== id)), LEAVE_MS);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', opts?: ToastOptions) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type, title: opts?.title, action: opts?.action }]);
    const ttl = opts?.durationMs ?? (opts?.action ? 8000 : type === 'error' ? 6000 : 4000);
    timers.current.set(id, window.setTimeout(() => remove(id), ttl));
  }, [remove]);

  useEffect(() => {
    const held = timers.current;
    return () => { for (const timer of held.values()) window.clearTimeout(timer); };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div
        role="region"
        aria-label={t('common.notifications')}
        aria-live="polite"
        aria-atomic="false"
        className="fixed flex flex-col gap-2 items-end"
        // Below the top rail when one is in the document, the corner when not
        // (login, mobile shell) — the inset variable tracks that for us.
        style={{
          top: 'calc(var(--app-overlay-top-inset, 0px) + 12px)',
          right: 16,
          zIndex: 'var(--z-toast)' as unknown as number,
          maxWidth: 'min(420px, calc(100vw - 32px))',
        }}
      >
        {toasts.map(toast => {
          const Icon = ICONS[toast.type];
          const urgent = toast.type === 'error' || toast.type === 'warning';
          return (
            <div
              key={toast.id}
              role={urgent ? 'alert' : 'status'}
              className={`ehr-toast ehr-toast--${toast.type} tm-elevated tm-motion tm-motion--toast${toast.leaving ? ' is-leaving' : ''}`}
            >
              <Icon className="ehr-toast-icon" aria-hidden="true" />
              <span className="sr-only">{t(`toast.${toast.type}`)}: </span>
              {toast.title ? (
                <div className="ehr-toast-copy">
                  <p className="ehr-toast-title">{toast.title}</p>
                  <p className="ehr-toast-text">{toast.message}</p>
                </div>
              ) : (
                <p className="ehr-toast-text">{toast.message}</p>
              )}
              {toast.action && (
                <button
                  type="button"
                  onClick={() => { void toast.action!.onClick(); remove(toast.id); }}
                  className="ehr-toast-action"
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(toast.id)}
                aria-label={t('common.dismissNotification')}
                className="ehr-toast-close"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
