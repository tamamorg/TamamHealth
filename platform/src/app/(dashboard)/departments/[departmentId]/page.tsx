'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calendar, ClipboardList, User } from '@/components/icons/lucide';
import EhrPageTitle from '@/components/ehr/EhrPageTitle';
import EmptyState from '@/components/EmptyState';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { appointmentBelongsToDepartment, buildDepartmentReport, sortDepartmentAppointments } from '@/modules/departments/client';
import { SPECIALTY_PATHWAYS } from '@/modules/specialty-care';
import { toIsoDate } from '@/lib/date-utils';

export default function DepartmentDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ departmentId: string }>();
  const id = decodeURIComponent(params.departmentId);
  const { departments, loading: departmentsLoading, error } = useDepartments();
  const { appointments, loading: appointmentsLoading } = useAppointments();
  const department = departments.find((item) => item._id === id);
  const rows = department ? appointments.filter((appointment) => appointmentBelongsToDepartment(appointment, department)) : [];
  const today = toIsoDate(new Date());
  const todayRows = department?.queueEnabled === false ? [] : sortDepartmentAppointments(rows.filter((appointment) => appointment.appointmentDate === today));
  const report = buildDepartmentReport(rows);
  const loading = departmentsLoading || appointmentsLoading;
  const hasSpecialtyWorkflow = department ? SPECIALTY_PATHWAYS.some((pathway) => pathway.departmentCodes.includes(department.code)) : false;

  if (!loading && (!department || error)) {
    return <div className="p-6"><EmptyState icon={ClipboardList} title={t('departments.notFound')} message={t('departments.notFoundMessage')} action={{ label: t('departments.back'), onClick: () => history.back() }} /></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/departments" className="inline-flex items-center gap-1 text-xs mb-2" style={{ color: 'var(--accent-primary)' }}><ArrowLeft className="w-3.5 h-3.5" /> {t('departments.back')}</Link>
          <EhrPageTitle>{department?.name || t('departments.loading')}</EhrPageTitle>
          {department && <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{department.location || t('departments.locationUnassigned')} · {department.specialties.length ? department.specialties.map((value) => value.replaceAll('_', ' ')).join(', ') : t('departments.sharedService')}</p>}
        </div>
        <div className="flex flex-wrap gap-2">{hasSpecialtyWorkflow && <Link href="/departments/specialty-care" className="btn btn-secondary btn-sm"><ClipboardList className="w-4 h-4" /> {t('specialtyCare.workflow')}</Link>}<Link href="/appointments" className="btn btn-primary btn-sm"><Calendar className="w-4 h-4" /> {t('departments.manageSchedule')}</Link></div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {([
          ['departments.report.total', report.total], ['departments.report.waiting', report.waiting],
          ['departments.report.inProgress', report.inProgress], ['departments.report.completed', report.completed],
          ['departments.report.urgent', report.urgent], ['departments.report.noShows', report.noShows],
        ] as const).map(([key, value]) => <div key={key} className="rounded-xl border p-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}><div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t(key)}</div></div>)}
      </div>

      <section className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('departments.todayWorklist')}</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('departments.worklistHelp')}</p>
        </div>
        <div className="grid grid-cols-[76px_minmax(150px,1.4fr)_minmax(150px,1fr)_110px_44px] gap-3 px-4 py-2 text-xs font-semibold border-b min-w-[700px]" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}>
          <span>{t('departments.time')}</span><span>{t('departments.patient')}</span><span>{t('departments.reason')}</span><span>{t('departments.status')}</span><span aria-hidden="true" />
        </div>
        {loading ? <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('departments.loadingWorklist')}</div>
          : todayRows.length === 0 ? <EmptyState icon={ClipboardList} title={t('departments.noPatients')} message={t('departments.noPatientsMessage')} />
          : <div className="overflow-x-auto">{todayRows.map((appointment) => (
            <div key={appointment._id} className="grid grid-cols-[76px_minmax(150px,1.4fr)_minmax(150px,1fr)_110px_44px] gap-3 items-center px-4 py-3 border-b min-w-[700px] text-sm" style={{ borderColor: 'var(--border-color)' }}>
              <span style={{ color: 'var(--text-primary)' }}>{appointment.appointmentTime}</span>
              <div className="min-w-0"><Link href={`/patients/${appointment.patientId}`} className="font-semibold hover:underline truncate block" style={{ color: 'var(--accent-primary)' }}>{appointment.patientName}</Link><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{appointment.providerName}</span></div>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{appointment.reason}</span>
              <span className="text-xs capitalize" style={{ color: 'var(--text-secondary)' }}>{appointment.status.replaceAll('_', ' ')}</span>
              <Link href={`/patients/${appointment.patientId}`} aria-label={t('departments.openChart', { patient: appointment.patientName })} className="w-8 h-8 inline-flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--accent-primary)' }}><User className="w-4 h-4" /></Link>
            </div>
          ))}</div>}
      </section>

      <section className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('departments.clinicSchedule')}</h2>
        {department?.clinicDays.length ? <div className="mt-3 flex flex-wrap gap-2">{department.clinicDays.map((day) => <span key={`${day.weekday}-${day.startTime}`} className="px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{t(`departments.weekday.${day.weekday}`)} · {day.startTime}–{day.endTime} · {day.slotMinutes} {t('departments.minutes')}</span>)}</div> : <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>{t('departments.noClinicDays')}</p>}
      </section>
    </div>
  );
}
