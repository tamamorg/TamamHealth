'use client';

/**
 * A consultation record in the chart's workspace slider — every field of the
 * visit, where it is reviewed and then attested. It replaced the inline
 * signature bar under a timeline row.
 *
 * Follows the Centricity "hold vs sign" model: a draft can be edited, saved and
 * signed (and is then locked); a trainee's signature routes for co-signature; a
 * signed record is corrected only by an append-only addendum. Vitals and orders
 * stay read-only here: they belong to the module that recorded them.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import CodedSearchField from '@/components/CodedSearchField';
import { O3Layout, O3Question, O3TextField, type O3LayoutSection } from '@/components/forms/O3Form';
import { X } from '@/components/icons/lucide';
import { FormError } from '@/components/overlay/FormNotices';
import { useToast } from '@/components/Toast';
import { recordSignRights } from '@/lib/clinical-roles';
import { useAuth } from '@/lib/context';
import type { Diagnosis, MedicalRecordDoc } from '@/lib/db-types';
import { formatDate, formatDateTime, humanizeStatus } from '@/lib/format-utils';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import { canEditRecordDraft } from '@/lib/clinical-notes/draft-access';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import './record-sign-panel.css';

export type RecordPanelIntent = 'view' | 'addendum';

/** The free-text fields a draft can still change, as `field` or `group.field`. */
const TEXT_FIELD_IDS = [
  'chiefComplaint',
  'historyOfPresentIllness',
  'pastMedicalHistory.pastAdmissions',
  'pastMedicalHistory.pastSurgeries',
  'pastMedicalHistory.notes',
  'familyHistory',
  'socialHistory.occupation',
  'socialHistory.substanceUse',
  'socialHistory.notes',
  'drugHistory.chronicMedications',
  'physicalExamination.general',
  'physicalExamination.cardiovascular',
  'physicalExamination.respiratory',
  'physicalExamination.abdominal',
  'physicalExamination.neurological',
  'treatmentPlan',
  'followUp.date',
  'followUp.reason',
] as const;

type TextFieldId = typeof TEXT_FIELD_IDS[number];
export type RecordFormValues = Record<TextFieldId, string>;

/** What a nested group must hold before a text field can be written into it. */
const GROUP_DEFAULTS: Record<string, Record<string, unknown>> = {
  pastMedicalHistory: { chronicConditions: [] },
  drugHistory: { allergies: [] },
};

export function recordFormValues(record: MedicalRecordDoc): RecordFormValues {
  const source = record as unknown as Record<string, unknown>;
  const values = {} as RecordFormValues;
  for (const id of TEXT_FIELD_IDS) {
    const [head, tail] = id.split('.');
    const raw = tail ? (source[head] as Record<string, unknown> | undefined)?.[tail] : source[head];
    values[id] = typeof raw === 'string' ? raw : '';
  }
  return values;
}

/** Only what changed, so an untouched draft signs without a second write. */
export function recordFormPatch(record: MedicalRecordDoc, values: RecordFormValues): Partial<MedicalRecordDoc> {
  const initial = recordFormValues(record);
  const source = record as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const id of TEXT_FIELD_IDS) {
    if (values[id] === initial[id]) continue;
    const [head, tail] = id.split('.');
    if (!tail) { patch[head] = values[id]; continue; }
    const group = (patch[head] ?? source[head] ?? GROUP_DEFAULTS[head] ?? {}) as Record<string, unknown>;
    patch[head] = { ...group, [tail]: values[id] };
  }
  const followUp = patch.followUp as { date?: string; reason?: string } | undefined;
  if (followUp && !followUp.date && !followUp.reason) patch.followUp = undefined;
  return patch as Partial<MedicalRecordDoc>;
}

/** A diagnosis picked here, coded the way the note editor codes one. */
export function codedDiagnosis(code: string, name: string, primary: boolean): Diagnosis {
  return { icd10Code: code, icd11Code: code, codeSystem: 'ICD-11-MMS', name, type: primary ? 'primary' : 'secondary', certainty: 'confirmed', severity: 'moderate' };
}

