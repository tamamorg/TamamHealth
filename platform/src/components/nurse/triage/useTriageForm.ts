'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { useANC } from '@/lib/hooks/useANC';
import { useTriage } from '@/lib/hooks/useTriage';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { type TriageResult, calculateTriagePriority } from '../shared';
import { type TriageDisposition, type TriageDoc } from '@/lib/db-types';
import { type TriageVitalField, validateTriageVitals, getTriageVitalWarnings, type TriageVitalWarning, calculateBmi, recommendTriagePriority, parseStrictVitalNumber, isLowerTriagePriority } from '@/lib/clinical/vitals';
import { patientFullName, patientAge, patientAgeYearsExact } from '@/lib/patient-utils';
import { type TriageDraft, loadTriageDraft, saveTriageDraft, dropTriageDraft } from '@/lib/triage-draft';
import { manualPriorityRaiseNeedsReason, composeTriageIntakeNotes } from '../triage-intake-notes';
import { mayAutoResume } from './triage-helpers';
import { jubaDate } from '@/lib/time-juba';
import { APPOINTMENT_CLOSED_STATUSES } from '@/lib/appointment-status';
import { sortTriageQueueRows, selectTriageQueueRows } from '../triage-queue';
import { todayIso } from '@/lib/date-utils';
import { ClipboardList, AlertTriangle, Activity, Clock, Send } from '@/components/icons/lucide';
import type { TriageWorkflowProps } from './types';

