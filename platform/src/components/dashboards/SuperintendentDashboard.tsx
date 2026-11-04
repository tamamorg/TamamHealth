'use client';
// Admin-oriented landing for the Medical Superintendent — the clinical
// administrator who runs the hospital. Unlike the doctor/clinical-officer
// `/dashboard` (SOAP / prescribe / lab quick-actions), this surfaces the
// management view: staffing, bed capacity, pending leave decisions, finance
// and facility oversight, plus the disease-surveillance signal an
// administrator needs at a glance. It reuses the same hooks/services as the
// HR dashboard and the clinical dashboard so the numbers stay consistent.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SadbKpiTile, SadbCard, SadbQueueRow, SadbHeadLink, trendBetween } from '@/components/admin/sadb-ui';
import { Activity } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useUsers } from '@/lib/hooks/useUsers';
import { useWards } from '@/lib/hooks/useWards';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';
import { todayIso } from '@/lib/date-utils';
import { userWorksAtFacility } from '@/modules/tenancy/client';
import { usersHrefForRole } from '@/lib/people-nav';
import { useDataScope } from '@/lib/hooks/useDataScope';


const DOCTOR_ROLES = new Set(['doctor', 'clinical_officer', 'clinician']);
const NURSE_ROLES = new Set(['nurse', 'midwife']);

