'use client';

import { useRouter } from 'next/navigation';
import { Building2 } from '@/components/icons/lucide';
import { SadbCard, SadbGridList, SadbGridRow, SadbSearch } from '@/components/admin/sadb-ui';
import FacilityKpiBand from '@/components/dashboards/FacilityKpiBand';
import InlineBanner from '@/components/overlay/InlineBanner';
import EmptyState from '@/components/EmptyState';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { appointmentBelongsToDepartment } from '@/modules/departments/client';
import { toIsoDate } from '@/lib/date-utils';
import { useMemo, useState } from 'react';

const CONFIG_ROLES = new Set(['super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager']);

export default function DepartmentsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { departments, loading, error, reload } = useDepartments();
  const { appointments } = useAppointments();
  const [search, setSearch] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState(false);
  const today = toIsoDate(new Date());
  const activeFacilityId = scope?.hospitalId || currentUser?.hospitalId;

  const provision = async () => {
    if (!scope || !activeFacilityId || !currentUser || provisioning) return;
    setProvisioning(true);
    setProvisionError(false);
    try {
      const { provisionTamamDepartments } = await import('@/modules/departments/services/department-service');
      await provisionTamamDepartments({
        scope, facilityId: activeFacilityId,
        facilityName: currentUser?.hospitalName || activeFacilityId,
        actorId: currentUser._id, actorName: currentUser.name,
      });
      await reload();
    } catch (cause) {
      console.error(cause);
      setProvisionError(true);
    } finally { setProvisioning(false); }
  };

  // One row per department: what is booked for it today and how much of that
  // is still waiting. The same figures feed the KPI band above.
  const rows = useMemo(() => departments.map((department) => {
    const todayRows = appointments.filter(
      (appointment) => appointmentBelongsToDepartment(appointment, department) && appointment.appointmentDate === today,
    );
    const waiting = todayRows.filter((appointment) => !['completed', 'cancelled', 'no_show'].includes(appointment.status)).length;
    return { department, today: todayRows.length, waiting };
  }), [departments, appointments, today]);

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? rows.filter(r => `${r.department.name} ${r.department.location || ''}`.toLowerCase().includes(needle))
    : rows;
  const bookedToday = rows.reduce((n, r) => n + r.today, 0);
  const waitingNow = rows.reduce((n, r) => n + r.waiting, 0);
  const busiest = rows.reduce<typeof rows[number] | null>((best, r) => (!best || r.today > best.today ? r : best), null);
  const canConfigure = CONFIG_ROLES.has(currentUser?.role || '') && !!activeFacilityId;
  const GRID = 'minmax(220px, 1.6fr) minmax(160px, 1.2fr) 100px 100px';

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">
        {departments.length > 0 && (
          <FacilityKpiBand tiles={[
            { key: 'departments', label: t('departments.title'), value: departments.length, detail: t('departments.kpiWithLocation', { count: departments.filter(d => d.location).length }) },
            { key: 'today', label: t('departments.today'), value: bookedToday, detail: t('departments.kpiTodayDetail') },
            { key: 'waiting', label: t('departments.waiting'), value: waitingNow, detail: bookedToday ? t('departments.kpiWaitingDone', { done: bookedToday - waitingNow, total: bookedToday }) : t('departments.kpiNothingToday'), warn: waitingNow > 0 },
            { key: 'busiest', label: t('departments.kpiBusiest'), value: busiest && busiest.today ? busiest.today : 0, detail: busiest && busiest.today ? busiest.department.name : t('departments.kpiNoBookingsToday') },
          ]} />
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('departments.loading')}>
            {[0, 1, 2].map((item) => <div key={item} className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--bg-secondary)' }} />)}
          </div>
        ) : error ? (
          <InlineBanner tone="danger" action={{ label: t('common.retry'), onClick: () => void reload() }}>
            {t(error)}
          </InlineBanner>
        ) : departments.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t('departments.emptyTitle')}
            message={t(provisionError ? 'departments.provisionError' : CONFIG_ROLES.has(currentUser?.role || '') ? 'departments.emptyAdmin' : 'departments.emptyStaff')}
            action={canConfigure ? { label: provisioning ? t('departments.provisioning') : t('departments.provision'), onClick: () => void provision() } : undefined}
          />
        ) : (
          <SadbCard title={t('departments.title')} meta={`${departments.length}`}>
            <div className="sadb-search-row sadb-search-row--table-aligned">
              <SadbSearch value={search} onChange={setSearch} placeholder="Search departments…" ariaLabel="Search departments" />
            </div>
            <div className="sadb-card-scroll">
              <SadbGridList template={GRID} minWidth={640} head={['Department', 'Location', 'Today', 'Waiting']} empty="No departments match this search.">
                {visible.map(({ department, today: todayCount, waiting }) => (
                  <SadbGridRow key={department._id} template={GRID} onClick={() => router.push(`/departments/${encodeURIComponent(department._id)}`)}>
                    <span className="min-w-0"><span className="sadb-tenant-name truncate">{department.name}</span></span>
                    <span className="truncate">{department.location || t('departments.locationUnassigned')}</span>
                    <span className="sadb-tenant-num">{todayCount}</span>
                    <span className="sadb-tenant-num" style={waiting ? { color: 'var(--color-warning-text)' } : undefined}>{waiting}</span>
                  </SadbGridRow>
                ))}
              </SadbGridList>
            </div>
          </SadbCard>
        )}
      </div>
    </main>
  );
}
