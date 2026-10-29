'use client';

/**
 * Imaging report — chart workspace form (`imaging-report` panel).
 *
 * The radiology station used to be the only place a study could be started,
 * imaged and reported. Reporting now happens in the chart, beside the order
 * and the history it was asked against, the same way a doctor documents a
 * note: the radiologist's dashboard lists who is waiting and opens the chart
 * here. Every study modality (X-ray, ultrasound, CT, MRI, …) is the same
 * `lab_result` order with the imaging specimen, so one form serves them all.
 *
 * Writes are the station's own: status → in_progress on start, images to the
 * patient's documents (category `radiology`) linked back on the order, and
 * findings + completedAt on report, followed by a best-effort message to the
 * ordering clinician.
 */

import { useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { addPatientDocument } from '@/lib/services/patient-document-service';
import { patientFullName } from '@/lib/patient-utils';
import { formatDate } from '@/lib/format-utils';
import { describeError } from '@/lib/user-facing-error';
import FormNotices from '@/components/overlay/FormNotices';
import type { LabResultDoc, PatientDoc } from '@/lib/db-types';
import type { ChartPanelUser } from './types';
import './start-visit-panel.css';

interface ImagingReportPanelProps {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  onClose: () => void;
}

/** 5MB per file — the PouchDB document budget the station enforced. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const STATUS_ORDER: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function ImagingReportPanel({ patient, currentUser, onClose }: ImagingReportPanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { results, update } = useLabResults(patient._id);
  const studies = useMemo(
    () => results
      .filter(r => isImagingStudy(r))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)
        || (b.orderedAt || '').localeCompare(a.orderedAt || '')),
    [results],
  );
  const [findings, setFindings] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachTargetRef = useRef<LabResultDoc | null>(null);

  const startStudy = async (study: LabResultDoc) => {
    setBusyId(study._id);
    try {
      await update(study._id, { status: 'in_progress', acquiredAt: new Date().toISOString(), acquiredBy: currentUser?.name });
    } catch (err) {
      showToast(describeError(err, t('radiology.updateFailed')), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const chooseFiles = (study: LabResultDoc) => {
    attachTargetRef.current = study;
    fileInputRef.current?.click();
  };

  const attachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const study = attachTargetRef.current;
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!study || files.length === 0) return;
    setBusyId(study._id);
    const documentIds: string[] = [];
    let skipped = 0;
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) { skipped += 1; continue; }
      try {
        const document = await addPatientDocument({
          patientId: patient._id,
          title: `${study.testName}: ${file.name}`,
          category: 'radiology',
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data: await fileToBase64(file),
          sizeBytes: file.size,
          note: t('imagingForm.attachedNote', { id: study._id }),
          uploadedById: currentUser?._id,
          uploadedByName: currentUser?.name,
          hospitalId: currentUser?.hospitalId,
          orgId: currentUser?.orgId,
        });
        documentIds.push(document._id);
      } catch {
        skipped += 1;
      }
    }
    try {
      if (documentIds.length) {
        const linked = [...new Set([...(study.studyDocumentIds || []), ...documentIds])];
        await update(study._id, { studyDocumentIds: linked, imageCount: linked.length });
        showToast(t('imagingForm.imagesAttached', { count: documentIds.length }), 'success');
      }
      if (skipped) showToast(t('imagingForm.imagesSkipped', { count: skipped }), 'warning');
    } catch (err) {
      showToast(describeError(err, t('radiology.updateFailed')), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const submitReport = async (study: LabResultDoc) => {
    const text = (findings[study._id] || '').trim();
    if (!text) return;
    setBusyId(study._id);
    try {
      const now = new Date().toISOString();
      await update(study._id, {
        result: text, findings: text, status: 'completed',
        completedAt: now, reportedAt: now, reportedBy: currentUser?.name,
      });
    } catch (err) {
      showToast(describeError(err, t('radiology.updateFailed')), 'error');
      setBusyId(null);
      return;
    }
    // A report otherwise surfaces only when someone reopens the chart, so
    // page the ordering clinician. Best-effort: the report is already saved.
    try {
      const { createMessage } = await import('@/modules/communication/services/message-service');
      const name = patientFullName(patient);
      await createMessage({
        recipientType: 'staff',
        patientId: patient._id,
        patientName: name,
        patientPhone: '',
        fromDoctorId: currentUser?._id || 'radiology',
        fromDoctorName: currentUser?.name || 'Radiology',
        fromHospitalName: currentUser?.hospitalName || '',
        subject: `Imaging report ready: ${study.testName} for ${name}`,
        body: `${study.testName} for ${name} has been reported: ${text}`,
        channel: 'app',
        sentAt: new Date().toISOString(),
        orgId: currentUser?.orgId,
      });
    } catch (err) {
      console.error('[imaging-report] clinician notification failed; report was saved', err);
    }
    setFindings(prev => ({ ...prev, [study._id]: '' }));
    setBusyId(null);
    showToast(t('imagingForm.reported', { study: study.testName }), 'success');
  };

  const statusLabel = (status: string) => t(`radiology.status_${status}`);

  return (
    <div className="sv-root">
      <div className="sv-body">
        <input ref={fileInputRef} type="file" accept="image/*,.dcm,application/dicom" multiple hidden onChange={e => void attachFiles(e)} />
        {studies.length === 0 && <p className="sv-empty">{t('imagingForm.none')}</p>}
        {studies.map(study => {
          const done = study.status === 'completed';
          const busy = busyId === study._id;
          return (
            <section key={study._id} className="irp-study" data-status={study.status}>
              <header className="irp-study-head">
                <div>
                  <strong>{study.testName}</strong>
                  <span>
                    {t('radiology.orderedBy')}: {study.orderedBy || '—'}
                    {study.orderedAt ? ` · ${formatDate(study.orderedAt)}` : ''}
                    {study.critical ? ` · ${t('radiology.priority_urgent')}` : ''}
                  </span>
                </div>
                <b className="irp-status">{statusLabel(study.status)}</b>
              </header>
              {study.clinicalNotes && (
                <p className="irp-notes"><span className="sv-label">{t('radiology.clinicalNotes')}</span>{study.clinicalNotes}</p>
              )}
              {done ? (
                <p className="irp-notes"><span className="sv-label">{t('radiology.findings')}</span>{study.findings || study.result}</p>
              ) : (
                <>
                  <div className="irp-actions">
                    {study.status === 'pending' && (
                      <button type="button" onClick={() => void startStudy(study)} disabled={busy}>{t('imagingForm.start')}</button>
                    )}
                    <button type="button" onClick={() => chooseFiles(study)} disabled={busy}>
                      {t('radiology.attachImage')}{study.imageCount ? ` (${study.imageCount})` : ''}
                    </button>
                  </div>
                  <label className="sv-field">
                    <span className="sv-label">{t('radiology.enterFindings')}</span>
                    <textarea
                      rows={4}
                      value={findings[study._id] || ''}
                      placeholder={t('radiology.findingsPlaceholder')}
                      onChange={e => setFindings(prev => ({ ...prev, [study._id]: e.target.value }))}
                    />
                  </label>
                  <div className="irp-actions">
                    <button type="button" className="is-primary" onClick={() => void submitReport(study)}
                      disabled={busy || !(findings[study._id] || '').trim()}>
                      {t('radiology.submitReport')}
                    </button>
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>
      <FormNotices />
      <div className="sv-footer">
        <button type="button" className="sv-footer-btn sv-footer-btn--discard" onClick={onClose}>
          {t('imagingForm.close')}
        </button>
      </div>
    </div>
  );
}
