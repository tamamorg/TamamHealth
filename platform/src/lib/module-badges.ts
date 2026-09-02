
import type { NotificationItem, NotificationType } from '@/modules/communication';
/**
 * Counts for the top-rail module shortcuts — the small number on the pharmacy /
 * lab / referrals icons that says "there is something waiting in here".
 *
 * Derived from the notification feed rather than counted separately: every item
 * in that feed is already an open, actionable event scoped to the signed-in
 * user's facility, so a badge built from it can never claim work that isn't
 * there. It also means a module badge and the bell agree by construction.
 *
 * Only routes with a genuinely actionable queue are listed. A module with no
 * entry renders no badge — /patients, /reports and /settings deliberately have
 * none, because "35 patients on file" is not something to action.
 */

export const MODULE_BADGE_SOURCES: Readonly<Record<string, readonly NotificationType[]>> = {
  '/referrals': ['referral', 'transfer'],
  '/lab': ['lab'],
  '/pharmacy': ['prescription'],
  '/appointments': ['appointment'],
  '/messages': ['message'],
  '/surveillance': ['alert'],
  // Patients waiting to be picked up — the triage queue and the shared
  // consultation progress board are both "someone is waiting on a clinician".
  '/consultation': ['triage', 'progress'],
};

/** href → open-item count. Hrefs with nothing waiting are omitted entirely. */
export function moduleBadgeCounts(items: NotificationItem[]): Record<string, number> {
  const byType = new Map<NotificationType, number>();
  for (const item of items) byType.set(item.type, (byType.get(item.type) || 0) + 1);

  const out: Record<string, number> = {};
  for (const [href, types] of Object.entries(MODULE_BADGE_SOURCES)) {
    const total = types.reduce((sum, type) => sum + (byType.get(type) || 0), 0);
    if (total > 0) out[href] = total;
  }
  return out;
}
