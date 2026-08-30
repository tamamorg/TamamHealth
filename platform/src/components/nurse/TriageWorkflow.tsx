'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { useANC } from '@/lib/hooks/useANC';
import { useTriage } from '@/lib/hooks/useTriage';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { APPOINTMENT_CLOSED_STATUSES } from '@/lib/appointment-status';
import type { PatientDoc, TriageDisposition, TriageDoc } from '@/lib/db-types';
import { jubaDate } from '@/lib/time-juba';
import { useToast } from '@/components/Toast';
import { patientAge, patientAgeYearsExact, patientFullName, patientGenderAge, initials, shortenPersonName } from '@/lib/patient-utils';
import {
  calculateBmi,
  getTriageVitalWarnings,
  isLowerTriagePriority,
  parseStrictVitalNumber,
  recommendTriagePriority,
  validateTriageVitals,
  type TriageVitalField,
  type TriageVitalWarning,
} from '@/lib/clinical/vitals';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  Activity, Clock, X, AlertTriangle, Wind, Brain, Heart,
  Eye, ClipboardList, CheckCircle2, LogIn, LogOut, Send, TrendingUp,
} from '@/components/icons/lucide';
import {
  ACCENT, calculateTriagePriority, type TriageResult,
} from './shared';
import { countActiveRedTriage, selectTriageQueueRows, sortTriageQueueRows } from './triage-queue';
import { composeTriageIntakeNotes, manualPriorityRaiseNeedsReason } from './triage-intake-notes';
import { waitLabel } from '@/components/ehr/EhrVisitPopup';
import ListSearch from './ListSearch';
import RowActionsMenu, { type RowAction } from '@/components/referrals/RowActionsMenu';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';
import { IITT_RED_CRITERIA, IITT_YELLOW_CRITERIA, INFECTION_RISK_SIGNS } from '@/lib/clinical/iitt';
import {
  dropTriageDraft, loadTriageDraft, saveTriageDraft, type TriageDraft,
} from '@/lib/triage-draft';

/** High-prevalence chronic conditions offered as quick-pick chips. TriageDoc
 *  has no `chronicConditions` field of its own (that lives on PatientDoc, a
 *  standing record — not this visit's triage snapshot), so the selection here
 *  folds into `notes` as a clearly labelled line rather than inventing a new
 *  schema field (see the report for this limitation). */
const TRIAGE_CHRONIC_CONDITIONS = ['HIV', 'TB', 'Diabetes', 'Hypertension', 'Sickle cell', 'Epilepsy', 'Other'] as const;

/** Why a vital could not be captured this visit — recorded as a structured
 *  note (TriageDoc has no dedicated field for this; see the report). */
const UNMEASURED_VITAL_REASONS = [
  ['equipment_unavailable', 'Equipment unavailable'],
  ['patient_condition', 'Patient condition'],
  ['declined', 'Patient declined'],
] as const;

