'use client';

/**
 * The chart's Visits tab, in the OpenMRS O3 shape: one row per visit (a day
 * the patient was seen) with its date, visit type and diagnoses — a "?" on a
 * provisional one — and, in the row's ⋮, open that visit's note, print the
 * clinical Visit Summary, or show what happened that day. A row expands to what happened that
 * day. "All encounters" keeps the event-by-event timeline.
 */
import { Fragment, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown } from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { openIsolatedHtmlWindow } from '@/lib/safe-html';
import { buildClinicalVisitSummaryHtml, visitDiagnoses } from '@/lib/clinical-visit-summary';
import { formatDate } from '@/lib/format-utils';
import type { AppointmentDoc, LabResultDoc, MedicalRecordDoc, PatientDoc, PrescriptionDoc, ProblemDoc, TriageDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import type { VitalsTimelineEntry } from '@/lib/clinical/vitals';
import './visits-table.css';

const dayOf = (iso?: string) => (iso ? iso.slice(0, 10) : '');

const VISIT_TYPE_KEY: Record<string, string> = {
  outpatient: 'visits.type.opd',
  inpatient: 'visits.type.inpatient',
  emergency: 'visits.type.emergency',
  referral: 'visits.type.referral',
};

export interface VisitsTableProps {
  patient: PatientDoc;
  facilityName?: string;
  records: MedicalRecordDoc[];
  notes: ClinicalNoteDoc[];
  labs: LabResultDoc[];
  prescriptions: PrescriptionDoc[];
  problems: ProblemDoc[];
  triages: TriageDoc[];
  appointments: AppointmentDoc[];
  vitalsTimeline: VitalsTimelineEntry[];
  canViewClinical: boolean;
}

export default function VisitsTable(props: VisitsTableProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const days = useMemo(() => {
    const set = new Set<string>();
    props.records.forEach(r => set.add(dayOf(r.consultedAt || r.visitDate || r.createdAt)));
    props.notes.forEach(n => set.add(dayOf(n.serviceDate || n.createdAt)));
    props.triages.forEach(tr => set.add(dayOf(tr.triagedAt || tr.createdAt)));
    props.appointments
      .filter(a => a.status === 'checked_in' || a.status === 'completed' || a.status === 'in_progress')
      .forEach(a => set.add(a.appointmentDate));
    set.delete('');
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [props.records, props.notes, props.triages, props.appointments]);

  const visitType = (day: string) => {
    const rec = props.records.find(r => dayOf(r.consultedAt || r.visitDate || r.createdAt) === day && r.recordKind !== 'nursing_vitals');
    if (rec?.visitType && VISIT_TYPE_KEY[rec.visitType]) return t(VISIT_TYPE_KEY[rec.visitType]);
    return t('visits.type.facility');
  };

  const print = (day: string) => {
    openIsolatedHtmlWindow(buildClinicalVisitSummaryHtml({
      patient: props.patient,
      day,
      visitType: visitType(day),
      facilityName: props.facilityName,
      records: props.records,
      notes: props.notes,
      labs: props.labs,
      prescriptions: props.prescriptions,
      problems: props.problems,
      vitals: props.vitalsTimeline.find(v => dayOf(v.at) === day),
    }), '', true);
  };

  const toggle = (day: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(day)) next.delete(day); else next.add(day);
    return next;
  });

  return (
    <div className="vt-wrap">
      <table className="vt-table">
        <thead>
          <tr>
            <th className="vt-col-toggle" aria-label={t('visits.expand')} />
            <th>{t('visits.date')}</th>
            <th>{t('visits.visitType')}</th>
            <th>{t('visits.diagnoses')}</th>
            <th className="vt-col-actions tamam-col-actions">{t('chart.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {days.length === 0 && (
            <tr><td colSpan={5} className="vt-empty">{t('visits.empty')}</td></tr>
          )}
          {days.map(day => {
            const dx = visitDiagnoses(props.records, day);
            const note = props.notes.filter(n => dayOf(n.serviceDate || n.createdAt) === day)
              .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
            const isOpen = open.has(day);
            const vit = props.vitalsTimeline.find(v => dayOf(v.at) === day);
            const meds = props.prescriptions.filter(p => dayOf(p.createdAt) === day);
            const labs = props.labs.filter(l => dayOf(l.orderedAt || l.createdAt) === day);
            const dayNotes = props.notes.filter(n => dayOf(n.serviceDate || n.createdAt) === day);
            return (
              <Fragment key={day}>
                <tr className={isOpen ? 'vt-row is-open' : 'vt-row'}>
                  <td className="vt-col-toggle">
                    <button type="button" className="vt-toggle" aria-expanded={isOpen} aria-label={isOpen ? t('visits.collapse') : t('visits.expand')} onClick={() => toggle(day)}>
                      <ChevronDown aria-hidden />
                    </button>
                  </td>
                  <td className="vt-date">{formatDate(day)}</td>
                  <td>{visitType(day)}</td>
                  <td>
                    <div className="vt-chips">
                      {dx.map((d, i) => (
                        <span key={`${d.name}-${i}`} className="vt-chip" title={d.certainty === 'Provisional' ? t('visits.provisional') : undefined}>
                          {d.certainty === 'Provisional' && <span className="vt-chip-q" aria-label={t('visits.provisional')}>?</span>}
                          {d.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="vt-col-actions">
                    <RowActionsMenu
                      ariaLabel={t('visits.rowActions', { date: formatDate(day) })}
                      actions={[
                        ...(props.canViewClinical && note ? [
                          { key: 'note', label: t('visits.editNote'), onClick: () => router.push(`${pathname}?tab=history&note=${encodeURIComponent(note._id)}`) },
                        ] : []),
                        { key: 'details', label: isOpen ? t('visits.collapse') : t('visits.expand'), onClick: () => toggle(day) },
                        { key: 'print', label: t('visits.print'), onClick: () => print(day) },
                      ]}
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="vt-detail">
                    <td />
                    <td colSpan={4}>
                      <dl className="vt-facts">
                        <div><dt>{t('visits.vitals')}</dt><dd>{vit ? [
                          vit.systolic !== undefined && vit.diastolic !== undefined ? `BP ${vit.systolic}/${vit.diastolic}` : '',
                          vit.pulse !== undefined ? `HR ${vit.pulse}` : '',
                          vit.temperature !== undefined ? `T ${vit.temperature}°C` : '',
                          vit.oxygenSaturation !== undefined ? `SpO₂ ${vit.oxygenSaturation}%` : '',
                        ].filter(Boolean).join(' · ') || '—' : '—'}</dd></div>
                        <div><dt>{t('visits.notes')}</dt><dd>{dayNotes.length ? dayNotes.map(n => `${n.authorName || ''}${n.signedAt ? '' : ` (${t('visits.unsigned')})`}`).join(' · ') : '—'}</dd></div>
                        <div><dt>{t('visits.medications')}</dt><dd>{meds.length ? meds.map(m => m.medication).join(' · ') : '—'}</dd></div>
                        <div><dt>{t('visits.labs')}</dt><dd>{labs.length ? labs.map(l => `${l.testName}${l.result ? `: ${l.result}${l.unit ? ` ${l.unit}` : ''}` : ''}`).join(' · ') : '—'}</dd></div>
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
