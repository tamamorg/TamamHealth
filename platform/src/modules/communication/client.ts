/**
 * Communication — messages, announcements and the notification bell, as the
 * browser sees them.
 *
 * This module is client-heavy by nature: every consumer outside it but one is
 * a React component or a hook. So unlike `identity`, the *client* surface is
 * the main one and `index.ts` carries the small server-safe remainder.
 *
 * Services are not re-exported here. Two reasons, and the first is concrete:
 * `message-service` and `conversation-service` both export `deleteMessage`, so
 * a single barrel would have to rename one of them and quietly make the import
 * line lie about which store it writes to. The second is the rule the identity
 * module established — services are a named entrypoint tier
 * (`@/modules/communication/services/<name>`), which keeps a lazy import lazy
 * and keeps a barrel from dragging the data layer behind a hook.
 *
 * See docs/adr/0003-domain-modules.md.
 */

// ── The notification bell ───────────────────────────────────────────────────
export {
  useNotifications, getNotificationAlertPref, setNotificationAlertPref,
  type NotificationAlertPref, type UseNotificationsOptions,
} from './hooks/useNotifications';
export type {
  NotificationType, NotificationSeverity, NotificationItem,
} from './notifications/types';
export {
  NOTIFICATION_META, NOTIFICATION_TYPE_ORDER, SEVERITY_META,
  relativeNotificationTime, notificationBucket, type NotificationMeta,
} from './notifications/notification-meta';
export {
  NOTIFICATION_READS_EVENT, getReadNotificationIds, markNotificationsRead,
} from './notifications/notification-reads';

// ── Who a notification is for ───────────────────────────────────────────────
// Pure predicates, no store. Exported from both barrels because the same rule
// decides what a bell shows and what a server-side digest would send.
export {
  isKindRelevantToRole, hasPersonalFeed, isOwnedByViewer, isForViewer,
  type NotificationKind, type FeedViewer, type RecordOwner,
} from './notifications/notification-scope';

// ── Messaging ───────────────────────────────────────────────────────────────
export { useMessages } from './hooks/useMessages';
export {
  MessagingDockProvider, useMessagingDock, type DockPerson,
} from './components/messaging-dock-context';
export { default as MessagingDock } from './components/MessagingDock';
export { default as AnnouncementsPanel } from './components/AnnouncementsPanel';
