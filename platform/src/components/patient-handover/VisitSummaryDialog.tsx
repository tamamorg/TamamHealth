'use client';

/**
 * The end-of-visit summary: preview what the patient takes home, then print
 * it or text it.
 *
 * The summary is assembled from what the visit already recorded (see
 * `lib/visit-summary`), so there is nothing to fill in — only the advice is
 * editable, because that is the one part written in the clinician's voice.
 * The text version leaves the diagnosis out unless the sender asks for it.
 */
import { useId, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import InlineBanner from '@/components/overlay/InlineBanner';
import FormField from '@/components/overlay/FormField';
import Select from '@/components/Select';
import { Printer, MessageSquare } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { PatientTextDialog } from '@/modules/communication/client';
import type { AppointmentDoc, LabResultDoc, MedicalRecordDoc, PatientDoc, PrescriptionDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { patientAgeLabel, patientDisplayName, patientFullName } from '@/lib/patient-utils';
import { openIsolatedHtmlWindow } from '@/lib/safe-html';
import { scriptDate } from '@/lib/prescription-script';
import {
  buildVisitSummary, buildVisitSummaryHtml, buildVisitSummaryText, isVisitSummaryEmpty, visitDays,
} from '@/lib/visit-summary';
import './patient-handover.css';

export interface VisitSummaryDialogProps {
  patient: PatientDoc;
  records: MedicalRecordDoc[];
  notes: ClinicalNoteDoc[];
  prescriptions: PrescriptionDoc[];
  labOrders: LabResultDoc[];
  appointments: AppointmentDoc[];
  currentUser: {
    _id: string; name?: string; username?: string;
    orgId?: string; hospitalId?: string; hospitalName?: string;
  } | null;
  onClose: () => void;
}

export default function VisitSummaryDialog({
  patient, records, notes, prescriptions, labOrders, appointments, currentUser, onClose,
}: VisitSummaryDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descId = useId();

  const days = useMemo(() => visitDays({ records, notes, prescriptions }), [records, notes, prescriptions]);
  // The latest visit unless another is picked — and still a real visit if the
  // list changes underneath (a prescription discontinued while this is open).
  const [pickedDay, setDay] = useState<string | null>(null);
  const day = pickedDay && days.includes(pickedDay) ? pickedDay : (days[0] || '');
  const [texting, setTexting] = useState(false);
  const [includeDiagnosis, setIncludeDiagnosis] = useState(false);

  const userName = currentUser?.name || currentUser?.username || '';
  const facilityName = currentUser?.hospitalName || t('patientCopy.thisFacility');

  const summary = useMemo(() => (day ? buildVisitSummary({
    visitDate: day,
    records, notes, prescriptions, labOrders, appointments,
    patient: {
      name: patientFullName(patient),
      hospitalNumber: patient.hospitalNumber,
      ageLabel: patientAgeLabel(patient),
      sex: patient.gender,
    },
    facilityName,
    clinicianName: userName,
  }) : null), [day, records, notes, prescriptions, labOrders, appointments, patient, facilityName, userName]);

  // Seeded from the note's patient-facing sections; the clinician's edits win,
  // for the visit they were typed against.
  const [adviceEdit, setAdviceEdit] = useState<{ day: string; text: string } | null>(null);
  const advice = adviceEdit?.day === day ? adviceEdit.text : (summary ? summary.advice.join('\n\n') : '');
  const setAdvice = (text: string) => setAdviceEdit({ day, text });

  const empty = !summary || isVisitSummaryEmpty(summary);

  const handlePrint = () => {
    if (!summary) return;
    openIsolatedHtmlWindow(buildVisitSummaryHtml(summary, { advice }), '', true);
  };

  const text = summary
    // The text names the patient the way a list does; the paper carries the full name.
    ? buildVisitSummaryText({ ...summary, patient: { ...summary.patient, name: patientDisplayName(patient) } }, { advice, includeDiagnosis })
    : '';

  return (
    <>
      <Modal onClose={onClose} size="lg" labelledBy={titleId} describedBy={descId}>
        <DialogFrame>
          <DialogHeader
            titleId={titleId}
            descriptionId={descId}
            title={t('visitSummary.title')}
            description={t('visitSummary.description', { name: patientFullName(patient) })}
            onClose={onClose}
          />
          <DialogBody>
            <div className="ph-stack">
              {days.length === 0 ? (
                <InlineBanner tone="warning" title={t('visitSummary.noVisitsTitle')}>
                  {t('visitSummary.noVisitsBody')}
                </InlineBanner>
              ) : (
                <FormField label={t('visitSummary.visitLabel')}>
                  {control => (
                    <Select {...control} value={day} onChange={e => setDay(e.target.value)}>
                      {days.map(d => <option key={d} value={d}>{scriptDate(d)}</option>)}
                    </Select>
                  )}
                </FormField>
              )}

              {summary?.hasUnsignedNote && (
                <InlineBanner tone="warning" compact>{t('visitSummary.unsignedNote')}</InlineBanner>
              )}

              {summary && (
                <div className="ph-summary">
                  <section>
                    <h3>{t('visitSummary.seenBy')}</h3>
                    <p>{summary.clinicianName || t('visitSummary.notRecorded')} · {summary.facilityName}</p>
                  </section>
                  {summary.reason && (
                    <section>
                      <h3>{t('visitSummary.reason')}</h3>
                      <p>{summary.reason}</p>
                    </section>
                  )}
                  {summary.diagnoses.length > 0 && (
                    <section>
                      <h3>{t('visitSummary.diagnoses')}</h3>
                      <ul>{summary.diagnoses.map(d => <li key={d}>{d}</li>)}</ul>
                    </section>
                  )}
                  <section>
                    <h3>{t('visitSummary.medicines')}</h3>
                    {summary.medications.length === 0
                      ? <p className="ph-muted">{t('visitSummary.noMedicines')}</p>
                      : (
                        <ul>
                          {summary.medications.map((m, index) => (
                            <li key={`${m.name}-${index}`}>
                              <strong>{m.name}</strong> — {m.directions}{m.duration ? `, ${m.duration}` : ''}
                              {m.outsidePharmacy ? ` (${t('patientCopy.tagOutside')})` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                  </section>
                  {summary.tests.length > 0 && (
                    <section>
                      <h3>{t('visitSummary.tests')}</h3>
                      <ul>{summary.tests.map(test => <li key={test}>{test}</li>)}</ul>
                    </section>
                  )}
                  <section>
                    <h3>{t('visitSummary.followUp')}</h3>
                    <p className={summary.followUp ? undefined : 'ph-muted'}>
                      {summary.followUp
                        ? `${scriptDate(summary.followUp.date)}${summary.followUp.time ? ` · ${summary.followUp.time}` : ''}${summary.followUp.with ? ` · ${summary.followUp.with}` : ''}`
                        : t('visitSummary.noFollowUp')}
                    </p>
                  </section>
                  <FormField label={t('visitSummary.advice')} hint={t('visitSummary.adviceHint')}>
                    {control => (
                      <textarea
                        {...control}
                        className="ph-advice"
                        value={advice}
                        onChange={e => setAdvice(e.target.value)}
                        rows={4}
                      />
                    )}
                  </FormField>
                </div>
              )}

              {summary && empty && !advice.trim() && (
                <InlineBanner tone="info" compact>{t('visitSummary.emptyBody')}</InlineBanner>
              )}
            </div>
          </DialogBody>
          <DialogFooter note={t('visitSummary.footNote')}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('action.close')}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setTexting(true)} disabled={!summary}>
              <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> {t('patientCopy.text')}
            </button>
            <button type="button" className="btn btn-primary" onClick={handlePrint} disabled={!summary}>
              <Printer className="w-3.5 h-3.5" aria-hidden="true" /> {t('visitSummary.print')}
            </button>
          </DialogFooter>
        </DialogFrame>
      </Modal>
      {texting && summary && currentUser && (
        <PatientTextDialog
          patient={{ _id: patient._id, name: patientDisplayName(patient), phone: patient.phone }}
          sender={{
            _id: currentUser._id, name: userName,
            hospitalId: currentUser.hospitalId, hospitalName: currentUser.hospitalName, orgId: currentUser.orgId,
          }}
          title={t('visitSummary.textTitle')}
          subject={t('visitSummary.textSubject', { date: scriptDate(summary.visitDate) })}
          kind="visit_summary"
          text={text}
          options={summary.diagnoses.length > 0 ? (
            <label className="ph-check">
              <input type="checkbox" checked={includeDiagnosis} onChange={e => setIncludeDiagnosis(e.target.checked)} />
              <span>{t('visitSummary.includeDiagnosis')}</span>
            </label>
          ) : undefined}
          onClose={() => setTexting(false)}
        />
      )}
    </>
  );
}
