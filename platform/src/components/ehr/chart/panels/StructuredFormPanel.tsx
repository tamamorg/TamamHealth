'use client';

/**
 * A structured clinical form (lib/forms/o3-form-definitions) in the chart
 * workspace, drawn by O3Form with "Back to clinical forms" and Save | Cancel.
 *
 * Save files the record the rest of the chart already reads:
 *  - Laboratory Test Results → one completed lab result per profile that has
 *    answers (Hematology, Chemistry, Urine, Stool), its observations the bench's
 *    own record shape, so the Results tab and the lab read it like any other;
 *  - every other form → a signed clinical note of the form's own type, the
 *    answers on `formData` and a readable copy in the note body.
 */

import { useState } from 'react';
import O3Form, { CHECK_SEPARATOR, UNSPECIFIED, o3MissingRequired, o3WithComputed, type O3Page } from '@/components/forms/O3Form';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useToast } from '@/components/Toast';
import { buildLabObservations, summarizeLabObservations, type LabResultProfile } from '@/components/lab/workflow/lab-result-catalog';
import { LAB_RESULT_PROFILES, STRUCTURED_FORMS, type StructuredFormId } from '@/lib/forms/o3-form-definitions';
import type { NoteTypeId } from '@/lib/clinical-notes/note-catalog';
import { localClockOf, todayIso } from '@/lib/date-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { patientFullName } from '@/lib/patient-utils';
import { describeError } from '@/lib/user-facing-error';
import type { PatientDoc } from '@/lib/db-types';
import type { ChartPanelUser } from './types';

const SPECIMEN: Record<LabResultProfile['id'], string> = {
  hematology: 'Blood', chemistry: 'Serum', urine: 'Urine', stool: 'Stool',
};

/** The answers as plain text, page by page — the note body. */
function readableAnswers(pages: O3Page[], values: Record<string, string>, unspecified: string): string {
  const lines: string[] = [];
  for (const page of pages) {
    const answered = page.sections.flatMap(s => s.fields).flatMap(f => {
      const v = (values[f.id] ?? '').trim();
      if (!v) return [];
      const shown = v === UNSPECIFIED ? unspecified
        : f.kind === 'checkboxes' ? v.split(CHECK_SEPARATOR).join(', ')
          : f.kind === 'datetime' ? v.replace('T', ' ')
            : v;
      return [`${f.label}: ${shown}${f.unit && v !== UNSPECIFIED ? ` ${f.unit}` : ''}`];
    });
    if (answered.length) lines.push(page.label, ...answered, '');
  }
  return lines.join('\n').trim();
}

export default function StructuredFormPanel({ formId, patient, currentUser, encounterId, onBack, onSaved }: {
  formId: StructuredFormId;
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  encounterId?: string;
  /** Back to the Clinical forms list (also Cancel). */
  onBack: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const form = STRUCTURED_FORMS[formId];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  const save = async () => {
    if (!currentUser?._id) return;
    const missing = o3MissingRequired(form.pages, values);
    if (missing.length) {
      setInvalid(new Set(missing.map(f => f.id)));
      setNotice(t('o3form.missingRequired', { count: missing.length }));
      return;
    }
    const answers = o3WithComputed(form.pages, values);
    const now = new Date().toISOString();
    const base = {
      patientId: patient._id,
      patientName: patientFullName(patient),
      hospitalId: currentUser.hospitalId,
      hospitalName: currentUser.hospitalName,
      orgId: currentUser.orgId,
      encounterId,
    };
    setSaving(true);
    setNotice('');
    try {
      if (formId === 'lab_results') {
        const filled = LAB_RESULT_PROFILES
          .map(profile => ({ profile, observations: buildLabObservations(profile, answers) }))
          .filter(entry => entry.observations.length > 0);
        if (!filled.length) {
          setNotice(t('o3form.nothingEntered'));
          return;
        }
        const { createLabResult } = await import('@/lib/services/lab-service');
        for (const { profile, observations } of filled) {
          await createLabResult({
            ...base,
            hospitalNumber: patient.hospitalNumber,
            testName: profile.label,
            specimen: SPECIMEN[profile.id],
            status: 'completed',
            orderStatus: 'resulted',
            orderKind: 'lab',
            result: summarizeLabObservations(observations),
            observations,
            unit: '',
            referenceRange: '',
            abnormal: false,
            critical: false,
            orderedBy: currentUser.name,
            orderedById: currentUser._id,
            orderedAt: now,
            completedAt: now,
          });
        }
      } else {
        const body = readableAnswers(form.pages, answers, t('o3form.unspecified'));
        if (!body) {
          setNotice(t('o3form.nothingEntered'));
          return;
        }
        const { createClinicalNote, signClinicalNote } = await import('@/lib/clinical-notes/note-service');
        const note = await createClinicalNote({
          ...base,
          mrn: patient.hospitalNumber,
          patientDob: patient.dateOfBirth,
          noteType: formId as NoteTypeId,
          serviceDate: todayIso(),
          serviceTime: localClockOf(now),
          authorId: currentUser._id,
          authorName: currentUser.name,
          sections: [{ sectionId: 'memo', text: body }],
          formData: answers,
        });
        await signClinicalNote(note._id, {
          signedBy: currentUser._id,
          signedByName: currentUser.name,
          signerRole: currentUser.role,
        });
      }
      showToast(t('o3form.saved', { form: form.name }), 'success');
      onSaved();
    } catch (error) {
      setNotice(describeError(error, t('o3form.notSaved')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <O3Form
      pages={form.pages}
      values={values}
      onChange={(id, value) => setValues(prev => ({ ...prev, [id]: value }))}
      onSave={() => void save()}
      onCancel={onBack}
      onBack={onBack}
      backLabel={t('o3form.backToForms')}
      saving={saving}
      disabled={!currentUser?._id}
      invalid={invalid}
      notice={notice ? <div className="o3f-notice"><InlineBanner tone="danger">{notice}</InlineBanner></div> : undefined}
    />
  );
}
