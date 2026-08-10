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
import { priorityColor } from '@/lib/clinical/triage-display';
import { formatPhoneDisplay } from '@/lib/field-formats';
import type { PatientShiftHandoff } from '@/lib/hooks/usePatientHandoff';

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

export default function PatientSBAR({
  patient, records, labs, prescriptions, triages, problems, latestShiftHandoff,
}: PatientSBARProps) {
  const { t } = useTranslation();
  const age = patientAge(patient);
  const fullName = patientFullName(patient);
  const allergies = (patient.allergies || []).filter(a => a && a.toLowerCase() !== 'none known' && a.toLowerCase() !== 'none');
  const chronic = (patient.chronicConditions || []).filter(c => c && c.toLowerCase() !== 'none');

  const latestTriage = triages[0];
  const latestRecord = records[0];
  const latestVitals = latestRecord?.vitalSigns;
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
        addLabel={t('action.print')}
        addIcon={<Printer />}
        onAdd={handlePrint}
      >
        <p className="sbar-lede">
          {/* The name stays in the sentence — it is the clinical statement a
              nurse reads aloud at handoff — but no longer as a page title. */}
          <strong>{fullName}</strong>
          {age != null && <>, {t('sbar.yearOld', { age })} {patient.gender.toLowerCase()}</>}
          {patient.hospitalNumber && <span className="sbar-muted"> · {patient.hospitalNumber}</span>}
        </p>
        {latestTriage ? (
          <p className="sbar-para">
            {t('sbar.currentlyTriaged')}{' '}
            <strong style={{ color: priorityColor(latestTriage.priority) }}>
              {latestTriage.priority === 'RED'
                ? t('nurse.priorityRedLabel')
                : latestTriage.priority === 'YELLOW'
                ? t('nurse.priorityYellowLabel')
                : t('nurse.priorityGreenLabel')}
            </strong>{' '}
            ({formatDateTime(latestTriage.triagedAt)}). {t('sbar.statusLabel')} {latestTriage.status}.
            {latestTriage.chiefComplaint && (
              <> {t('sbar.chiefComplaintLabel')} <em>{latestTriage.chiefComplaint}</em>.</>
            )}
          </p>
        ) : latestRecord?.chiefComplaint ? (
          <p className="sbar-para">
            {t('sbar.lastConsult')} ({formatDateTime(latestRecord.consultedAt || latestRecord.visitDate)}):{' '}
            <em>{latestRecord.chiefComplaint}</em>
          </p>
        ) : (
          <p className="sbar-para sbar-muted">{t('sbar.noActiveSituation')}</p>
        )}
      </ChartSection>

      <ChartSection title={t('sbar.backgroundTitle')}>
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

      <ChartSection title={t('sbar.assessmentTitle')}>
        {latestVitals ? (
          <div className="sbar-block">
            <SubHead icon={<Heart className="w-3.5 h-3.5" />}>
              {t('sbar.latestVitals')} · {formatDateTime(latestVitals.recordedAt)}
            </SubHead>
            <div className="sbar-tiles">
              <Tile label={t('sbar.vitalTemp')} value={`${latestVitals.temperature}°C`} />
              <Tile label={t('sbar.vitalBp')} value={`${latestVitals.systolic}/${latestVitals.diastolic}`} />
              <Tile label={t('sbar.vitalPulse')} value={`${latestVitals.pulse}`} />
              <Tile label={t('sbar.vitalRr')} value={`${latestVitals.respiratoryRate}`} />
              <Tile label={t('sbar.vitalSpo2')} value={`${latestVitals.oxygenSaturation}%`} />
              <Tile label={t('sbar.vitalWt')} value={`${latestVitals.weight} kg`} />
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

      <ChartSection title={t('sbar.recommendationTitle')}>
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
        {pendingLabs.length === 0 && !latestRecord?.followUp?.date && activeRx.length === 0 && !latestRecord?.treatmentPlan && (
          <p className="sbar-para sbar-muted">{t('sbar.noOutstandingActions')}</p>
        )}
      </ChartSection>

      <p className="sbar-disclaimer">{t('sbar.disclaimer')}</p>
    </div>
  );
}