export default function SuperintendentDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { users } = useUsers();
  const { referrals } = useReferrals();
  const { alerts: diseaseAlerts } = useSurveillance();
  // Real ward census — the same numbers the Wards board and the facility
  // dashboard show, so the two views can never disagree.
  const { totalBeds: wardBedTotal, occupiedBeds: wardBedsOccupied, occupancyRate: wardOccupancyPct } = useWards();
  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);

  const facilityId = currentUser?.hospitalId;
  const today = todayIso();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!scope) {
        setLeave([]);
        return;
      }
      try {
        const { getAllLeaveRequests } = await import('@/lib/services/leave-service');
        const l = await getAllLeaveRequests(scope);
        if (!cancelled) setLeave(l);
      } catch {
        // Leave service is optional context here — fail soft to an empty queue.
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const facilityUsers = useMemo(
    () => (facilityId ? users.filter(u => userWorksAtFacility(u, facilityId)) : users),
    [users, facilityId],
  );

  const pendingLeave = leave.filter(l => l.status === 'pending');
  const onLeaveToday = leave.filter(
    l => l.status === 'approved' && l.startDate <= today && l.endDate >= today,
  );

  const hospital = currentUser?.hospital;
  const totalDoctors = hospital?.doctors || 0;
  const totalNurses = hospital?.nurses || 0;
  // Bed occupancy comes from the ward census (useWards sums ward docs'
  // totalBeds/occupiedBeds), never from the hospital registry record or a
  // multiplier: the old `bedTotal * 0.72` printed a fabricated occupancy
  // percentage on a superintendent's KPI tile.
  const bedTotal = wardBedTotal;
  const bedOccupancy = wardBedsOccupied;
  const occupancyPct = wardOccupancyPct;

  const activeAlerts = diseaseAlerts.filter(a => a.alertLevel === 'emergency' || a.alertLevel === 'warning');
  const pendingReferrals = referrals.filter(r => r.status === 'sent' || r.status === 'received');

  // Doctors and nurses are counted from this facility's own accounts, the same
  // records the Active staff figure counts; the registry's headcount fields
  // describe the whole hospital and would not add up to the tile's number.
  const doctorAccounts = facilityUsers.filter(u => DOCTOR_ROLES.has(u.role)).length;
  const nurseAccounts = facilityUsers.filter(u => NURSE_ROLES.has(u.role)).length;

  // Requests received this week against the week before: leave carries its
  // request date, so the comparison is real. Staff, beds and alerts carry no
  // history here and get no trend.
  const leaveTrend = (() => {
    const nowMs = Date.now();
    let thisWeek = 0;
    let lastWeek = 0;
    for (const l of leave) {
      const at = l.requestedAt ? new Date(l.requestedAt).getTime() : NaN;
      if (at >= nowMs - 7 * 86400000) thisWeek++;
      else if (at >= nowMs - 14 * 86400000) lastWeek++;
    }
    return { direction: trendBetween(thisWeek, lastWeek), label: `${thisWeek} requested this week vs ${lastWeek} last`, good: 'down' as const };
  })();

  const kpis = [
    { id: 'staff', label: t('dashboard.activeStaff'), value: facilityUsers.length || (totalDoctors + totalNurses), sub: `${doctorAccounts} ${doctorAccounts === 1 ? 'doctor' : 'doctors'} · ${nurseAccounts} ${nurseAccounts === 1 ? 'nurse' : 'nurses'}`, href: (currentUser ? usersHrefForRole(currentUser.role) : null) || '/hr/schedule' },
    { id: 'beds', label: t('dashboard.bedOccupancy'), value: `${occupancyPct}%`, sub: t('superintendent.bedsSub', { occupied: bedOccupancy, total: bedTotal }), href: '/wards' },
    { id: 'leave', label: t('hr.kpiPendingLeave'), value: pendingLeave.length, sub: t('superintendent.leaveSub', { count: onLeaveToday.length }), href: '/hr/leave', alarm: pendingLeave.length > 0, trend: leaveTrend },
    { id: 'alerts', label: t('dashboard.activeAlerts'), value: activeAlerts.length, sub: t('superintendent.alertsSub', { count: pendingReferrals.length }), href: '/surveillance', alarm: activeAlerts.length > 0 },
  ];

  /* Every card opens the page that owns its figure directly (2026-11-04):
     the preview popup that stood between a number and its page is gone, as
     on the platform and facility dashboards. */

  return (
    <>
      <main className="page-container page-enter">
        {/* ═══ KPI ROW — the management KPI band: label, value, what it is made
            of; a tile that needs a decision is the warning cell. The strip of
            Doctors / Nurses / Pending referrals that sat under it repeated
            these tiles' own detail lines and was removed (2026-11-04). ═══ */}
        <div className="sadb-kpi-row mb-3">
          {kpis.map(k => (
            <SadbKpiTile
              key={k.id}
              label={k.label}
              value={k.value}
              delta={k.sub}
              deltaTone={k.alarm ? 'warn' : undefined}
              trend={k.trend}
              onClick={() => router.push(k.href)}
            />
          ))}
        </div>

        {/* ═══ SURVEILLANCE / ALERTS ═══ */}
        <SadbCard
          title={t('superintendent.surveillanceSignal')}
          tabletTitle={t('superintendent.surveillanceTitle')}
          action={<SadbHeadLink onClick={() => router.push('/surveillance')}>{t('hr.viewAll')}</SadbHeadLink>}
        >
          {activeAlerts.length === 0 ? (
            <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
              <Activity className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-success-text)', opacity: 0.6 }} />
              {t('epidemic.noActiveDiseaseAlerts')}
            </div>
          ) : (
            activeAlerts.slice(0, 6).map((a, i) => (
              <SadbQueueRow
                key={a._id || i}
                chip={a.alertLevel === 'emergency' ? 'Emergency' : 'Warning'}
                chipTone={a.alertLevel === 'emergency' ? 'red' : 'yellow'}
                title={a.disease || t('superintendent.alertFallback')}
                sub={`${[a.county, a.state].filter(Boolean).join(', ') || t('superintendent.locationFallback')} · ${t('dashboard.casesCount', { count: a.cases })}`}
                onClick={() => router.push(a._id ? `/surveillance?alert=${encodeURIComponent(a._id)}` : '/surveillance')}
              />
            ))
          )}
        </SadbCard>
      </main>
    </>
  );
}
