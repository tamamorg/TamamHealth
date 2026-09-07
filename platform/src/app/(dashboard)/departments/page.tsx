'use client';

import Link from 'next/link';
import { Building2, Calendar, ChevronRight, RefreshCw } from '@/components/icons/lucide';
import EhrPageTitle from '@/components/ehr/EhrPageTitle';
import EmptyState from '@/components/EmptyState';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { appointmentBelongsToDepartment } from '@/modules/departments/client';
import { toIsoDate } from '@/lib/date-utils';
import { useState } from 'react';

const CONFIG_ROLES = new Set(['super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager']);

export default function DepartmentsPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { departments, loading, error, reload } = useDepartments();
  const { appointments } = useAppointments();
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

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <EhrPageTitle>{t('departments.title')}</EhrPageTitle>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{t('departments.subtitle')}</p>
        </div>
        <Link className="btn btn-secondary btn-sm" href="/appointments">
          <Calendar className="w-4 h-4" /> {t('departments.allAppointments')}
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('departments.loading')}>
          {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-32 rounded-xl animate-pulse" style={{ background: 'var(--bg-secondary)' }} />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: 'var(--border-color)' }}>
          <p className="text-sm mb-3" style={{ color: 'var(--color-danger-text)' }}>{t(error)}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => void reload()}><RefreshCw className="w-4 h-4" /> {t('common.retry')}</button>
        </div>
      ) : departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t('departments.emptyTitle')}
          message={t(provisionError ? 'departments.provisionError' : CONFIG_ROLES.has(currentUser?.role || '') ? 'departments.emptyAdmin' : 'departments.emptyStaff')}
          action={CONFIG_ROLES.has(currentUser?.role || '') && activeFacilityId ? { label: provisioning ? t('departments.provisioning') : t('departments.provision'), onClick: () => void provision() } : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((department) => {
            const departmentAppointments = appointments.filter((appointment) => appointmentBelongsToDepartment(appointment, department));
            const todayRows = departmentAppointments.filter((appointment) => appointment.appointmentDate === today);
            const waiting = todayRows.filter((appointment) => !['completed', 'cancelled', 'no_show'].includes(appointment.status)).length;
            return (
              <Link key={department._id} href={`/departments/${encodeURIComponent(department._id)}`} className="rounded-xl border p-4 transition-shadow hover:shadow-md" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{department.name}</h2>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{department.facilityName} · {department.location || t('departments.locationUnassigned')}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div><div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{todayRows.length}</div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('departments.today')}</div></div>
                  <div><div className="text-xl font-semibold" style={{ color: waiting ? 'var(--color-warning-text)' : 'var(--text-primary)' }}>{waiting}</div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('departments.waiting')}</div></div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
