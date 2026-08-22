/**
 * What a notification IS, as this domain defines it.
 *
 * These lived inside `hooks/useNotifications.ts` — the domain's vocabulary
 * defined inside a React hook, so a server-side module that needed the shape
 * of a notification had to reach into client code to get it. Two already did,
 * and only got away with it because both imports were type-only.
 *
 * A type is not a client concern. It goes where the concept lives, and both
 * barrels can carry it without either pulling React.
 */
import type { NotificationKind } from './notification-scope';

export type NotificationType = NotificationKind;

/**
 * How hard the item pushes: an outbreak or a breached critical result is not
 * the same class of thing as "a prescription is waiting". Drives the filter
 * tabs and row treatment on /notifications.
 */
export type NotificationSeverity = 'critical' | 'warning' | 'info';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  subtitle: string;
  time: string;
  href: string;
  /** Set from per-device read state — see `notification-reads.ts`. */
  read?: boolean;
};