function VitalInputField({
  field,
  label,
  value,
  placeholder,
  inputMode,
  error,
  warning,
  onChange,
  unmeasuredReason,
  onUnmeasuredReasonChange,
}: {
  field: TriageVitalField;
  label: string;
  value: string;
  placeholder: string;
  inputMode: 'numeric' | 'decimal';
  error?: string;
  warning?: TriageVitalWarning;
  onChange: (value: string) => void;
  /** Set once the nurse has flagged this vital as not captured this visit —
   *  see UNMEASURED_VITAL_REASONS. `undefined` means "captured normally". */
  unmeasuredReason?: string;
  onUnmeasuredReasonChange: (reason: string | undefined) => void;
}) {
  const message = error || warning?.message;
  const messageId = `triage-vital-${field}-message`;
  const tone = error || warning?.urgency === 'RED' ? 'var(--color-danger)' : 'var(--color-warning)';
  const isUnmeasured = unmeasuredReason !== undefined;

  return (
    <div data-vital-field={field}>
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={`triage-vital-${field}`} className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>
          {label}
        </label>
        <button
          type="button"
          onClick={() => onUnmeasuredReasonChange(isUnmeasured ? undefined : UNMEASURED_VITAL_REASONS[0][0])}
          className="text-[8px] font-semibold uppercase tracking-wide"
          style={{ color: isUnmeasured ? 'var(--color-warning)' : 'var(--text-muted)' }}
          title="Record why this vital could not be measured"
        >
          {isUnmeasured ? 'Not taken' : 'N/A'}
        </button>
      </div>
      <input
        id={`triage-vital-${field}`}
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={isUnmeasured}
        aria-invalid={Boolean(error)}
        aria-describedby={message ? messageId : undefined}
        style={{
          width: '100%',
          padding: '5px 8px',
          borderRadius: 6,
          fontSize: 12,
          background: isUnmeasured ? 'var(--overlay-subtle)' : 'var(--bg-card)',
          border: `1px solid ${message ? tone : 'var(--border-light)'}`,
          color: 'var(--text-primary)',
        }}
      />
      {isUnmeasured && (
        <Select
          aria-label={`Reason ${label} was not measured`}
          value={unmeasuredReason}
          onChange={event => onUnmeasuredReasonChange(event.target.value)}
          style={{ width: '100%', marginTop: 4, padding: '3px 6px', borderRadius: 6, fontSize: 10, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
        >
          {UNMEASURED_VITAL_REASONS.map(([code, reasonLabel]) => <option key={code} value={code}>{reasonLabel}</option>)}
        </Select>
      )}
      {message && (
        <p id={messageId} role={error ? 'alert' : 'status'} className="mt-1 text-[9px] leading-tight font-medium" style={{ color: tone }}>
          {error || `${warning?.urgency}: ${warning?.message}`}
        </p>
      )}
    </div>
  );
}

// Mode-of-arrival → Source column label, using the same terms as the ETAT
// form's own <select> options.
function modeOfArrivalLabel(mode: string | undefined, t: (key: string) => string): string {
  switch (mode) {
    case 'walk-in': return t('nurse.modeWalkIn');
    case 'ambulance': return t('nurse.modeAmbulance');
    case 'referral': return t('nurse.modeReferral');
    case 'police': return t('nurse.modePolice');
    case 'other': return t('nurse.modeOther');
    default: return '—';
  }
}

export default function TriageWorkflow({
  initialPatientId,
  lockedPatientId,
  lockedPatient,
  onSaved,
}: {
  initialPatientId?: string;
  /**
   * Pin the form to one patient — the per-patient triage page at
   * `/triage/[patientId]`. The picker becomes a read-only identity chip, Reset
   * and a completed save keep the patient instead of clearing it, and "Recent
   * triages" narrows to that patient's own history. Without it the component is
   * the station: pick anyone, and the list is the whole facility's.
   */
  lockedPatientId?: string;
  /** Resolved patient from the focused page, including cross-facility referrals. */
  lockedPatient?: PatientDoc | null;
  /** Focused pages close after a successful save; embedded stations may reset. */
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const facilitySettings = useSettings();
  const { patients } = usePatients();
  const { users } = useUsers();
  const { visits: ancVisits } = useANC();
  // Portrait per patient id — the triage card shows the same face as the
  // register, falling back to initials when a patient has no photo on file.
  const triagePhotoById = useMemo(() => {
    const map = new Map<string, string>();
    for (const patient of patients) {
      const photo = (patient as { photoUrl?: string }).photoUrl;
      if (photo) map.set(patient._id, photo);
    }
    return map;
  }, [patients]);
  const { triages: triageHistory, create: createTriageRecord, update: updateTriageRecord } = useTriage();
  const { appointments } = useAppointments();
  const { showToast } = useToast();
  const dataScope = useDataScope();
  const currentActor = { userId: currentUser?._id, username: currentUser?.name };

  // When set, the form is correcting an already-saved triage record rather
  // than creating a new one. Lets a nurse fix a mistyped vital / mis-tapped
  // ABCC option after saving — the audit trail keeps the record id stable.
  const [editingTriageId, setEditingTriageId] = useState<string | null>(null);
  // When set, the next save completes THIS pending (clerical walk-in
  // placeholder, KAN-100) triage via createTriage's resumePendingId rather
  // than creating a second record for the same visit. Distinct from
  // `editingTriageId`, which corrects an already-ASSESSED ('seen') record —
  // a pending placeholder was never assessed at all, so this is a resume, not
  // a correction, even though both end up calling the same update path.
  const [resumePendingTriageId, setResumePendingTriageId] = useState<string | null>(null);
  // The encounter a brand-new triage should attach to — either the pending
  // placeholder's own encounter (carried through on resume) or, absent any
  // active triage, the patient's own already-open encounter. Without this the
  // saved triage carried no encounterId at all and the Escalate/LWBS row
  // actions (which require one) never appeared for a walk-in.
  const [encounterIdForNewTriage, setEncounterIdForNewTriage] = useState<string | undefined>(undefined);
  // Guards the patient-select effect below so it resolves a pending/active
  // triage (or restores a draft) once per patient selection rather than on
  // every re-render triggered by the live triage subscription.
  const resumeCheckedPatientRef = useRef<string | null>(null);
  const [draftRestoredNotice, setDraftRestoredNotice] = useState(false);

  const [triageData, setTriageData] = useState<TriageResult>({
    airway: '', breathing: '', circulation: '', consciousness: '', priority: '',
  });
  const [triagePatientId, setTriagePatientId] = useState(lockedPatientId ?? initialPatientId ?? '');
  const [triagePatientSearch, setTriagePatientSearch] = useState('');
  // Inline search for the "Recent Triages" list (right column).
  const [historySearch, setHistorySearch] = useState('');
  // "Now" for the station queue's Wait column — sampled in an effect (render
  // stays pure) and refreshed every minute, the same pattern EhrClinicalDashboard
  // uses for its own queue clock, so a nurse watching the board sees wait
  // times actually age instead of freezing at whenever the page first loaded.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [triageVitals, setTriageVitals] = useState({
    temperature: '', pulse: '', respiratoryRate: '', systolic: '', diastolic: '',
    oxygenSaturation: '', weight: '', height: '', painScore: '', bloodGlucose: '', gcs: '', muac: '',
  });
  const [triageContext, setTriageContext] = useState<{
    modeOfArrival: 'walk-in' | 'ambulance' | 'referral' | 'police' | 'other' | '';
    symptomDuration: string;
    referralSource: string;
    knownAllergies: string;
  }>({
    modeOfArrival: '', symptomDuration: '', referralSource: '', knownAllergies: '',
  });
  const [triageComplaint, setTriageComplaint] = useState('');
  const [triageNotes, setTriageNotes] = useState('');
  const [presentationCategory, setPresentationCategory] = useState<'medical' | 'trauma' | 'obstetric' | 'mental_health' | 'other'>('medical');
  const [redCriteria, setRedCriteria] = useState<string[]>([]);
  const [yellowCriteria, setYellowCriteria] = useState<string[]>([]);
  const [capillaryRefillSeconds, setCapillaryRefillSeconds] = useState('');
  const [pregnancyStatus, setPregnancyStatus] = useState<'not_pregnant' | 'pregnant' | 'postpartum' | 'unknown' | 'not_applicable'>('unknown');
  const [gestationalAgeWeeks, setGestationalAgeWeeks] = useState('');
  const [injuryMechanism, setInjuryMechanism] = useState('');
  const [infectionRiskSigns, setInfectionRiskSigns] = useState<string[]>([]);
  const [isolationRequired, setIsolationRequired] = useState(false);
  const [preArrivalCare, setPreArrivalCare] = useState('');
  const [immediateInterventions, setImmediateInterventions] = useState('');
  const [triageDisposition, setTriageDisposition] = useState<TriageDisposition>('general_clinic');
  const [destinationClinic, setDestinationClinic] = useState('');
  const [assignedProviderId, setAssignedProviderId] = useState('');
  const [handoffNote, setHandoffNote] = useState('');
  const [overrideVitalUrgency, setOverrideVitalUrgency] = useState(false);
  const [vitalUrgencyOverrideReason, setVitalUrgencyOverrideReason] = useState('');
  // Manual upgrade: the complement of the override above. That flow lets a
  // nurse save BELOW the computed recommendation with a reason; this is the
  // only path that lets a nurse go the other way and mark a patient MORE
  // urgent than everything else on the form computes, for a reason no
  // structured field captures (e.g. safeguarding concern, gut instinct on a
  // vulnerable patient). Never lower via this control.
  const [manualPriorityRaise, setManualPriorityRaise] = useState<'RED' | 'YELLOW' | ''>('');
  const [manualUpgradeReason, setManualUpgradeReason] = useState('');
  // Light-touch intake fields with no dedicated TriageDoc column (see the
  // report) — folded into `notes` on save with a clear label.
  const [currentMedications, setCurrentMedications] = useState('');
  const [chronicConditionsSelected, setChronicConditionsSelected] = useState<string[]>([]);
  // Per-vital "couldn't measure this" reason, keyed by field. Presence of a
  // key (even '') means the nurse has flagged that vital as unmeasured.
  const [unmeasuredVitalReasons, setUnmeasuredVitalReasons] = useState<Partial<Record<TriageVitalField, string>>>({});
  const [triageSubmitting, setTriageSubmitting] = useState(false);
  const [activeSection, setActiveSection] = useState('patient');
  // Station queue: exclude terminal-status triages by default (a queue, not a
  // log of everyone ever triaged) with an opt-in to also show today's.
  const [showCompletedToday, setShowCompletedToday] = useState(false);

  // Triage auto-calculate
  useEffect(() => {
    const priority = calculateTriagePriority(triageData);
    if (priority !== triageData.priority) {
      setTriageData(prev => ({ ...prev, priority }));
    }
  }, [triageData]);

  const triagePatientMatches = useMemo(() => {
    const q = triagePatientSearch.trim().toLowerCase();
    if (q.length < 2 || triagePatientId) return [];
    return patients.filter(p =>
      patientFullName(p).toLowerCase().includes(q) ||
      (p.hospitalNumber || '').toLowerCase().includes(q)
    ).slice(0, 6);
  }, [triagePatientSearch, patients, triagePatientId]);

  const selectedTriagePatient = useMemo(
    () => lockedPatient && lockedPatient._id === triagePatientId
      ? lockedPatient
      : patients.find(p => p._id === triagePatientId) || null,
    [lockedPatient, triagePatientId, patients]
  );
  const selectedPatientAge = selectedTriagePatient ? patientAge(selectedTriagePatient) ?? undefined : undefined;
  // FRACTIONAL, not whole years — required by getTriageVitalWarnings' IITT
  // infant age bands (< 8 days RED, < 6 months YELLOW, MUAC eligibility from
  // 0.5y). `selectedPatientAge` above rounds to whole years, so every infant
  // under 12 months read as age 0 and matched the same neonatal-emergency
  // band regardless of whether they were 1 day or 11 months old — the exact
  // mismatch the service layer now guards against server-side. Feeding the
  // rounded value here just meant the nurse's live preview disagreed with
  // what the save would actually enforce.
  const selectedPatientAgeExact = selectedTriagePatient ? patientAgeYearsExact(selectedTriagePatient) ?? undefined : undefined;
  const triagePathway = selectedPatientAge !== undefined && selectedPatientAge < 12
    ? 'pediatric_under_12' as const
    : 'adult_12_plus' as const;
  /**
   * Pregnant, by the same signal the chart header's pregnancy pill uses: an
   * ANC record that has not yet been linked to a birth. IITT's only numeric
   * blood-pressure rule is a pregnancy rule and it is a RED one, so triage has
   * to know this or a pre-eclamptic reading passes silently.
   */
  const isSelectedPatientPregnant = useMemo(() => {
    if (!selectedTriagePatient) return false;
    return (ancVisits || []).some(visit => visit.patientId === selectedTriagePatient._id && !visit.linkedBirthId);
  }, [ancVisits, selectedTriagePatient]);
  const vitalErrors = useMemo(() => validateTriageVitals(triageVitals), [triageVitals]);
  const isPregnantForVitals = isSelectedPatientPregnant || pregnancyStatus === 'pregnant';
  const vitalWarnings = useMemo(
    () => getTriageVitalWarnings(triageVitals, selectedPatientAgeExact, { isPregnant: isPregnantForVitals }),
    [triageVitals, selectedPatientAgeExact, isPregnantForVitals],
  );
  const warningByVital = useMemo(() => {
    const result = new Map<TriageVitalField, TriageVitalWarning>();
    for (const item of vitalWarnings) {
      const current = result.get(item.field);
      if (!current || item.urgency === 'RED') result.set(item.field, item);
    }
    return result;
  }, [vitalWarnings]);
  const calculatedBmi = useMemo(
    () => calculateBmi(triageVitals.weight, triageVitals.height),
    [triageVitals.height, triageVitals.weight],
  );
  const vitalRecommendedPriority = recommendTriagePriority(triageData.priority, vitalWarnings);
  const capillaryRefillValue = parseStrictVitalNumber(capillaryRefillSeconds);
  const recommendedPriority = redCriteria.length > 0 || (capillaryRefillValue !== null && capillaryRefillValue > 3)
    ? 'RED'
    : yellowCriteria.length > 0 && isLowerTriagePriority(vitalRecommendedPriority, 'YELLOW')
      ? 'YELLOW'
      : vitalRecommendedPriority;
  const recommendationRaisesPriority = isLowerTriagePriority(triageData.priority, recommendedPriority);
  const effectivePriority = recommendationRaisesPriority && !overrideVitalUrgency
    ? recommendedPriority
    : triageData.priority;
  // Manual raise: priorities strictly ABOVE the computed effective priority.
  // RED has nothing higher, so it offers no options — this control can only
  // ever move a patient UP, never down (the existing override above keeps
  // sole ownership of "save below what was computed").
  const manualRaiseOptions: Array<'RED' | 'YELLOW'> = effectivePriority === 'GREEN'
    ? ['YELLOW', 'RED']
    : effectivePriority === 'YELLOW'
      ? ['RED']
      : [];
  const effectiveManualPriorityRaise = manualPriorityRaise && manualRaiseOptions.includes(manualPriorityRaise)
    ? manualPriorityRaise
    : '';
  const finalPriority = effectiveManualPriorityRaise || effectivePriority;
  const recordedPregnancyStatus = pregnancyStatus === 'unknown' && isSelectedPatientPregnant
    ? 'pregnant'
    : pregnancyStatus;
  const availableProviders = useMemo(() => users.filter(user =>
    user.isActive !== false &&
    ['doctor', 'clinical_officer', 'clinician', 'medical_superintendent'].includes(user.role) &&
    (!currentUser?.hospitalId || !user.hospitalId || user.hospitalId === currentUser.hospitalId)
  ), [currentUser?.hospitalId, users]);
  const destinationOptions = useMemo(
    () => facilitySettings.departments.filter(Boolean),
    [facilitySettings.departments],
  );
  const resolvedDestinationClinic = destinationClinic || destinationOptions[0] || '';
  const selectedProvider = availableProviders.find(provider => provider._id === assignedProviderId);

  // Load an already-saved triage back into the form for correction (behavior:
  // edit-saved-record). Uses updateTriage on the next save, keeping the id.
  const loadTriageForEdit = (ti: typeof triageHistory[number]) => {
    setEditingTriageId(ti._id);
    // A correction targets an already-identified record directly — it is
    // never also "resume this pending placeholder", and any encounterId this
    // save needs is already on the record itself (updateTriage preserves
    // fields it isn't given), so neither piece of new-triage bookkeeping
    // applies here.
    setResumePendingTriageId(null);
    setEncounterIdForNewTriage(undefined);
    // These have no TriageDoc field of their own (see the report) and are
    // folded into `notes` as free text on save — there is nothing structured
    // to read back out of an existing record, so a correction starts blank
    // rather than guessing at a previous save's wording.
    setManualPriorityRaise('');
    setManualUpgradeReason('');
    setCurrentMedications('');
    setChronicConditionsSelected([]);
    setUnmeasuredVitalReasons({});
    setDraftRestoredNotice(false);
    setTriagePatientId(ti.patientId);
    setTriagePatientSearch('');
    // 'not_assessed' (clerical check-in, KAN-100) maps to the form's unset
    // state — the nurse must make the actual assessment, not inherit one.
    const formValue = <T extends string>(v: string | undefined): T =>
      (v === 'not_assessed' ? '' : v || '') as T;
    setTriageData({
      airway: formValue<TriageResult['airway']>(ti.airway),
      breathing: formValue<TriageResult['breathing']>(ti.breathing),
      circulation: formValue<TriageResult['circulation']>(ti.circulation),
      consciousness: formValue<TriageResult['consciousness']>(ti.consciousness),
      priority: (ti.priority as TriageResult['priority']) || '',
    });
    setTriageVitals({
      temperature: ti.temperature || '',
      pulse: ti.pulse || '',
      respiratoryRate: ti.respiratoryRate || '',
      systolic: ti.systolic || '',
      diastolic: ti.diastolic || '',
      oxygenSaturation: ti.oxygenSaturation || '',
      weight: ti.weight || '',
      height: ti.height || '',
      painScore: ti.painScore || '',
      bloodGlucose: ti.bloodGlucose || '',
      gcs: ti.gcs || '',
      muac: ti.muac || '',
    });
    setTriageContext({
      modeOfArrival: (ti.modeOfArrival as typeof triageContext.modeOfArrival) || '',
      symptomDuration: ti.symptomDuration || '',
      referralSource: ti.referralSource || '',
      knownAllergies: ti.knownAllergies || '',
    });
    setTriageComplaint(ti.chiefComplaint || '');
    setTriageNotes(ti.notes || '');
    setPresentationCategory(ti.presentationCategory || 'medical');
    setRedCriteria(ti.redCriteria || []);
    setYellowCriteria(ti.yellowCriteria || []);
    setCapillaryRefillSeconds(ti.capillaryRefillSeconds || '');
    setPregnancyStatus(ti.pregnancyStatus || 'unknown');
    setGestationalAgeWeeks(ti.gestationalAgeWeeks || '');
    setInjuryMechanism(ti.injuryMechanism || '');
    setInfectionRiskSigns(ti.infectionRiskSigns || []);
    setIsolationRequired(Boolean(ti.isolationRequired));
    setPreArrivalCare(ti.preArrivalCare || '');
    setImmediateInterventions(ti.immediateInterventions || '');
    setTriageDisposition(ti.disposition || 'general_clinic');
    setDestinationClinic(ti.destinationClinic || '');
    setAssignedProviderId(ti.assignedProviderId || '');
    setHandoffNote(ti.handoffNote || '');
    setOverrideVitalUrgency(Boolean(ti.vitalUrgencyOverridden));
    setVitalUrgencyOverrideReason(ti.vitalUrgencyOverrideReason || '');
  };

  // Prefill from a clerical walk-in placeholder (KAN-100: front-desk check-in
  // creates a 'pending', assessmentSource:'clerical_checkin' triage with real
  // front-desk vitals/complaint/allergies but ABCC left `not_assessed`). Never
  // touches ABCC or priority — those must come from this nurse's own
  // assessment — and never overwrites a field the nurse has already typed
  // into (relevant when this runs after a draft already seeded the form).
  const prefillFromPendingTriage = (ti: TriageDoc) => {
    setTriageVitals(previous => ({
      temperature: previous.temperature || ti.temperature || '',
      pulse: previous.pulse || ti.pulse || '',
      respiratoryRate: previous.respiratoryRate || ti.respiratoryRate || '',
      systolic: previous.systolic || ti.systolic || '',
      diastolic: previous.diastolic || ti.diastolic || '',
      oxygenSaturation: previous.oxygenSaturation || ti.oxygenSaturation || '',
      weight: previous.weight || ti.weight || '',
      height: previous.height || ti.height || '',
      painScore: previous.painScore || ti.painScore || '',
      bloodGlucose: previous.bloodGlucose || '',
      gcs: previous.gcs || '',
      muac: previous.muac || '',
    }));
    setTriageComplaint(previous => previous || ti.chiefComplaint || '');
    setTriageNotes(previous => previous || ti.notes || '');
    setTriageContext(previous => ({
      modeOfArrival: previous.modeOfArrival || (ti.modeOfArrival as typeof previous.modeOfArrival) || '',
      symptomDuration: previous.symptomDuration || ti.symptomDuration || '',
      referralSource: previous.referralSource || ti.referralSource || '',
      knownAllergies: previous.knownAllergies || ti.knownAllergies || '',
    }));
  };

  const applyTriageDraft = (draft: TriageDraft) => {
    setTriageData(draft.abcc);
    setTriageVitals(draft.vitals);
    setTriageContext(draft.context);
    setTriageComplaint(draft.complaint);
    setTriageNotes(draft.notes);
    setPresentationCategory(draft.presentationCategory);
    setRedCriteria(draft.redCriteria);
    setYellowCriteria(draft.yellowCriteria);
    setCapillaryRefillSeconds(draft.capillaryRefillSeconds);
    setPregnancyStatus(draft.pregnancyStatus);
    setGestationalAgeWeeks(draft.gestationalAgeWeeks);
    setInjuryMechanism(draft.injuryMechanism);
    setInfectionRiskSigns(draft.infectionRiskSigns);
    setIsolationRequired(draft.isolationRequired);
    setPreArrivalCare(draft.preArrivalCare);
    setImmediateInterventions(draft.immediateInterventions);
    setTriageDisposition(draft.disposition);
    setDestinationClinic(draft.destinationClinic);
    setAssignedProviderId(draft.assignedProviderId);
    setHandoffNote(draft.handoffNote);
    setOverrideVitalUrgency(draft.overrideVitalUrgency);
    setVitalUrgencyOverrideReason(draft.vitalUrgencyOverrideReason);
    setCurrentMedications(draft.currentMedications);
    setChronicConditionsSelected(draft.chronicConditions);
    setUnmeasuredVitalReasons(draft.unmeasuredVitalReasons as Partial<Record<TriageVitalField, string>>);
    setManualPriorityRaise(draft.manualPriorityRaise);
    setManualUpgradeReason(draft.manualUpgradeReason);
    setEditingTriageId(draft.editingTriageId);
    setResumePendingTriageId(draft.resumePendingTriageId);
    setEncounterIdForNewTriage(draft.encounterId ?? undefined);
  };

  // Runs once per patient selection (guarded by resumeCheckedPatientRef, reset
  // by clearForm): restores an in-progress draft for this patient if one
  // exists, and otherwise resolves whether this patient already has a triage
  // in flight — a clerical walk-in placeholder to resume/prefill, or an
  // already-assessed record to correct instead of duplicating — and which
  // encounter a brand-new triage should attach to.
  useEffect(() => {
    const patientId = selectedTriagePatient?._id;
    // The lookup is one-shot per patient, so it must not spend its shot
    // before auth (and with it the data scope) has hydrated — on a locked
    // /triage/[patientId] load the patient id is available on the very first
    // render, when useDataScope() is still undefined and the local replica
    // may still be seeding. Consuming the ref then meant the clerical
    // placeholder was never found and never prefilled.
    if (!patientId || !dataScope) return;
    if (resumeCheckedPatientRef.current === patientId) return;
    resumeCheckedPatientRef.current = patientId;
    // A manual "Edit" from the recent-triages list already set
    // editingTriageId (and its own resumePendingTriageId/encounterId reset)
    // synchronously, in the same tick as selecting this patient — running the
    // draft/pending lookup below would either overwrite that deliberate
    // choice with an unrelated stale draft, or needlessly re-derive bookkeeping
    // this component already knows. Nothing left to resolve.
    if (editingTriageId) return;
    let cancelled = false;
    (async () => {
      const draft = await loadTriageDraft(patientId);
      if (cancelled) return;
      if (draft) {
        applyTriageDraft(draft);
        setDraftRestoredNotice(true);
        return;
      }
      try {
        const { findActiveTriageForPatient } = await import('@/lib/services/triage-service');
        const active = await findActiveTriageForPatient(patientId, dataScope);
        if (cancelled) return;
        if (active?.status === 'pending') {
          prefillFromPendingTriage(active);
          setResumePendingTriageId(active._id);
          setEncounterIdForNewTriage(active.encounterId);
        } else if (active?.status === 'seen') {
          loadTriageForEdit(active);
        } else if (currentUser?.hospitalId) {
          const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
          const openEncounter = await findOpenEncounterForPatient(patientId, currentUser.hospitalId);
          if (!cancelled && openEncounter) setEncounterIdForNewTriage(openEncounter._id);
        }
      } catch (err) {
        console.error('Could not resolve an existing triage/encounter for this patient:', err);
      }
    })();
    return () => { cancelled = true; };
    // `!!dataScope` (not the object) so scope HYDRATION re-arms the un-consumed
    // one-shot without identity churn re-triggering it after it has run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTriagePatient?._id, !!dataScope]);

  // Debounced autosave while assessing — protects the in-progress ETAT
  // against a refresh, a crash, or a tablet sleeping mid-assessment. Only the
  // raw form fields are stored (see triage-draft.ts); nothing derived.
  useEffect(() => {
    const patientId = selectedTriagePatient?._id;
    if (!patientId) return;
    const timer = setTimeout(() => {
      const draft: TriageDraft = {
        version: 1,
        patientId,
        abcc: triageData,
        vitals: triageVitals,
        context: triageContext,
        complaint: triageComplaint,
        notes: triageNotes,
        presentationCategory,
        redCriteria,
        yellowCriteria,
        capillaryRefillSeconds,
        pregnancyStatus,
        gestationalAgeWeeks,
        injuryMechanism,
        infectionRiskSigns,
        isolationRequired,
        preArrivalCare,
        immediateInterventions,
        disposition: triageDisposition,
        destinationClinic,
        assignedProviderId,
        handoffNote,
        overrideVitalUrgency,
        vitalUrgencyOverrideReason,
        currentMedications,
        chronicConditions: chronicConditionsSelected,
        unmeasuredVitalReasons,
        manualPriorityRaise,
        manualUpgradeReason,
        editingTriageId,
        resumePendingTriageId,
        encounterId: encounterIdForNewTriage ?? null,
      };
      void saveTriageDraft(patientId, draft);
    }, 800);
    return () => clearTimeout(timer);
  }, [
    selectedTriagePatient?._id, triageData, triageVitals, triageContext, triageComplaint, triageNotes,
    presentationCategory, redCriteria, yellowCriteria, capillaryRefillSeconds, pregnancyStatus,
    gestationalAgeWeeks, injuryMechanism, infectionRiskSigns, isolationRequired, preArrivalCare,
    immediateInterventions, triageDisposition, destinationClinic, assignedProviderId, handoffNote,
    overrideVitalUrgency, vitalUrgencyOverrideReason, currentMedications, chronicConditionsSelected,
    unmeasuredVitalReasons, manualPriorityRaise, manualUpgradeReason, editingTriageId,
    resumePendingTriageId, encounterIdForNewTriage,
  ]);

  // Clears everything the patient-select effect above derives — the resume/
  // edit/encounter bookkeeping — so switching the PATIENT never leaves one
  // patient's resume target attached to a different patient's save. Without
  // this, clearing the picker and choosing someone else kept whatever
  // `resumePendingTriageId`/`encounterIdForNewTriage` the first patient had
  // resolved to, and the next save would have resumed (or attached to) THEIR
  // record instead of the new patient's.
  const resetTriageBookkeeping = () => {
    setEditingTriageId(null);
    setResumePendingTriageId(null);
    setEncounterIdForNewTriage(undefined);
    setDraftRestoredNotice(false);
    resumeCheckedPatientRef.current = null;
  };

  // A changed ABCC selection, IITT criterion, capillary refill reading or
  // pregnancy status can all change the RECOMMENDED priority the override
  // reason was attesting against — not just a raw vital. Previously only the
  // vitals' own onChange reset this attestation, so a nurse could tick a new
  // RED danger sign after already overriding down to GREEN and save with a
  // now-stale reason that no longer matches what it is overriding.
  const resetVitalOverride = () => {
    setOverrideVitalUrgency(false);
    setVitalUrgencyOverrideReason('');
  };

  // Disposition a triaged patient straight from the queue row — mark them seen,
  // admit, discharge, or refer onward — without re-opening the full form. Each
  // transition persists via updateTriage so the queue, ward acuity, and the
  // patient timeline stay consistent.
  const setTriageStatus = async (
    ti: typeof triageHistory[number],
    status: 'seen' | 'admitted' | 'discharged' | 'referred',
    label: string,
  ) => {
    // Discharge closes the triage record for good (VALID_TRANSITIONS has no
    // edge out of 'discharged') — the same one-way-door confirm
    // EhrClinicalDashboard already asks before escalate/LWBS, so a mis-tapped
    // row-menu entry doesn't silently end a patient's visit.
    if (status === 'discharged' && !window.confirm(t('nurse.triageDischargeConfirm', { name: ti.patientName }))) return;
    try {
      // updateTriage resolves with the updated doc or throws (an illegal
      // transition, a lost update conflict after retries, a failed vital
      // safety check) — it never resolves to a falsy value, so there is
      // nothing to null-check here; a rejected status change reaches the
      // catch block below instead.
      await updateTriageRecord(ti._id, { status }, currentActor);
      showToast(t('nurse.triageStatusUpdated', { name: ti.patientName, status: label }), 'success');
    } catch {
      showToast(t('nurse.triageStatusFailed'), 'error');
    }
  };

  // LWBS and emergency escalation act on the ENCOUNTER (KAN-100): the state
  // machine removes the visit from waiting worklists (lwbs is terminal;
  // escalation hands the visit to emergency care). The triage doc mirrors
  // lwbs so this queue stops showing a patient who has left. Both are
  // one-way — same confirm pattern EhrClinicalDashboard uses for its own
  // copies of these two actions.
  const markLeftWithoutBeingSeen = async (ti: typeof triageHistory[number]) => {
    if (!window.confirm(t('nurse.triageLwbsConfirm', { name: ti.patientName }))) return;
    try {
      const { recordLeftWithoutBeingSeen } = await import('@/lib/services/encounter-service');
      await recordLeftWithoutBeingSeen(ti.encounterId!, { actorId: currentUser?._id });
      // updateTriage resolves with the updated doc or throws — see the note
      // in setTriageStatus above.
      await updateTriageRecord(ti._id, { status: 'lwbs' }, currentActor);
      showToast(t('nurse.triageStatusUpdated', { name: ti.patientName, status: t('nurse.triageActionLwbs') }), 'success');
    } catch {
      showToast(t('nurse.triageStatusFailed'), 'error');
    }
  };

  const escalateToEmergency = async (ti: typeof triageHistory[number]) => {
    if (!window.confirm(t('nurse.triageEscalateConfirm', { name: ti.patientName }))) return;
    try {
      const { getEncounter, transitionEncounter, escalateEncounterToEmergency } =
        await import('@/lib/services/encounter-service');
      // A clerical check-in leaves the encounter at awaiting_triage, which has
      // no escalation edge by design (an escalation asserts an assessment).
      // The nurse escalating IS the assessment — take the visit into triage
      // first, then escalate, instead of throwing on the deteriorating
      // patient this button exists for.
      const enc = await getEncounter(ti.encounterId!);
      if (enc?.status === 'awaiting_triage') {
        await transitionEncounter(ti.encounterId!, 'in_triage', {
          actorId: currentUser?._id, actorRole: currentUser?.role,
        });
      }
      await escalateEncounterToEmergency(ti.encounterId!, { actorId: currentUser?._id });
      // Mirror onto the triage doc like LWBS above does — the waiting queues
      // are triage-derived, so without this the escalated patient stayed at
      // the top of the triage queue as the most urgent person in the building.
      // 'referred' is the existing "handed onward" terminal the queue drops.
      // updateTriage resolves with the updated doc or throws — see the note
      // in setTriageStatus above.
      await updateTriageRecord(ti._id, { status: 'referred' }, currentActor);
      showToast(t('nurse.triageStatusUpdated', { name: ti.patientName, status: t('nurse.triageActionEscalate') }), 'success');
    } catch {
      showToast(t('nurse.triageStatusFailed'), 'error');
    }
  };

  // Empty the form. On the per-patient page the patient survives the clear —
  // the nurse is there to triage that one person, and dropping the selection
  // would leave a form with no subject on a page that is about them.
  const clearForm = (options: { discardDraft?: boolean } = {}) => {
    const draftPatientId = selectedTriagePatient?._id;
    setEditingTriageId(null);
    setResumePendingTriageId(null);
    setEncounterIdForNewTriage(undefined);
    setDraftRestoredNotice(false);
    setTriageData({ airway: '', breathing: '', circulation: '', consciousness: '', priority: '' });
    setTriagePatientId(lockedPatientId ?? '');
    setTriagePatientSearch('');
    setTriageVitals({ temperature: '', pulse: '', respiratoryRate: '', systolic: '', diastolic: '', oxygenSaturation: '', weight: '', height: '', painScore: '', bloodGlucose: '', gcs: '', muac: '' });
    setTriageContext({ modeOfArrival: '', symptomDuration: '', referralSource: '', knownAllergies: '' });
    setTriageComplaint('');
    setTriageNotes('');
    setPresentationCategory('medical');
    setRedCriteria([]);
    setYellowCriteria([]);
    setCapillaryRefillSeconds('');
    setPregnancyStatus('unknown');
    setGestationalAgeWeeks('');
    setInjuryMechanism('');
    setInfectionRiskSigns([]);
    setIsolationRequired(false);
    setPreArrivalCare('');
    setImmediateInterventions('');
    setTriageDisposition('general_clinic');
    setDestinationClinic('');
    setAssignedProviderId('');
    setHandoffNote('');
    setOverrideVitalUrgency(false);
    setVitalUrgencyOverrideReason('');
    setManualPriorityRaise('');
    setManualUpgradeReason('');
    setCurrentMedications('');
    setChronicConditionsSelected([]);
    setUnmeasuredVitalReasons({});
    // Let the patient-select effect re-resolve a pending/active triage (or a
    // fresh draft) rather than treating this patient as "already checked" —
    // relevant when Reset is pressed but the locked-patient page keeps the
    // same patient selected.
    resumeCheckedPatientRef.current = null;
    if (options.discardDraft && draftPatientId) void dropTriageDraft(draftPatientId);
  };

  const triagePriorityColor = (priority: string) => {
    switch (priority) {
      case 'RED': return { bg: 'var(--color-danger)', text: '#FFF', label: t('nurse.priorityRedLabel') };
      case 'YELLOW': return { bg: 'var(--color-warning)', text: '#000', label: t('nurse.priorityYellowLabel') };
      case 'GREEN': return { bg: 'var(--color-success)', text: '#000', label: t('nurse.priorityGreenLabel') };
      default: return { bg: 'var(--text-muted)', text: '#FFF', label: t('nurse.priorityDefaultLabel') };
    }
  };

  const handleSubmitTriage = async () => {
    if (!selectedTriagePatient) {
      showToast(t('nurse.selectPatientFirst'), 'error');
      return;
    }
    // Require all four ABCC assessments explicitly (don't rely on the derived
    // priority happening to be truthy only when all four are set).
    if (!triageData.airway || !triageData.breathing || !triageData.circulation || !triageData.consciousness || !triageData.priority) {
      showToast(t('nurse.completeAbcc'), 'error');
      return;
    }
    // A valid triaging user is required so the audit trail is never blank.
    if (!currentUser?._id) {
      showToast(t('nurse.noActiveUser'), 'error');
      return;
    }
    const firstVitalError = Object.values(vitalErrors)[0];
    if (firstVitalError) {
      showToast(firstVitalError, 'error');
      document.getElementById('triage-vital-safety-summary')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const capillaryRefill = parseStrictVitalNumber(capillaryRefillSeconds);
    if (capillaryRefillSeconds.trim() && (capillaryRefill === null || capillaryRefill < 0 || capillaryRefill > 10)) {
      showToast('Capillary refill must be between 0 and 10 seconds.', 'error');
      return;
    }
    const gestationalAge = parseStrictVitalNumber(gestationalAgeWeeks);
    if (gestationalAgeWeeks.trim() && (gestationalAge === null || !Number.isInteger(gestationalAge) || gestationalAge < 0 || gestationalAge > 45)) {
      showToast('Gestational age must be a whole number from 0 to 45 weeks.', 'error');
      return;
    }
    if (recommendationRaisesPriority && overrideVitalUrgency && !vitalUrgencyOverrideReason.trim()) {
      showToast('Record a clinical reason before overriding the recommended urgency.', 'error');
      document.getElementById('triage-vital-override-reason')?.focus();
      return;
    }
    if (manualPriorityRaiseNeedsReason(effectiveManualPriorityRaise, manualUpgradeReason)) {
      showToast(t('nurse.raiseReasonRequired'), 'error');
      document.getElementById('triage-manual-raise-reason')?.focus();
      return;
    }
    try {
      setTriageSubmitting(true);
      const now = new Date().toISOString();
      // Every light-touch field below (medications, chronic conditions, why a
      // vital is missing, the manual-raise reason) has no TriageDoc column of
      // its own — see the report — so they fold into one clearly labelled
      // notes string rather than being silently dropped.
      const composedNotes = composeTriageIntakeNotes({
        baseNotes: triageNotes,
        currentMedications,
        chronicConditions: chronicConditionsSelected,
        unmeasuredVitalReasons,
        manualPriorityRaise: effectiveManualPriorityRaise,
        manualUpgradeReason,
      });
      // Shared field payload for both create and correct-an-existing-record paths.
      const payload = {
        airway: triageData.airway as 'clear' | 'obstructed',
        breathing: triageData.breathing as 'normal' | 'distressed' | 'absent',
        circulation: triageData.circulation as 'normal' | 'impaired' | 'absent',
        consciousness: triageData.consciousness as 'alert' | 'verbal' | 'pain' | 'unresponsive',
        // This form IS the clinician assessment — the submit guard above
        // refuses to save until every ABCC dimension is chosen (KAN-100).
        assessmentSource: 'clinician' as const,
        // The manually-raised priority (if any) is the one actually saved —
        // it is presented as the effective priority throughout the UI, so the
        // record must agree with what the nurse was shown.
        priority: finalPriority as 'RED' | 'YELLOW' | 'GREEN',
        temperature: triageVitals.temperature || undefined,
        pulse: triageVitals.pulse || undefined,
        respiratoryRate: triageVitals.respiratoryRate || undefined,
        systolic: triageVitals.systolic || undefined,
        diastolic: triageVitals.diastolic || undefined,
        oxygenSaturation: triageVitals.oxygenSaturation || undefined,
        weight: triageVitals.weight || undefined,
        height: triageVitals.height || undefined,
        bmi: calculatedBmi || undefined,
        painScore: triageVitals.painScore || undefined,
        bloodGlucose: triageVitals.bloodGlucose || undefined,
        gcs: triageVitals.gcs || undefined,
        muac: triageVitals.muac || undefined,
        vitalUrgencyRecommendation: recommendationRaisesPriority
          ? recommendedPriority as 'RED' | 'YELLOW' | 'GREEN'
          : undefined,
        vitalUrgencyWarnings: vitalWarnings.length > 0 ? vitalWarnings : undefined,
        vitalUrgencyOverridden: recommendationRaisesPriority && overrideVitalUrgency,
        vitalUrgencyOverrideReason: recommendationRaisesPriority && overrideVitalUrgency
          ? vitalUrgencyOverrideReason.trim()
          : undefined,
        modeOfArrival: triageContext.modeOfArrival || undefined,
        symptomDuration: triageContext.symptomDuration || undefined,
        referralSource: triageContext.referralSource || undefined,
        knownAllergies: triageContext.knownAllergies || undefined,
        presentationCategory,
        triagePathway,
        redCriteria,
        yellowCriteria,
        capillaryRefillSeconds: capillaryRefillSeconds || undefined,
        pregnancyStatus: recordedPregnancyStatus,
        gestationalAgeWeeks: recordedPregnancyStatus === 'pregnant' && gestationalAgeWeeks
          ? gestationalAgeWeeks
          : undefined,
        injuryMechanism: presentationCategory === 'trauma' && injuryMechanism
          ? injuryMechanism
          : undefined,
        infectionRiskSigns,
        isolationRequired,
        preArrivalCare: preArrivalCare || undefined,
        immediateInterventions: immediateInterventions || undefined,
        chiefComplaint: triageComplaint || undefined,
        notes: composedNotes,
        disposition: triageDisposition,
        destinationClinic: destinationClinic || undefined,
        assignedProviderId: assignedProviderId || undefined,
        assignedProviderName: selectedProvider?.name || undefined,
        handoffStatus: assignedProviderId ? 'assigned' as const : 'awaiting_provider' as const,
        handoffNote: handoffNote || undefined,
      };
      // The saved record's id, so the encounter can point back at the
      // assessment that routed it.
      let created: Awaited<ReturnType<typeof createTriageRecord>> | null = null;
      if (editingTriageId) {
        // Correct an already-saved record in place — keeps the same id so the
        // patient chart history points at one record, not a duplicate. A
        // record still sitting at 'pending' (e.g. a clerical check-in,
        // KAN-100, that this save is now giving its first real ETAT) advances
        // past it here too — otherwise it joins the same "finished assessment
        // stuck at Awaiting Triage forever" bug fixed below for new records.
        // updateTriage resolves with the updated doc or throws (invalid
        // transition, lost-update conflict, failed vital safety check) — the
        // catch block below is what handles a rejected save; there is no
        // falsy "it silently failed" result to check for.
        const existingTriage = triageHistory.find(h => h._id === editingTriageId);
        await updateTriageRecord(
          editingTriageId,
          existingTriage?.status === 'pending' ? { ...payload, status: 'seen' } : payload,
          currentActor,
        );
      } else {
        // `resumePendingTriageId` — set by the patient-select effect below
        // when this patient already has a clerical walk-in placeholder
        // (KAN-100) — routes this straight into createTriage's resume path:
        // the placeholder is completed via updateTriage instead of a second
        // triage record being created for the same visit.
        const createPayload = {
          patientId: selectedTriagePatient._id,
          patientName: patientFullName(selectedTriagePatient),
          hospitalNumber: selectedTriagePatient.hospitalNumber,
          ...payload,
          triagedBy: currentUser?._id || '',
          triagedByName: currentUser?.name || 'Unknown Nurse',
          triagedAt: now,
          facilityId: currentUser?.hospitalId,
          facilityName: currentUser?.hospitalName,
          orgId: currentUser?.orgId,
          // A completed ETAT (the submit guard above requires every ABCC
          // dimension) is past triage, not still awaiting it. 'pending' here
          // meant buildQueueFromTriage classified every nurse-assessed
          // patient as `awaiting_triage` and no doctor's worklist ever
          // picked them up — the worst break in the triage → doctor handoff.
          status: 'seen' as const,
          // The visit this triage belongs to — the resumed placeholder's own
          // encounter, or (no pending triage, but an open encounter already
          // exists) that encounter. Without this a brand-new triage saved
          // with no encounterId at all, which is what left the Escalate/LWBS
          // row actions permanently hidden for every walk-in this form triaged.
          ...(encounterIdForNewTriage ? { encounterId: encounterIdForNewTriage } : {}),
        };
        try {
          created = await createTriageRecord(createPayload, { resumePendingId: resumePendingTriageId || undefined, actor: currentActor });
        } catch (error) {
          // The placeholder can arrive AFTER the patient-select effect looked
          // for it (delayed sync — a device that came online mid-assessment).
          // The guard names the record it found, so complete that one instead
          // of asking the nurse to re-enter a finished assessment.
          const dup = error as { code?: string; existingTriageId?: string };
          if (dup?.code === 'DUPLICATE_ACTIVE_TRIAGE' && dup.existingTriageId && !resumePendingTriageId) {
            created = await createTriageRecord(createPayload, { resumePendingId: dup.existingTriageId, actor: currentActor });
          } else {
            throw error;
          }
        }
      }
      const triageId = editingTriageId ?? created?._id;
      if (!triageId) throw new Error('The triage record has no id.');
      const today = jubaDate();
      const currentVisit = appointments.find(appointment =>
        appointment.patientId === selectedTriagePatient._id &&
        appointment.appointmentDate === today &&
        !APPOINTMENT_CLOSED_STATUSES.includes(appointment.status)
      );
      const { completeTriageHandoff } = await import('@/lib/services/triage-handoff-service');
      await completeTriageHandoff({
        triageId,
        patientId: selectedTriagePatient._id,
        patientName: patientFullName(selectedTriagePatient),
        appointmentId: currentVisit?._id,
        disposition: triageDisposition,
        destinationClinic: resolvedDestinationClinic || undefined,
        assignedProviderId: assignedProviderId || undefined,
        assignedProviderName: selectedProvider?.name,
        handoffNote: handoffNote || undefined,
        actorId: currentUser?._id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        hospitalId: currentUser?.hospitalId || selectedTriagePatient.registrationHospital,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      showToast(t('nurse.triageSaved', { priority: finalPriority, name: patientFullName(selectedTriagePatient) }), 'success');
      // The assessment is safely on the record — the draft that shadowed it
      // (if any) would otherwise "restore" a completed triage's own contents
      // back over whatever the nurse starts filling in next for this patient.
      await dropTriageDraft(selectedTriagePatient._id);
      // A focused patient assessment is complete: close its page and return
      // to the queue that launched it. Embedded stations remain ready for the
      // next patient instead.
      if (onSaved) onSaved();
      else clearForm();
    } catch (err) {
      console.error(err);
      // Duck-typed on DuplicateActiveTriageError's discriminant `code` rather
      // than an `instanceof` import — every other reference to the triage
      // service in this component goes through `await import(...)` so it
      // never gets pulled into the client bundle at parse time; importing
      // just the error CLASS to type-check it here would undo that.
      if ((err as { code?: unknown } | undefined)?.code === 'DUPLICATE_ACTIVE_TRIAGE') {
        // The patient-select effect below should have already resolved this
        // into a resume/edit before the nurse ever got to Save — reaching
        // here means the active triage appeared after that check ran (another
        // station triaged the same patient in the meantime). Refreshing the
        // list is safer than silently overwriting or duplicating a record.
        showToast(t('nurse.triageDuplicateActive'), 'error');
      } else {
        // Keep form data intact so the nurse can retry
        showToast(t('nurse.triageSaveFailed'), 'error');
      }
    } finally {
      setTriageSubmitting(false);
    }
  };

  // On the per-patient page the list is that patient's own triage history —
  // every other person's is noise on a page about one of them.
  const scopedHistory = lockedPatientId
    ? triageHistory.filter(ti => ti.patientId === lockedPatientId)
    : triageHistory;
  const histQ = historySearch.trim().toLowerCase();
  const filteredHistory = histQ
    ? scopedHistory.filter(ti => (ti.patientName || '').toLowerCase().includes(histQ) || (ti.chiefComplaint || '').toLowerCase().includes(histQ))
    : scopedHistory;
  // The station list is a QUEUE (who still needs attention right now), not a
  // log of everyone ever triaged — terminal statuses drop out by default,
  // with an opt-in to also see today's, and whoever remains sorts most
  // urgent (RED, then YELLOW, then GREEN) and longest-waiting first within
  // the same acuity. The per-patient page's own "Triage history" is a real
  // history across visits and keeps its plain newest-first order.
  const stationQueueRows = useMemo(
    () => sortTriageQueueRows(selectTriageQueueRows(filteredHistory, { includeCompletedToday: showCompletedToday, todayIso: todayIso() })),
    [filteredHistory, showCompletedToday],
  );
  const displayedTriageRows = lockedPatientId ? filteredHistory : stationQueueRows;

  const triageSections = [
    { id: 'patient', label: 'Patient & complaint', icon: ClipboardList, detail: selectedTriagePatient ? 'Identity confirmed' : 'Select patient' },
    { id: 'assessment', label: 'ABCC assessment', icon: AlertTriangle, detail: triageData.priority ? 'Assessment complete' : 'Required' },
    { id: 'danger', label: 'IITT danger signs', icon: AlertTriangle, detail: redCriteria.length ? `${redCriteria.length} red` : yellowCriteria.length ? `${yellowCriteria.length} yellow` : 'Screen all signs' },
    { id: 'vitals', label: 'Vitals', icon: Activity, detail: 'Record observations' },
    { id: 'context', label: 'Visit context', icon: Clock, detail: 'Arrival & history' },
    { id: 'handoff', label: 'Provider handoff', icon: Send, detail: assignedProviderId ? 'Provider selected' : 'Assign later' },
    { id: 'notes', label: 'Notes & save', icon: ClipboardList, detail: triageData.priority ? 'Ready to save' : 'Final review' },
  ] as const;

  const goToTriageSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(`triage-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={lockedPatientId ? 'omrs-reg triage-reg' : 'flex flex-col lg:flex-row gap-4'} style={{ flex: 1, minHeight: 0 }}>
      {lockedPatientId && (
        <aside className="omrs-reg-rail" aria-label="Triage progress">
          <h1 className="omrs-reg-title">Patient triage</h1>
          {selectedTriagePatient && (
            <div className="triage-rail-patient">
              <div className="triage-patient-photo">
                <div className="triage-patient-photo-frame">
                  {(selectedTriagePatient as { photoUrl?: string }).photoUrl
                    ? <img src={(selectedTriagePatient as { photoUrl?: string }).photoUrl} alt={patientFullName(selectedTriagePatient)} />
                    : <span className="text-3xl font-semibold" style={{ color: 'var(--accent-primary)' }}>{initials(patientFullName(selectedTriagePatient))}</span>}
                </div>
                <span className="triage-patient-photo-label">Patient photo</span>
              </div>
              <strong>{patientFullName(selectedTriagePatient)}</strong>
              <span>{[selectedTriagePatient.hospitalNumber, patientGenderAge(selectedTriagePatient)].filter(Boolean).join(' · ')}</span>
              <button type="button" onClick={() => router.push(`/patients/${selectedTriagePatient._id}`)} className="triage-rail-chart-link">
                Open chart
              </button>
            </div>
          )}
          <p className="omrs-reg-railnote">Complete the assessment from top to bottom, then save the triage record.</p>
          <p className="omrs-reg-jump">Assessment steps</p>
          <nav className="omrs-reg-nav" aria-label="Triage sections">
            {triageSections.map(section => {
              const isCurrent = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => goToTriageSection(section.id)}
                  className={`omrs-reg-navitem${isCurrent ? ' is-current' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span className="omrs-reg-navarrow" aria-hidden>↳</span>
                  <span className="omrs-reg-navlabel">{section.label}</span>
                  <span className="omrs-reg-navmeta">{section.detail}</span>
                </button>
              );
            })}
          </nav>
          <div className="omrs-reg-railactions">
            <button
              type="button"
              onClick={handleSubmitTriage}
              disabled={triageSubmitting || !triageData.priority || !selectedTriagePatient}
              className="btn btn-primary"
            >
              {triageSubmitting ? t('nurse.saving') : editingTriageId ? t('action.saveChanges') : t('nurse.saveTriage')}
            </button>
            <button type="button" onClick={() => clearForm({ discardDraft: true })} disabled={triageSubmitting} className="btn btn-secondary">
              {t('nurse.reset')}
            </button>
          </div>
        </aside>
      )}

      <div data-tour="triage-form" className={lockedPatientId ? 'omrs-reg-form patient-registration-shell triage-reg-form' : 'lg:flex-[2] dash-card overflow-hidden flex flex-col'} style={{ padding: lockedPatientId ? 0 : undefined, minHeight: 0 }}>
        {!lockedPatientId && (
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: '#FF9933' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.etatTriageAssessment')}</h3>
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {/* RED count is every RED triage the department still owes
                  attention to — pending, or seen but not yet in an active
                  consultation — not just status==='pending'. The old
                  predicate dropped a RED patient from this count the instant
                  a nurse marked them 'seen', long before a doctor picked them
                  up, understating how many critical patients were still
                  waiting. */}
              {t('nurse.triageHeaderSummary', { today: triageHistory.filter(ti => (ti.triagedAt || '').startsWith(todayIso())).length, red: countActiveRedTriage(triageHistory) })}
            </span>
          </div>
        )}
        <div className={lockedPatientId ? 'patient-registration-card-body' : 'p-4 space-y-4 flex-1 overflow-y-auto'}>
          <div className={lockedPatientId ? 'omrs-reg-section' : 'space-y-4'}>
            {lockedPatientId && <div className="omrs-reg-sectionhead"><h2>ETAT assessment</h2><p>Record the patient identity, immediate risk, observations, and handoff context.</p></div>}
            <div className={lockedPatientId ? 'omrs-reg-fields space-y-4' : 'space-y-4'}>
          {draftRestoredNotice && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33,145,208,0.25))' }}>
              <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>
                {t('nurse.draftRestoredNotice')}
              </span>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => clearForm({ discardDraft: true })}
                  className="text-[10px] font-semibold"
                  style={{ color: 'var(--color-danger)' }}
                >
                  {t('nurse.discardDraft')}
                </button>
                <button
                  type="button"
                  onClick={() => setDraftRestoredNotice(false)}
                  className="text-[10px] font-semibold inline-flex items-center gap-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-3 h-3" /> {t('action.dismiss')}
                </button>
              </div>
            </div>
          )}
          {!lockedPatientId && <>
          {/* Patient picker */}
          <div id="triage-section-patient" className="relative scroll-mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nurse.patient')}</label>
            {selectedTriagePatient ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33, 145, 208,0.25))' }}>
                <div className="flex items-baseline gap-2 min-w-0">
                  <p className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                    {patientFullName(selectedTriagePatient)}
                  </p>
                  <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                    {selectedTriagePatient.hospitalNumber} · {patientGenderAge(selectedTriagePatient)}
                  </p>
                </div>
                {/* No clear button on the per-patient page: the patient is the
                    page, not a field on it. */}
                {!lockedPatientId && (
                  <button onClick={() => { setTriagePatientId(''); setTriagePatientSearch(''); setOverrideVitalUrgency(false); setVitalUrgencyOverrideReason(''); resetTriageBookkeeping(); }} className="p-1.5 rounded-lg flex-shrink-0" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={triagePatientSearch}
                  onChange={e => setTriagePatientSearch(e.target.value)}
                  placeholder={t('nurse.searchPatientPlaceholder')}
                  className="w-full px-3 py-1 rounded-lg text-[10px]"
                  style={{
                    background: 'var(--overlay-subtle)',
                    border: '1px solid var(--border-light)',
                    color: 'var(--text-primary)',
                  }}
                />
                {triagePatientMatches.length > 0 && (
                  <div className="absolute start-0 end-0 mt-1 rounded-xl overflow-hidden z-10" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg)' }}>
                    {triagePatientMatches.map(p => (
                      <button
                        key={p._id}
                        onClick={() => { setTriagePatientId(p._id); setTriagePatientSearch(''); setOverrideVitalUrgency(false); setVitalUrgencyOverrideReason(''); resetTriageBookkeeping(); }}
                        className="w-full text-start px-3 py-2 text-xs hover:bg-[var(--overlay-subtle)]"
                        style={{ borderBottom: '1px solid var(--border-light)' }}
                      >
                        <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{patientFullName(p)}</div>
                        <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber} · {p.gender}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          </>}

          {/* Chief complaint */}
          <div id={lockedPatientId ? 'triage-section-patient' : undefined} className="scroll-mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nurse.chiefComplaint')}</label>
            <input
              type="text"
              value={triageComplaint}
              onChange={e => setTriageComplaint(e.target.value)}
              placeholder={t('nurse.chiefComplaintPlaceholder')}
              className="w-full px-3 py-2 rounded-xl text-sm"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
          </div>

          {(Object.keys(vitalErrors).length > 0 || vitalWarnings.length > 0) && (
            <div
              id="triage-vital-safety-summary"
              role="alert"
              aria-live="polite"
              className="p-3 rounded-xl"
              style={{
                background: Object.keys(vitalErrors).length > 0 || vitalWarnings.some(item => item.urgency === 'RED')
                  ? 'rgba(224, 49, 39,0.10)'
                  : 'rgba(255, 127, 0,0.12)',
                border: `1px solid ${Object.keys(vitalErrors).length > 0 || vitalWarnings.some(item => item.urgency === 'RED')
                  ? 'var(--color-danger)'
                  : 'var(--color-warning)'}`,
              }}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: Object.keys(vitalErrors).length > 0 || vitalWarnings.some(item => item.urgency === 'RED') ? 'var(--color-danger)' : 'var(--color-warning)' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {Object.keys(vitalErrors).length > 0
                      ? 'Vital signs need correction before Save'
                      : recommendedPriority
                        ? `Clinical safety warning · Recommended ${recommendedPriority}`
                        : 'Clinical safety warning · Complete ABCC to calculate urgency'}
                  </p>
                  {Object.entries(vitalErrors).map(([field, message]) => (
                    <p key={field} className="text-[10px] mt-1" style={{ color: 'var(--color-danger)' }}>{message}</p>
                  ))}
                  {vitalWarnings.map(item => (
                    <p key={item.code} className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                      <strong>{item.urgency}:</strong> {item.message}
                    </p>
                  ))}
                  {recommendationRaisesPriority && !overrideVitalUrgency && (
                    <p className="text-[10px] font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>
                      Save will use {recommendedPriority} instead of the ABCC-only {triageData.priority} priority.
                    </p>
                  )}
                  {recommendationRaisesPriority && (
                    <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
                      <label className="flex items-start gap-2 text-[10px] font-semibold cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                        <input
                          type="checkbox"
                          checked={overrideVitalUrgency}
                          onChange={event => setOverrideVitalUrgency(event.target.checked)}
                          className="mt-0.5"
                        />
                        Override and save at the ABCC-only {triageData.priority} priority
                      </label>
                      {overrideVitalUrgency && (
                        <div className="mt-2">
                          <label htmlFor="triage-vital-override-reason" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--color-danger)' }}>
                            Clinical reason for override (required)
                          </label>
                          <textarea
                            id="triage-vital-override-reason"
                            rows={2}
                            value={vitalUrgencyOverrideReason}
                            onChange={event => setVitalUrgencyOverrideReason(event.target.value)}
                            placeholder="Document reassessment findings and why the lower urgency is clinically appropriate."
                            className="w-full px-2 py-1.5 rounded-lg text-xs mt-1"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--color-danger)', color: 'var(--text-primary)' }}
                            required
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ABCC Assessment */}
          <div id="triage-section-assessment" className="grid grid-cols-1 sm:grid-cols-2 gap-3 scroll-mt-3">
            {/* Airway */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Wind className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.airway')}</span>
              </div>
              <div className="flex gap-2">
                {(['clear', 'obstructed'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setTriageData(prev => ({ ...prev, airway: prev.airway === opt ? '' : opt })); resetVitalOverride(); }}
                    title={triageData.airway === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.airway === opt
                        ? (opt === 'clear' ? 'rgba(79, 199, 155,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.airway === opt
                        ? (opt === 'clear' ? 'var(--color-success)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.airway === opt
                        ? (opt === 'clear' ? 'rgba(79, 199, 155,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt === 'clear' ? t('nurse.airwayClear') : t('nurse.airwayObstructed')}
                  </button>
                ))}
              </div>
            </div>

            {/* Breathing */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4" style={{ color: 'var(--chart-3)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.breathing')}</span>
              </div>
              <div className="flex gap-2">
                {(['normal', 'distressed', 'absent'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setTriageData(prev => ({ ...prev, breathing: prev.breathing === opt ? '' : opt })); resetVitalOverride(); }}
                    title={triageData.breathing === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.breathing === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.2)' : opt === 'distressed' ? 'rgba(255, 210, 166,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.breathing === opt
                        ? (opt === 'normal' ? 'var(--color-success)' : opt === 'distressed' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.breathing === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.3)' : opt === 'distressed' ? 'rgba(255, 210, 166,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt === 'normal' ? t('nurse.breathingNormal') : opt === 'distressed' ? t('nurse.breathingDistressed') : t('nurse.breathingAbsent')}
                  </button>
                ))}
              </div>
            </div>

            {/* Circulation */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Heart className="w-4 h-4" style={{ color: 'var(--chart-2)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.circulation')}</span>
              </div>
              <div className="flex gap-2">
                {(['normal', 'impaired', 'absent'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setTriageData(prev => ({ ...prev, circulation: prev.circulation === opt ? '' : opt })); resetVitalOverride(); }}
                    title={triageData.circulation === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.circulation === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.2)' : opt === 'impaired' ? 'rgba(255, 210, 166,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.circulation === opt
                        ? (opt === 'normal' ? 'var(--color-success)' : opt === 'impaired' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.circulation === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.3)' : opt === 'impaired' ? 'rgba(255, 210, 166,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt === 'normal' ? t('nurse.circulationNormal') : opt === 'impaired' ? t('nurse.circulationImpaired') : t('nurse.circulationAbsent')}
                  </button>
                ))}
              </div>
            </div>

            {/* Consciousness (AVPU) */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.consciousnessAvpu')}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 keep-cols">
                {([
                  { key: 'alert' as const, label: t('nurse.avpuAlert') },
                  { key: 'verbal' as const, label: t('nurse.avpuVerbal') },
                  { key: 'pain' as const, label: t('nurse.avpuPain') },
                  { key: 'unresponsive' as const, label: t('nurse.avpuUnresponsive') },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { setTriageData(prev => ({ ...prev, consciousness: prev.consciousness === opt.key ? '' : opt.key })); resetVitalOverride(); }}
                    title={triageData.consciousness === opt.key ? t('action.deselect') : undefined}
                    className="px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'rgba(79, 199, 155,0.2)' : opt.key === 'verbal' ? 'rgba(255, 210, 166,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'var(--color-success)' : opt.key === 'verbal' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'rgba(79, 199, 155,0.3)' : opt.key === 'verbal' ? 'rgba(255, 210, 166,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* WHO/ICRC/MSF Interagency Integrated Triage Tool. ABCC alone does
              not capture trauma, obstetric, exposure, infection or the full
              adult/paediatric danger-sign screen used at first contact. */}
          <div id="triage-section-danger" className="p-3 rounded-xl scroll-mt-3 space-y-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <div>
                <span className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>IITT danger-sign screen</span>
                <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {triagePathway === 'pediatric_under_12' ? 'Pediatric pathway (under 12)' : 'Adult pathway (12+)'} · Any red sign requires immediate high-acuity care.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label htmlFor="triage-presentation-category" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Presentation</label>
                <Select id="triage-presentation-category" value={presentationCategory} onChange={event => setPresentationCategory(event.target.value as typeof presentationCategory)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="medical">Medical</option>
                  <option value="trauma">Trauma / burn</option>
                  <option value="obstetric">Obstetric</option>
                  <option value="mental_health">Mental health / behavioural</option>
                  <option value="other">Other</option>
                </Select>
              </div>
              <div>
                <label htmlFor="triage-capillary-refill" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Capillary refill (seconds)</label>
                <input id="triage-capillary-refill" type="text" inputMode="decimal" value={capillaryRefillSeconds} onChange={event => { setCapillaryRefillSeconds(event.target.value); resetVitalOverride(); }} placeholder="2" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label htmlFor="triage-pregnancy-status" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Pregnancy status</label>
                <Select id="triage-pregnancy-status" value={recordedPregnancyStatus} onChange={event => { setPregnancyStatus(event.target.value as typeof pregnancyStatus); resetVitalOverride(); }} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="unknown">Unknown</option>
                  <option value="not_applicable">Not applicable</option>
                  <option value="not_pregnant">Not pregnant</option>
                  <option value="pregnant">Pregnant</option>
                  <option value="postpartum">Postpartum</option>
                </Select>
              </div>
              {recordedPregnancyStatus === 'pregnant' && (
                <div>
                  <label htmlFor="triage-gestational-age" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Gestational age (weeks)</label>
                  <input id="triage-gestational-age" type="text" inputMode="numeric" value={gestationalAgeWeeks} onChange={event => setGestationalAgeWeeks(event.target.value)} placeholder="28" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
                </div>
              )}
              {presentationCategory === 'trauma' && (
                <div className="sm:col-span-2">
                  <label htmlFor="triage-injury-mechanism" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Injury mechanism</label>
                  <input id="triage-injury-mechanism" type="text" value={injuryMechanism} onChange={event => setInjuryMechanism(event.target.value)} placeholder="Road traffic crash, fall, penetrating injury…" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
                </div>
              )}
            </div>

            <fieldset className="rounded-lg p-2" style={{ border: '1px solid rgba(224,49,39,0.3)', background: 'var(--bg-card)' }}>
              <legend className="px-1 text-[10px] font-bold" style={{ color: 'var(--color-danger)' }}>Red — immediate</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {IITT_RED_CRITERIA.map(([code, label]) => (
                  <label key={code} className="flex items-start gap-2 text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={redCriteria.includes(code)} onChange={event => { setRedCriteria(current => event.target.checked ? [...current, code] : current.filter(item => item !== code)); resetVitalOverride(); }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-lg p-2" style={{ border: '1px solid rgba(255,153,51,0.4)', background: 'var(--bg-card)' }}>
              <legend className="px-1 text-[10px] font-bold" style={{ color: 'var(--color-warning)' }}>Yellow — urgent review</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {IITT_YELLOW_CRITERIA.map(([code, label]) => (
                  <label key={code} className="flex items-start gap-2 text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={yellowCriteria.includes(code)} onChange={event => { setYellowCriteria(current => event.target.checked ? [...current, code] : current.filter(item => item !== code)); resetVitalOverride(); }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-lg p-2" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
              <legend className="px-1 text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>Outbreak / infection screen</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {INFECTION_RISK_SIGNS.map(([code, label]) => (
                  <label key={code} className="flex items-start gap-2 text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={infectionRiskSigns.includes(code)} onChange={event => setInfectionRiskSigns(current => event.target.checked ? [...current, code] : current.filter(item => item !== code))} />
                    <span>{label}</span>
                  </label>
                ))}
                <label className="flex items-start gap-2 text-[10px] font-semibold leading-tight" style={{ color: 'var(--color-danger)' }}>
                  <input type="checkbox" checked={isolationRequired} onChange={event => setIsolationRequired(event.target.checked)} />
                  <span>Separate immediately and apply facility isolation / IPC pathway</span>
                </label>
              </div>
            </fieldset>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="triage-pre-arrival-care" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Care before arrival</label>
                <input id="triage-pre-arrival-care" type="text" value={preArrivalCare} onChange={event => setPreArrivalCare(event.target.value)} placeholder="First aid, medicines, fluids, referral treatment…" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label htmlFor="triage-immediate-interventions" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Immediate interventions</label>
                <input id="triage-immediate-interventions" type="text" value={immediateInterventions} onChange={event => setImmediateInterventions(event.target.value)} placeholder="Airway manoeuvre, oxygen, bleeding control, glucose…" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>

          {/* Triage Result */}
          {triageData.priority && effectivePriority && (
            <div
              className="p-4 rounded-2xl text-center transition-all"
              style={{
                background: triagePriorityColor(finalPriority).bg,
                color: triagePriorityColor(finalPriority).text,
              }}
            >
              <p className="text-base font-bold">{triagePriorityColor(finalPriority).label}</p>
              {recommendationRaisesPriority && (
                <p className="text-[10px] mt-1 font-semibold opacity-90">
                  {overrideVitalUrgency
                    ? `Override selected · recommended ${recommendedPriority}`
                    : `Escalated from ABCC ${triageData.priority} by IITT danger signs or vital-sign warning`}
                </p>
              )}
              {effectiveManualPriorityRaise && (
                <p className="text-[10px] mt-1 font-semibold opacity-90">
                  {t('nurse.raisedByNurse', { reason: manualUpgradeReason.trim() || '—' })}
                </p>
              )}
              {selectedTriagePatient && (
                <p className="text-xs mt-1 opacity-80">{t('nurse.patientLabel', { name: patientFullName(selectedTriagePatient) })}</p>
              )}
            </div>
          )}

          {/* Manual priority raise — the complement of the vital-urgency
              override above. That control only ever lets a nurse save BELOW
              the computed recommendation (with a reason); this is the only
              path in the other direction, for a concern nothing structured on
              the form captures. Not offered once already RED — there is
              nothing higher to raise to. */}
          {triageData.priority && manualRaiseOptions.length > 0 && (
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.raisePriorityAboveComputed')}</span>
              </div>
              <div className="flex gap-2">
                {manualRaiseOptions.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setManualPriorityRaise(current => current === option ? '' : option)}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: effectiveManualPriorityRaise === option ? triagePriorityColor(option).bg : 'var(--bg-card)',
                      color: effectiveManualPriorityRaise === option ? triagePriorityColor(option).text : 'var(--text-secondary)',
                      border: `1px solid ${effectiveManualPriorityRaise === option ? triagePriorityColor(option).bg : 'var(--border-light)'}`,
                    }}
                  >
                    {t('nurse.raiseTo', { label: triagePriorityColor(option).label })}
                  </button>
                ))}
              </div>
              {effectiveManualPriorityRaise && (
                <div className="mt-2">
                  <label htmlFor="triage-manual-raise-reason" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--color-danger)' }}>
                    {t('nurse.raiseReasonLabel')}
                  </label>
                  <textarea
                    id="triage-manual-raise-reason"
                    rows={2}
                    value={manualUpgradeReason}
                    onChange={event => setManualUpgradeReason(event.target.value)}
                    placeholder="What did you observe that the ABCC and danger-sign screen above didn't capture?"
                    className="w-full px-2 py-1.5 rounded-lg text-xs mt-1"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--color-danger)', color: 'var(--text-primary)' }}
                    required
                  />
                </div>
              )}
            </div>
          )}

          {/* Vitals at triage */}
          <div id="triage-section-vitals" className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.vitalsAtTriage')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { field: 'temperature', label: t('nurse.tempC'), placeholder: '37.0', inputMode: 'decimal' },
                { field: 'pulse', label: t('nurse.pulse'), placeholder: '80', inputMode: 'numeric' },
                { field: 'respiratoryRate', label: t('nurse.rr'), placeholder: '18', inputMode: 'numeric' },
                { field: 'oxygenSaturation', label: t('nurse.spo2Pct'), placeholder: '98', inputMode: 'numeric' },
                { field: 'systolic', label: t('nurse.sysBp'), placeholder: '120', inputMode: 'numeric' },
                { field: 'diastolic', label: t('nurse.diaBp'), placeholder: '80', inputMode: 'numeric' },
                { field: 'weight', label: t('nurse.weightKg'), placeholder: '65', inputMode: 'decimal' },
                { field: 'height', label: `${t('vitals.height')} cm`, placeholder: '170', inputMode: 'decimal' },
                { field: 'painScore', label: t('nurse.painScore'), placeholder: '0', inputMode: 'numeric' },
                { field: 'bloodGlucose', label: t('nurse.bloodGlucose'), placeholder: '5.5', inputMode: 'decimal' },
                { field: 'gcs', label: t('nurse.gcs'), placeholder: '15', inputMode: 'numeric' },
                { field: 'muac', label: t('nurse.muac'), placeholder: '23.5', inputMode: 'decimal' },
              ] as const).map(item => (
                <VitalInputField
                  key={item.field}
                  {...item}
                  value={triageVitals[item.field]}
                  error={vitalErrors[item.field]}
                  warning={warningByVital.get(item.field)}
                  unmeasuredReason={unmeasuredVitalReasons[item.field]}
                  onChange={value => {
                    setTriageVitals(previous => ({ ...previous, [item.field]: value }));
                    resetVitalOverride();
                  }}
                  onUnmeasuredReasonChange={reason => {
                    setUnmeasuredVitalReasons(previous => {
                      const next = { ...previous };
                      if (reason === undefined) delete next[item.field];
                      else next[item.field] = reason;
                      return next;
                    });
                    // A reading the nurse can no longer vouch for either way —
                    // clear it so a stale number doesn't silently get saved
                    // once the field is disabled and out of sight.
                    if (reason !== undefined) setTriageVitals(previous => ({ ...previous, [item.field]: '' }));
                    resetVitalOverride();
                  }}
                />
              ))}
              <div data-vital-field="bmi">
                <label htmlFor="triage-bmi" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('vitals.bmi')} kg/m²</label>
                <output id="triage-bmi" aria-live="polite" className="flex items-center" style={{ width: '100%', minHeight: 30, padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: calculatedBmi ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {calculatedBmi || 'Calculated from height and weight'}
                </output>
              </div>
            </div>
          </div>

          {/* Current medications + chronic conditions — light-touch intake.
              TriageDoc has no dedicated column for either (that data lives on
              PatientDoc as a standing record, not this visit's snapshot), so
              both fold into the saved notes as clearly labelled lines — see
              the implementation report. */}
          <div className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="triage-current-medications" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Current medications</label>
                <input
                  id="triage-current-medications"
                  type="text"
                  value={currentMedications}
                  onChange={event => setCurrentMedications(event.target.value)}
                  placeholder="What is the patient already taking?"
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>Chronic conditions</span>
                <div className="flex flex-wrap gap-1.5">
                  {TRIAGE_CHRONIC_CONDITIONS.map(condition => {
                    const selected = chronicConditionsSelected.includes(condition);
                    return (
                      <button
                        key={condition}
                        type="button"
                        onClick={() => setChronicConditionsSelected(current =>
                          selected ? current.filter(item => item !== condition) : [...current, condition])}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
                        style={{
                          background: selected ? 'var(--accent-light)' : 'var(--bg-card)',
                          color: selected ? ACCENT : 'var(--text-secondary)',
                          border: `1px solid ${selected ? 'var(--accent-border, rgba(33,145,208,0.3))' : 'var(--border-light)'}`,
                        }}
                      >
                        {condition}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Triage context */}
          <div id="triage-section-context" className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.triageContext')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.modeOfArrival')}</label>
                <Select value={triageContext.modeOfArrival} onChange={e => setTriageContext({ ...triageContext, modeOfArrival: e.target.value as typeof triageContext.modeOfArrival })} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="">{t('nurse.modeSelectPlaceholder')}</option>
                  <option value="walk-in">{t('nurse.modeWalkIn')}</option>
                  <option value="ambulance">{t('nurse.modeAmbulance')}</option>
                  <option value="referral">{t('nurse.modeReferral')}</option>
                  <option value="police">{t('nurse.modePolice')}</option>
                  <option value="other">{t('nurse.modeOther')}</option>
                </Select>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.symptomDuration')}</label>
                <input type="text" value={triageContext.symptomDuration} onChange={e => setTriageContext({ ...triageContext, symptomDuration: e.target.value })} placeholder={t('nurse.symptomDurationPlaceholder')} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.referralSource')}</label>
                <input type="text" value={triageContext.referralSource} onChange={e => setTriageContext({ ...triageContext, referralSource: e.target.value })} placeholder={t('nurse.referralSourcePlaceholder')} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.knownAllergies')}</label>
                <input type="text" value={triageContext.knownAllergies} onChange={e => setTriageContext({ ...triageContext, knownAllergies: e.target.value })} placeholder={t('nurse.knownAllergiesPlaceholder')} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>

          {/* Disposition and provider handoff */}
          <div id="triage-section-handoff" className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Send className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <div>
                <span className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Disposition & provider handoff</span>
                <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Tell the care team where this patient goes next.</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Destination</label>
                <Select value={triageDisposition} onChange={event => setTriageDisposition(event.target.value as TriageDisposition)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="emergency">Emergency care</option>
                  <option value="general_clinic">General clinic</option>
                  <option value="specialty_clinic">Specialty clinic</option>
                  <option value="home_care">Discharge / home care</option>
                </Select>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Clinic or service</label>
                <input type="text" value={destinationClinic || destinationOptions[0] || ''} onChange={event => setDestinationClinic(event.target.value)} placeholder={destinationOptions[0] || 'Destination clinic'} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Receiving provider</label>
                <Select value={assignedProviderId} onChange={event => setAssignedProviderId(event.target.value)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="">Assign provider later</option>
                  {availableProviders.map(provider => <option key={provider._id} value={provider._id}>{provider.name}{provider.specialty ? ` · ${provider.specialty}` : ''}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Handoff note</label>
                <input type="text" value={handoffNote} onChange={event => setHandoffNote(event.target.value)} placeholder="What should the provider know first?" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div id="triage-section-notes" className="scroll-mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nurse.notesOptional')}</label>
            <textarea
              rows={2}
              value={triageNotes}
              onChange={e => setTriageNotes(e.target.value)}
              placeholder={t('nurse.additionalObservations')}
              className="w-full px-3 py-2 rounded-xl text-sm"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* Editing-an-existing-record banner — makes it clear the next save
              corrects a saved triage rather than creating a new one. */}
          {editingTriageId && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33,145,208,0.25))' }}>
              <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>{t('action.edit')}</span>
              <button
                onClick={() => clearForm({ discardDraft: true })}
                className="text-[10px] font-semibold inline-flex items-center gap-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-3 h-3" /> {t('action.cancel')}
              </button>
            </div>
          )}

          {/* Actions remain at the bottom of the station form. The focused
              patient flow places them in the registration-style rail. */}
          {!lockedPatientId && <div className="flex gap-2">
            <button
              onClick={() => clearForm({ discardDraft: true })}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: 'var(--overlay-subtle)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-light)',
              }}
              disabled={triageSubmitting}
            >
              {t('nurse.reset')}
            </button>
            <button
              onClick={handleSubmitTriage}
              disabled={triageSubmitting || !triageData.priority || !selectedTriagePatient}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all btn btn-primary"
            >
              {triageSubmitting ? t('nurse.saving') : editingTriageId ? t('action.saveChanges') : t('nurse.saveTriage')}
            </button>
          </div>}
          </div>
          </div>
        </div>
      </div>

      {!lockedPatientId && <div data-tour="triage-recent" className="lg:flex-[1] card-elevated overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: ACCENT }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {lockedPatientId ? 'Triage history' : t('nurse.recentTriages')}
            </h3>
          </div>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('nurse.total', { count: scopedHistory.length })}</span>
        </div>
        <div className="px-3 py-2.5 flex items-center gap-2 border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <ListSearch value={historySearch} onChange={setHistorySearch} placeholder={t('nurse.searchPatientPlaceholder')} />
          {/* A queue by default (still-active triages only); this is the
              opt-in to also see who was admitted/discharged/referred/left
              today, without the list defaulting to a lifetime log. */}
          <label className="flex items-center gap-1 text-[9px] font-semibold flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showCompletedToday} onChange={event => setShowCompletedToday(event.target.checked)} />
            {t('nurse.showCompletedToday')}
          </label>
        </div>
        <div className="p-3 flex-1 overflow-y-auto">
          {displayedTriageRows.length === 0 ? (
            <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>{t('nurse.noTriages')}</p>
          ) : (
            <div className="ehr-queue-cards ehr-queue-cards--triage">
              <div className="ehr-queue-guide ehr-queue-guide--triage" aria-hidden="true">
                {['Patient', 'Source', 'Wait', 'Action'].map(head => (
                  <span key={head}>{head}</span>
                ))}
              </div>
              {displayedTriageRows.slice(0, 12).map(ti => {
                const minutesAgo = Math.max(0, Math.floor((nowMs - new Date(ti.triagedAt).getTime()) / 60000));
                const actions: RowAction[] = [
                  { key: 'view', label: t('nurse.triageActionView'), icon: <Eye />, onClick: () => router.push(`/patients/${ti.patientId}?tab=vitals`) },
                  { key: 'edit', label: t('action.edit'), icon: <ClipboardList />, onClick: () => loadTriageForEdit(ti) },
                ];
                if (ti.status !== 'seen' && ti.status !== 'discharged' && ti.status !== 'admitted') {
                  actions.push({ key: 'seen', label: t('nurse.triageActionMarkSeen'), tone: 'success', icon: <CheckCircle2 />, onClick: () => setTriageStatus(ti, 'seen', t('nurse.triageActionMarkSeen')) });
                }
                if (ti.status !== 'admitted') {
                  actions.push({ key: 'admit', label: t('nurse.triageActionAdmit'), icon: <LogIn />, onClick: () => setTriageStatus(ti, 'admitted', t('nurse.triageActionAdmit')) });
                }
                if (ti.status !== 'referred') {
                  actions.push({ key: 'refer', label: t('nurse.triageActionRefer'), icon: <Send />, onClick: () => setTriageStatus(ti, 'referred', t('nurse.triageActionRefer')) });
                }
                if (ti.status !== 'discharged') {
                  actions.push({ key: 'discharge', label: t('nurse.triageActionDischarge'), tone: 'danger', icon: <LogOut />, onClick: () => setTriageStatus(ti, 'discharged', t('nurse.triageActionDischarge')) });
                }
                // Escalation and LWBS act on the visit's encounter, so they
                // are only offered while the patient is still waiting and the
                // triage is linked to one (KAN-100).
                // LWBS also applies once triage is done but no room or provider
                // has freed up — that wait is exactly when patients walk away.
                if ((ti.status === 'pending' || ti.status === 'seen') && ti.encounterId) {
                  if (ti.status === 'pending') actions.push({ key: 'escalate', label: t('nurse.triageActionEscalate'), tone: 'danger', icon: <AlertTriangle />, onClick: () => escalateToEmergency(ti) });
                  actions.push({ key: 'lwbs', label: t('nurse.triageActionLwbs'), icon: <X />, onClick: () => markLeftWithoutBeingSeen(ti) });
                }
                return (
                  <div key={ti._id} className="ehr-queue-card ehr-queue-card--triage" data-triage={ti.priority}>
                    <div className="ehr-queue-patient">
                      <span className="ehr-patient-icon" data-acuity={ti.priority}>
                        {triagePhotoById.get(ti.patientId)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={triagePhotoById.get(ti.patientId)} alt="" className="ehr-patient-icon-photo" />
                          : initials(ti.patientName)}
                      </span>
                      <div className="ehr-queue-patient-text">
                        {/* Clicking a patient in a triage list opens their own
                            triage page — this list is a queue of people to
                            triage, so the name leads to triaging them rather
                            than to the chart. The chart is still one row-menu
                            entry away. On that page itself the name is already
                            the subject, so it is plain text. */}
                        {lockedPatientId ? (
                          <span className="ehr-queue-name">{shortenPersonName(ti.patientName)}</span>
                        ) : (
                          <button type="button" className="ehr-queue-name" onClick={() => router.push(`/triage/${ti.patientId}`)} title={`Triage ${ti.patientName}`}>
                            {shortenPersonName(ti.patientName)}
                          </button>
                        )}
                        <p>{ti.chiefComplaint || t('nurse.noComplaintRecorded')}</p>
                      </div>
                    </div>

                    <div className="ehr-queue-cell ehr-queue-muted-cell">
                      {modeOfArrivalLabel(ti.modeOfArrival, t)}
                    </div>

                    <div className="ehr-queue-cell ehr-queue-num-col">
                      <div className="ehr-queue-wait">
                        <strong>{new Date(ti.triagedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</strong>
                        <small>{waitLabel(minutesAgo)}</small>
                      </div>
                    </div>

                    <div className="ehr-queue-actions">
                      <RowActionsMenu ariaLabel={t('nurse.colActions')} actions={actions} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
