'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTriage } from '@/lib/hooks/useTriage';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { APPOINTMENT_CLOSED_STATUSES } from '@/lib/appointment-status';
import type { PatientDoc, TriageDisposition } from '@/lib/db-types';
import { jubaDate } from '@/lib/time-juba';
import { useToast } from '@/components/Toast';
import { patientFullName, patientGenderAge, initials } from '@/lib/patient-utils';
import { isVitalInRange, VITAL_RANGES } from '@/lib/clinical/vitals';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  Activity, Clock, X, AlertTriangle, Wind, Brain, Heart,
  Eye, ClipboardList, CheckCircle2, LogIn, LogOut, Send,
} from '@/components/icons/lucide';
import {
  ACCENT, calculateTriagePriority, type TriageResult,
} from './shared';
import { waitLabel } from '@/components/ehr/EhrVisitPopup';
import ListSearch from './ListSearch';
import RowActionsMenu, { type RowAction } from '@/components/referrals/RowActionsMenu';
import Select from '@/components/Select';

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
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const facilitySettings = useSettings();
  const { patients } = usePatients();
  const { users } = useUsers();
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

  // When set, the form is correcting an already-saved triage record rather
  // than creating a new one. Lets a nurse fix a mistyped vital / mis-tapped
  // ABCC option after saving — the audit trail keeps the record id stable.
  const [editingTriageId, setEditingTriageId] = useState<string | null>(null);

  const [triageData, setTriageData] = useState<TriageResult>({
    airway: '', breathing: '', circulation: '', consciousness: '', priority: '',
  });
  const [triagePatientId, setTriagePatientId] = useState(lockedPatientId ?? initialPatientId ?? '');
  const [triagePatientSearch, setTriagePatientSearch] = useState('');
  // Inline search for the "Recent Triages" list (right column).
  const [historySearch, setHistorySearch] = useState('');
  // "Now" for the recent-triages Wait column — captured once on mount rather
  // than read from Date.now() during render (impure). Live-ish, not live: no
  // ticking interval, matching the spec for this list.
  const [nowMs] = useState(() => Date.now());
  const [triageVitals, setTriageVitals] = useState({
    temperature: '', pulse: '', respiratoryRate: '', systolic: '', diastolic: '',
    oxygenSaturation: '', weight: '', painScore: '', bloodGlucose: '', gcs: '', muac: '',
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
  const [triageDisposition, setTriageDisposition] = useState<TriageDisposition>('general_clinic');
  const [destinationClinic, setDestinationClinic] = useState('');
  const [assignedProviderId, setAssignedProviderId] = useState('');
  const [handoffNote, setHandoffNote] = useState('');
  const [triageSubmitting, setTriageSubmitting] = useState(false);
  const [activeSection, setActiveSection] = useState('patient');

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
    setTriageDisposition(ti.disposition || 'general_clinic');
    setDestinationClinic(ti.destinationClinic || '');
    setAssignedProviderId(ti.assignedProviderId || '');
    setHandoffNote(ti.handoffNote || '');
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
    try {
      // updateTriage never throws on an illegal/failed transition — it
      // swallows the error and resolves null. Without this check a rejected
      // status change still showed the success toast below.
      const updated = await updateTriageRecord(ti._id, { status });
      if (!updated) {
        showToast(t('nurse.triageStatusFailed'), 'error');
        return;
      }
      showToast(t('nurse.triageStatusUpdated', { name: ti.patientName, status: label }), 'success');
    } catch {
      showToast(t('nurse.triageStatusFailed'), 'error');
    }
  };

  // LWBS and emergency escalation act on the ENCOUNTER (KAN-100): the state
  // machine removes the visit from waiting worklists (lwbs is terminal;
  // escalation hands the visit to emergency care). The triage doc mirrors
  // lwbs so this queue stops showing a patient who has left.
  const markLeftWithoutBeingSeen = async (ti: typeof triageHistory[number]) => {
    try {
      const { recordLeftWithoutBeingSeen } = await import('@/lib/services/encounter-service');
      await recordLeftWithoutBeingSeen(ti.encounterId!, { actorId: currentUser?._id });
      // updateTriage never throws on an illegal/failed transition — it
      // swallows the error and resolves null, which previously still hit the
      // success toast below while the triage record stayed 'pending' forever.
      const updated = await updateTriageRecord(ti._id, { status: 'lwbs' });
      if (!updated) {
        showToast(t('nurse.triageStatusFailed'), 'error');
        return;
      }
      showToast(t('nurse.triageStatusUpdated', { name: ti.patientName, status: t('nurse.triageActionLwbs') }), 'success');
    } catch {
      showToast(t('nurse.triageStatusFailed'), 'error');
    }
  };

  const escalateToEmergency = async (ti: typeof triageHistory[number]) => {
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
      const updated = await updateTriageRecord(ti._id, { status: 'referred' });
      if (!updated) {
        showToast(t('nurse.triageStatusFailed'), 'error');
        return;
      }
      showToast(t('nurse.triageStatusUpdated', { name: ti.patientName, status: t('nurse.triageActionEscalate') }), 'success');
    } catch {
      showToast(t('nurse.triageStatusFailed'), 'error');
    }
  };

  // Empty the form. On the per-patient page the patient survives the clear —
  // the nurse is there to triage that one person, and dropping the selection
  // would leave a form with no subject on a page that is about them.
  const clearForm = () => {
    setEditingTriageId(null);
    setTriageData({ airway: '', breathing: '', circulation: '', consciousness: '', priority: '' });
    setTriagePatientId(lockedPatientId ?? '');
    setTriagePatientSearch('');
    setTriageVitals({ temperature: '', pulse: '', respiratoryRate: '', systolic: '', diastolic: '', oxygenSaturation: '', weight: '', painScore: '', bloodGlucose: '', gcs: '', muac: '' });
    setTriageContext({ modeOfArrival: '', symptomDuration: '', referralSource: '', knownAllergies: '' });
    setTriageComplaint('');
    setTriageNotes('');
    setTriageDisposition('general_clinic');
    setDestinationClinic('');
    setAssignedProviderId('');
    setHandoffNote('');
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
    // Validate any entered vitals are numeric and physiologically plausible,
    // so garbage strings ("abc", "999") are never persisted to the record.
    // Maps each triage form field to its key in the shared VITAL_RANGES table
    // (the form labels SpO₂ as `oxygenSaturation`; the shared table uses `spo2`).
    const vitalFieldMap: Record<keyof typeof triageVitals, keyof typeof VITAL_RANGES> = {
      temperature: 'temperature', pulse: 'pulse', respiratoryRate: 'respiratoryRate',
      systolic: 'systolic', diastolic: 'diastolic', oxygenSaturation: 'spo2', weight: 'weight',
      painScore: 'painScore', bloodGlucose: 'bloodGlucose', gcs: 'gcs', muac: 'muac',
    };
    for (const key of Object.keys(vitalFieldMap) as (keyof typeof triageVitals)[]) {
      if (!isVitalInRange(vitalFieldMap[key], triageVitals[key])) {
        showToast(t('nurse.invalidVital', { field: t(`nurse.vital_${key}`) }), 'error');
        return;
      }
    }
    try {
      setTriageSubmitting(true);
      const now = new Date().toISOString();
      // Shared field payload for both create and correct-an-existing-record paths.
      const payload = {
        airway: triageData.airway as 'clear' | 'obstructed',
        breathing: triageData.breathing as 'normal' | 'distressed' | 'absent',
        circulation: triageData.circulation as 'normal' | 'impaired' | 'absent',
        consciousness: triageData.consciousness as 'alert' | 'verbal' | 'pain' | 'unresponsive',
        // This form IS the clinician assessment — the submit guard above
        // refuses to save until every ABCC dimension is chosen (KAN-100).
        assessmentSource: 'clinician' as const,
        priority: triageData.priority as 'RED' | 'YELLOW' | 'GREEN',
        temperature: triageVitals.temperature || undefined,
        pulse: triageVitals.pulse || undefined,
        respiratoryRate: triageVitals.respiratoryRate || undefined,
        systolic: triageVitals.systolic || undefined,
        diastolic: triageVitals.diastolic || undefined,
        oxygenSaturation: triageVitals.oxygenSaturation || undefined,
        weight: triageVitals.weight || undefined,
        painScore: triageVitals.painScore || undefined,
        bloodGlucose: triageVitals.bloodGlucose || undefined,
        gcs: triageVitals.gcs || undefined,
        muac: triageVitals.muac || undefined,
        modeOfArrival: triageContext.modeOfArrival || undefined,
        symptomDuration: triageContext.symptomDuration || undefined,
        referralSource: triageContext.referralSource || undefined,
        knownAllergies: triageContext.knownAllergies || undefined,
        chiefComplaint: triageComplaint || undefined,
        notes: triageNotes || undefined,
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
        const existingTriage = triageHistory.find(h => h._id === editingTriageId);
        const updated = await updateTriageRecord(
          editingTriageId,
          existingTriage?.status === 'pending' ? { ...payload, status: 'seen' } : payload,
        );
        if (!updated) {
          // updateTriage never throws on an illegal/failed transition — it
          // swallows the error and resolves null. Without this check the
          // correction silently didn't save while the toast still read success.
          showToast(t('nurse.triageSaveFailed'), 'error');
          return;
        }
      } else {
        created = await createTriageRecord({
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
          status: 'seen',
        });
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
      showToast(t('nurse.triageSaved', { priority: triageData.priority, name: patientFullName(selectedTriagePatient) }), 'success');
      // Reset form only on success
      clearForm();
    } catch (err) {
      console.error(err);
      // Keep form data intact so the nurse can retry
      showToast(t('nurse.triageSaveFailed'), 'error');
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

  const triageSections = [
    { id: 'patient', label: 'Patient & complaint', icon: ClipboardList, detail: selectedTriagePatient ? 'Identity confirmed' : 'Select patient' },
    { id: 'assessment', label: 'ABCC assessment', icon: AlertTriangle, detail: triageData.priority ? 'Assessment complete' : 'Required' },
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
            <button type="button" onClick={clearForm} disabled={triageSubmitting} className="btn btn-secondary">
              {t('nurse.reset')}
            </button>
          </div>
        </aside>
      )}

      <div data-tour="triage-form" className={lockedPatientId ? 'omrs-reg-form patient-registration-shell triage-reg-form' : 'lg:flex-[2] dash-card overflow-hidden flex flex-col'} style={{ padding: lockedPatientId ? 0 : undefined, minHeight: 0 }}>
        {!lockedPatientId && (
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: '#FB923C' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.etatTriageAssessment')}</h3>
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {t('nurse.triageHeaderSummary', { today: triageHistory.filter(ti => (ti.triagedAt || '').startsWith(new Date().toISOString().slice(0, 10))).length, red: triageHistory.filter(ti => ti.priority === 'RED' && ti.status === 'pending').length })}
            </span>
          </div>
        )}
        <div className={lockedPatientId ? 'patient-registration-card-body' : 'p-4 space-y-4 flex-1 overflow-y-auto'}>
          <div className={lockedPatientId ? 'omrs-reg-section' : 'space-y-4'}>
            {lockedPatientId && <div className="omrs-reg-sectionhead"><h2>ETAT assessment</h2><p>Record the patient identity, immediate risk, observations, and handoff context.</p></div>}
            <div className={lockedPatientId ? 'omrs-reg-fields space-y-4' : 'space-y-4'}>
          {!lockedPatientId && <>
          {/* Patient picker */}
          <div id="triage-section-patient" className="relative scroll-mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nurse.patient')}</label>
            {selectedTriagePatient ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(59, 130, 246,0.25))' }}>
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
                  <button onClick={() => { setTriagePatientId(''); setTriagePatientSearch(''); }} className="p-1.5 rounded-lg flex-shrink-0" style={{ background: 'var(--overlay-subtle)' }}>
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
                  <div className="absolute left-0 right-0 mt-1 rounded-xl overflow-hidden z-10" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg)' }}>
                    {triagePatientMatches.map(p => (
                      <button
                        key={p._id}
                        onClick={() => { setTriagePatientId(p._id); setTriagePatientSearch(''); }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--overlay-subtle)]"
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
                    onClick={() => setTriageData(prev => ({ ...prev, airway: prev.airway === opt ? '' : opt }))}
                    title={triageData.airway === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.airway === opt
                        ? (opt === 'clear' ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.airway === opt
                        ? (opt === 'clear' ? 'var(--color-success)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.airway === opt
                        ? (opt === 'clear' ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)')
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
                    onClick={() => setTriageData(prev => ({ ...prev, breathing: prev.breathing === opt ? '' : opt }))}
                    title={triageData.breathing === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.breathing === opt
                        ? (opt === 'normal' ? 'rgba(74,222,128,0.2)' : opt === 'distressed' ? 'rgba(251,191,36,0.2)' : 'rgba(239,68,68,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.breathing === opt
                        ? (opt === 'normal' ? 'var(--color-success)' : opt === 'distressed' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.breathing === opt
                        ? (opt === 'normal' ? 'rgba(74,222,128,0.3)' : opt === 'distressed' ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)')
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
                    onClick={() => setTriageData(prev => ({ ...prev, circulation: prev.circulation === opt ? '' : opt }))}
                    title={triageData.circulation === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.circulation === opt
                        ? (opt === 'normal' ? 'rgba(74,222,128,0.2)' : opt === 'impaired' ? 'rgba(251,191,36,0.2)' : 'rgba(239,68,68,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.circulation === opt
                        ? (opt === 'normal' ? 'var(--color-success)' : opt === 'impaired' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.circulation === opt
                        ? (opt === 'normal' ? 'rgba(74,222,128,0.3)' : opt === 'impaired' ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)')
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
                    onClick={() => setTriageData(prev => ({ ...prev, consciousness: prev.consciousness === opt.key ? '' : opt.key }))}
                    title={triageData.consciousness === opt.key ? t('action.deselect') : undefined}
                    className="px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'rgba(74,222,128,0.2)' : opt.key === 'verbal' ? 'rgba(251,191,36,0.2)' : 'rgba(239,68,68,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'var(--color-success)' : opt.key === 'verbal' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'rgba(74,222,128,0.3)' : opt.key === 'verbal' ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Triage Result */}
          {triageData.priority && (
            <div
              className="p-4 rounded-2xl text-center transition-all"
              style={{
                background: triagePriorityColor(triageData.priority).bg,
                color: triagePriorityColor(triageData.priority).text,
              }}
            >
              <p className="text-base font-bold">{triagePriorityColor(triageData.priority).label}</p>
              {selectedTriagePatient && (
                <p className="text-xs mt-1 opacity-80">{t('nurse.patientLabel', { name: patientFullName(selectedTriagePatient) })}</p>
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
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.tempC')}</label>
                <input type="text" inputMode="decimal" value={triageVitals.temperature} onChange={e => setTriageVitals({ ...triageVitals, temperature: e.target.value })} placeholder="37.0" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.pulse')}</label>
                <input type="text" inputMode="numeric" value={triageVitals.pulse} onChange={e => setTriageVitals({ ...triageVitals, pulse: e.target.value })} placeholder="80" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.rr')}</label>
                <input type="text" inputMode="numeric" value={triageVitals.respiratoryRate} onChange={e => setTriageVitals({ ...triageVitals, respiratoryRate: e.target.value })} placeholder="18" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.spo2Pct')}</label>
                <input type="text" inputMode="numeric" value={triageVitals.oxygenSaturation} onChange={e => setTriageVitals({ ...triageVitals, oxygenSaturation: e.target.value })} placeholder="98" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.sysBp')}</label>
                <input type="text" inputMode="numeric" value={triageVitals.systolic} onChange={e => setTriageVitals({ ...triageVitals, systolic: e.target.value })} placeholder="120" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.diaBp')}</label>
                <input type="text" inputMode="numeric" value={triageVitals.diastolic} onChange={e => setTriageVitals({ ...triageVitals, diastolic: e.target.value })} placeholder="80" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.weightKg')}</label>
                <input type="text" inputMode="decimal" value={triageVitals.weight} onChange={e => setTriageVitals({ ...triageVitals, weight: e.target.value })} placeholder="65" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.painScore')}</label>
                <input type="text" inputMode="numeric" value={triageVitals.painScore} onChange={e => setTriageVitals({ ...triageVitals, painScore: e.target.value })} placeholder="0" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.bloodGlucose')}</label>
                <input type="text" inputMode="decimal" value={triageVitals.bloodGlucose} onChange={e => setTriageVitals({ ...triageVitals, bloodGlucose: e.target.value })} placeholder="5.5" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.gcs')}</label>
                <input type="text" inputMode="numeric" value={triageVitals.gcs} onChange={e => setTriageVitals({ ...triageVitals, gcs: e.target.value })} placeholder="15" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.muac')}</label>
                <input type="text" inputMode="decimal" value={triageVitals.muac} onChange={e => setTriageVitals({ ...triageVitals, muac: e.target.value })} placeholder="23.5" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
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
                  <option value="telehealth">Telehealth</option>
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
                onClick={clearForm}
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
              onClick={clearForm}
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
        <div className="px-3 py-2.5 flex items-center border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <ListSearch value={historySearch} onChange={setHistorySearch} placeholder={t('nurse.searchPatientPlaceholder')} />
        </div>
        <div className="p-3 flex-1 overflow-y-auto">
          {filteredHistory.length === 0 ? (
            <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>{t('nurse.noTriages')}</p>
          ) : (
            <div className="ehr-queue-cards ehr-queue-cards--triage">
              <div className="ehr-queue-guide ehr-queue-guide--triage" aria-hidden="true">
                {['Patient', 'Source', 'Wait', 'Action'].map(head => (
                  <span key={head}>{head}</span>
                ))}
              </div>
              {filteredHistory.slice(0, 12).map(ti => {
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
                          <span className="ehr-queue-name">{ti.patientName}</span>
                        ) : (
                          <button type="button" className="ehr-queue-name" onClick={() => router.push(`/triage/${ti.patientId}`)} title={`Triage ${ti.patientName}`}>
                            {ti.patientName}
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
