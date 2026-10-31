'use client';

import { useState, useCallback, useRef, createContext, useContext, useEffect, type ReactNode } from 'react';
import { X } from '@/components/icons/lucide';
import StatusGlyph from '@/components/overlay/StatusGlyph';
import { NoticeHostContext, RELATED_WINDOW_MS, splitNotice, type NoticeHost } from '@/components/overlay/notice-hosts';
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
  /** `corner` keeps an error in the toast stack even when the user is in a
   *  form — for a failure that is not about that form (sync, a background
   *  job). By default an error or warning raised right after the user acted
   *  inside a form surface is shown inline in that form (see FormNotices). */
  placement?: 'auto' | 'corner';
}

export { splitNotice } from '@/components/overlay/notice-hosts';

interface ToastContextType {
  showToast: (message: string, type?: ToastType, opts?: ToastOptions) => void;
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

  // Form surfaces that take their own errors, and where the user last acted —
  // together they say whether an error belongs to an open form.
  const hosts = useRef(new Set<NoticeHost>());
  const lastAct = useRef<{ target: Element | null; at: number }>({ target: null, at: 0 });
  useEffect(() => {
    const note = (event: Event) => {
      lastAct.current = { target: event.target instanceof Element ? event.target : null, at: Date.now() };
    };
    document.addEventListener('pointerdown', note, true);
    document.addEventListener('keydown', note, true);
    return () => {
      document.removeEventListener('pointerdown', note, true);
      document.removeEventListener('keydown', note, true);
    };
  }, []);
  const hostRegistry = useRef({
    register: (host: NoticeHost) => {
      hosts.current.add(host);
      return () => { hosts.current.delete(host); };
    },
  }).current;

  /** The innermost open form the user just acted in, if any. */
  const relatedHost = useCallback((): NoticeHost | null => {
    const { target, at } = lastAct.current;
    if (!target || Date.now() - at > RELATED_WINDOW_MS) return null;
    let best: NoticeHost | null = null;
    for (const host of hosts.current) {
      if (!host.el.isConnected || !host.el.contains(target)) continue;
      if (!best || best.el.contains(host.el)) best = host;
    }
    return best;
  }, []);

  const remove = useCallback((id: number) => {
    const held = timers.current.get(id);
    if (held !== undefined) { window.clearTimeout(held); timers.current.delete(id); }
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

  // Mirror of the rendered toasts so showToast can find a duplicate without
  // waiting on a state updater.
  const live = useRef<Toast[]>([]);
  useEffect(() => { live.current = toasts; }, [toasts]);

  const showToast = useCallback((raw: string, type: ToastType = 'info', opts?: ToastOptions) => {
    const { title, message } = splitNotice(raw, opts?.title);
    if ((type === 'error' || type === 'warning') && opts?.placement !== 'corner' && !opts?.action) {
      const host = relatedHost();
      if (host) { host.push({ id: ++toastId, type, title, message }); return; }
    }
    const ttl = opts?.sticky ? null
      : opts?.durationMs ?? (opts?.action ? 10000 : type === 'error' ? 10000 : type === 'warning' ? 8000 : 5000);
    const same = live.current.find(toast => !toast.leaving && toast.message === message && toast.type === type && toast.title === title);
    const id = same ? same.id : ++toastId;
    setToasts(prev => (prev.some(toast => toast.id === id)
      ? prev.map(toast => (toast.id === id ? { ...toast, action: opts?.action, ttl } : toast))
      : [...prev, { id, ttl, message, type, title, action: opts?.action }]));
    arm(id, ttl);
  }, [arm, relatedHost]);

  useEffect(() => {
    const held = timers.current;
    return () => { for (const timer of held.values()) window.clearTimeout(timer); };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      <NoticeHostContext.Provider value={hostRegistry}>
      {children}
      </NoticeHostContext.Provider>
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

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