export default function RecordSignPanel({ record, intent = 'view', onClose, onChanged }: {
  record: MedicalRecordDoc;
  intent?: RecordPanelIntent;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  const [values, setValues] = useState(() => recordFormValues(record));
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>(() => record.diagnoses || []);
  const [dxSearch, setDxSearch] = useState('');
  const icdOptions = useMemo(() => COMMON_ICD11_CODES.map(c => ({ code: c.code, name: c.title, meta: c.chapter, keywords: c.keywords })), []);
  const [addendum, setAddendum] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addendumRef = useRef<HTMLTextAreaElement>(null);

  const status = record.documentStatus ?? 'draft';
  const role = currentUser?.role;
  const { isProvider, isTrainee, canAuthor } = recordSignRights(role);
  // A saved draft opens locked; Edit is the deliberate step into changing it,
  // and belongs to whoever wrote it or oversees documentation.
  const [unlocked, setUnlocked] = useState(false);
  const mayEdit = status === 'draft' && canAuthor && canEditRecordDraft(record, currentUser);
  const draftLocked = status === 'draft' && !unlocked;
  const editable = mayEdit && unlocked;
  const canCosign = status === 'awaiting_cosign' && isProvider;
  const canAddend = (status === 'signed' || status === 'amended') && canAuthor;
  const signer = {
    userId: currentUser?._id,
    userName: currentUser?.name || currentUser?.username || 'Unknown',
    userRole: role,
  };

  useEffect(() => {
    if (intent !== 'addendum') return;
    addendumRef.current?.scrollIntoView({ block: 'center' });
    addendumRef.current?.focus({ preventScroll: true });
  }, [intent]);

  const notRecorded = t('recordSign.notRecorded');
  const set = (id: TextFieldId) => (value: string) => setValues(prev => ({ ...prev, [id]: value }));

  const shown = (label: ReactNode, value: ReactNode, wide = false) => (
    <O3Question label={label} wide={wide}>
      <div className="rsp-value">{value || <span className="rsp-empty">{notRecorded}</span>}</div>
    </O3Question>
  );
  const text = (id: TextFieldId, labelKey: string, multiline = true) => (editable
    ? <O3TextField id={`rsp-${id}`} label={t(labelKey)} value={values[id]} onChange={set(id)} multiline={multiline} wide={multiline} />
    : shown(t(labelKey), values[id], multiline));
  const list = (lines: string[]) => (lines.length > 0 ? <ul className="rsp-list">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul> : null);
  const line = (...parts: (string | number | undefined | null | false)[]) => parts.filter(Boolean).join(' · ');
  const diagnosisLine = (d: Diagnosis) => line(d.name, d.icd11Code || d.icd10Code, d.type && humanizeStatus(d.type), d.certainty && humanizeStatus(d.certainty), d.severity && humanizeStatus(d.severity));
  const yesNo = (value?: boolean) => (value === undefined ? '' : t(value ? 'recordSign.yes' : 'recordSign.no'));

  const vitals = record.vitalSigns;
  const triage = record.triageVitals;
  const measured = (value: number | undefined, fallback: string | undefined, unit = '') => {
    const reading = value || fallback;
    return reading ? `${reading}${unit ? ` ${unit}` : ''}` : '';
  };
  const systolic = vitals?.systolic || triage?.systolic;
  const diastolic = vitals?.diastolic || triage?.diastolic;
  const pmh = record.pastMedicalHistory;
  const social = record.socialHistory;
  const drugs = record.drugHistory;

  const sections: O3LayoutSection[] = [
    {
      id: 'visit',
      label: t('recordSign.sectionVisit'),
      body: (
        <div className="rsp-grid">
          {shown(t('recordSign.visitDate'), formatDateTime(record.consultedAt || record.visitDate || record.createdAt))}
          {shown(t('recordSign.visitType'), record.visitType ? humanizeStatus(record.visitType) : '')}
          {shown(t('recordSign.provider'), line(record.providerName, record.providerRole && humanizeStatus(record.providerRole)))}
          {shown(t('recordSign.department'), record.department)}
          {shown(t('recordSign.facility'), record.hospitalName)}
          {shown(t('recordSign.disposition'), record.visitDisposition ? humanizeStatus(record.visitDisposition) : '')}
        </div>
      ),
    },
    {
      id: 'complaint',
      label: t('recordSign.sectionComplaint'),
      body: (
        <div className="rsp-grid">
          {text('chiefComplaint', 'recordSign.chiefComplaint')}
          {(record.chiefComplaints?.length ?? 0) > 0 && shown(t('recordSign.otherComplaints'), list(record.chiefComplaints || []), true)}
          {text('historyOfPresentIllness', 'recordSign.hpi')}
        </div>
      ),
    },
    {
      id: 'ros',
      label: t('recordSign.sectionRos'),
      body: (
        <div className="rsp-grid">
          <div className="rsp-value o3f-field--wide">
            {list(Object.entries(record.reviewOfSystems || {}).map(([system, entry]) => line(humanizeStatus(system), humanizeStatus(entry.status), entry.findings)))
              || <span className="rsp-empty">{notRecorded}</span>}
          </div>
        </div>
      ),
    },
    {
      id: 'history',
      label: t('recordSign.sectionHistory'),
      body: (
        <div className="rsp-grid">
          {shown(t('recordSign.chronicConditions'), list(pmh?.chronicConditions || []), true)}
          {text('pastMedicalHistory.pastAdmissions', 'recordSign.pastAdmissions')}
          {text('pastMedicalHistory.pastSurgeries', 'recordSign.pastSurgeries')}
          {shown(t('recordSign.bloodTransfusion'), yesNo(pmh?.bloodTransfusion))}
          {text('pastMedicalHistory.notes', 'recordSign.historyNotes')}
          {text('familyHistory', 'recordSign.familyHistory')}
          {shown(t('recordSign.smoking'), social?.smoking ? humanizeStatus(social.smoking) : '')}
          {shown(t('recordSign.alcohol'), social?.alcohol ? humanizeStatus(social.alcohol) : '')}
          {text('socialHistory.occupation', 'recordSign.occupation', false)}
          {text('socialHistory.substanceUse', 'recordSign.substanceUse', false)}
          {shown(t('recordSign.insurance'), line(yesNo(social?.hasHealthInsurance), social?.insuranceProvider))}
          {shown(t('recordSign.socioeconomic'), social?.socioeconomicStatus ? humanizeStatus(social.socioeconomicStatus) : '')}
          {text('socialHistory.notes', 'recordSign.socialNotes')}
          {text('drugHistory.chronicMedications', 'recordSign.chronicMedications')}
          {shown(t('recordSign.allergies'), drugs?.noKnownAllergies ? t('recordSign.noKnownAllergies') : list(drugs?.allergies || []), true)}
        </div>
      ),
    },
    {
      id: 'vitals',
      label: t('recordSign.sectionVitals'),
      body: (
        <div className="rsp-grid rsp-grid--3">
          {shown(t('recordSign.temperature'), measured(vitals?.temperature, triage?.temperature, '°C'))}
          {shown(t('recordSign.bloodPressure'), systolic && diastolic ? `${systolic}/${diastolic} mmHg` : '')}
          {shown(t('recordSign.pulse'), measured(vitals?.pulse, triage?.pulse, 'bpm'))}
          {shown(t('recordSign.respiratoryRate'), measured(vitals?.respiratoryRate, triage?.respiratoryRate, '/min'))}
          {shown(t('recordSign.oxygenSaturation'), measured(vitals?.oxygenSaturation, triage?.oxygenSaturation, '%'))}
          {shown(t('recordSign.weight'), measured(vitals?.weight, triage?.weight, 'kg'))}
          {shown(t('recordSign.height'), measured(vitals?.height, triage?.height, 'cm'))}
          {shown(t('recordSign.bmi'), measured(vitals?.bmi, triage?.bmi))}
          {shown(t('recordSign.muac'), measured(vitals?.muac, triage?.muac, 'cm'))}
          {shown(t('recordSign.painScore'), measured(vitals?.painScore, undefined, '/10'))}
          {shown(t('recordSign.bloodGlucose'), measured(vitals?.bloodGlucose, triage?.bloodGlucose, 'mmol/L'))}
          {shown(t('recordSign.gcs'), measured(vitals?.gcs, undefined, '/15'))}
        </div>
      ),
    },
    {
      id: 'exam',
      label: t('recordSign.sectionExam'),
      body: (
        <div className="rsp-grid">
          {text('physicalExamination.general', 'recordSign.examGeneral')}
          {text('physicalExamination.cardiovascular', 'recordSign.examCardiovascular')}
          {text('physicalExamination.respiratory', 'recordSign.examRespiratory')}
          {text('physicalExamination.abdominal', 'recordSign.examAbdominal')}
          {text('physicalExamination.neurological', 'recordSign.examNeurological')}
        </div>
      ),
    },
    {
      id: 'assessment',
      label: t('recordSign.sectionAssessment'),
      body: (
        <div className="rsp-grid">
          {editable ? (
            <O3Question label={t('recordSign.diagnoses')} wide>
              {diagnoses.length > 0 && (
                <ul className="rsp-list rsp-dx">
                  {diagnoses.map((d, i) => (
                    <li key={`${d.name}-${i}`}>
                      <span>{diagnosisLine(d)}</span>
                      <button type="button" aria-label={t('recordSign.removeDiagnosis', { name: d.name })} onClick={() => setDiagnoses(prev => prev.filter((_, at) => at !== i))}><X aria-hidden /></button>
                    </li>
                  ))}
                </ul>
              )}
              <CodedSearchField
                label=""
                placeholder={t('recordSign.addDiagnosis')}
                options={icdOptions}
                value={dxSearch}
                onChange={setDxSearch}
                onSelect={c => {
                  setDiagnoses(prev => [...prev, codedDiagnosis(c.code, c.name, prev.length === 0)]);
                  setDxSearch('');
                }}
                excludeCodes={diagnoses.map(d => d.icd11Code || d.icd10Code)}
              />
            </O3Question>
          ) : shown(t('recordSign.diagnoses'), list(diagnoses.map(diagnosisLine)), true)}
          {shown(t('recordSign.prescriptions'), list((record.prescriptions || []).map(rx => line(rx.drugName, rx.dose, rx.route, rx.frequency, rx.duration, rx.instructions))), true)}
          {shown(t('recordSign.labResults'), list((record.labResults || []).map(lab => line(lab.testName, [lab.result, lab.unit].filter(Boolean).join(' '), lab.referenceRange, lab.critical ? t('timeline.badgeCritical') : lab.abnormal && t('timeline.badgeAbnormal')))), true)}
          {text('treatmentPlan', 'recordSign.treatmentPlan')}
          {editable ? (
            <O3Question label={t('recordSign.followUpDate')} htmlFor="rsp-followUp.date">
              <input id="rsp-followUp.date" type="date" className="o3f-input" value={values['followUp.date']} onChange={e => set('followUp.date')(e.target.value)} />
            </O3Question>
          ) : shown(t('recordSign.followUpDate'), values['followUp.date'] ? formatDate(values['followUp.date']) : '')}
          {text('followUp.reason', 'recordSign.followUpReason', false)}
          {(record.attachments?.length ?? 0) > 0 && shown(t('recordSign.attachments'), list((record.attachments || []).map(a => a.name)), true)}
        </div>
      ),
    },
    {
      id: 'signature',
      label: t('recordSign.sectionSignature'),
      body: (
        <div className="rsp-grid">
          {shown(t('recordSign.status'), t(`recordSign.status.${status}`))}
          {shown(t('recordSign.signedBy'), record.signedAt ? line(record.signedByName, formatDateTime(record.signedAt)) : '')}
          {record.cosignedByName && shown(t('recordSign.cosignedBy'), line(record.cosignedByName, record.cosignedAt && formatDateTime(record.cosignedAt)))}
          {(record.addenda?.length ?? 0) > 0 && shown(t('recordSign.addenda'), (
            <ul className="rsp-addenda">
              {(record.addenda || []).map((a, i) => (
                <li key={i}>
                  <span>{line(a.authorName, formatDateTime(a.createdAt))}</span>
                  <p>{a.text}</p>
                </li>
              ))}
            </ul>
          ), true)}
          {canAddend && (
            <O3Question label={t('noteViewer.addAddendum')} htmlFor="rsp-addendum" wide>
              <textarea
                id="rsp-addendum"
                ref={addendumRef}
                className="o3f-input"
                rows={3}
                value={addendum}
                placeholder={t('noteViewer.addendumPlaceholder')}
                onChange={e => setAddendum(e.target.value)}
              />
            </O3Question>
          )}
        </div>
      ),
    },
  ];

  async function run(work: () => Promise<unknown>, doneKey: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result === null) throw new Error(t('msg.changeNotSavedTryAgain'));
      showToast(t(doneKey), 'success');
      onChanged?.();
      onClose();
    } catch (e) {
      setError(describeError(e, t('msg.changeNotSavedTryAgain')));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const service = () => import('@/lib/services/medical-record-service');
  /** Writes the draft's edits. Null when the record could not be saved. */
  const saveEdits = async () => {
    const patch = recordFormPatch(record, values);
    if (JSON.stringify(diagnoses) !== JSON.stringify(record.diagnoses || [])) patch.diagnoses = diagnoses;
    if (Object.keys(patch).length === 0) return record;
    return (await service()).updateMedicalRecord(record._id, patch);
  };
  const sign = async () => {
    if ((await saveEdits()) === null) return null;
    // Providers sign as final; trainees sign and route for co-signature.
    return (await service()).signMedicalRecord(record._id, signer, { awaitingCosign: isTrainee && !isProvider });
  };

  const footer = (() => {
    if (confirming) {
      return (
        <>
          <p className="rsp-confirm">{t(canCosign ? 'recordSign.cosignConfirm' : 'recordSign.signConfirm')}</p>
          <div className="sv-footer rsp-footer">
            <button type="button" className="sv-footer-btn sv-footer-btn--discard" disabled={busy} onClick={() => setConfirming(false)}>{t('action.cancel')}</button>
            <button
              type="button"
              className="sv-footer-btn sv-footer-btn--primary"
              disabled={busy}
              onClick={() => (canCosign
                ? run(async () => (await service()).cosignMedicalRecord(record._id, signer), 'recordSign.cosigned')
                : run(sign, isProvider ? 'recordSign.signed' : 'recordSign.routedForCosign'))}
            >
              {t('recordSign.confirm')}
            </button>
          </div>
        </>
      );
    }
    return (
      <div className="sv-footer rsp-footer">
        <button type="button" className="sv-footer-btn sv-footer-btn--discard" disabled={busy} onClick={onClose}>
          {t(editable || canAddend ? 'action.cancel' : 'recordSign.close')}
        </button>
        {draftLocked && mayEdit && (
          <button type="button" className="sv-footer-btn sv-footer-btn--primary" onClick={() => setUnlocked(true)}>
            {t('noteViewer.edit')}
          </button>
        )}
        {editable && (
          <button type="button" className="sv-footer-btn sv-footer-btn--discard" disabled={busy} onClick={() => run(saveEdits, 'recordSign.draftSaved')}>
            {t('recordSign.saveDraft')}
          </button>
        )}
        {editable && (
          <button type="button" className="sv-footer-btn sv-footer-btn--primary" disabled={busy} onClick={() => setConfirming(true)}>
            {t(isProvider ? 'noteEditor.sign' : 'recordSign.signRoute')}
          </button>
        )}
        {canCosign && (
          <button type="button" className="sv-footer-btn sv-footer-btn--primary" disabled={busy} onClick={() => setConfirming(true)}>
            {t('recordSign.cosign')}
          </button>
        )}
        {canAddend && (
          <button
            type="button"
            className="sv-footer-btn sv-footer-btn--primary"
            disabled={busy || addendum.trim().length === 0}
            onClick={() => run(async () => (await service()).addAddendum(record._id, addendum, signer), 'recordSign.addendumSaved')}
          >
            {t('recordSign.saveAddendum')}
          </button>
        )}
      </div>
    );
  })();

  return (
    <div className="rsp">
      {draftLocked && (
        <InlineBanner compact title={t('chart.locked')}>
          {mayEdit ? t('noteViewer.lockedHint') : null}
        </InlineBanner>
      )}
      <div className="rsp-scroll">
        <O3Layout pages={[{ id: 'record', label: t('recordSign.title'), sections }]} />
      </div>
      {error && <FormError message={error} />}
      {footer}
    </div>
  );
}
