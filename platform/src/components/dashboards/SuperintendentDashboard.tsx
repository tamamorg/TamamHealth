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
import DashboardGreetingHeader from '@/components/dashboard/DashboardGreetingHeader';
import {
  Users, Stethoscope, HeartPulse, BedDouble,
  ClipboardCheck, Activity, AlertTriangle, SendHorizontal,
  ChevronRight, ArrowRight} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useUsers } from '@/lib/hooks/useUsers';
import { useWards } from '@/lib/hooks/useWards';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';
import { todayIso } from '@/lib/date-utils';
import { userWorksAtFacility } from '@/modules/tenancy/client';
import { useDataScope } from '@/lib/hooks/useDataScope';


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

  const kpis = [
    { id: 'staff', label: t('dashboard.activeStaff'), value: facilityUsers.length || (totalDoctors + totalNurses), sub: t('superintendent.staffSub', { doctors: totalDoctors, nurses: totalNurses }), Icon: Users, color: 'var(--accent-primary)', href: '/hr' },
    { id: 'beds', label: t('dashboard.bedOccupancy'), value: `${occupancyPct}%`, sub: t('superintendent.bedsSub', { occupied: bedOccupancy, total: bedTotal }), Icon: BedDouble, color: 'var(--color-success-text)', href: '/wards' },
    { id: 'leave', label: t('hr.kpiPendingLeave'), value: pendingLeave.length, sub: t('superintendent.leaveSub', { count: onLeaveToday.length }), Icon: ClipboardCheck, color: pendingLeave.length > 0 ? 'var(--color-danger-500)' : 'var(--accent-primary)', href: '/hr/leave', alarm: pendingLeave.length > 0 },
    { id: 'alerts', label: t('dashboard.activeAlerts'), value: activeAlerts.length, sub: t('superintendent.alertsSub', { count: pendingReferrals.length }), Icon: AlertTriangle, color: activeAlerts.length > 0 ? 'var(--color-danger-500)' : 'var(--accent-primary)', href: '/surveillance', alarm: activeAlerts.length > 0 },
  ];

  const staffingSummaries = [
    { id: 'doctors', Icon: Stethoscope, label: t('dashboard.doctors'), value: totalDoctors, href: '/hr' },
    { id: 'nurses', Icon: HeartPulse, label: t('dataEntry.nurses'), value: totalNurses, href: '/hr' },
    { id: 'referrals', Icon: SendHorizontal, label: t('dashboard.pendingReferrals'), value: pendingReferrals.length, href: '/referrals' },
  ];

  /* Every card opens the page that owns its figure directly (2026-11-04):
     the preview popup that stood between a number and its page is gone, as
     on the platform and facility dashboards. */

  return (
    <>
      <main className="page-container page-enter">
        <DashboardGreetingHeader module="Facility management" />
        {/* ═══ KPI ROW ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          {kpis.map(k => (
            <button
              key={k.id}
              type="button"
              onClick={() => router.push(k.href)}
              className="dash-card text-start transition-colors"
              style={{ padding: '14px 16px', position: 'relative', cursor: 'pointer' }}
            >
              {k.alarm && <span className="data-tile__alarm-pulse" aria-hidden="true" />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div className="icon-box-sm">
                  <k.Icon className="w-3.5 h-3.5" style={{ color: k.color }} />
                </div>
                <span className="kpi-card-title">{k.label}</span>
              </div>
              <div className="stat-value text-3xl" style={{ color: 'var(--text-primary)', lineHeight: 1, fontWeight: 800, letterSpacing: '-0.03em' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{k.sub}</div>
            </button>
          ))}
        </div>

        {/* ═══ STAFF MIX + REFERRALS strip ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {staffingSummaries.map(s => (
            <button key={s.id} onClick={() => router.push(s.href)} className="dash-card flex items-center gap-3" style={{ padding: '14px 16px', textAlign: 'start' }}>
              <div className="icon-box-sm">
                <s.Icon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <span className="text-[13px]" style={{ color: 'var(--text-secondary)', flex: 1 }}>{s.label}</span>
              <span className="stat-value" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{s.value}</span>
            </button>
          ))}
        </div>

        {/* ═══ SURVEILLANCE / ALERTS ═══ */}
        <div className="dash-card overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              <span className="dashboard-panel-title-full">{t('superintendent.surveillanceSignal')}</span>
              <span className="dashboard-panel-title-tablet">{t('superintendent.surveillanceTitle')}</span>
            </h3>
            <button onClick={() => router.push('/surveillance')} className="text-[11px] font-bold inline-flex items-center gap-1" style={{ color: 'var(--accent-primary)' }}>
              {t('hr.viewAll')} <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          {activeAlerts.length === 0 ? (
            <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
              <Activity className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-success-text)', opacity: 0.6 }} />
              {t('epidemic.noActiveDiseaseAlerts')}
            </div>
          ) : (
            <div>
              {activeAlerts.slice(0, 6).map((a, i) => (
                <button
                  key={a._id || i}
                  onClick={() => router.push(a._id ? `/surveillance?alert=${encodeURIComponent(a._id)}` : '/surveillance')}
                  className="data-row data-row--warning w-full"
                  style={{ textAlign: 'start' }}
                >
                  <div className="icon-box-sm flex-shrink-0">
                    <AlertTriangle className="w-4 h-4" style={{ color: a.alertLevel === 'emergency' ? 'var(--color-danger-500)' : 'var(--color-warning)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a.disease || t('superintendent.alertFallback')}</div>
                    <div className="text-[11.5px] mt-0.5 capitalize" style={{ color: a.alertLevel === 'emergency' ? 'var(--color-danger-500)' : 'var(--color-warning-text)' }}>
                      {a.alertLevel} · {[a.county, a.state].filter(Boolean).join(', ') || t('superintendent.locationFallback')} · {t('dashboard.casesCount', { count: a.cases })}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
