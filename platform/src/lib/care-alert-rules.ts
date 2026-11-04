/**
 * Which care alerts belong on the chart.
 *
 * Care alerts are for lasting facts that change how a patient is cared for
 * (a fall risk, difficult IV access, an isolation need). Until 2026-11 the
 * referral service also wrote one every time a receiving facility received,
 * accepted or completed a referral. Those were notices, not risks: they sat on
 * the chart as red "ADMINISTRATIVE" banners and made the real flags easier to
 * miss. Referral progress now reaches the referring team through the
 * notification bell and shows on the referral itself in Care coordination, so
 * the old notices are hidden wherever care alerts are read. They stay on the
 * patient document; nothing is deleted.
 */
import type { CareAlertEntry } from '../data/mock';

const REFERRAL_STATUS_NOTICE = /^Referral to .+ has been (received|accepted|completed)\b/;

/** An alert the old referral loop wrote, which the chart no longer shows. */
export function isReferralStatusNotice(alert: Pick<CareAlertEntry, 'category' | 'message'>): boolean {
  return alert.category === 'administrative' && REFERRAL_STATUS_NOTICE.test(alert.message || '');
}

/** Active alerts the chart shows, most urgent first. */
export function chartCareAlerts(alerts: CareAlertEntry[] | undefined): CareAlertEntry[] {
  return (alerts ?? [])
    .filter(alert => alert.status === 'active' && !isReferralStatusNotice(alert))
    .sort((a, b) => (a.priority === b.priority ? (b.recordedAt || '').localeCompare(a.recordedAt || '') : a.priority === 'high' ? -1 : 1));
}
