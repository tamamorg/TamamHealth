'use client';

import { useState, useCallback, useRef, createContext, useContext, useEffect, type ReactNode } from 'react';
import { X } from '@/components/icons/lucide';
import StatusGlyph from '@/components/overlay/StatusGlyph';
import { splitNotice } from '@/components/overlay/notice-hosts';
import { useTranslation } from '@/lib/i18n/useTranslation';

/** An inline action rendered as a button in the toast — e.g. Undo. */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  ttl: number | null;
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
  /** Stay until dismissed — for a failed clinical save the user must not miss. */
  sticky?: boolean;
  /** Every notification now shows in the bottom-left stack; errors are no
   *  longer routed into the form the user is in. Kept so existing calls that
   *  asked for the corner explicitly still compile. */
  placement?: 'auto' | 'corner';
}

export { splitNotice } from '@/components/overlay/notice-hosts';

interface ToastContextType {
  /** Returns the notification's id, for `dismissToast`. */
  showToast: (message: string, type?: ToastType, opts?: ToastOptions) => number;
  /** Take a notification down — a sticky one whose condition has cleared. */
  dismissToast?: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastId = 0;

/** How long the leave animation runs before the node is removed. Matches
 *  `--motion-base`; reduced-motion zeroes the animation but the node still
 *  waits this long, which is imperceptible. */
const LEAVE_MS = 180;

/**
 * Transient feedback: the receipt for something that just happened.
 *
 * Four tones. `success` and `info` are polite (`role="status"`); `error`
 * and `warning` interrupt (`role="alert"`). A toast carrying an action
 * (Undo) stays up twice as long — it is the recovery window, not just a
 * receipt. Errors stay longer than receipts, a `sticky` toast stays until
 * dismissed, and the timer pauses while the pointer or keyboard focus is on
 * a toast so nobody loses a message mid-read. Repeating the same message
 * restarts the existing toast instead of stacking a copy. Each toast leaves
 * with a short fade rather than vanishing, so a user who glanced up at the
 * right moment sees it go instead of wondering whether it was ever there.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  // Mirror of the rendered toasts so showToast can find a duplicate without
  // waiting on a state updater.
  const live = useRef<Toast[]>([]);
  useEffect(() => { live.current = toasts; }, [toasts]);

  const remove = useCallback((id: number) => {
    const held = timers.current.get(id);
    if (held !== undefined) { window.clearTimeout(held); timers.current.delete(id); }
    // Marked leaving in the mirror at once, not only after the render. A
    // form's FormError raises its toast in an effect and takes it down in the
    // cleanup; React runs that pair twice in development, and the re-run
    // found the toast it had just removed, "restarted" it, and the pending
    // removal then took it away, so every form error flashed and vanished.
    live.current = live.current.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast));
    setToasts(prev => prev.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast)));
    window.setTimeout(() => setToasts(prev => prev.filter(toast => toast.id !== id)), LEAVE_MS);
  }, []);

  const arm = useCallback((id: number, ttl: number | null) => {
    const held = timers.current.get(id);
    if (held !== undefined) window.clearTimeout(held);
    timers.current.delete(id);
    if (ttl !== null) timers.current.set(id, window.setTimeout(() => remove(id), ttl));
  }, [remove]);

  const hold = useCallback((id: number) => {
    const held = timers.current.get(id);
    if (held !== undefined) { window.clearTimeout(held); timers.current.delete(id); }
  }, []);


  const showToast = useCallback((raw: string, type: ToastType = 'info', opts?: ToastOptions) => {
    const { title, message } = splitNotice(raw, opts?.title);
    const ttl = opts?.sticky ? null
      : opts?.durationMs ?? (opts?.action ? 10000 : type === 'error' ? 10000 : type === 'warning' ? 8000 : 5000);
    const same = live.current.find(toast => !toast.leaving && toast.message === message && toast.type === type && toast.title === title);
    const id = same ? same.id : ++toastId;
    // Known at once, not only after the render: a form's status message can
    // be raised twice in one tick (React runs effects twice in development),
    // and the second call must find the first.
    if (!same) live.current = [...live.current, { id, ttl, message, type, title, action: opts?.action }];
    setToasts(prev => (prev.some(toast => toast.id === id)
      ? prev.map(toast => (toast.id === id ? { ...toast, action: opts?.action, ttl } : toast))
      : [...prev, { id, ttl, message, type, title, action: opts?.action }]));
    arm(id, ttl);
    return id;
  }, [arm]);

  useEffect(() => {
    const held = timers.current;
    return () => { for (const timer of held.values()) window.clearTimeout(timer); };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast: remove }}>
      {children}
      {/* Toast container */}
      <div
        role="region"
        aria-label={t('common.notifications')}
        aria-live="polite"
        aria-atomic="false"
        // Bottom-left, newest at the bottom, the O3 stack: clear of the
        // rail's own menus at the top and of the help and chat docks on the
        // right, and where the eye lands after a form's action bar.
        className="ehr-toast-stack"
      >
        {toasts.map(toast => {
          const urgent = toast.type === 'error' || toast.type === 'warning';
          return (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- hover and focus only pause the dismiss timer; the toast's own buttons carry every action.
            <div
              key={toast.id}
              role={urgent ? 'alert' : 'status'}
              onMouseEnter={() => hold(toast.id)}
              onMouseLeave={() => arm(toast.id, toast.ttl)}
              onFocus={() => hold(toast.id)}
              onBlur={() => arm(toast.id, toast.ttl)}
              className={`ehr-toast ehr-toast--${toast.type} tm-elevated tm-motion tm-motion--toast${toast.leaving ? ' is-leaving' : ''}`}
            >
              <StatusGlyph tone={toast.type} className="ehr-toast-icon" />
              <span className="sr-only">{t(`toast.${toast.type}`)}: </span>
              {/* A one-sentence message is its own title, so every notification
                  leads the same way whichever module raised it. */}
              <div className="ehr-toast-copy">
                <p className="ehr-toast-title">{toast.title ?? toast.message}</p>
                {toast.title && <p className="ehr-toast-text">{toast.message}</p>}
              </div>
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
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** The toast API, or undefined outside ToastProvider — for shared components that also render in isolation. */
export function useOptionalToast(): ToastContextType | undefined {
  return useContext(ToastContext);
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
