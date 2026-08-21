/**
 * Which of a user's `notify.*` settings governs each notification the bell
 * produces.
 *
 * The design-11 notification rows were written per role in the settings
 * language ("Critical lab results", "New STAT orders", "Deteriorating
 * vitals"), while `useNotifications` emits a small set of typed items. This
 * module is the join between the two, so switching a row off actually stops
 * the notification instead of only recolouring a toggle.
 *
 * Deliberately conservative: a notification is hidden ONLY when a setting that
 * plainly covers it is switched off. Rows describing alerts the platform does
 * not raise yet (stock-out risk, analyser errors, insurance claim rejections)
 * govern nothing here — they are marked `pending` in `lib/role-settings.ts`
 * rather than silently filtering something they don't mean.
 */
import type { NotificationItem } from '../hooks/useNotifications';
import type { RoleSettingsValues } from '../role-settings';

/**
 * The `notify.*` keys that cover one notification, across every role that has
 * an opinion about it. Only keys present in the signed-in user's own settings
 * are consulted — a doctor is never filtered by a nurse's row.
 */
function governingKeys(item: NotificationItem): string[] {
  switch (item.type) {
    case 'lab':
      return item.severity === 'critical'
        // Doctor: "Critical lab results". Lab tech: "Unacknowledged critical
        // results". Both mean this row.
        ? ['notify.criticalLabs', 'notify.criticalUnacked']
        // Lab tech: "New STAT orders" — the ready-to-review feed.
        : ['notify.stat'];
    case 'referral':
      return ['notify.referrals'];
    case 'transfer':
      // Nurse: "New admissions to my ward". Generic: "Work assigned to me".
      return ['notify.admissions', 'notify.assigned'];
    case 'alert':
      // Admin: "Surveillance signals" (IDSR thresholds).
      return ['notify.surveillance'];
    case 'triage':
      // Nurse: "Deteriorating vitals". Front desk: "Queue over capacity".
      return ['notify.vitals', 'notify.queue'];
    case 'appointment':
      return ['notify.apptSummary'];
    case 'prescription':
      // Pharmacist: "New prescriptions to dispense". Nurse: "Overdue doses".
      return ['notify.newRx', 'notify.overdueDoses'];
    case 'progress':
      // Doctor: "Co-signature requests". Generic: "Work assigned to me".
      return ['notify.cosign', 'notify.assigned'];
    default:
      return [];
  }
}

/**
 * True when this user still wants to see `item`.
 *
 * Kept if no governing key appears in their settings (the role has no say over
 * this notification), or if at least one governing key they DO have is on.
 * "At least one" rather than "all": where two rows both describe an item, a
 * user who wants either of them wants the item.
 */
export function wantsNotification(item: NotificationItem, values: RoleSettingsValues): boolean {
  const keys = governingKeys(item).filter(key => values[key] !== undefined);
  if (keys.length === 0) return true;
  return keys.some(key => values[key] === true);
}

/** Filter a built notification list down to what this user asked for. */
export function filterNotifications(
  items: NotificationItem[],
  values: RoleSettingsValues,
): NotificationItem[] {
  return items.filter(item => wantsNotification(item, values));
}
