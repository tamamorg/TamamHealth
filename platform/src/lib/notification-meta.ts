/**
 * Shared presentation for the notification feed — one source for the bell
 * panel (NotificationsPanel) and the full page (/notifications), so a lab item
 * is the same purple flask in both places.
 *
 * Per-source colour + icon + label: a glance tells you where each notification
 * comes from. Every source gets a distinct hue (appointments use the deep
 * accent blue so they don't read the same as referrals).
 */
import { Bell, AlertTriangle, ArrowRightLeft, FlaskConical, Calendar, Pill, ClipboardList, Activity } from '@/components/icons/lucide';
import type { NotificationSeverity, NotificationType } from '@/lib/hooks/useNotifications';

export interface NotificationMeta {
  icon: typeof Bell;
  color: string;
  bg: string;
  label: string;
}

export const NOTIFICATION_META: Record<NotificationType, NotificationMeta> = {
  alert: { icon: AlertTriangle, color: 'var(--color-danger)', bg: 'var(--color-danger-bg)', label: 'Surveillance' },
  // Rose, not another red: triage sits next to the danger-red surveillance
  // alert in the same feed, so it needs a hue far enough away to tell apart at
  // chip size (~333° vs ~8°). The ETAT acuity itself rides on `severity`, which
  // is what turns a RED triage critical — the type colour stays constant so the
  // source is still readable at a glance.
  triage: { icon: Activity, color: 'var(--category-maternal)', bg: 'var(--category-maternal-bg)', label: 'Triage' },
  referral: { icon: ArrowRightLeft, color: 'var(--tb-blue-700)', bg: 'rgba(33, 145, 208, 0.12)', label: 'Referrals' },
  lab: { icon: FlaskConical, color: 'var(--category-lab)', bg: 'var(--category-lab-bg)', label: 'Lab' },
  appointment: { icon: Calendar, color: 'var(--tb-blue-800)', bg: 'rgba(1, 86, 151, 0.10)', label: 'Schedule' },
  prescription: { icon: Pill, color: 'var(--color-warning)', bg: 'rgba(230, 114, 0, 0.12)', label: 'Pharmacy' },
  progress: { icon: ClipboardList, color: 'var(--accent-primary)', bg: 'var(--accent-light)', label: 'Care progress' },
  // Internal transfers share the arrows glyph with referrals but take the gold
  // accent — the two move a patient in different senses (ownership vs facility)
  // and must not read as the same queue at a glance.
  transfer: { icon: ArrowRightLeft, color: 'var(--category-transfer)', bg: 'var(--category-transfer-bg)', label: 'Transfers' },
};

/** Order the source filters are presented in — urgency first, admin last. */
export const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  'alert', 'triage', 'lab', 'transfer', 'referral', 'appointment', 'progress', 'prescription',
];

export const SEVERITY_META: Record<NotificationSeverity, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'var(--color-danger-text)', bg: 'var(--color-danger-bg)' },
  warning: { label: 'Needs action', color: 'var(--color-warning-text)', bg: 'var(--color-warning-bg)' },
  info: { label: 'For information', color: 'var(--accent-primary)', bg: 'var(--accent-light)' },
};

/** "3m ago" / "5h ago" / "2d ago" — same wording the bell panel has always used. */
export function relativeNotificationTime(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Recency buckets used as section headings on the notifications page. */
export function notificationBucket(iso: string): 'today' | 'yesterday' | 'week' | 'older' {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'older';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  if (t >= startOfToday.getTime()) return 'today';
  if (t >= startOfToday.getTime() - dayMs) return 'yesterday';
  if (t >= startOfToday.getTime() - 7 * dayMs) return 'week';
  return 'older';
}
