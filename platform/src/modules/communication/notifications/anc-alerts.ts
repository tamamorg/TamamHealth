/**
 * High-risk pregnancies for the bell. Pure derivation, like visit-updates.ts:
 * an ANC visit recorded as high-risk in the last three days reaches the
 * clinicians and midwives who can see the mother's record (the caller passes
 * visits already narrowed to the viewer's scope). This replaced a message the
 * ANC service filed under the mother's own id, which reached nobody on the
 * care team and showed in the patient's own portal inbox instead.
 */
import type { ANCVisitDoc, UserRole } from '@/lib/db-types';
import type { NotificationItem } from './types';

export const ANC_ALERT_ROLES: readonly UserRole[] = [
  'doctor', 'clinical_officer', 'clinician', 'midwife', 'nurse', 'medical_superintendent',
];

const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

export function ancHighRiskItems(
  visits: ANCVisitDoc[],
  viewer: { role?: string } | null | undefined,
  nowMs: number,
  limit: number,
): NotificationItem[] {
  if (!viewer?.role || !(ANC_ALERT_ROLES as readonly string[]).includes(viewer.role)) return [];
  return visits
    .filter(v => v.riskLevel === 'high' && !v.isDeleted)
    .filter(v => {
      const at = Date.parse(v.createdAt || v.visitDate);
      return Number.isFinite(at) && nowMs - at <= RECENT_MS;
    })
    .sort((a, b) => (b.createdAt || b.visitDate).localeCompare(a.createdAt || a.visitDate))
    .slice(0, limit)
    .map(v => ({
      id: `anc-risk-${v._id}`,
      type: 'alert' as const,
      severity: 'warning' as const,
      title: v.motherName || 'High-risk pregnancy',
      subtitle: `High-risk pregnancy · ANC visit ${v.visitNumber}${v.riskFactors?.length ? ` · ${v.riskFactors.join(', ')}` : ''}`,
      time: v.createdAt || v.visitDate,
      href: `/patients/${encodeURIComponent(v.motherId)}?tab=anc`,
    }));
}
