/**
 * Communication — the server-safe surface.
 *
 * Deliberately small. Almost everything this domain does happens in the
 * browser (see `client.ts`), so what belongs here is only what a server route
 * or a shared module can legitimately ask: who a notification is for.
 *
 * A barrel that re-exported the hooks and components would put React in the
 * import graph of every API route that wanted to know whether a nurse should
 * see a lab alert. Keeping the two surfaces apart is what stops that.
 */
export {
  isKindRelevantToRole, hasPersonalFeed, isOwnedByViewer, isForViewer,
  type NotificationKind, type FeedViewer, type RecordOwner,
} from './notifications/notification-scope';

// The domain's vocabulary. Types only, so nothing is pulled at runtime — a
// server module can describe a notification without importing the bell.
export type {
  NotificationType, NotificationSeverity, NotificationItem,
} from './notifications/types';
