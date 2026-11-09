'use client';
import { activeCountry } from '@/lib/country/country-pack';
import { countryName } from '@/lib/country/world-lists';
import ChartSection from '@/components/ehr/chart/ChartSection';
import { AlertTriangle, Pill, Activity, ClipboardList, Plus, Pencil, Sliders, Check } from '@/components/icons/lucide';
import Badge from '@/components/Badge';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { todayIso as isoToday } from '@/lib/date-utils';
import { formatDateTime, formatDate, formatClockTime, formatRxSig, humanizeStatus } from '@/lib/format-utils';
import { isScreeningOverdue } from '@/lib/services/screening-service';
import { patientFullName, patientInitials, patientAgeLabel } from '@/lib/patient-utils';
import { priorityBadge, priorityLabel } from '@/lib/clinical/triage-display';
import { IITT_RED_CRITERIA, IITT_YELLOW_CRITERIA, INFECTION_RISK_SIGNS, iittCodeLabels } from '@/lib/clinical/iitt';
import type { AppointmentDoc, ImmunizationDoc, LabResultDoc, PatientDoc, PrescriptionDoc, ProblemDoc, TriageDoc } from '@/lib/db-types';
import { formatPhoneDisplay } from '@/lib/field-formats';
import { clickable } from '@/lib/a11y';
import { useNow } from '@/lib/hooks/useNow';
import { FACESHEET_PANEL_OPTIONS, type FacesheetPanelId, type ChartVitalsLike, type FacesheetActions } from './chart-constants';
import { appointmentStatusLabel } from '@/lib/appointment-status';
import { formatMedicationReview } from '@/lib/clinical/triage-medication-review';
import { useHistoryEntries } from '@/lib/hooks/useHistoryEntries';
import { MEDICATION_HISTORY_DOMAIN, historyForDomain } from '@/lib/clinical/patient-history';

/**
 * Facesheet card header — icon + title on the left, the card's primary write
 * action on the right. The action button stops propagation so it never also
 * fires the card's "open this tab" click handler.
 */
export function FacesheetPanelHead({
  icon: Icon,
  title,
  action,
}: {
  icon: typeof Pill;
  title: string;
  action?: FacesheetActions[FacesheetPanelId];
}) {
  const ActionIcon = action?.icon || Plus;
  return (
    <div className="tebra-panel__head">
      <h2><Icon className="tebra-panel-icon" aria-hidden /> {title}</h2>
      {action && (
        <button
          type="button"
          className="tebra-panel-action"
          onClick={event => { event.stopPropagation(); action.onClick(); }}
          aria-label={`${action.label} — ${title}`}
        >
          <ActionIcon aria-hidden /> {action.label}
        </button>
      )}
    </div>
  );
}

