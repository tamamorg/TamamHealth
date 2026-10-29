'use client';
import { AlertTriangle, Pill, Activity, ClipboardList, Plus, Pencil, Sliders, Check } from '@/components/icons/lucide';
import Badge from '@/components/Badge';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { todayIso as isoToday } from '@/lib/date-utils';
import { formatDateTime, formatDate, formatClockTime, formatRxSig, humanizeStatus } from '@/lib/format-utils';
import { isScreeningOverdue } from '@/lib/services/screening-service';
import { patientFullName, patientInitials, patientAgeLabel } from '@/lib/patient-utils';
import { priorityBadge, priorityLabel } from '@/lib/clinical/triage-display';
import type { AppointmentDoc, ImmunizationDoc, LabResultDoc, PatientDoc, PrescriptionDoc, ProblemDoc, TriageDoc } from '@/lib/db-types';
import { formatPhoneDisplay } from '@/lib/field-formats';
import { clickable } from '@/lib/a11y';
import { useNow } from '@/lib/hooks/useNow';
import { FACESHEET_PANEL_OPTIONS, type FacesheetPanelId, type ChartVitalsLike, type FacesheetActions } from './chart-constants';
import { appointmentStatusLabel } from '@/lib/appointment-status';

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
  const recentLabs = [...labResults]
    .sort((a, b) => (b.completedAt || b.createdAt || '').localeCompare(a.completedAt || a.createdAt || ''))
    .slice(0, 4);
  const careActions = buildCareActions(patient, immunizations);
  const showPanel = (panelId: FacesheetPanelId) => visiblePanelIds.has(panelId);

  if (!canViewClinical) {
    return (
      <div className="tebra-facesheet">
        <section className="tebra-panel tebra-panel--wide">
          <div className="tebra-panel__head">
            <h2>Facesheet</h2>
          </div>
          <div className="tebra-empty">
            Clinical information is restricted for your role. Use Demographics, Appointments, Billing history, Documents, and Care coordination for administrative work.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="tebra-facesheet">
      <div className="tebra-section-title">
        <h1>{t('ptDetail.summaryTitle')}</h1>
        <button type="button" onClick={onToggleCustomize}>
          {customizeOpen ? <Check aria-hidden /> : <Sliders aria-hidden />}
          {customizeOpen ? 'Done' : 'Customize View'}
        </button>
      </div>

      {customizeOpen && (
        <div className="tebra-customize-panel" role="group" aria-label="Customize facesheet panels">
          <div className="tebra-customize-panel__head">
            <strong>{t('ptDetail.showOnFacesheet')}</strong>
            <button type="button" onClick={onResetPanels}>Reset</button>
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
        <FacesheetPanelHead icon={Pill} title="Medications" action={actions.medications} />
        {currentMeds.length ? (
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
          </div>
        ) : <p className="tebra-none">(None documented)</p>}
      </section>
      )}

      {showPanel('problems') && (
      <section className="tebra-panel" {...clickable(() => onOpenTab('problems'), { label: 'Open conditions' })}>
        <FacesheetPanelHead icon={AlertTriangle} title="Conditions" action={actions.problems} />
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
        ) : <p className="tebra-none">No active problems documented.</p>}
      </section>
      )}

      {showPanel('vitals') && (() => {
        return (
      <section className="tebra-panel tebra-panel--highlight" {...clickable(() => onOpenTab('vitals'), { label: 'Open latest observations' })}>
        <FacesheetPanelHead icon={Activity} title="Latest observations" action={actions.vitals} />
        {latestTriage && (
          <div className="tebra-triage-snapshot">
            <div
              className="tebra-triage-snapshot__priority"
              style={{ color: priorityBadge(latestTriage.priority).color, background: priorityBadge(latestTriage.priority).bg }}
            >
              <strong>{priorityLabel(latestTriage.priority)}</strong>
              <span>{latestTriage.chiefComplaint || 'Triage assessment'} · {formatDateTime(latestTriage.triagedAt)}</span>
            </div>
            <div className="tebra-triage-snapshot__abcc" aria-label="Latest triage assessment">
              <span data-tone={latestTriage.airway === 'clear' ? 'normal' : latestTriage.airway === 'not_assessed' ? 'muted' : 'danger'}><small>Airway</small><strong>{latestTriage.airway.replace('_', ' ')}</strong></span>
              <span data-tone={latestTriage.breathing === 'normal' ? 'normal' : latestTriage.breathing === 'not_assessed' ? 'muted' : latestTriage.breathing === 'distressed' ? 'warning' : 'danger'}><small>Breathing</small><strong>{latestTriage.breathing.replace('_', ' ')}</strong></span>
              <span data-tone={latestTriage.circulation === 'normal' ? 'normal' : latestTriage.circulation === 'not_assessed' ? 'muted' : latestTriage.circulation === 'impaired' ? 'warning' : 'danger'}><small>Circulation</small><strong>{latestTriage.circulation.replace('_', ' ')}</strong></span>
              <span data-tone={latestTriage.consciousness === 'alert' ? 'normal' : latestTriage.consciousness === 'not_assessed' ? 'muted' : latestTriage.consciousness === 'verbal' ? 'warning' : 'danger'}><small>Consciousness</small><strong>{latestTriage.consciousness.replace('_', ' ')}</strong></span>
            </div>
            {(latestTriage.destinationClinic || latestTriage.assignedProviderName || latestTriage.handoffNote) && (
              <p className="tebra-triage-snapshot__route">
                {[latestTriage.destinationClinic, latestTriage.assignedProviderName, latestTriage.handoffNote].filter(Boolean).join(' · ')}
              </p>
            )}
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
            : <p className="tebra-none">{latestVitals ? t('chart.observationsInBand') : '(None documented)'}</p>
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
        <FacesheetPanelHead icon={ClipboardList} title="Next care actions" action={actions.recommendations} />
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
        ) : <p className="tebra-none">No outstanding care actions.</p>}
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
      <div className="tebra-demo-title">
        <h1>Demographics</h1>
      </div>
      <div className="tebra-demo-tabs" role="tablist" aria-label="Demographics sections">
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

      {activeTab === 'profile' && (
        <section className="tebra-demo-panel">
          {canEdit && <button type="button" className="tebra-demo-edit" onClick={onEdit}><Pencil aria-hidden /> Edit</button>}
          <div className="tebra-demo-person">
            <div className="tebra-demo-avatar">{patientInitials(patient)}</div>
            <h2>{patientFullName(patient)}</h2>
            <span>Active</span>
          </div>
          <div className="tebra-demo-columns">
            <DemoField label="Legal Name" value={patientFullName(patient)} />
            <DemoField label="Pronoun" value="-" />
            <DemoField label="MRN" value={patient.hospitalNumber || '-'} />
            <DemoField label="Preferred Name" value={patient.firstName || '-'} />
            <DemoField label="Sex" value={patient.gender || '-'} />
            <DemoField label="Tamam Patient ID" value={patient.geocodeId || patient.hospitalNumber || '-'} />
            <DemoField label="Date of Birth" value={patient.dateOfBirth ? `${formatDate(patient.dateOfBirth)} (${patientAgeLabel(patient)})` : '-'} />
            <DemoField label="Gender Identity" value={patient.gender || '-'} />
            <DemoField label="National ID" value={patient.nationalId || '-'} />
            <DemoField label="Previous Full Name" value={patient.maidenName || '-'} />
            <DemoField label="Sexual Orientation" value="Choose not to disclose" />
            <DemoField label="Facility" value={regHospitalName || '-'} />
            <DemoField label="Marital Status" value="Unknown" />
            <DemoField label="Blood Type" value={patient.bloodType || '-'} />
            <DemoField label="Primary Language" value={patient.primaryLanguage || '-'} />
          </div>

          <div className="tebra-demo-section">
            <h3>Contact Information:</h3>
            <div className="tebra-demo-columns">
              <DemoField label="Home Address" value={[patient.address, patient.boma, patient.payam, patient.county, patient.state].filter(Boolean).join(', ') || '-'} wide />
              <DemoField label="Mobile Phone" value={patient.phone ? `${formatPhoneDisplay(patient.phone)} Primary` : '-'} />
              <DemoField label="Personal Email" value="-" />
              <DemoField label="Mailing Address" value={patient.address || '-'} wide />
              <DemoField label="Home Phone" value="-" />
              <DemoField label="Work Email" value="-" />
              <DemoField label="Previous Address" value="-" wide />
              <DemoField label="Other Phone" value={patient.altPhone ? formatPhoneDisplay(patient.altPhone) : '-'} />
              <DemoField label="Preferred Communication" value="Unknown" />
              <DemoField label="Driver's License" value="-" />
              <DemoField label="Send Reminders by" value={patient.whatsapp ? 'Phone(Text Message), WhatsApp' : 'Phone(Text Message)'} wide />
            </div>
          </div>
        </section>
      )}

      {activeTab === 'additional' && (
        <section className="tebra-demo-panel">
          <div className="tebra-demo-columns">
            <DemoField label="State" value={patient.state || '-'} />
            <DemoField label="County" value={patient.county || '-'} />
            <DemoField label="Payam" value={patient.payam || '-'} />
            <DemoField label="Boma" value={patient.boma || '-'} />
            <DemoField label="Tribe" value={patient.tribe || '-'} />
            <DemoField label="Registered" value={(patient.registrationDate || patient.registeredAt) ? formatDate(patient.registrationDate || patient.registeredAt) : '-'} />
          </div>
        </section>
      )}

      {activeTab === 'contacts' && (
        <section className="tebra-demo-panel">
          <div className="tebra-demo-columns">
            <DemoField label="Primary Contact" value={patient.nokName || '-'} />
            <DemoField label="Relationship" value={patient.nokRelationship || '-'} />
            <DemoField label="Phone" value={patient.nokPhone ? formatPhoneDisplay(patient.nokPhone) : '-'} />
            <DemoField label="Address" value={patient.nokAddress || '-'} wide />
          </div>
        </section>
      )}

      {(activeTab === 'upcoming' || activeTab === 'past') && (
        <section className="tebra-demo-panel">
          <table className="tebra-demo-table">
            <thead><tr><th>Date</th><th>Time</th><th>{t('chartMessages.careTeam')}</th><th>Context</th><th>Status</th></tr></thead>
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
                <tr><td colSpan={5}>No appointments documented.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'portal' && (
        <section className="tebra-demo-panel">
          <div className="tebra-demo-columns">
            <DemoField label="Portal Status" value="Not invited" />
            <DemoField label="Reminder Channel" value={patient.whatsapp ? 'SMS / WhatsApp' : 'SMS'} />
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
