/**
 * Read-state for the notification feed.
 *
 * Notifications are derived on the fly from live clinical data (see
 * useNotifications) — there is no notification document to stamp, so "I have
 * seen this" is kept per device in localStorage, keyed by user id — per
 * device, surviving reloads, with every access wrapped so a storage failure
 * can never break the bell.
 *
 * The stored list is NOT pruned against the current feed: a caller may load
 * the feed at a shallower depth (useNotifications takes a per-source cap), and
 * pruning to "what is on screen" would then erase marks another surface made.
 * Growth is bounded by MAX_STORED_IDS instead — oldest marks fall off first,
 * which at worst re-flags a very old item as new.
 */

const STORAGE_PREFIX = 'tamamhealth.notifications.read.';
/** Safety valve — a feed can legitimately carry hundreds of ids. */
const MAX_STORED_IDS = 2000;
/** Fired whenever read-state changes so every mounted feed re-renders. */
export const NOTIFICATION_READS_EVENT = 'tamamhealth:notification-reads';

function key(userId: string): string {
  return `${STORAGE_PREFIX}${userId || 'anonymous'}`;
}

function write(userId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key(userId), JSON.stringify(ids.slice(-MAX_STORED_IDS)));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
  try {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_READS_EVENT));
  } catch {
    // Ignore — SSR/no-DOM.
  }
}

export function getReadNotificationIds(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/** Marks ids as read. Returns the full read set so callers can update state. */
export function markNotificationsRead(userId: string, ids: string[]): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const current = getReadNotificationIds(userId);
  let changed = false;
  for (const id of ids) {
    if (!current.has(id)) { current.add(id); changed = true; }
  }
  if (changed) write(userId, [...current]);
  return current;
}

