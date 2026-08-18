'use client';

/**
 * Global quick-actions cluster — tasks, notifications, and announcements.
 * Rendered once inside EhrTopRail's action row (the single top chrome bar),
 * so its buttons pick up `.ehr-top-actions button` styling from that parent
 * rather than declaring their own circular/bordered look.
 */
import { useState, useRef, useEffect } from 'react';
import { Megaphone, Bell, ClipboardCheck } from '@/components/icons/lucide';
import AnnouncementsPanel from '@/components/AnnouncementsPanel';
import NotificationsPanel from '@/components/NotificationsPanel';
import TasksPanel from '@/components/TasksPanel';
import { useTasks } from '@/lib/hooks/useTasks';

/**
 * The rail's one count colour (`.ehr-top-action-badge`, the module shortcut
 * badges). Every badge on the blue bar is this red — the tasks badge used to
 * be `--accent-primary`, i.e. blue on blue, so all a user saw was a floating
 * white digit with no pill behind it.
 */
const RAIL_BADGE_RED = '#E05A3A';

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

  // Close the panel on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (announceRef.current && !announceRef.current.contains(e.target as Node)) setAnnounceOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <>
      {/* My Tasks */}
      <button
        type="button"
        onClick={() => setTasksOpen(true)}
        aria-label={openTasks.length > 0 ? `My tasks (${openTasks.length} open)` : 'My tasks'}
        title="My tasks"
        className="relative"
      >
        <ClipboardCheck className="w-5 h-5" />
        {openTasks.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: RAIL_BADGE_RED, boxShadow: '0 0 0 1.5px var(--bg-card)' }}>
            {openTasks.length > 99 ? '99+' : openTasks.length}
          </span>
        )}
      </button>
      {tasksOpen && <TasksPanel onClose={() => setTasksOpen(false)} />}

      {/* Notifications */}
      <button
        type="button"
        onClick={() => setNotifOpen(true)}
        aria-label={notifCount > 0 ? `Notifications (${notifCount} unread)` : 'Notifications'}
        title="Notifications"
        className="relative"
      >
        <Bell className="w-5 h-5" />
        {notifCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: RAIL_BADGE_RED, boxShadow: '0 0 0 1.5px var(--bg-card)' }}>
            {notifCount > 99 ? '99+' : notifCount}
          </span>
        )}
      </button>
      {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}

      {/* Announcements */}
      <div className="relative" ref={announceRef}>
        <button
          type="button"
          onClick={() => setAnnounceOpen(o => !o)}
          aria-label="Announcements"
          aria-expanded={announceOpen}
          title="Announcements"
          className="relative"
        >
          <Megaphone className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-0.5 end-0.5 w-2 h-2 rounded-full border-2 border-white" aria-hidden="true" style={{ background: RAIL_BADGE_RED }} />
          )}
        </button>
        {announceOpen && (
          <AnnouncementsPanel onClose={() => setAnnounceOpen(false)} onUnreadChange={setUnread} />
        )}
      </div>
    </>
  );
}
