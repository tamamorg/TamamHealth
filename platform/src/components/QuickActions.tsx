'use client';

/**
 * Global quick-actions cluster — tasks, notifications, and announcements.
 * Rendered once inside EhrTopRail's action row (the single top chrome bar),
 * so its buttons pick up `.ehr-top-actions button` styling from that parent
 * rather than declaring their own circular/bordered look. The counts wear
 * `.ehr-top-action-badge` — the same pill the module shortcuts in that row
 * use — so every badge on the rail sits on the same anchor in the same
 * colour. These used to carry their own smaller red pill offset outside the
 * button, which put the bell's count a few pixels up and out from the "12"
 * on the shortcut beside it.
 */
import { useState, useRef, useEffect } from 'react';
import { Megaphone, Bell, ClipboardCheck } from '@/components/icons/lucide';

import NotificationsPanel from '@/components/NotificationsPanel';
import TasksPanel from '@/components/TasksPanel';
import { useTasks } from '@/lib/hooks/useTasks';
import { AnnouncementsPanel } from '@/modules/communication/client';

export default function QuickActions({ notificationCount }: {
  /** Unread bell count. Supplied by the rail, which already loads the feed for
   *  the module shortcut badges — loading it here too would run every source
   *  query twice on each mount. */
  notificationCount: number;
}) {
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // The badge counts what the user has NOT opened yet — read state is kept per
  // device in lib/notification-reads.ts, so the bell stops nagging about items
  // already actioned from the panel or /notifications.
  const notifCount = notificationCount;
  const { open: openTasks } = useTasks();

  const announceRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifButtonRef = useRef<HTMLButtonElement>(null);

  // Close header popovers on outside click. Both panels stay in their trigger
  // wrappers even though notifications uses fixed positioning, so containment
  // remains reliable without a backdrop over the clinical workspace.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (announceRef.current && !announceRef.current.contains(e.target as Node)) setAnnounceOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <>
      {/* My Tasks */}
      <button
        type="button"
        onClick={() => {
          setTasksOpen(true);
          setNotifOpen(false);
          setAnnounceOpen(false);
        }}
        aria-label={openTasks.length > 0 ? `My tasks (${openTasks.length} open)` : 'My tasks'}
        title="My tasks"
        className="relative"
      >
        <ClipboardCheck className="w-5 h-5" />
        {openTasks.length > 0 && (
          <span className="ehr-top-action-badge">
            {openTasks.length > 99 ? '99+' : openTasks.length}
          </span>
        )}
      </button>
      {tasksOpen && <TasksPanel onClose={() => setTasksOpen(false)} />}

      {/* Notifications */}
      <div className="relative inline-flex" ref={notifRef}>
        <button
          ref={notifButtonRef}
          type="button"
          onClick={() => {
            setNotifOpen(open => !open);
            setAnnounceOpen(false);
          }}
          aria-label={notifCount > 0 ? `Notifications (${notifCount} unread)` : 'Notifications'}
          aria-expanded={notifOpen}
          aria-haspopup="dialog"
          aria-controls="notifications-popover"
          title="Notifications"
          className={`relative ${notifOpen ? 'active' : ''}`}
        >
          <Bell className="w-5 h-5" />
          {notifCount > 0 && (
            <span className="ehr-top-action-badge">
              {notifCount > 99 ? '99+' : notifCount}
            </span>
          )}
        </button>
        {notifOpen && (
          <NotificationsPanel
            anchorRef={notifButtonRef}
            onClose={() => setNotifOpen(false)}
          />
        )}
      </div>

      {/* Announcements */}
      <div className="relative" ref={announceRef}>
        <button
          type="button"
          onClick={() => {
            setAnnounceOpen(open => !open);
            setNotifOpen(false);
          }}
          aria-label="Announcements"
          aria-expanded={announceOpen}
          title="Announcements"
          className="relative"
        >
          <Megaphone className="w-5 h-5" />
          {unread > 0 && (
            <span className="ehr-top-action-badge is-dot" aria-hidden="true" />
          )}
        </button>
        {announceOpen && (
          <AnnouncementsPanel onClose={() => setAnnounceOpen(false)} onUnreadChange={setUnread} />
        )}
      </div>
    </>
  );
}
