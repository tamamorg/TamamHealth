'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { Bell, BellOff, Check, ChevronRight, X } from '@/components/icons/lucide';
import { NOTIFICATION_META, getNotificationAlertPref, relativeNotificationTime, setNotificationAlertPref, useNotifications } from '@/modules/communication/client';

/**
 * The bell panel — a glance surface over the most recent notifications.
 * Deliberately capped: the full, filterable feed lives at /notifications,
 * which this panel links to at the foot of the list.
 */
const PANEL_LIMIT = 12;

export default function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();
  // Sound-alert preference: 'sound' chimes when new notifications arrive,
  // 'muted' keeps the badge silent. Persisted per device.
  const [alertPref, setAlertPref] = useState(getNotificationAlertPref);
  const toggleAlertPref = () => {
    const next = alertPref === 'sound' ? 'muted' : 'sound';
    setAlertPref(next);
    setNotificationAlertPref(next);
  };

  const visible = items.slice(0, PANEL_LIMIT);

  const openAll = () => { onClose(); router.push('/notifications'); };

  return (
    <Modal onClose={onClose} width={520} align="top">
      <div className="card-elevated" style={{ background: 'var(--bg-card-solid)', borderRadius: 16, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 60px)', overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Notifications</h2>
            {unreadCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}>{unreadCount} new</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                title="Mark everything as read"
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
                style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}
              >
                <Check className="w-4 h-4" style={{ stroke: 'currentColor' }} />
                Mark all read
              </button>
            )}
            <button
              onClick={toggleAlertPref}
              aria-label={alertPref === 'sound' ? 'Mute notification sounds' : 'Enable notification sounds'}
              title={alertPref === 'sound' ? 'Sound on — new notifications chime. Click to mute.' : 'Muted — click to chime on new notifications.'}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{
                background: alertPref === 'sound' ? 'var(--accent-light)' : 'var(--overlay-subtle)',
                color: alertPref === 'sound' ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              {alertPref === 'sound'
                ? <Bell className="w-4 h-4" style={{ stroke: 'currentColor' }} />
                : <BellOff className="w-4 h-4" style={{ stroke: 'currentColor' }} />}
              {alertPref === 'sound' ? 'Sound on' : 'Muted'}
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div style={{ overflowY: 'auto' }}>
          {loading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
              <Bell className="w-10 h-10 mx-auto mb-2" style={{ opacity: 0.35 }} />
              <p className="text-sm">You&apos;re all caught up — no notifications.</p>
            </div>
          ) : (
            <div>
              {visible.map(n => {
                const m = NOTIFICATION_META[n.type];
                const Icon = m.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => { markRead(n.id); onClose(); router.push(n.href); }}
                    className="w-full text-start flex items-start gap-3 px-5 py-3 border-b transition-colors hover:bg-[var(--overlay-subtle)]"
                    style={{ borderColor: 'var(--border-light)', opacity: n.read ? 0.62 : 1 }}
                  >
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: m.bg, color: m.color }}>
                      {/* The icon set hardcodes a stroke attribute, so the colour
                          must be forced via the stroke property. */}
                      <Icon className="w-4 h-4" style={{ stroke: m.color, color: m.color }} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] truncate" style={{ color: 'var(--text-primary)', fontWeight: n.read ? 500 : 700 }}>{n.title}</div>
                      <div className="text-[12px] truncate" style={{ color: 'var(--text-muted)' }}>{n.subtitle}</div>
                    </div>
                    <span className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: m.bg, color: m.color }}>{m.label}</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{relativeNotificationTime(n.time)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Always offered, not just on overflow: the page carries filters,
            search, and the full history the panel deliberately truncates. */}
        <button
          onClick={openAll}
          className="flex items-center justify-center gap-1 px-5 py-3 border-t text-[12px] font-bold"
          style={{ borderColor: 'var(--border-light)', color: 'var(--accent-primary)', background: 'var(--bg-card-solid)' }}
        >
          {items.length > visible.length ? `View all ${items.length} notifications` : 'View all notifications'}
          <ChevronRight className="w-3.5 h-3.5" style={{ stroke: 'currentColor' }} />
        </button>
      </div>
    </Modal>
  );
}
