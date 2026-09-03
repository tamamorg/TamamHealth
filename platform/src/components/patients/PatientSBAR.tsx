'use client';

/**
 * PatientSBAR — auto-generated SBAR handoff document.
 *
 * SBAR = Situation, Background, Assessment, Recommendation. Standard
 * shift-handover format used worldwide; the WHO and the Joint Commission
 * both call it out as the single most effective intervention against
 * preventable harm at handoff (the leading cause of in-hospital error).
 *
 * This component composes the document from the live chart — no manual
 * entry. A nurse going off shift prints this; the night nurse reads it.
 *
 * Presentation mirrors the triage form the way it was filled: the OpenMRS
 * `omrs-reg` layout — a left step-nav rail (patient card + the same seven
 * sections the nurse fills, in the same order) beside stacked field slabs —
 * rendered read-only. So the handoff reads as the triage form itself rather
 * than as a separate document, with the priority badge and allergy strip
 * leading the way they do on the filled sheet.
 */

import { useMemo } from 'react';
import { Printer, ShieldAlert } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type {
  PatientDoc, MedicalRecordDoc, LabResultDoc, PrescriptionDoc, TriageDoc, ProblemDoc,
} from '@/lib/db-types';
import { formatDateTime , formatRxSig } from '@/lib/format-utils';
import { patientAge, patientFullName } from '@/lib/patient-utils';
import { priorityBadge, priorityLabel } from '@/lib/clinical/triage-display';
import { mergeVitalsTimeline } from '@/lib/clinical/vitals';
import { formatPhoneDisplay } from '@/lib/field-formats';
import type { PatientShiftHandoff } from '@/lib/hooks/usePatientHandoff';
import { printElementById } from '@/lib/safe-html';
import { IITT_RED_CRITERIA, IITT_YELLOW_CRITERIA, INFECTION_RISK_SIGNS } from '@/lib/clinical/iitt';
import { extractManualPriorityRaise } from '@/components/nurse/triage-intake-notes';

const IITT_RED_LABELS = new Map<string, string>(IITT_RED_CRITERIA);
const IITT_YELLOW_LABELS = new Map<string, string>(IITT_YELLOW_CRITERIA);
const INFECTION_RISK_LABELS = new Map<string, string>(INFECTION_RISK_SIGNS);

interface PatientSBARProps {
  patient: PatientDoc;
  records: MedicalRecordDoc[];
  labs: LabResultDoc[];
  prescriptions: PrescriptionDoc[];
  triages: TriageDoc[];
  problems: ProblemDoc[];
  latestShiftHandoff?: PatientShiftHandoff | null;
}

/** A heading inside a section body, for the sub-lists (vitals, critical labs). */
function SubHead({ icon, tone, children }: { icon?: React.ReactNode; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <div className="sbar-subhead" data-tone={tone}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="sbar-tile">
      <span className="sbar-tile-label">{label}</span>
      <span className="sbar-tile-value">{value}</span>
    </div>
  );
}

const ABCC_LABELS = {
  airway: { clear: 'Clear', obstructed: 'Obstructed', not_assessed: 'Not assessed' },
  breathing: { normal: 'Normal', distressed: 'Distressed', absent: 'Absent', not_assessed: 'Not assessed' },
  circulation: { normal: 'Normal', impaired: 'Impaired', absent: 'Absent', not_assessed: 'Not assessed' },
  consciousness: { alert: 'Alert', verbal: 'Responds to voice', pain: 'Responds to pain', unresponsive: 'Unresponsive', not_assessed: 'Not assessed' },
} as const;

function abccTone(value: string): 'normal' | 'warning' | 'danger' | 'muted' {
  if (value === 'clear' || value === 'normal' || value === 'alert') return 'normal';
  if (value === 'not_assessed') return 'muted';
  if (value === 'impaired' || value === 'distressed' || value === 'verbal') return 'warning';
  return 'danger';
}

