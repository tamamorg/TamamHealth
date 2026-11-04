'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ClipboardList } from '@/components/icons/lucide';
import { SadbCard, SadbGridList, SadbGridRow, SadbChip, type ChipTone } from '@/components/admin/sadb-ui';
import FacilityKpiBand from '@/components/dashboards/FacilityKpiBand';
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
  const router = useRouter();
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

  const GRID = '90px minmax(180px, 1.4fr) minmax(160px, 1fr) 130px';
  const statusTone = (status: string): ChipTone => (
    status === 'completed' ? 'green' : status === 'cancelled' || status === 'no_show' ? 'red' : status === 'in_progress' ? 'blue' : 'yellow'
  );
  const statusLabel = (status: string) => {
    const text = status.replaceAll('_', ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <EhrPageTitle>{department?.name || t('departments.loading')}</EhrPageTitle>
            {department && <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{department.location || t('departments.locationUnassigned')} · {department.specialties.length ? department.specialties.map((value) => value.replaceAll('_', ' ')).join(', ') : t('departments.sharedService')}</p>}
          </div>
          {hasSpecialtyWorkflow && (
            <Link href="/departments/specialty-care" className="tm-ghost-btn">
              <ClipboardList className="w-4 h-4" /> {t('specialtyCare.workflow')}
            </Link>
          )}
        </div>

        <FacilityKpiBand tiles={[
          { key: 'total', label: t('departments.report.total'), value: report.total, detail: `${todayRows.length} of them today` },
          { key: 'waiting', label: t('departments.report.waiting'), value: report.waiting, detail: 'Booked and not yet seen', warn: report.waiting > 0 },
          { key: 'progress', label: t('departments.report.inProgress'), value: report.inProgress, detail: 'With a clinician now' },
          { key: 'completed', label: t('departments.report.completed'), value: report.completed, detail: report.total ? `${Math.round((report.completed / report.total) * 100)}% of all bookings` : 'No bookings yet' },
          { key: 'urgent', label: t('departments.report.urgent'), value: report.urgent, detail: 'Booked as urgent', warn: report.urgent > 0 },
          { key: 'noshow', label: t('departments.report.noShows'), value: report.noShows, detail: report.total ? `${Math.round((report.noShows / report.total) * 100)}% of all bookings` : 'No bookings yet' },
        ]} />

        <SadbCard title={t('departments.todayWorklist')}>
          <p className="px-4 pb-2 text-xs" style={{ color: 'var(--text-muted)' }}>{t('departments.worklistHelp')}</p>
          <div className="sadb-card-scroll">
            <SadbGridList
              template={GRID}
              minWidth={640}
              head={[t('departments.time'), t('departments.patient'), t('departments.reason'), t('departments.status')]}
              alignEndLast
              empty={loading ? t('departments.loadingWorklist') : t('departments.noPatients')}
            >
              {todayRows.map((appointment) => (
                <SadbGridRow key={appointment._id} template={GRID} onClick={() => router.push(`/patients/${appointment.patientId}`)}>
                  <span className="tabular-nums">{appointment.appointmentTime}</span>
                  <span className="min-w-0">
                    <span className="sadb-tenant-name truncate">{appointment.patientName}</span>
                    <span className="block text-xs truncate" style={{ color: 'var(--text-muted)' }}>{appointment.providerName}</span>
                  </span>
                  <span className="truncate">{appointment.reason}</span>
                  <span style={{ textAlign: 'end' }}><SadbChip tone={statusTone(appointment.status)}>{statusLabel(appointment.status)}</SadbChip></span>
                </SadbGridRow>
              ))}
            </SadbGridList>
          </div>
        </SadbCard>

        <SadbCard title={t('departments.clinicSchedule')}>
          <div className="px-4 pb-4">
            {department?.clinicDays.length
              ? <div className="flex flex-wrap gap-2">{department.clinicDays.map((day) => <SadbChip key={`${day.weekday}-${day.startTime}`} tone="neutral">{t(`departments.weekday.${day.weekday}`)} · {day.startTime}–{day.endTime} · {day.slotMinutes} {t('departments.minutes')}</SadbChip>)}</div>
              : <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('departments.noClinicDays')}</p>}
          </div>
        </SadbCard>
      </div>
    </main>
  );
}