export function PatientFacesheetView({
  patient,
  latestVitals,
  vitalsLoading = false,
  latestTriage,
  problems,
  prescriptions,
  labResults,
  immunizations,
  canViewClinical,
  onOpenTab,
  actions,
  visiblePanelIds,
  customizeOpen,
  onToggleCustomize,
  onTogglePanel,
  onResetPanels,
}: {
  patient: PatientDoc;
  latestVitals?: ChartVitalsLike;
  /** True until every vitals source has resolved — never show a stale reading as latest. */
  vitalsLoading?: boolean;
  latestTriage?: TriageDoc;
  problems: ProblemDoc[];
  prescriptions: PrescriptionDoc[];
  labResults: LabResultDoc[];
  immunizations: ImmunizationDoc[];
  canViewClinical: boolean;
  onOpenTab: (tab: string, focus?: string) => void;
  /** Per-panel primary actions. A missing entry hides that panel's action
   *  button (the role lacks the permission); the card itself stays clickable. */
  actions: FacesheetActions;
  visiblePanelIds: Set<FacesheetPanelId>;
  customizeOpen: boolean;
  onToggleCustomize: () => void;
  onTogglePanel: (panelId: FacesheetPanelId) => void;
  onResetPanels: () => void;
}) {
  const { t } = useTranslation();
  const activeProblems = problems.filter(problem => problem.status === 'active' || problem.status === 'chronic');
  // "Current" = anything not stopped. A dispensed medicine is the one the
  // patient is actually taking — excluding it (the old filter) made the panel
  // read "(None documented)" for fully-dispensed patients.
  const currentMeds = prescriptions.filter(rx => rx.status !== 'discontinued').slice(0, 4);
  // Medicines the patient reports taking (recorded at triage or on the Medications
  // tab) are part of what they are on: a card that read "(None documented)" beside
  // a listed Metformin hid it from the prescriber's first screen.
  const { entries: historyEntries } = useHistoryEntries(patient._id);
  // A medicine both reported and prescribed is listed once, as the order.
  const drugKey = (name?: string) => (name || '').trim().toLowerCase().split(/[\s,(]+/)[0];
  const prescribedDrugs = new Set(prescriptions.filter(rx => rx.status !== 'discontinued').map(rx => drugKey(rx.medication)));
  const reportedMeds = historyForDomain(historyEntries, MEDICATION_HISTORY_DOMAIN)
    .filter(entry => !prescribedDrugs.has(drugKey(entry.title)))
    .slice(0, Math.max(0, 4 - currentMeds.length));
  const recentLabs = [...labResults]
    .sort((a, b) => (b.completedAt || b.createdAt || '').localeCompare(a.completedAt || a.createdAt || ''))
    .slice(0, 4);
  const careActions = buildCareActions(patient, immunizations);
  const showPanel = (panelId: FacesheetPanelId) => visiblePanelIds.has(panelId);

  if (!canViewClinical) {
    return (
      <div className="tebra-facesheet">
        {/* The chart's own section header, its note as the light sub-line. */}
        <ChartSection
          title={t('ui.facesheet')}
          subtitle={t('ui.clinicalInformationIsRestrictedFor')}
        >{null}</ChartSection>
      </div>
    );
  }

  return (
    <div className="tebra-facesheet">
      <div className="tebra-section-title">
        <div className="tamam-section-title-wrap">
          <h3 className="tamam-section-title">{t('ptDetail.summaryTitle')}</h3>
          <span className="tamam-section-underline" aria-hidden />
        </div>
        <button type="button" onClick={onToggleCustomize}>
          {customizeOpen ? <Check aria-hidden /> : <Sliders aria-hidden />}
          {customizeOpen ? 'Done' : 'Customize View'}
        </button>
      </div>

      {customizeOpen && (
        <div className="tebra-customize-panel" role="group" aria-label={t('ui.customizeFacesheetPanels')}>
          <div className="tebra-customize-panel__head">
            <strong>{t('ptDetail.showOnFacesheet')}</strong>
            <button type="button" onClick={onResetPanels}>{t('branding.reset')}</button>
          </div>
          <div className="tebra-customize-panel__grid">
            {FACESHEET_PANEL_OPTIONS.map(panel => (
              <label key={panel.id}>
                <input
                  type="checkbox"
                  checked={visiblePanelIds.has(panel.id)}
                  onChange={() => onTogglePanel(panel.id)}
                  disabled={visiblePanelIds.has(panel.id) && visiblePanelIds.size === 1}
                />
                <span>{panel.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {showPanel('medications') && (
      <section className="tebra-panel" {...clickable(() => onOpenTab('prescriptions'), { label: 'Open medications' })}>
        <FacesheetPanelHead icon={Pill} title={t('noteEditor.section.medications')} action={actions.medications} />
        {currentMeds.length || reportedMeds.length ? (
          <div className="tebra-list">
            {currentMeds.map(rx => (
              <div
                key={rx._id}
                className="tebra-list-row"
                {...clickable(event => { event.stopPropagation(); onOpenTab('prescriptions', rx._id); }, { label: `Open ${rx.medication}` })}
              >
                <strong>{rx.medication}</strong>
                <span>{formatRxSig(rx)}</span>
              </div>
            ))}
            {reportedMeds.map(entry => (
              <div
                key={entry._id}
                className="tebra-list-row"
                {...clickable(event => { event.stopPropagation(); onOpenTab('prescriptions'); }, { label: `Open ${entry.title}` })}
              >
                <strong>{entry.title}</strong>
                <span>{[entry.detail, t('meds.reported.tag')].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        ) : <p className="tebra-none">{t('ui.noneDocumented')}</p>}
      </section>
      )}

      {showPanel('problems') && (
      <section className="tebra-panel" {...clickable(() => onOpenTab('problems'), { label: 'Open conditions' })}>
        <FacesheetPanelHead icon={AlertTriangle} title={t('patients.colConditions')} action={actions.problems} />
        {activeProblems.length ? (
          <div className="tebra-list">
            {activeProblems.slice(0, 4).map(problem => (
              <div key={problem._id} className="tebra-list-row">
                <strong>{problem.name}</strong>
                <span className="tebra-list-row-meta">
                  {/* Problems are coded in ICD-11; icd10Code is only on legacy imports. */}
                  {(problem.icd11Code || problem.icd10Code) && <span>{problem.icd11Code || problem.icd10Code}</span>}
                  <Badge tone={problem.status === 'chronic' ? 'warning' : 'success'}>{humanizeStatus(problem.status)}</Badge>
                </span>
              </div>
            ))}
          </div>
        ) : <p className="tebra-none">{t('ui.noActiveProblemsDocumented')}</p>}
      </section>
      )}

      {showPanel('vitals') && (() => {
        return (
      <section className="tebra-panel tebra-panel--highlight" {...clickable(() => onOpenTab('vitals'), { label: 'Open latest observations' })}>
        <FacesheetPanelHead icon={Activity} title={t('ui.latestObservations')} action={actions.vitals} />
        {latestTriage && (
          <div className="tebra-triage-snapshot">
            <div
              className="tebra-triage-snapshot__priority"
              style={{ color: priorityBadge(latestTriage.priority).color, background: priorityBadge(latestTriage.priority).bg }}
            >
              <strong>{priorityLabel(latestTriage.priority)}</strong>
              <span>{latestTriage.chiefComplaint || 'Triage assessment'} · {formatDateTime(latestTriage.triagedAt)}</span>
            </div>
            <div className="tebra-triage-snapshot__abcc" aria-label={t('ui.latestTriageAssessment')}>
              <span data-tone={latestTriage.airway === 'clear' ? 'normal' : latestTriage.airway === 'not_assessed' ? 'muted' : 'danger'}><small>{t('nurse.airway')}</small><strong>{latestTriage.airway.replace('_', ' ')}</strong></span>
              <span data-tone={latestTriage.breathing === 'normal' ? 'normal' : latestTriage.breathing === 'not_assessed' ? 'muted' : latestTriage.breathing === 'distressed' ? 'warning' : 'danger'}><small>{t('nurse.breathing')}</small><strong>{latestTriage.breathing.replace('_', ' ')}</strong></span>
              <span data-tone={latestTriage.circulation === 'normal' ? 'normal' : latestTriage.circulation === 'not_assessed' ? 'muted' : latestTriage.circulation === 'impaired' ? 'warning' : 'danger'}><small>{t('nurse.circulation')}</small><strong>{latestTriage.circulation.replace('_', ' ')}</strong></span>
              <span data-tone={latestTriage.consciousness === 'alert' ? 'normal' : latestTriage.consciousness === 'not_assessed' ? 'muted' : latestTriage.consciousness === 'verbal' ? 'warning' : 'danger'}><small>{t('ui.consciousness')}</small><strong>{latestTriage.consciousness.replace('_', ' ')}</strong></span>
            </div>
            {(latestTriage.destinationClinic || latestTriage.assignedProviderName || latestTriage.handoffNote) && (
              <p className="tebra-triage-snapshot__route">
                {[latestTriage.destinationClinic, latestTriage.assignedProviderName, latestTriage.handoffNote].filter(Boolean).join(' · ')}
              </p>
            )}
            {/* A patient waiting for their first note has no other place in the
                chart to read what set this priority. */}
            {latestTriage.isolationRequired && <p className="tebra-triage-snapshot__sign is-red"><strong>{t('ptDetail.triageIsolation')}</strong></p>}
            {latestTriage.medicationReview && (
              <p className="tebra-triage-snapshot__sign"><strong>{t('triageMeds.heading')}:</strong> {formatMedicationReview(latestTriage.medicationReview, t)}</p>
            )}
            {([
              ['ptDetail.triageDangerSigns', iittCodeLabels(latestTriage.redCriteria, IITT_RED_CRITERIA), 'is-red'],
              ['ptDetail.triageUrgentSigns', iittCodeLabels(latestTriage.yellowCriteria, IITT_YELLOW_CRITERIA), 'is-yellow'],
              ['ptDetail.triageInfectionRisk', iittCodeLabels(latestTriage.infectionRiskSigns, INFECTION_RISK_SIGNS), ''],
            ] as const).map(([label, signs, tone]) => signs.length > 0 && (
              <p key={label} className={`tebra-triage-snapshot__sign ${tone}`}><strong>{t(label)}:</strong> {signs.join('; ')}</p>
            ))}
          </div>
        )}
        {/* The latest BP / pulse / temperature / SpO2 are the vitals band's job,
            directly above this card, with the shared age- and pregnancy-aware
            flags. Repeating them here showed the same numbers twice, flagged
            by different cut-offs. The card keeps what the band does not have:
            the triage assessment and the newest results. */}
        {!latestTriage && recentLabs.length === 0 && (
          vitalsLoading
            ? <p className="tebra-none">{t('chart.vitalsLoading')}</p>
            : <p className="tebra-none">{latestVitals ? t('chart.observationsInBand') : t('ui.noneDocumented')}</p>
        )}
        {recentLabs.length > 0 && (
          // Results live on their own section, not Vitals — without the
          // stopPropagation these rows inherited the card's click and opened
          // the vitals table instead of the result they name.
          <div
            className="tebra-list mt-2"
            {...clickable(event => { event.stopPropagation(); onOpenTab('labs'); }, { label: 'Open labs' })}
          >
            <div className="tebra-list-row"><strong>{t('ptDetail.recentResults')}</strong><span>{recentLabs.length} recorded</span></div>
            {recentLabs.slice(0, 2).map(lab => (
              <div
                key={lab._id}
                className="tebra-list-row"
                {...clickable(event => { event.stopPropagation(); onOpenTab('labs', lab._id); }, { label: `Open ${lab.testName}` })}
              >
                <strong>{lab.testName}</strong>
                <span>{[lab.result, lab.unit].filter(Boolean).join(' ') || lab.status || 'Pending'}</span>
              </div>
            ))}
          </div>
        )}
      </section>
        );
      })()}

      {showPanel('recommendations') && (
      <section className="tebra-panel tebra-recommendations" {...clickable(() => onOpenTab('careChecklist'), { label: 'Open next care actions' })}>
        <FacesheetPanelHead icon={ClipboardList} title={t('ui.nextCareActions')} action={actions.recommendations} />
        {careActions.length ? (
          <div className="tebra-reco-list">
            {careActions.map(item => (
              <div key={item.key} className="tebra-reco-row">
                <span className={item.overdue ? 'tebra-reco-grade is-rec' : 'tebra-reco-grade is-info'}>
                  {item.overdue ? '!' : '•'}
                </span>
                <div>
                  <small>{item.category}{item.detail ? ` · ${item.detail}` : ''}{item.overdue ? ' · overdue' : ''}</small>
                  <strong>{item.title}</strong>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="tebra-none">{t('ui.noOutstandingCareActions')}</p>}
      </section>
      )}

    </div>
  );
}

export function PatientDemographicsView({
  patient,
  activeTab,
  onTabChange,
  onEdit,
  canEdit,
  appointments,
  regHospitalName,
}: {
  patient: PatientDoc;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onEdit: () => void;
  /** Whether this viewer may change the registration record. */
  canEdit: boolean;
  appointments: AppointmentDoc[];
  regHospitalName: string;
}) {
  // Which appointments are still ahead is a comparison against the clock.
  const { t } = useTranslation();
  const now = useNow(60_000);
  const tabs = [
    ['profile', 'Profile'],
    ['additional', 'Additional Info'],
    ['contacts', 'Contacts'],
    ['upcoming', 'Upcoming Appointments'],
    ['past', 'Past Appointments'],
    ['portal', 'Patient Portal'],
  ];
  const upcoming = appointments
    .filter(appt => new Date(`${appt.appointmentDate}T${appt.appointmentTime || '00:00'}:00`).getTime() >= now)
    .sort((a, b) => `${a.appointmentDate}${a.appointmentTime}`.localeCompare(`${b.appointmentDate}${b.appointmentTime}`));
  const past = appointments
    .filter(appt => new Date(`${appt.appointmentDate}T${appt.appointmentTime || '00:00'}:00`).getTime() < now)
    .sort((a, b) => `${b.appointmentDate}${b.appointmentTime}`.localeCompare(`${a.appointmentDate}${a.appointmentTime}`));

  return (
    <div className="tebra-demographics">
      {/* Titled like every other chart tab. */}
      <div className="tebra-demo-title tamam-section-title-wrap">
        <h3 className="tamam-section-title">{t('patient.demographics')}</h3>
        <span className="tamam-section-underline" aria-hidden />
      </div>
      <div className="tebra-demo-tabbar">
        <div className="tebra-demo-tabs" role="tablist" aria-label={t('ui.demographicsSections')}>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? 'active' : ''}
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {activeTab === 'profile' && canEdit && <button type="button" className="tebra-demo-edit" onClick={onEdit}><Pencil aria-hidden /> {t('action.edit')}</button>}
      </div>

      {activeTab === 'profile' && (
        <section className="tebra-demo-panel">
          <div className="tebra-demo-person">
            <div className="tebra-demo-avatar">{patientInitials(patient)}</div>
            <h2>{patientFullName(patient)}</h2>
            <span>{t('adminBilling.statusActive')}</span>
          </div>
          <div className="tebra-demo-columns">
            <DemoField label={t('ui.legalName')} value={patientFullName(patient)} />
            <DemoField label={t('ui.pronoun')} value="-" />
            <DemoField label="MRN" value={patient.hospitalNumber || '-'} />
            <DemoField label={t('ui.preferredName')} value={patient.firstName || '-'} />
            <DemoField label={t('nutrition.formSex')} value={patient.gender || '-'} />
            <DemoField label={t('ui.tamamPatientId')} value={patient.geocodeId || patient.hospitalNumber || '-'} />
            <DemoField label={t('births.colDateOfBirth')} value={patient.dateOfBirth ? `${formatDate(patient.dateOfBirth)} (${patientAgeLabel(patient)})` : '-'} />
            <DemoField label={t('ui.genderIdentity')} value={patient.gender || '-'} />
            <DemoField label={t('patientNew.nationalId')} value={patient.nationalId || '-'} />
            {patient.identifiers?.map(id => (
              <DemoField key={`${id.type}-${id.value}`} label={t(`idType.${id.type}`)} value={[id.value, countryName(id.country)].filter(Boolean).join(' · ')} />
            ))}
            {patient.latinName && <DemoField label={t('patientNew.latinName')} value={patient.latinName} />}
            <DemoField label={t('patientNew.citizenship')} value={countryName(patient.citizenship) || '-'} />
            <DemoField label={t('ui.previousFullName')} value={patient.maidenName || '-'} />
            <DemoField label={t('ui.sexualOrientation')} value="Choose not to disclose" />
            <DemoField label={t('births.colFacility')} value={regHospitalName || '-'} />
            <DemoField label={t('ui.maritalStatus')} value="Unknown" />
            <DemoField label={t('patient.bloodType')} value={patient.bloodType || '-'} />
            <DemoField label={t('patientNew.primaryLanguage')} value={patient.primaryLanguage || '-'} />
          </div>

          <div className="tebra-demo-section">
            <h3>{t('ui.contactInformation')}</h3>
            <div className="tebra-demo-columns">
              <DemoField label={t('ui.homeAddress')} value={[patient.address, patient.boma, patient.payam, patient.county, patient.state].filter(Boolean).join(', ') || '-'} wide />
              <DemoField label={t('ui.mobilePhone')} value={patient.phone ? `${formatPhoneDisplay(patient.phone)} Primary` : '-'} />
              <DemoField label={t('ui.personalEmail')} value={patient.email || '-'} />
              <DemoField label={t('ui.mailingAddress')} value={patient.address || '-'} wide />
              <DemoField label={t('ui.homePhone')} value="-" />
              <DemoField label={t('landing.demo.workEmail')} value="-" />
              <DemoField label={t('ui.previousAddress')} value="-" wide />
              <DemoField label={t('ui.otherPhone')} value={patient.altPhone ? formatPhoneDisplay(patient.altPhone) : '-'} />
              <DemoField label={t('ui.preferredCommunication')} value="Unknown" />
              <DemoField label={t('ui.driverSLicense')} value="-" />
              <DemoField label={t('ui.sendRemindersBy')} value={patient.whatsapp ? 'Phone(Text Message), WhatsApp' : 'Phone(Text Message)'} wide />
            </div>
          </div>
        </section>
      )}

      {activeTab === 'additional' && (
        <section className="tebra-demo-panel">
          <div className="tebra-demo-columns">
            <DemoField label={t('patientNew.residenceCountry')} value={countryName(patient.residenceCountry || activeCountry().code)} />
            <DemoField label={t('births.colState')} value={patient.state || '-'} />
            <DemoField label={t('births.county')} value={patient.county || '-'} />
            <DemoField label={t('dhis2.levelPayam')} value={patient.payam || '-'} />
            <DemoField label={t('payam.boma')} value={patient.boma || '-'} />
            {(activeCountry().asksTribe || patient.tribe) && <DemoField label={t('patient.tribe')} value={patient.tribe || '-'} />}
            <DemoField label={t('deaths.colRegistered')} value={(patient.registrationDate || patient.registeredAt) ? formatDate(patient.registrationDate || patient.registeredAt) : '-'} />
          </div>
        </section>
      )}

      {activeTab === 'contacts' && (
        <section className="tebra-demo-panel">
          <div className="tebra-demo-columns">
            <DemoField label={t('ui.primaryContact')} value={patient.nokName || '-'} />
            <DemoField label={t('patientNew.relationship')} value={patient.nokRelationship || '-'} />
            <DemoField label={t('noteEditor.type.phone')} value={patient.nokPhone ? formatPhoneDisplay(patient.nokPhone) : '-'} />
            {patient.nokEmail && <DemoField label={t('patientNew.nokEmail')} value={patient.nokEmail} />}
            <DemoField label={t('hospitals.fieldAddress')} value={patient.nokAddress || '-'} wide />
          </div>
        </section>
      )}

      {(activeTab === 'upcoming' || activeTab === 'past') && (
        <section className="tebra-demo-panel">
          <table className="tebra-demo-table">
            <thead><tr><th>{t('billing.activityColumn.date')}</th><th>{t('noteEditor.time')}</th><th>{t('chartMessages.careTeam')}</th><th>{t('ui.context')}</th><th>{t('billing.activityColumn.status')}</th></tr></thead>
            <tbody>
              {(activeTab === 'upcoming' ? upcoming : past).length ? (activeTab === 'upcoming' ? upcoming : past).map(appt => (
                <tr key={appt._id}>
                  <td>{formatDate(appt.appointmentDate)}</td>
                  <td>{formatClockTime(appt.appointmentTime) || '-'}</td>
                  <td>
                    <div className="appointment-card-provider">
                      {/* Same rule as the Appointments section above: this
                          column describes the booking, not the patient's
                          current assignment. */}
                      <strong>{appt.providerName || 'Doctor unassigned'}</strong>
                      {appt.staffName && <span>{appt.staffName}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="appointment-card-provider">
                      <strong>{appt.reason || appt.department || '-'}</strong>
                      <span>{appt.department || 'Appointment'}</span>
                    </div>
                  </td>
                  <td>{appointmentStatusLabel(appt.status)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5}>{t('ui.noAppointmentsDocumented')}</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'portal' && (
        <section className="tebra-demo-panel">
          <div className="tebra-demo-columns">
            <DemoField label={t('ui.portalStatus')} value="Not invited" />
            <DemoField label={t('ui.reminderChannel')} value={patient.whatsapp ? 'SMS / WhatsApp' : 'SMS'} />
          </div>
        </section>
      )}
    </div>
  );
}

export function DemoField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'tebra-demo-field tebra-demo-field--wide' : 'tebra-demo-field'}>
      <dt>{label}:</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * "Next care actions" for the facesheet — the patient's REAL outstanding work,
 * from the same `patient.screenings` model the Care plan tab manages (so the
 * two surfaces can never contradict each other) plus overdue/due vaccine doses.
 * Replaces a hardcoded USPSTF measure list that told every patient to get a
 * colorectal screening regardless of their data.
 */
export function buildCareActions(patient: PatientDoc, immunizations: ImmunizationDoc[]) {
  const items: Array<{ key: string; overdue: boolean; category: string; title: string; detail?: string }> = [];
  for (const s of patient.screenings ?? []) {
    if (s.status !== 'due') continue;
    items.push({
      key: `scr-${s.id}`,
      overdue: isScreeningOverdue(s),
      category: 'Screening',
      title: s.type,
      detail: s.dueDate ? `Due ${formatDate(s.dueDate)}` : undefined,
    });
  }
  const todayIso = isoToday();
  for (const imm of immunizations) {
    if (imm.status === 'completed' || !imm.nextDueDate) continue;
    items.push({
      key: `imm-${imm._id}`,
      overdue: imm.status === 'overdue' || imm.nextDueDate < todayIso,
      category: 'Immunization',
      title: `${imm.vaccine}${imm.doseNumber > 0 ? ` · dose ${imm.doseNumber}` : ''}`,
      detail: `Due ${formatDate(imm.nextDueDate)}`,
    });
  }
  // Overdue first, then soonest due.
  return items.sort((a, b) => Number(b.overdue) - Number(a.overdue)).slice(0, 6);
}