function TriageAssessment({ triage }: { triage: TriageDoc }) {
  const items = [
    ['Airway', ABCC_LABELS.airway[triage.airway], triage.airway],
    ['Breathing', ABCC_LABELS.breathing[triage.breathing], triage.breathing],
    ['Circulation', ABCC_LABELS.circulation[triage.circulation], triage.circulation],
    ['Consciousness', ABCC_LABELS.consciousness[triage.consciousness], triage.consciousness],
  ] as const;

  return (
    <div className="sbar-triage-grid" aria-label="Latest triage ABCC assessment">
      {items.map(([label, value, raw]) => (
        <div key={label} className="sbar-triage-card" data-tone={abccTone(raw)}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function displayVital(value: string | number | undefined, suffix = ''): string {
  return value === undefined || value === '' ? '—' : `${value}${suffix}`;
}

function TriageField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="sbar-triage-field">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );
}

/**
 * A read-only field rendered to look like a filled triage-form input: a small
 * label above a value sitting on the same underlined field surface the form
 * uses, so this handoff reads as the triage form the way it was entered.
 */
function RoField({ label, value, full }: { label: string; value?: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sbar-ro-field sbar-ro-field--full' : 'sbar-ro-field'}>
      <span className="sbar-ro-label">{label}</span>
      <span className="sbar-ro-value">{value === undefined || value === null || value === '' ? '—' : value}</span>
    </div>
  );
}

/** One OpenMRS-styled form section: heading + description over the field slab. */
function FormSection({ id, title, description, children }: {
  id: string; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="omrs-reg-section">
      <div className="omrs-reg-sectionhead"><h2>{title}</h2><p>{description}</p></div>
      <div className="omrs-reg-fields">{children}</div>
    </section>
  );
}

/**
 * "Why this priority" — every structured triage danger sign is write-only in
 * the form (a nurse ticks it, a RED badge appears) unless this renders it
 * back out. Without this a doctor scanning a RED patient's chart saw the
 * colour and nothing that produced it: which IITT criteria fired, whether
 * isolation was called for, or that the nurse manually raised the priority
 * (or downgraded it) past what the structured findings alone justified.
 */
function TriagePriorityExplain({ triage }: { triage: TriageDoc }) {
  const redLabels = (triage.redCriteria || []).map(code => IITT_RED_LABELS.get(code) || code);
  const yellowLabels = (triage.yellowCriteria || []).map(code => IITT_YELLOW_LABELS.get(code) || code);
  const infectionLabels = (triage.infectionRiskSigns || []).map(code => INFECTION_RISK_LABELS.get(code) || code);
  const manualRaise = extractManualPriorityRaise(triage.notes);
  const hasContent = redLabels.length > 0 || yellowLabels.length > 0 || infectionLabels.length > 0
    || triage.isolationRequired || triage.capillaryRefillSeconds || triage.immediateInterventions
    || triage.preArrivalCare || (triage.vitalUrgencyWarnings?.length ?? 0) > 0
    || triage.vitalUrgencyOverridden || manualRaise;
  if (!hasContent) return null;

  return (
    <div className="sbar-block" aria-label="Why this triage priority">
      <SubHead icon={<ShieldAlert className="w-3.5 h-3.5" />}>Why this priority</SubHead>

      {triage.isolationRequired && (
        <p className="sbar-para">
          <span className="sbar-critical">ISOLATION — separate immediately and apply facility IPC pathway.</span>
        </p>
      )}

      {redLabels.length > 0 && (
        <div className="sbar-block">
          <span className="sbar-fact-label">Red danger signs</span>
          <ul className="sbar-chips">
            {redLabels.map(label => <li key={label} data-tone="danger">{label}</li>)}
          </ul>
        </div>
      )}

      {yellowLabels.length > 0 && (
        <div className="sbar-block">
          <span className="sbar-fact-label">Yellow danger signs</span>
          <ul className="sbar-chips">
            {yellowLabels.map(label => <li key={label} data-tone="warning">{label}</li>)}
          </ul>
        </div>
      )}

      {infectionLabels.length > 0 && (
        <div className="sbar-block">
          <span className="sbar-fact-label">Infection / outbreak risk</span>
          <ul className="sbar-chips">
            {infectionLabels.map(label => <li key={label}>{label}</li>)}
          </ul>
        </div>
      )}

      <div className="sbar-triage-fields">
        {triage.capillaryRefillSeconds && <TriageField label="Capillary refill" value={`${triage.capillaryRefillSeconds}s`} />}
        {triage.immediateInterventions && <TriageField label="Immediate interventions" value={triage.immediateInterventions} />}
        {triage.preArrivalCare && <TriageField label="Care before arrival" value={triage.preArrivalCare} />}
      </div>

      {(triage.vitalUrgencyWarnings?.length ?? 0) > 0 && (
        <div className="sbar-block">
          <span className="sbar-fact-label">Vital-sign safety warnings</span>
          <ul className="sbar-rows">
            {triage.vitalUrgencyWarnings!.map(warning => (
              <li key={warning.code}>
                <span className="sbar-row-main">{warning.urgency}: {warning.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {triage.vitalUrgencyOverridden && (
        <p className="sbar-para">
          <span className="sbar-critical">Saved below the recommended {triage.vitalUrgencyRecommendation || 'higher'} urgency</span> — {triage.vitalUrgencyOverrideReason || 'no reason recorded'}
          <span className="sbar-muted"> — recorded by {triage.triagedByName || 'unknown clinician'}</span>
        </p>
      )}

      {manualRaise && (
        <p className="sbar-para">
          <span className="sbar-critical">Priority raised to {manualRaise.priority} by nurse</span> — {manualRaise.reason}
          <span className="sbar-muted"> — recorded by {triage.triagedByName || 'unknown clinician'}</span>
        </p>
      )}
    </div>
  );
}

export default function PatientSBAR({
  patient, records, labs, prescriptions, triages, problems, latestShiftHandoff,
}: PatientSBARProps) {
  const { t } = useTranslation();
  const age = patientAge(patient);
  const fullName = patientFullName(patient);
  const recordedAllergies = (patient.structuredAllergies ?? (patient.allergies || []).map((substance, index) => ({ id: `${index}`, substance, status: 'active' as const })))
    .filter(a => a.status === 'active' && a.substance && a.substance.toLowerCase() !== 'none known' && a.substance.toLowerCase() !== 'none')
    .map(a => a.substance);
  const chronic = (patient.chronicConditions || []).filter(c => c && c.toLowerCase() !== 'none');

  const latestTriage = useMemo(
    () => [...triages].sort((a, b) => (b.triagedAt || b.createdAt || '').localeCompare(a.triagedAt || a.createdAt || ''))[0],
    [triages],
  );
  const latestRecord = useMemo(
    () => [...records].sort((a, b) => (b.consultedAt || b.visitDate || b.createdAt || '').localeCompare(a.consultedAt || a.visitDate || a.createdAt || ''))[0],
    [records],
  );
  const latestVitals = useMemo(() => mergeVitalsTimeline(records, triages)[0], [records, triages]);
  const allergies = recordedAllergies.length > 0
    ? recordedAllergies
    : (latestTriage?.knownAllergies || '')
        .split(/[,;]/)
        .map(value => value.trim())
        .filter(value => value && !/^none( known)?$/i.test(value));
  const activeProblems = useMemo(
    () => problems.filter(p => p.status === 'active' || p.status === 'chronic'),
    [problems],
  );
  const activeRx = useMemo(
    () => prescriptions.filter(p => p.status === 'pending'),
    [prescriptions],
  );
  const recentCriticalLabs = useMemo(
    () => labs.filter(l => l.critical && l.status === 'completed').slice(0, 5),
    [labs],
  );
  const pendingLabs = useMemo(
    () => labs.filter(l => l.status === 'pending' || l.status === 'in_progress').slice(0, 5),
    [labs],
  );

  const handlePrint = () => { printElementById('patient-sbar-print'); };

  const genderAge = [patient.gender, age != null ? `${age}y` : null].filter(Boolean).join(' · ');
  const dangerCount = (latestTriage?.redCriteria?.length || 0) + (latestTriage?.yellowCriteria?.length || 0);

  const priorityMeta = latestTriage ? priorityBadge(latestTriage.priority) : null;

  return (
    <div id="patient-sbar-print" className="sbar-doc sbar-as-form omrs-reg triage-reg">
      {/* No left rail: the chart's own rail already names this section, and the
          patient card repeated the header two rows above it. The record itself
          reads top to bottom, so the step-nav had nothing to navigate that
          scrolling doesn't. Print moves in beside the record it prints. */}
      <div className="omrs-reg-form triage-reg-form sbar-as-form-body">
        {/* Print sits with the record now that the rail is gone. `no-print`
            keeps the control itself out of the printed sheet. */}
        <div className="sbar-form-actions no-print">
          <button type="button" onClick={handlePrint} className="btn btn-secondary btn-sm">
            <Printer /> {t('action.print')}
          </button>
        </div>
        {/* Priority and allergies lead — the two facts that change what is safe
            to do next, sitting above the form the way the badge and the allergy
            banner do on the filled sheet. */}
        {priorityMeta && (
          <div className="sbar-form-priority" style={{ color: priorityMeta.color, background: priorityMeta.bg }}>
            <strong>{priorityLabel(latestTriage!.priority)}</strong>
            <span>{latestTriage!.priority} priority · {latestTriage!.status}</span>
          </div>
        )}
        <div className={allergies.length ? 'sbar-allergies is-alert' : 'sbar-allergies'}>
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="sbar-allergies-label">{t('patientNew.reviewAllergies')}</span>
          {allergies.length === 0 ? (
            <span className="sbar-allergies-none">{t('patient.noneKnown')}</span>
          ) : (
            <span className="sbar-allergies-list">{allergies.map(a => <em key={a}>{a}</em>)}</span>
          )}
        </div>

        <FormSection id="sbar-section-patient" title="Patient & complaint" description="Who the patient is and why they came in.">
          <div className="sbar-ro-grid">
            <RoField label="Patient" value={fullName} />
            <RoField label="Hospital number" value={patient.hospitalNumber} />
            <RoField label="Sex / Age" value={genderAge} />
            <RoField label="Chief complaint" value={latestTriage?.chiefComplaint || latestRecord?.chiefComplaint} full />
            <RoField label="Symptom duration" value={latestTriage?.symptomDuration} />
            <RoField label="Mode of arrival" value={latestTriage?.modeOfArrival?.replace('-', ' ')} />
            <RoField label="Referral source" value={latestTriage?.referralSource} />
            {latestTriage && <RoField label="Triaged by" value={latestTriage.triagedByName || 'Unknown clinician'} />}
            {latestTriage && <RoField label="Date and time" value={formatDateTime(latestTriage.triagedAt)} />}
            {latestTriage && <RoField label="Assessment source" value={latestTriage.assessmentSource === 'clerical_checkin' ? 'Clerical check-in' : 'Clinician ETAT'} />}
          </div>
        </FormSection>

        <FormSection id="sbar-section-assessment" title="ABCC assessment" description="Airway, breathing, circulation, consciousness — and the priority they set.">
          {latestTriage ? (
            <TriageAssessment triage={latestTriage} />
          ) : (
            <p className="sbar-para sbar-muted">{t('sbar.noActiveSituation')}</p>
          )}
        </FormSection>

        <FormSection id="sbar-section-danger" title="IITT danger signs" description="Red and yellow criteria, the infection screen, and what set this priority.">
          {latestTriage ? (
            <>
              <TriagePriorityExplain triage={latestTriage} />
              {dangerCount === 0 && !latestTriage.isolationRequired && (
                <p className="sbar-para sbar-muted">No danger signs recorded.</p>
              )}
            </>
          ) : (
            <p className="sbar-para sbar-muted">No triage danger-sign screen on file.</p>
          )}
        </FormSection>

        <FormSection id="sbar-section-vitals" title="Vitals" description={latestVitals ? `Observations · ${latestVitals.source} · ${formatDateTime(latestVitals.at)}` : 'Observations recorded at triage.'}>
          {latestVitals ? (
            <div className="sbar-tiles">
              <Tile label={t('sbar.vitalTemp')} value={displayVital(latestVitals.temperature, '°C')} />
              <Tile label={t('sbar.vitalBp')} value={latestVitals.systolic !== undefined && latestVitals.diastolic !== undefined ? `${latestVitals.systolic}/${latestVitals.diastolic}` : '—'} />
              <Tile label={t('sbar.vitalPulse')} value={displayVital(latestVitals.pulse)} />
              <Tile label={t('sbar.vitalRr')} value={displayVital(latestVitals.respiratoryRate)} />
              <Tile label={t('sbar.vitalSpo2')} value={displayVital(latestVitals.oxygenSaturation, '%')} />
              <Tile label={t('sbar.vitalWt')} value={displayVital(latestVitals.weight, ' kg')} />
              {latestVitals.source === 'Triage' && latestTriage?.painScore && <Tile label="Pain" value={`${latestTriage.painScore}/10`} />}
              {latestVitals.source === 'Triage' && latestTriage?.gcs && <Tile label="GCS" value={latestTriage.gcs} />}
            </div>
          ) : (
            <p className="sbar-para sbar-muted">{t('sbar.noVitals')}</p>
          )}
        </FormSection>

        <FormSection id="sbar-section-context" title="Visit context" description="Background that shapes care — history, medications, and next of kin.">
          <div className="sbar-ro-grid">
            <RoField label={t('patient.bloodType')} value={patient.bloodType || undefined} />
            <RoField label="Known allergies" value={allergies.length ? allergies.join(', ') : t('patient.noneKnown')} full />
          </div>
          {(activeProblems.length > 0 || chronic.length > 0) && (
            <div className="sbar-block">
              <SubHead>{t('sbar.activeProblems')}</SubHead>
              <ul className="sbar-chips">
                {(activeProblems.length ? activeProblems.map(p => p.name) : chronic).map(name => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          )}
          {activeRx.length > 0 && (
            <div className="sbar-block">
              <SubHead>{t('patient.medications')} · {activeRx.length}</SubHead>
              <ul className="sbar-rows">
                {activeRx.map(rx => (
                  <li key={rx._id}>
                    <span className="sbar-row-main">{rx.medication}</span>
                    <span className="sbar-muted">{formatRxSig(rx)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recentCriticalLabs.length > 0 && (
            <div className="sbar-block">
              <SubHead tone="danger" icon={<ShieldAlert className="w-3.5 h-3.5" />}>{t('sbar.criticalLabResults')}</SubHead>
              <ul className="sbar-rows">
                {recentCriticalLabs.map(l => (
                  <li key={l._id}>
                    <span className="sbar-row-main">{l.testName}<span className="sbar-muted"> · {t('sbar.refRange')} {l.referenceRange} · {formatDateTime(l.completedAt)}</span></span>
                    <span className="sbar-critical">{l.result} {l.unit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {patient.nokName && (
            <div className="sbar-ro-grid">
              <RoField label={t('patient.nextOfKin')} value={`${patient.nokName}${patient.nokRelationship ? ` (${patient.nokRelationship})` : ''}`} />
              <RoField label="Contact" value={formatPhoneDisplay(patient.nokPhone)} />
            </div>
          )}
        </FormSection>

        <FormSection id="sbar-section-handoff" title="Provider handoff" description="Where the patient goes next, who receives them, and what is still open.">
          <div className="sbar-ro-grid">
            <RoField label="Destination" value={latestTriage?.disposition?.replace(/_/g, ' ')} />
            <RoField label="Clinic or service" value={latestTriage?.destinationClinic} />
            <RoField label="Receiving provider" value={latestTriage?.assignedProviderName || (latestTriage ? 'Assign provider later' : undefined)} />
            <RoField label="Handoff status" value={latestTriage?.handoffStatus?.replace(/_/g, ' ')} />
            <RoField label="Handoff note" value={latestTriage?.handoffNote} full />
          </div>
          {(pendingLabs.length > 0 || latestRecord?.followUp?.date || latestRecord?.treatmentPlan) && (
            <div className="sbar-ro-grid">
              {pendingLabs.length > 0 && <RoField label={t('sbar.pendingLabsFollowUp')} value={pendingLabs.map(l => l.testName).join(', ')} full />}
              {latestRecord?.followUp?.date && <RoField label={t('sbar.followUpScheduled')} value={`${latestRecord.followUp.date}${latestRecord.followUp.reason ? ` — ${latestRecord.followUp.reason}` : ''}`} full />}
              {latestRecord?.treatmentPlan && <RoField label={t('sbar.activePlan')} value={latestRecord.treatmentPlan} full />}
            </div>
          )}
          {latestShiftHandoff && (
            <div className="sbar-block">
              <SubHead>Latest shift handoff · {latestShiftHandoff.handoff.outgoingNurseName} · {latestShiftHandoff.handoff.shift} shift</SubHead>
              <div className="sbar-handoff-grid">
                {([
                  ['Situation', latestShiftHandoff.entry.situation],
                  ['Background', latestShiftHandoff.entry.background],
                  ['Assessment', latestShiftHandoff.entry.assessment],
                  ['Recommendation', latestShiftHandoff.entry.recommendation],
                ] as const).map(([label, value]) => value ? (
                  <div key={label} className="sbar-handoff-cell">
                    <span className="sbar-fact-label">{label}</span>
                    <p>{value}</p>
                  </div>
                ) : null)}
              </div>
            </div>
          )}
        </FormSection>

        <FormSection id="sbar-section-notes" title="Notes" description="Triage and clinical notes recorded with this assessment.">
          <div className="sbar-ro-grid">
            <RoField label="Triage notes" value={latestTriage?.notes} full />
            {latestRecord?.diagnoses && latestRecord.diagnoses.length > 0 && (
              <RoField label={t('sbar.latestDiagnoses')} full value={
                <span>{latestRecord.diagnoses.map((d, i) => (
                  <span key={i} className="sbar-inline-dx">{d.name}{[d.icd10Code, d.certainty, d.severity].filter(Boolean).length ? <em> ({[d.icd10Code, d.certainty, d.severity].filter(Boolean).join(' · ')})</em> : null}{i < latestRecord.diagnoses!.length - 1 ? '; ' : ''}</span>
                ))}</span>
              } />
            )}
          </div>
          <p className="sbar-disclaimer">{t('sbar.disclaimer')}</p>
        </FormSection>
      </div>
    </div>
  );
}