export function useTriageForm({
  initialPatientId,
  lockedPatientId,
  lockedPatient,
  onSaved,
}: TriageWorkflowProps) {
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
  const confirm = useConfirm();
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
  // Read out of the user once so the memo below depends on the FIELD rather
  // than on the whole user object: a dependency list naming a property of an
  // object the body reads is narrower than the compiler can infer, and it
  // skips optimizing the component rather than guess.
  const myHospitalId = currentUser?.hospitalId;
  const availableProviders = useMemo(() => users.filter(user =>
    user.isActive !== false &&
    ['doctor', 'clinical_officer', 'clinician', 'medical_superintendent'].includes(user.role) &&
    (!myHospitalId || !user.hospitalId || user.hospitalId === myHospitalId)
  ), [myHospitalId, users]);
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
        } else if (myHospitalId) {
          const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
          const openEncounter = await findOpenEncounterForPatient(patientId, myHospitalId);
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
    if (status === 'discharged' && !await confirm({
      title: t('nurse.triageDischargeTitle', { name: ti.patientName }),
      message: t('nurse.triageDischargeConfirm', { name: ti.patientName }),
      confirmLabel: t('nurse.triageDischargeAction'),
      tone: 'warning',
    })) return;
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
    if (!await confirm({
      title: t('nurse.triageLwbsTitle', { name: ti.patientName }),
      message: t('nurse.triageLwbsConfirm', { name: ti.patientName }),
      confirmLabel: t('nurse.triageLwbsAction'),
      tone: 'danger',
    })) return;
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
    if (!await confirm({
      title: t('nurse.triageEscalateTitle', { name: ti.patientName }),
      message: t('nurse.triageEscalateConfirm', { name: ti.patientName }),
      confirmLabel: t('nurse.triageEscalateAction'),
      tone: 'danger',
    })) return;
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
      showToast('Enter a capillary refill time between 0 and 10 seconds.', 'error');
      return;
    }
    const gestationalAge = parseStrictVitalNumber(gestationalAgeWeeks);
    if (gestationalAgeWeeks.trim() && (gestationalAge === null || !Number.isInteger(gestationalAge) || gestationalAge < 0 || gestationalAge > 45)) {
      showToast('Enter gestational age as a whole number of weeks, from 0 to 45.', 'error');
      return;
    }
    if (recommendationRaisesPriority && overrideVitalUrgency && !vitalUrgencyOverrideReason.trim()) {
      showToast('Enter a clinical reason to override the recommended urgency.', 'error');
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
          facilityId: myHospitalId,
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
          // of asking the nurse to re-enter a finished assessment — but ONLY
          // when that record is still the unassessed placeholder. The error
          // carries just an id, not the record's own status/source, so it must
          // be re-read before resuming onto it: without this check, a record
          // that arrived as someone else's completed 'seen' assessment (a
          // different station triaged the same patient in the meantime, or —
          // on a multi-org replica — a same-id collision from another tenant)
          // would silently be overwritten via updateTriage, which lets a
          // seen → seen write through with no guard of its own.
          const dup = error as { code?: string; existingTriageId?: string };
          let existing: TriageDoc | undefined;
          if (dup?.code === 'DUPLICATE_ACTIVE_TRIAGE' && dup.existingTriageId && !resumePendingTriageId) {
            const { findActiveTriageForPatient } = await import('@/lib/services/triage-service');
            existing = dataScope ? await findActiveTriageForPatient(selectedTriagePatient._id, dataScope) : undefined;
          }
          if (existing && existing._id === dup.existingTriageId && mayAutoResume(existing)) {
            created = await createTriageRecord(createPayload, { resumePendingId: existing._id, actor: currentActor });
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
      if (!dataScope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
      await completeTriageHandoff({
        scope: dataScope,
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
        hospitalId: myHospitalId || selectedTriagePatient.registrationHospital,
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
        // here means either the active triage appeared after that check ran
        // (another station triaged the same patient in the meantime), or the
        // create-path retry above found one but it was someone else's
        // completed assessment rather than the unassessed placeholder
        // (`mayAutoResume` above refused it). Either way, refreshing the list
        // is safer than silently overwriting or duplicating a record.
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

  return {
    t,
    router,
    currentUser,
    facilitySettings,
    patients,
    users,
    ancVisits,
    triagePhotoById,
    triageHistory,
    createTriageRecord,
    updateTriageRecord,
    appointments,
    showToast,
    confirm,
    dataScope,
    currentActor,
    editingTriageId,
    setEditingTriageId,
    resumePendingTriageId,
    setResumePendingTriageId,
    encounterIdForNewTriage,
    setEncounterIdForNewTriage,
    resumeCheckedPatientRef,
    draftRestoredNotice,
    setDraftRestoredNotice,
    triageData,
    setTriageData,
    triagePatientId,
    setTriagePatientId,
    triagePatientSearch,
    setTriagePatientSearch,
    historySearch,
    setHistorySearch,
    nowMs,
    setNowMs,
    triageVitals,
    setTriageVitals,
    triageContext,
    setTriageContext,
    triageComplaint,
    setTriageComplaint,
    triageNotes,
    setTriageNotes,
    presentationCategory,
    setPresentationCategory,
    redCriteria,
    setRedCriteria,
    yellowCriteria,
    setYellowCriteria,
    capillaryRefillSeconds,
    setCapillaryRefillSeconds,
    pregnancyStatus,
    setPregnancyStatus,
    gestationalAgeWeeks,
    setGestationalAgeWeeks,
    injuryMechanism,
    setInjuryMechanism,
    infectionRiskSigns,
    setInfectionRiskSigns,
    isolationRequired,
    setIsolationRequired,
    preArrivalCare,
    setPreArrivalCare,
    immediateInterventions,
    setImmediateInterventions,
    triageDisposition,
    setTriageDisposition,
    destinationClinic,
    setDestinationClinic,
    assignedProviderId,
    setAssignedProviderId,
    handoffNote,
    setHandoffNote,
    overrideVitalUrgency,
    setOverrideVitalUrgency,
    vitalUrgencyOverrideReason,
    setVitalUrgencyOverrideReason,
    manualPriorityRaise,
    setManualPriorityRaise,
    manualUpgradeReason,
    setManualUpgradeReason,
    currentMedications,
    setCurrentMedications,
    chronicConditionsSelected,
    setChronicConditionsSelected,
    unmeasuredVitalReasons,
    setUnmeasuredVitalReasons,
    triageSubmitting,
    setTriageSubmitting,
    activeSection,
    setActiveSection,
    showCompletedToday,
    setShowCompletedToday,
    triagePatientMatches,
    selectedTriagePatient,
    selectedPatientAge,
    selectedPatientAgeExact,
    triagePathway,
    isSelectedPatientPregnant,
    vitalErrors,
    isPregnantForVitals,
    vitalWarnings,
    warningByVital,
    calculatedBmi,
    vitalRecommendedPriority,
    capillaryRefillValue,
    recommendedPriority,
    recommendationRaisesPriority,
    effectivePriority,
    manualRaiseOptions,
    effectiveManualPriorityRaise,
    finalPriority,
    recordedPregnancyStatus,
    myHospitalId,
    availableProviders,
    destinationOptions,
    resolvedDestinationClinic,
    selectedProvider,
    loadTriageForEdit,
    prefillFromPendingTriage,
    applyTriageDraft,
    resetTriageBookkeeping,
    resetVitalOverride,
    setTriageStatus,
    markLeftWithoutBeingSeen,
    escalateToEmergency,
    clearForm,
    triagePriorityColor,
    handleSubmitTriage,
    scopedHistory,
    histQ,
    filteredHistory,
    stationQueueRows,
    displayedTriageRows,
    triageSections,
    goToTriageSection,
    lockedPatientId,
    onSaved,
  };
}

export type TriageFormState = ReturnType<typeof useTriageForm>;
