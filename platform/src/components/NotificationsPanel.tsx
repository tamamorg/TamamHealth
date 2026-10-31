'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Bell, BellOff, Check, ChevronRight, X } from '@/components/icons/lucide';
import { NOTIFICATION_META, getNotificationAlertPref, notificationBucket, relativeNotificationTime, setNotificationAlertPref, useNotifications } from '@/modules/communication/client';

/**
 * The bell panel — a glance surface over the most recent notifications, grouped
 * by day. Its height is capped and the list scrolls inside it, between a header
 * and a footer that stay put; the full, filterable feed lives at /notifications,
 * which this panel links to at the foot of the list.
 */
const PANEL_LIMIT = 40;
/** Tall enough for about six rows, and never to the bottom of the screen. */
const PANEL_MAX_HEIGHT = 560;
const SCREEN_MARGIN = 24;

const BUCKET_ORDER = ['today', 'yesterday', 'week', 'older'] as const;
const BUCKET_LABEL_KEY: Record<(typeof BUCKET_ORDER)[number], string> = {
  today: 'notifications.today',
  yesterday: 'notifications.yesterday',
  week: 'notifications.thisWeek',
  older: 'notifications.older',
};

/** Unread first when choosing what fits; then newest first, by day. */
export function groupForPanel<T extends { read?: boolean; time: string }>(items: readonly T[]) {
  const chosen = [...items]
    .sort((a, b) => Number(!!a.read) - Number(!!b.read))
    .slice(0, PANEL_LIMIT)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return BUCKET_ORDER
    .map(bucket => ({ bucket, items: chosen.filter(item => notificationBucket(item.time) === bucket) }))
    .filter(group => group.items.length > 0);
}

export type NotificationPopoverPosition = {
  left: number;
  top: number;
  width: number;
  pointerLeft: number;
};

export function notificationPopoverPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'width'>,
  viewportWidth: number,
  railBottom: number,
): NotificationPopoverPosition {
  const gutter = 8;
  const width = Math.max(0, Math.min(420, viewportWidth - gutter * 2));
  const desiredLeft = anchor.right - width;
  const left = Math.min(
    Math.max(gutter, desiredLeft),
    viewportWidth - width - gutter,
  );
  const pointerLeft = Math.min(
    Math.max(18, anchor.left + anchor.width / 2 - left - 7),
    width - 32,
  );

  return { left, top: railBottom, width, pointerLeft };
}

export default function NotificationsPanel({
  anchorRef,
  onClose,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<NotificationPopoverPosition | null>(null);
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();
  // Sound-alert preference: 'sound' chimes when new notifications arrive,
  // 'muted' keeps the badge silent. Persisted per device.
  const [alertPref, setAlertPref] = useState(getNotificationAlertPref);
  const toggleAlertPref = () => {
    const next = alertPref === 'sound' ? 'muted' : 'sound';
    setAlertPref(next);
    setNotificationAlertPref(next);
  };

  const groups = groupForPanel(items);
  const shownCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  const openAll = () => { onClose(); router.push('/notifications'); };

  useLayoutEffect(() => {
    const placePanel = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      const railBottom = anchor.closest('.ehr-top-rail')?.getBoundingClientRect().bottom
        ?? anchorRect.bottom;
      setPosition(notificationPopoverPosition(anchorRect, window.innerWidth, railBottom));
    };

    placePanel();
    window.addEventListener('resize', placePanel);
    return () => window.removeEventListener('resize', placePanel);
  }, [anchorRef]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        anchorRef.current?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [anchorRef, onClose]);

  return (
    <div
      ref={panelRef}
      id="notifications-popover"
      role="dialog"
      aria-labelledby="notifications-popover-title"
      className="notifications-popover"
      style={{
        left: position?.left ?? 8,
        top: position?.top ?? 0,
        width: position?.width ?? 420,
        maxHeight: position ? `min(${PANEL_MAX_HEIGHT}px, calc(100vh - ${position.top + SCREEN_MARGIN}px))` : undefined,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <span
        className="notifications-popover-pointer"
        style={{ left: position?.pointerLeft ?? 0 }}
        aria-hidden="true"
      />
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit', overflow: 'hidden' }}>
        <div className="notifications-popover-header" style={{ borderColor: 'var(--border-light)' }}>
          <div className="notifications-popover-heading">
            <h2 id="notifications-popover-title" className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Notifications</h2>
            {unreadCount > 0 && (
              <span className="notifications-popover-count" style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}>{unreadCount} new</span>
            )}
          </div>
          <div className="notifications-popover-controls">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                title="Mark everything as read"
                aria-label="Mark all read"
                className="notifications-popover-action flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
                style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}
              >
                <Check className="w-4 h-4" style={{ stroke: 'currentColor' }} />
              </button>
            )}
            <button
              onClick={toggleAlertPref}
              aria-label={alertPref === 'sound' ? 'Mute notification sounds' : 'Enable notification sounds'}
              title={alertPref === 'sound' ? 'Sound on — new notifications chime. Click to mute.' : 'Muted — click to chime on new notifications.'}
              className="notifications-popover-action flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{
                background: alertPref === 'sound' ? 'var(--accent-light)' : 'var(--overlay-subtle)',
                color: alertPref === 'sound' ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              {alertPref === 'sound'
                ? <Bell className="w-4 h-4" style={{ stroke: 'currentColor' }} />
                : <BellOff className="w-4 h-4" style={{ stroke: 'currentColor' }} />}
            </button>
            <button onClick={onClose} aria-label="Close" className="notifications-popover-action p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="notifications-popover-scroll">
          {loading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
              <Bell className="w-10 h-10 mx-auto mb-2" style={{ opacity: 0.35 }} />
              <p className="text-sm">You&apos;re all caught up — no notifications.</p>
            </div>
          ) : groups.map(group => (
            <section key={group.bucket} aria-label={t(BUCKET_LABEL_KEY[group.bucket])}>
              <h3 className="notifications-popover-group">{t(BUCKET_LABEL_KEY[group.bucket])}</h3>
              {group.items.map(n => {
                const m = NOTIFICATION_META[n.type];
                const Icon = m.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => { markRead(n.id); onClose(); router.push(n.href); }}
                    className={`notifications-popover-item${n.read ? ' is-read' : ''}`}
                  >
                    <span className="notifications-popover-icon" style={{ background: m.bg, color: m.color }}>
                      <Icon aria-hidden />
                    </span>
                    <span className="notifications-popover-copy">
                      <span className="notifications-popover-title">{n.title}</span>
                      {n.subtitle && <span className="notifications-popover-subtitle">{n.subtitle}</span>}
                      <span className="notifications-popover-meta">
                        <span style={{ color: m.color }}>{m.label}</span>
                        <span aria-hidden>·</span>
                        <span>{relativeNotificationTime(n.time)}</span>
                      </span>
                    </span>
                    {!n.read && <span className="notifications-popover-dot" title={t('notifications.unread')} />}
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        {/* Always offered, not just on overflow: the page carries filters,
            search, and the full history the panel deliberately truncates. */}
        <button
          onClick={openAll}
          className="notifications-popover-footer flex items-center justify-center gap-1 px-5 py-3 border-t text-[13px] font-semibold"
          style={{ borderColor: 'var(--border-light)', color: 'var(--accent-primary)', background: 'var(--bg-card-solid)' }}
        >
          {items.length > shownCount ? `View all ${items.length} notifications` : 'View all notifications'}
          <ChevronRight className="w-3.5 h-3.5" style={{ stroke: 'currentColor' }} />
        </button>
      </div>
    </div>
  );
}
