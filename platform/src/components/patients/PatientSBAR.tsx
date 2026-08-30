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
 * Presentation is the chart's own: four `ChartSection` cards, the same chrome
 * Conditions/Allergies/Orders use, so the handoff reads as part of the chart
 * rather than as a document pasted into it. Deliberately absent: a title
 * repeating the patient's name (the sticky header above already names them,
 * and the printed copy carries its own identity block) and the row-divider
 * rules that turned four short facts into a ruled ledger.
 */

import { useMemo } from 'react';
import { Printer, ShieldAlert, Heart } from '@/components/icons/lucide';
import ChartSection from '@/components/ehr/chart/ChartSection';
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

/** A labelled fact on one line. No rule under it — the label carries the
 *  separation, and a divider per fact was reading as a table of one column. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sbar-fact">
      <span className="sbar-fact-label">{label}</span>
      <span className="sbar-fact-value">{children}</span>
    </div>
  );
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

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  return (
    <div className="sbar-doc space-y-2">
      {latestTriage && (
        <section className="sbar-triage-header" aria-label="Completed triage handoff">
          <div className="sbar-triage-header__top">
            <div>
              <span className="sbar-triage-kicker">Completed ETAT triage</span>
              <h2>SBAR handoff</h2>
            </div>
            <button type="button" className="omrs-section-add" onClick={handlePrint}><Printer /> {t('action.print')}</button>
          </div>
          <div
            className="sbar-triage-priority"
            style={{ color: priorityBadge(latestTriage.priority).color, background: priorityBadge(latestTriage.priority).bg }}
          >
            <strong>{priorityLabel(latestTriage.priority)}</strong>
            <span>{latestTriage.priority} priority · {latestTriage.status}</span>
          </div>
          <div className="sbar-triage-meta">
            <TriageField label="Triaged by" value={latestTriage.triagedByName || 'Unknown clinician'} />
            <TriageField label="Date and time" value={formatDateTime(latestTriage.triagedAt)} />
            <TriageField label="Facility" value={latestTriage.facilityName || patient.registrationHospital} />
            <TriageField label="Assessment source" value={latestTriage.assessmentSource === 'clerical_checkin' ? 'Clerical check-in' : 'Clinician ETAT'} />
          </div>
        </section>
      )}
      {/* Allergies lead the handoff. They are the one line here that changes
          what is safe to give, and SBAR convention puts them before the S. */}
      <div className={allergies.length ? 'sbar-allergies is-alert' : 'sbar-allergies'}>
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <span className="sbar-allergies-label">{t('patientNew.reviewAllergies')}</span>
        {allergies.length === 0 ? (
          <span className="sbar-allergies-none">{t('patient.noneKnown')}</span>
        ) : (
          <span className="sbar-allergies-list">
            {allergies.map(a => <em key={a}>{a}</em>)}
          </span>
        )}
      </div>

      {latestShiftHandoff && (
        <ChartSection
          title="Latest shift handoff"
          filterSlot={(
            <span className="omrs-panel-badge omrs-panel-badge--muted">
              {latestShiftHandoff.handoff.outgoingNurseName} · {latestShiftHandoff.handoff.shift} shift · {latestShiftHandoff.handoff.shiftDate}
            </span>
          )}
        >
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
          {latestShiftHandoff.entry.tasks?.length ? (
            <div className="sbar-block">
              <SubHead>Outstanding tasks</SubHead>
              <ul className="sbar-bullets">
                {latestShiftHandoff.entry.tasks.map(task => <li key={task}>{task}</li>)}
              </ul>
            </div>
          ) : null}
        </ChartSection>
      )}

      {/* Print rides the first section's action slot rather than a header card
          of its own — the same place every other chart section puts its verb. */}
      <ChartSection
        title={t('sbar.situationTitle')}
        className="sbar-triage-section"
        addLabel={latestTriage ? undefined : t('action.print')}
        addIcon={latestTriage ? undefined : <Printer />}
        onAdd={latestTriage ? undefined : handlePrint}
      >
        <p className="sbar-lede">
          {/* The name stays in the sentence — it is the clinical statement a
              nurse reads aloud at handoff — but no longer as a page title. */}
          <strong>{fullName}</strong>
          {age != null && <>, {t('sbar.yearOld', { age })} {patient.gender.toLowerCase()}</>}
          {patient.hospitalNumber && <span className="sbar-muted"> · {patient.hospitalNumber}</span>}
        </p>
        {latestTriage ? (
          <>
            <div className="sbar-triage-fields">
              <TriageField label="Chief complaint" value={latestTriage.chiefComplaint} />
              <TriageField label="Symptom duration" value={latestTriage.symptomDuration} />
              <TriageField label="Mode of arrival" value={latestTriage.modeOfArrival?.replace('-', ' ')} />
              <TriageField label="Referral source" value={latestTriage.referralSource} />
            </div>
          </>
        ) : latestRecord?.chiefComplaint ? (
          <p className="sbar-para">
            {t('sbar.lastConsult')} ({formatDateTime(latestRecord.consultedAt || latestRecord.visitDate)}):{' '}
            <em>{latestRecord.chiefComplaint}</em>
          </p>
        ) : (
          <p className="sbar-para sbar-muted">{t('sbar.noActiveSituation')}</p>
        )}
      </ChartSection>

      <ChartSection title={t('sbar.backgroundTitle')} className="sbar-triage-section">
        <Fact label={t('patient.bloodType')}>
          <strong>{patient.bloodType || t('consultation.unknown')}</strong>
        </Fact>

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

        {patient.nokName && (
          <Fact label={t('patient.nextOfKin')}>
            {patient.nokName}
            <span className="sbar-muted"> ({patient.nokRelationship}) · {formatPhoneDisplay(patient.nokPhone)}</span>
          </Fact>
        )}
      </ChartSection>

      <ChartSection title={t('sbar.assessmentTitle')} className="sbar-triage-section">
        {latestTriage && (
          <div className="sbar-block">
            <SubHead>Latest triage assessment</SubHead>
            <TriageAssessment triage={latestTriage} />
            <TriagePriorityExplain triage={latestTriage} />
            {latestTriage.notes && <p className="sbar-para"><strong>Clinical notes:</strong> {latestTriage.notes}</p>}
          </div>
        )}

        {latestVitals ? (
          <div className="sbar-block">
            <SubHead icon={<Heart className="w-3.5 h-3.5" />}>
              {t('sbar.latestVitals')} · {latestVitals.source} · {formatDateTime(latestVitals.at)}
            </SubHead>
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
          </div>
        ) : (
          <p className="sbar-para sbar-muted">{t('sbar.noVitals')}</p>
        )}

        {recentCriticalLabs.length > 0 && (
          <div className="sbar-block">
            <SubHead tone="danger" icon={<ShieldAlert className="w-3.5 h-3.5" />}>
              {t('sbar.criticalLabResults')}
            </SubHead>
            <ul className="sbar-rows">
              {recentCriticalLabs.map(l => (
                <li key={l._id}>
                  <span className="sbar-row-main">
                    {l.testName}
                    <span className="sbar-muted"> · {t('sbar.refRange')} {l.referenceRange} · {formatDateTime(l.completedAt)}</span>
                  </span>
                  <span className="sbar-critical">{l.result} {l.unit}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {latestRecord?.diagnoses && latestRecord.diagnoses.length > 0 && (
          <div className="sbar-block">
            <SubHead>{t('sbar.latestDiagnoses')}</SubHead>
            <ul className="sbar-rows">
              {latestRecord.diagnoses.map((d, i) => (
                <li key={i}>
                  <span className="sbar-row-main">{d.name}</span>
                  <span className="sbar-muted">{[d.icd10Code, d.certainty, d.severity].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ChartSection>

      <ChartSection title={t('sbar.recommendationTitle')} className="sbar-triage-section">
        {latestTriage && (
          <div className="sbar-triage-fields sbar-triage-fields--handoff">
            <TriageField label="Destination" value={latestTriage.disposition?.replace(/_/g, ' ')} />
            <TriageField label="Clinic or service" value={latestTriage.destinationClinic} />
            <TriageField label="Receiving provider" value={latestTriage.assignedProviderName || 'Assign provider later'} />
            <TriageField label="Handoff status" value={latestTriage.handoffStatus?.replace(/_/g, ' ')} />
            <TriageField label="Handoff note" value={latestTriage.handoffNote} />
            <TriageField label="Triage notes" value={latestTriage.notes} />
          </div>
        )}
        {pendingLabs.length > 0 && (
          <Fact label={t('sbar.pendingLabsFollowUp')}>{pendingLabs.map(l => l.testName).join(', ')}</Fact>
        )}
        {latestRecord?.followUp?.date && (
          <Fact label={t('sbar.followUpScheduled')}>
            <strong>{latestRecord.followUp.date}</strong>
            {latestRecord.followUp.reason && <span className="sbar-muted"> — {latestRecord.followUp.reason}</span>}
          </Fact>
        )}
        {activeRx.length > 0 && (
          <Fact label={t('sbar.continueMedications')}>
            <span className="sbar-muted">
              {activeRx.length === 1
                ? t('sbar.activePrescriptionCount', { count: activeRx.length })
                : t('sbar.activePrescriptionCountPlural', { count: activeRx.length })}
            </span>
          </Fact>
        )}
        {latestRecord?.treatmentPlan && (
          <Fact label={t('sbar.activePlan')}>{latestRecord.treatmentPlan}</Fact>
        )}
        {pendingLabs.length === 0 && !latestRecord?.followUp?.date && activeRx.length === 0 && !latestRecord?.treatmentPlan && !latestTriage?.disposition && !latestTriage?.assignedProviderName && !latestTriage?.handoffNote && (
          <p className="sbar-para sbar-muted">{t('sbar.noOutstandingActions')}</p>
        )}
      </ChartSection>

      <p className="sbar-disclaimer">{t('sbar.disclaimer')}</p>
    </div>
  );
}
