'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Modal from '@/components/Modal';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
// Clean single-stroke Tailwind Labs Heroicons via the local compatibility shim.
import {
  ArrowLeft, ArrowRightLeft,
  AlertTriangle, FileText, FlaskConical,
  Pill, Activity,
  ShieldAlert, ChevronRight,
  ClipboardList,
  User as UserIcon, Building2, X, Wallet, Syringe, Stethoscope,
  Heart, Printer, History, Calendar,
  Bandage, Layers, Plus,
} from '@/components/icons/lucide';
import Badge from '@/components/Badge';
import { usePatients } from '@/lib/hooks/usePatients';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePatientReferrals } from '@/lib/hooks/useReferrals';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { Package, MessageSquare } from '@/components/icons/lucide';
import { Icon as DuotoneInfoIcon } from '@/components/icons';
import { useTranslation } from '@/lib/i18n/useTranslation';
import dynamic from 'next/dynamic';
// Lazy-loaded: recharts is large and only used on the Trends view, so keep it
// out of the patient-record initial bundle.
const VitalsTrends = dynamic(() => import('@/components/VitalsTrends'), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading charts…</div>,
});
import PatientTimeline from '@/components/PatientTimeline';
import { toIsoDate } from '@/components/ehr/EhrMiniCalendar';
// Canonical geography — the same lists patient registration writes from, so an
// edit here can't introduce a state/county spelling the geo rollups don't know.
import { states as SOUTH_SUDAN_STATES, statesAndCounties } from '@/lib/data/south-sudan-reference';
import { formatDateTime, formatDate, formatClockTime, formatRxSig, humanizeStatus } from '@/lib/format-utils';
import { isScreeningOverdue } from '@/lib/services/screening-service';
import { patientFullName, patientInitials, patientAgeLabel } from '@/lib/patient-utils';
import { usePatientAppointments } from '@/lib/hooks/useAppointments';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTriage } from '@/lib/hooks/useTriage';
import { mergeVitalsTimeline } from '@/lib/clinical/vitals';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePatientPayments } from '@/lib/hooks/usePayments';
import BillingTab from '@/components/patients/BillingTab';
import PatientSBAR from '@/components/patients/PatientSBAR';
import { usePatientHandoff } from '@/lib/hooks/usePatientHandoff';
import RecordSignatureBar from '@/components/patients/RecordSignatureBar';
import NotesList from '@/components/clinical-notes/NotesList';
import { useCreateNote } from '@/lib/clinical-notes/useCreateNote';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import PhoneNotes from '@/components/patients/PhoneNotes';
import AssessmentsPanel from '@/components/patients/AssessmentsPanel';
import ScreeningsPanel from '@/components/patients/ScreeningsPanel';
import RemindersPanel from '@/components/patients/RemindersPanel';
import TransferHistoryPanel, { TransferBanner } from '@/components/patients/TransferHistoryPanel';
import CareAlertsBanner from '@/components/patients/CareAlertsBanner';
import DocumentsPanel from '@/components/patients/DocumentsPanel';
import { useProblems } from '@/lib/hooks/useProblems';
import type {
  AppointmentDoc,
  ImmunizationDoc,
  LabResultDoc,
  MedicalRecordDoc,
  PatientDoc,
  PrescriptionDoc,
  ProblemDoc,
} from '@/lib/db-types';
import { isValidPhone, normalizePhone, formatPhoneDisplay } from '@/lib/field-formats';
import { useAuth } from '@/lib/context';
import { PrescribeModal, ReferModal } from '@/components/patients/PatientActionModals';
import LabOrderModal from '@/components/lab/order/LabOrderModal';
import LabWorkspace from '@/components/lab/workflow/LabWorkspace';
import OpenmrsChartShell from '@/components/ehr/chart/OpenmrsChartShell';
import ChartHeader from '@/components/ehr/chart/ChartHeader';
import ChartVitalsBand from '@/components/ehr/chart/ChartVitalsBand';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import AllergiesSection from '@/components/ehr/chart/sections/AllergiesSection';
import ConditionsSection from '@/components/ehr/chart/sections/ConditionsSection';
import MedicationsSection from '@/components/ehr/chart/sections/MedicationsSection';
import OrdersSection from '@/components/ehr/chart/sections/OrdersSection';
import ProceduresSection from '@/components/ehr/chart/sections/ProceduresSection';
import ProgramsSection from '@/components/ehr/chart/sections/ProgramsSection';
import ImmunizationsSection from '@/components/ehr/chart/sections/ImmunizationsSection';
import DirectivesSection from '@/components/ehr/chart/sections/DirectivesSection';
import AssignDoctorModal, { type AssignDoctorTarget } from '@/components/AssignDoctorModal';
import NurseVitalsModal from '@/components/nurse/NurseVitalsModal';
import Select from '@/components/Select';

// Administrative tabs are the only ones a non-clinical role (e.g. Medical
// Receptionist) may see — the "minimum necessary" rule: contact details,
// referral follow-up, and billing/scheduling, but NOT clinical notes, test
// results, diagnoses, vitals, or medications.
// 'transfers' is admin-visible because "who is responsible for this patient?"
// is a question the front desk fields constantly. The panel redacts the
// clinical detail (reason, hand-off notes, problem/medication snapshot) for
// these roles — see TransferHistoryPanel's canViewClinical prop — so the tab
// answers accountability without exposing the chart.
const ADMIN_TAB_IDS = ['overview', 'appointments', 'demographics', 'billing', 'documents', 'recall', 'referrals'];
// A lab technician works orders inside the chart (the bench steps live on the
// Labs tab) but has no business in the notes, medications or problem list, so
// their chart is exactly the two tabs the work needs: who the patient is, and
// the labs. Minimum necessary access, enforced the same way ADMIN_TAB_IDS is.
const LAB_TAB_IDS = ['overview', 'labs'];
// A pharmacist dispenses against the prescription and the allergy list; a
// radiographer reads the order and reports on it. Each gets the tabs their work
// needs and nothing else — same minimum-necessary rule as LAB_TAB_IDS.
const PHARMACY_TAB_IDS = ['overview', 'prescriptions', 'allergies'];
const IMAGING_TAB_IDS = ['overview', 'labs'];

/** The capabilities that decide how much of the chart a viewer gets. */
export interface ChartAccess {
  canViewClinical: boolean;
  canEnterLabResults: boolean;
  canDispense: boolean;
  role?: string;
}

/**
 * The tab ids a viewer may open, or `null` for "the whole chart".
 *
 * Exported so the minimum-necessary rule can be asserted directly: this is the
 * only thing standing between a cashier looking up a balance and the patient's
 * notes, and the order of these branches is load-bearing — a clinical role is
 * checked first, so a doctor who also happens to hold a lab permission is not
 * narrowed to the bench's two tabs.
 */
export function allowedChartTabIds(access: ChartAccess): string[] | null {
  if (access.canViewClinical) return null;
  if (access.canEnterLabResults) return LAB_TAB_IDS;
  if (access.canDispense) return PHARMACY_TAB_IDS;
  if (access.role === 'radiologist') return IMAGING_TAB_IDS;
  return ADMIN_TAB_IDS;
}

/**
 * Where a restricted viewer lands when the tab they asked for isn't theirs —
 * the tab their role came for, not a generic overview.
 */
export function chartLandingTab(allowedIds: string[] | null): string {
  if (!allowedIds) return 'overview';
  return allowedIds.find(id => id !== 'overview') || 'overview';
}
type PrintSectionId = 'consultation' | 'problems' | 'vitals' | 'medications' | 'allergies' | 'labs' | 'immunizations' | 'appointments';
const PRINT_SECTION_OPTIONS: Array<{ id: PrintSectionId; label: string; description: string }> = [
  { id: 'consultation', label: 'Latest consultation', description: 'Reason for visit, examination, assessment, and plan' },
  { id: 'problems', label: 'Problems and diagnoses', description: 'Current problem list and diagnoses from the latest visit' },
  { id: 'vitals', label: 'Vital signs', description: 'Most recently recorded observations' },
  { id: 'medications', label: 'Current medications', description: 'Active prescriptions and instructions' },
  { id: 'allergies', label: 'Allergies', description: 'Active allergies and adverse reactions' },
  { id: 'labs', label: 'Laboratory results', description: 'Recent results, values, units, and reference ranges' },
  { id: 'immunizations', label: 'Immunizations', description: 'Recorded vaccines and doses' },
  { id: 'appointments', label: 'Next appointment', description: 'Upcoming appointment and follow-up details' },
];
const DEFAULT_PRINT_SECTIONS = new Set<PrintSectionId>(PRINT_SECTION_OPTIONS.map(section => section.id));
type FacesheetPanelId = 'medications' | 'problems' | 'vitals' | 'recommendations';

/** The subset of a vitals set the chart's read-only surfaces display. Partial
 *  because a single observation rarely carries every reading — the vitals band
 *  and the facesheet both render "-" for whatever is missing. */
type ChartVitalsLike = Partial<NonNullable<MedicalRecordDoc['vitalSigns']>>;

const FACESHEET_PANEL_OPTIONS: Array<{ id: FacesheetPanelId; label: string }> = [
  { id: 'problems', label: 'Safety alerts' },
  { id: 'medications', label: 'Medications' },
  { id: 'vitals', label: 'Latest observations' },
  { id: 'recommendations', label: 'Next care actions' },
];

const DEFAULT_FACESHEET_PANELS = FACESHEET_PANEL_OPTIONS.map(panel => panel.id);

/** Primary write-action per facesheet card, keyed by panel id. An entry is
 *  omitted when the current role can't perform it, in which case no action
 *  button renders for that card. */
// 'allergies' is not its own facesheet panel (it's the second list inside the
// 'problems' Safety alerts card) but still needs its own add action, so the
// lookup key set is widened by one rather than by a whole new panel.
type FacesheetActions = Partial<Record<FacesheetPanelId | 'allergies', {
  label: string;
  onClick: () => void;
  /** Defaults to a "+" — override for actions that aren't additive (Edit, Review). */
  icon?: typeof Plus;
}>>;

// Tab ids that a `?tab=` deep-link is allowed to open. Mirrors `allTabs` (in the
// component) plus the other reachable `activeTab` targets (`referrals`, `sbar`).
// Clinical-permission gating still runs in the effect below, so a non-clinical
// user deep-linked to a clinical tab is bounced back to overview.
const DEEP_LINK_TAB_IDS = new Set([
    'overview', 'appointments', 'history', 'problems', 'prescriptions', 'immunizations',
  'allergies', 'vitals', 'notes', 'labs', 'demographics', 'billing', 'careChecklist',
    'documents', 'recall', 'referrals', 'sbar', 'transfers',
    'orders', 'procedures', 'programs',
]);

/** Legacy/alias `?tab=` values that don't have a section of their own: transfers
 *  are read on Care coordination, recall reminders on Appointments. */
const TAB_ALIASES: Record<string, string> = { transfers: 'referrals', recall: 'appointments' };

/** The section a `?tab=` value opens, or null when the value isn't a section.
 *  Shared by the initial read and the browser-navigation resync so a Back
 *  button and a deep link can never resolve the same URL differently. */
export function resolveChartTab(tabParam: string | null | undefined): string | null {
  if (!tabParam) return null;
  const mapped = TAB_ALIASES[tabParam] ?? tabParam;
  return DEEP_LINK_TAB_IDS.has(mapped) ? mapped : null;
}

export default function PatientDetailPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const id = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const contentRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  // Deep-link support: a link like `/patients/<id>?tab=labs&focus=<recordId>`
  // opens that chart section (validated + permission-gated) and the section
  // scrolls to / highlights the specific record.
  const [activeTab, setActiveTab] = useState(() => resolveChartTab(searchParams.get('tab')) ?? 'overview');

  // `focus` and the analyzer hand-off (`value`/`unit`/`range`) are one-shot
  // arrival state, not addressable state: they are read once here and then
  // stripped from the URL below. Left in place, the highlight came back every
  // later visit to that section and the reading was re-offered for filing.
  const [focusId, setFocusId] = useState<string | undefined>(() => searchParams.get('focus') || undefined);
  const [seedResult] = useState(() => (searchParams.get('value')
    ? {
        value: searchParams.get('value') || '',
        unit: searchParams.get('unit') || '',
        referenceRange: searchParams.get('range') || '',
      }
    : undefined));

  /**
   * Open a chart section AND record it in the URL, so the chart's own sections
   * are addressable: refresh keeps your place, a section can be linked or
   * bookmarked, and Back steps between sections instead of throwing the
   * clinician out of the chart. One-shot arrival params are dropped on the way
   * — they belong to the section you arrived at, not the one you moved to.
   */
  const selectTab = useCallback((next: string) => {
    setActiveTab(prev => {
      if (prev !== next) setFocusId(undefined);
      return next;
    });
    router.push(`${pathname}?tab=${encodeURIComponent(next)}`, { scroll: false });
  }, [router, pathname]);

  // Browser navigation (Back/Forward, or a `?tab=` link followed while this
  // page instance stays mounted) drives `activeTab` from the URL. Clinical-tab
  // gating still runs afterward in the allowedTabIds effect below, so a
  // non-clinical viewer deep-linked to a clinical tab is still bounced back.
  useEffect(() => {
    const resolved = resolveChartTab(searchParams.get('tab'));
    if (resolved) setActiveTab(resolved);
  }, [searchParams]);

  // Strip the one-shot arrival params once they have been read into state, so
  // the URL that stays in the address bar is the shareable one (`?tab=`).
  //
  // The current history state is passed through rather than replaced with
  // null: the App Router keeps its own bookkeeping in that object, and blanking
  // it mid-navigation made the next history event restore the entry we came
  // from — arriving from the dashboard's "documents to sign" list bounced
  // straight back to the dashboard.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!['focus', 'value', 'unit', 'range'].some(k => params.has(k))) return;
    ['focus', 'value', 'unit', 'range'].forEach(k => params.delete(k));
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);
  const [demographicsTab, setDemographicsTab] = useState('profile');
  const [vitalsView, setVitalsView] = useState<'table' | 'flowsheet'>('table');
  const [showCustomizeView, setShowCustomizeView] = useState(false);
  const [facesheetPanels, setFacesheetPanels] = useState<Set<FacesheetPanelId>>(() => new Set(DEFAULT_FACESHEET_PANELS));
  // Keep the content area pinned to the top when switching tabs, so cards don't
  // appear to "jump" when a shorter/taller tab swaps in under a retained scroll
  // position. Instant (no smooth) so it's a fixed reset, not an animation.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageSubject, setMessageSubject] = useState('Follow-up from your care team');
  const [messageBody, setMessageBody] = useState('');
  const [messageChannel, setMessageChannel] = useState<'app' | 'sms' | 'both'>('app');
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [messageSent, setMessageSent] = useState(false);
  // Set when the composer was opened from a "Patient education" action, so the
  // sent message is flagged as education and lists under Documents ▸ Patient
  // education. Tracked separately from the subject line, which the sender may
  // rewrite before sending.
  const [messageIsEducation, setMessageIsEducation] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const [showPlanWizard, setShowPlanWizard] = useState(false);
  // Header action modals — open in place, pre-filled with the current patient.
  const [showOrderLabModal, setShowOrderLabModal] = useState(false);
  const [showPrescribeModal, setShowPrescribeModal] = useState(false);
  const [showReferModal, setShowReferModal] = useState(false);
  const [showNurseVitals, setShowNurseVitals] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignDoctorTarget | null>(null);
  // One-shot request for the chart shell to open a workspace drawer panel
  // (e.g. header "+ Note" → `clinical-note:<id>`, the note editor drawer).
  const [chartPanelRequest, setChartPanelRequest] = useState<string | null>(null);
  // Bumped when the note drawer closes so the Notes tab under it reloads —
  // the editor autosaves, so whatever was typed is already on disk by then.
  const [notesRefreshToken, setNotesRefreshToken] = useState(0);
  // One-shot request for a tab's ChartSection to pop its own "Add" form open
  // (e.g. the Facesheet Problems card's "Add" → Conditions tab + add modal).
  const [sectionAddRequest, setSectionAddRequest] = useState<'problems' | 'allergies' | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printSignature, setPrintSignature] = useState('');
  const [printSigned, setPrintSigned] = useState(false);
  const [printSections, setPrintSections] = useState<Set<PrintSectionId>>(() => new Set(DEFAULT_PRINT_SECTIONS));
  // Trigger print after React commits the selected document into the DOM.
  useEffect(() => {
    if (!printSigned) return;
    const printFrame = window.requestAnimationFrame(() => window.print());
    const reset = () => setPrintSigned(false);
    window.addEventListener('afterprint', reset);
    return () => {
      window.cancelAnimationFrame(printFrame);
      window.removeEventListener('afterprint', reset);
    };
  }, [printSigned]);

  // OpenMRS-style client-side pagination for the Appointments tab (Stage 3).
  const [apptPage, setApptPage] = useState(1);
  const APPT_PAGE_SIZE = 8;
  const toggleFacesheetPanel = (panelId: FacesheetPanelId) => {
    setFacesheetPanels(prev => {
      const next = new Set(prev);
      if (next.has(panelId) && next.size > 1) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return next;
    });
  };

  const { t } = useTranslation();
  const { currentUser } = useAuth();
  // Best-effort link from a nurse-entered vitals observation to the patient's
  // currently open visit, so it lands under that encounter instead of
  // floating free. Resolved when the modal opens rather than kept live, since
  // "the open encounter" can change between visits.
  const [nurseVitalsEncounterId, setNurseVitalsEncounterId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!showNurseVitals || !id || !currentUser) return;
    let cancelled = false;
    import('@/lib/services/encounter-service')
      .then(m => m.findOpenEncounterForPatient(id, currentUser.hospitalId || ''))
      .then(enc => { if (!cancelled) setNurseVitalsEncounterId(enc?._id); })
      .catch(() => { if (!cancelled) setNurseVitalsEncounterId(undefined); });
    return () => { cancelled = true; };
  }, [showNurseVitals, id, currentUser]);
  const scope = useDataScope();
  const { patients, loading, update: updatePatient } = usePatients();
  const { hospitals } = useHospitals();

  const scopedPatient = patients.find(p => p._id === id);

  // The patients list is scoped to the viewer's facility, so a patient who was
  // registered at another facility in the same organisation (referred in, an
  // appointment booked here, a shared record) isn't in it — the chart would
  // wrongly show "Patient not found". Fetch such a patient directly by id, but
  // gate on the org boundary so tenant isolation still holds (no cross-org PHI).
  const [fallbackPatient, setFallbackPatient] = useState<PatientDoc | null>(null);
  const [fallbackChecked, setFallbackChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFallbackPatient(null);
    setFallbackChecked(false);
    if (!id || loading || scopedPatient) { setFallbackChecked(true); return; }
    (async () => {
      const { getPatientById } = await import('@/lib/services/patient-service');
      const doc = await getPatientById(id);
      if (cancelled) return;
      const sameOrg = !doc?.orgId || !currentUser?.orgId || doc.orgId === currentUser.orgId;
      const isNational = currentUser?.role === 'super_admin' || currentUser?.role === 'government';
      setFallbackPatient(doc && (sameOrg || isNational) ? doc : null);
      setFallbackChecked(true);
    })();
    return () => { cancelled = true; };
  }, [id, loading, scopedPatient, currentUser?.orgId, currentUser?.role]);

  const patient = scopedPatient ?? (fallbackPatient?._id === id ? fallbackPatient : undefined);
  const { records } = useMedicalRecords(patient?._id);
  const { referrals: patientReferrals } = usePatientReferrals(patient?._id);
  const { results: allLabResults, reload: reloadLabResults } = useLabResults(patient?._id);
  const { immunizations: allImmunizations } = useImmunizations(patient?._id);
  const { visits: allANCVisits } = useANC();
  const { appointments: patientAppointments } = usePatientAppointments(patient?._id);
  const { prescriptions: allPrescriptions } = usePrescriptions(patient?._id);
  const { triages: patientTriages } = useTriage(patient?._id);
  const latestShiftHandoff = usePatientHandoff(patient?._id);
  // Merged vitals history across both places they're captured — a consult's
  // own vitalSigns and a triage stop's own vitals fields — normalized and
  // sorted newest-first. Feeds the vitals band, the vitals table and the
  // trends view, so a patient who was just triaged (and not yet seen) shows
  // those readings instead of an older or blank one. Declared before the
  // loading/not-found early return below, alongside the other data hooks —
  // no hook in this component is called after that return.
  const vitalsTimeline = useMemo(() => mergeVitalsTimeline(records, patientTriages), [records, patientTriages]);
  const { canConsult, canViewClinical, canOrderLabs, canEnterLabResults, canDispense, canPrescribe, canBookAppointments, canManageReferrals, canRecordVitalEvents, canRegisterPatients } = usePermissions();
  const canAssignPatients = ['front_desk', 'central_registration_clerk', 'clinic_clerk'].includes(currentUser?.role ?? '');

  // Which tabs this viewer may open at all: clinicians get the chart, lab
  // technicians get identity + labs, everyone else gets the admin set.
  // Memoized on the capabilities themselves — the function returns a fresh
  // array for restricted roles, and an unmemoized one would re-run the bounce
  // effect below on every render.
  const allowedTabIds = useMemo(
    () => allowedChartTabIds({ canViewClinical, canEnterLabResults, canDispense, role: currentUser?.role }),
    [canViewClinical, canEnterLabResults, canDispense, currentUser?.role],
  );

  // Defence in depth: if a restricted viewer lands on (or deep-links to) a tab
  // outside their set, snap them back so those panels never render.
  useEffect(() => {
    if (allowedTabIds && !allowedTabIds.includes(activeTab)) {
      const landing = chartLandingTab(allowedTabIds);
      setActiveTab(landing);
      // A correction, not navigation: replace the denied `?tab=` rather than
      // pushing a history entry, so Back doesn't walk into the bounce again —
      // and so the address bar can't claim to be on a section that isn't
      // rendering.
      router.replace(`${pathname}?tab=${encodeURIComponent(landing)}`, { scroll: false });
    }
  }, [allowedTabIds, activeTab, router, pathname]);
  const { balance: patientBalance, reload: reloadPayments } = usePatientPayments(patient?._id);
  const { problems: patientProblems } = useProblems(patient?._id);
  const patientIdForNotes = patient?._id;

  // Clinical notes for this patient. They are the encounter record now that
  // the consultation wizard is retired, so the chart's Visits timeline needs
  // them: without this, signing a note left no trace in the patient's history.
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNoteDoc[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!patientIdForNotes) { setClinicalNotes([]); return; }
    import('@/lib/clinical-notes/note-service')
      .then(m => m.getNotesByPatient(patientIdForNotes, scope))
      .then(rows => { if (!cancelled) setClinicalNotes(rows); })
      .catch(() => { /* the timeline simply omits notes */ });
    return () => { cancelled = true; };
    // notesRefreshToken re-reads after a note is created, saved or signed.
  }, [patientIdForNotes, notesRefreshToken, scope]);

  // ── "+ Note" → the clinical-notes module, edited in the chart's drawer. ──
  // Reopen today's unsigned draft when one exists (a second click must not
  // fork the record — the same rule useCreateNote applies per appointment),
  // otherwise start a SOAP draft. Documentation happens beside the chart; the
  // /notes/[id] route stays for the cross-patient queue.
  const { createNote: createClinicalNoteDraft } = useCreateNote(currentUser ?? null);
  const openClinicalNoteDrawer = useCallback(async () => {
    if (!patient) return;
    try {
      const { listClinicalNotes } = await import('@/lib/clinical-notes/note-service');
      const today = toIsoDate(new Date());
      const drafts = await listClinicalNotes({ patientId: patient._id, display: 'unsigned' }, scope);
      const note = drafts.find(n => n.serviceDate === today)
        ?? await createClinicalNoteDraft({
          patientId: patient._id,
          patientName: patientFullName(patient),
          mrn: patient.hospitalNumber,
          patientDob: patient.dateOfBirth,
        }, { navigate: false });
      if (note) setChartPanelRequest(`clinical-note:${note._id}`);
    } catch {
      // The drawer could not be readied — land on the Notes tab so the click
      // still goes somewhere useful.
      selectTab('notes');
    }
  }, [patient, createClinicalNoteDraft, scope]);

  // Edit form state — initialised when modal opens
  const [editForm, setEditForm] = useState({
    firstName: '',
    middleName: '',
    surname: '',
    phone: '',
    state: '',
    county: '',
    dateOfBirth: '',
    gender: 'Male' as 'Male' | 'Female',
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  /** Counties for the state currently picked in the edit form. */
  const editCounties = useMemo(
    () => (editForm.state ? statesAndCounties[editForm.state] || [] : []),
    [editForm.state],
  );

  const openEditModal = () => {
    if (!patient) return;
    setEditErrors({});
    setEditForm({
      firstName: patient.firstName || '',
      middleName: patient.middleName || '',
      surname: patient.surname || '',
      phone: patient.phone || '',
      state: patient.state || '',
      county: patient.county || '',
      dateOfBirth: patient.dateOfBirth || '',
      gender: (patient.gender as 'Male' | 'Female') || 'Male',
    });
    setShowEditModal(true);
  };

  const openPaymentFromHeader = () => {
    selectTab('billing');
    setShowPaymentPanel(true);
  };

  // Facesheet card actions. Each one performs the real write action the card
  // represents, reusing the flows the header/tabs already use: the prescribe
  // and lab-order modals, the visit-note drawer, the consultation vitals form,
  // and the Conditions/Allergies tabs' own "Add" modals (opened via
  // sectionAddRequest so the card's action lands directly in the add form).
  const openSectionAdd = (section: 'problems' | 'allergies') => {
    selectTab(section);
    setSectionAddRequest(section);
  };
  const facesheetActions: FacesheetActions = {
    ...(canPrescribe ? { medications: { label: 'Prescribe', onClick: () => setShowPrescribeModal(true) } } : {}),
    ...(canConsult ? { problems: { label: 'Add', onClick: () => openSectionAdd('problems') } } : {}),
    ...(canConsult ? { allergies: { label: 'Add', onClick: () => openSectionAdd('allergies') } } : {}),
    // Vitals entry is always the nurse-vitals form now, for doctors and nurses
    // alike — a full /consultation redirect was the wrong weight for "record
    // a set of numbers" and orphaned the visit from the chart tab it was on.
    ...((canConsult || canRecordVitalEvents) && patient ? { vitals: { label: 'Record', onClick: () => { selectTab('vitals'); setShowNurseVitals(true); } } } : {}),
    ...(canConsult ? { recommendations: { label: 'Review', onClick: () => selectTab('careChecklist'), icon: ClipboardList } } : {}),
  };

  const handleEditSubmit = async () => {
    if (!patient) return;
    // Phone is optional — only block when a non-empty value is malformed.
    if (!isValidPhone(editForm.phone)) {
      setEditErrors({ phone: t('validation.errPhone') });
      return;
    }
    setEditErrors({});
    try {
      setEditSubmitting(true);
      // Normalize to canonical form before persisting (patient-service also
      // re-normalizes, but keep the saved value canonical here too).
      const normPhone = normalizePhone(editForm.phone) ?? editForm.phone.trim();
      await updatePatient(patient._id, {
        firstName: editForm.firstName.trim(),
        middleName: editForm.middleName.trim(),
        surname: editForm.surname.trim(),
        phone: normPhone,
        state: editForm.state.trim(),
        county: editForm.county.trim(),
        dateOfBirth: editForm.dateOfBirth,
        gender: editForm.gender,
      });
      const { logAudit } = await import('@/lib/services/audit-service');
      await logAudit('PATIENT_EDIT', undefined, undefined,
        `Updated demographics for ${patient.hospitalNumber} (${editForm.firstName} ${editForm.surname})`
      ).catch(() => {});
      setShowEditModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setEditSubmitting(false);
    }
  };

  // Still "loading" while the scoped list loads OR while the out-of-facility
  // fallback lookup is in flight — only declare "not found" once both are done.
  const stillResolving = loading || (!patient && !fallbackChecked);
  if (stillResolving || !patient) {
    return (
      <>
        <main className="page-container flex items-center justify-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {stillResolving ? t('status.loading') : t('patient.notFound')}
          </p>
        </main>
      </>
    );
  }

  const regHospital = hospitals.find(h => h._id === patient.registrationHospital);

  const sendPatientMessage = async () => {
    if (!patient || !currentUser) return;
    const body = messageBody.trim();
    if (!body) {
      setMessageError('Enter a message before sending.');
      return;
    }
    if ((messageChannel === 'sms' || messageChannel === 'both') && !patient.phone) {
      setMessageError('This patient does not have a phone number for SMS.');
      return;
    }
    setMessageSending(true);
    setMessageError('');
    try {
      const { createMessage } = await import('@/lib/services/message-service');
      await createMessage({
        patientId: patient._id,
        patientName: patientFullName(patient),
        patientPhone: patient.phone || '',
        recipientType: 'patient',
        direction: 'staff_to_patient',
        fromDoctorId: currentUser._id,
        fromDoctorName: currentUser.name || currentUser.username || 'Care team',
        fromHospitalId: currentUser.hospitalId,
        fromHospitalName: regHospital?.name || patient.registrationHospital || '',
        subject: messageSubject.trim() || 'Patient message',
        body,
        channel: messageChannel,
        patientEducation: messageIsEducation || undefined,
        sentAt: new Date().toISOString(),
        orgId: currentUser.orgId,
      });
      setMessageSent(true);
      setMessageBody('');
      setMessageSubject('Follow-up from your care team');
      setMessageChannel('app');
      setMessageIsEducation(false);
    } catch (err) {
      console.error(err);
      setMessageError('Could not send this message. Please try again.');
    } finally {
      setMessageSending(false);
    }
  };

  // Appointment sort key for the Appointments tab.
  const apptTs = (a: { appointmentDate: string; appointmentTime?: string }) =>
    new Date(`${a.appointmentDate}T${a.appointmentTime || '00:00'}:00`).getTime();

  const allTabs = [
    { id: 'overview', label: 'Patient summary', icon: Heart },
    { id: 'history', label: 'Visits', icon: FileText },
    { id: 'problems', label: 'Conditions', icon: AlertTriangle },
    { id: 'prescriptions', label: 'Medications', icon: Pill },
    { id: 'immunizations', label: 'Immunizations', icon: Syringe },
    { id: 'allergies', label: 'Allergies', icon: ShieldAlert },
    { id: 'vitals', label: 'Vitals & Biometrics', icon: Activity },
    { id: 'notes', label: 'Notes', icon: FileText },
    { id: 'sbar', label: 'SBAR handoff', icon: MessageSquare },
    { id: 'labs', label: 'Results', icon: FlaskConical },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'procedures', label: 'Procedures', icon: Bandage },
    { id: 'programs', label: 'Programs', icon: Layers },
    { id: 'demographics', label: 'Demographics', icon: UserIcon },
    { id: 'billing', label: 'Billing history', icon: Wallet },
    { id: 'careChecklist', label: 'Care plan', icon: ClipboardList },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'referrals', label: 'Care coordination', icon: ArrowRightLeft },
  ];
  const tabs = allowedTabIds ? allTabs.filter(tb => allowedTabIds.includes(tb.id)) : allTabs;

  // records[] is sorted newest-first by the service layer. A standalone
  // nursing vitals check (recordKind 'nursing_vitals') is not a consultation
  // — the printed record and the superbill's encounter link are both about
  // the VISIT, so they skip past a nursing stub to the newest real one.
  const latestRecord = records.find(r => r.recordKind !== 'nursing_vitals');
  // Newest entry across records AND triage — the one reading every surface of
  // the chart quotes: the sticky band, the facesheet's "Latest observations"
  // and the printed record. They used to derive it three different ways
  // (newest consult / newest record carrying vitals / merged timeline), so the
  // same patient could show three different "latest" sets on one screen, and
  // the printed Vital Signs block vanished whenever the newest consult
  // happened to be a note with no readings on it.
  const latestVitalsEntry = vitalsTimeline[0];
  // Partial: a timeline entry only carries the readings that were actually
  // taken, where MedicalRecordDoc['vitalSigns'] declares them all required.
  const latestVitals: ChartVitalsLike | undefined = latestVitalsEntry ? {
    temperature: latestVitalsEntry.temperature,
    systolic: latestVitalsEntry.systolic,
    diastolic: latestVitalsEntry.diastolic,
    pulse: latestVitalsEntry.pulse,
    respiratoryRate: latestVitalsEntry.respiratoryRate,
    oxygenSaturation: latestVitalsEntry.oxygenSaturation,
    weight: latestVitalsEntry.weight,
    height: latestVitalsEntry.height,
    bmi: latestVitalsEntry.bmi,
    recordedAt: latestVitalsEntry.at,
  } : undefined;
  // VitalsTrends only reads MedicalRecordDoc[] — a triage stop has no
  // medical_record to live on, so triage-sourced timeline entries are
  // represented as minimal synthetic records (never persisted, never shown
  // anywhere a real record normally would be) purely so the trend charts see
  // them too, instead of only ever plotting consult/nursing observations.
  const recordsWithTriageVitals: MedicalRecordDoc[] = [
    ...records,
    ...vitalsTimeline.filter(entry => entry.source === 'Triage').map(entry => ({
      _id: entry.id,
      type: 'medical_record',
      patientId: patient._id,
      hospitalId: currentUser?.hospitalId || '',
      hospitalName: entry.facility || '',
      visitDate: entry.at,
      consultedAt: entry.at,
      visitType: 'outpatient',
      providerName: 'Triage',
      providerRole: 'nurse',
      department: 'Triage',
      chiefComplaint: 'Triage vitals',
      historyOfPresentIllness: '',
      vitalSigns: {
        temperature: entry.temperature,
        systolic: entry.systolic,
        diastolic: entry.diastolic,
        pulse: entry.pulse,
        respiratoryRate: entry.respiratoryRate,
        oxygenSaturation: entry.oxygenSaturation,
        weight: entry.weight,
        muac: entry.muac,
        bloodGlucose: entry.bloodGlucose,
        recordedAt: entry.at,
      },
      diagnoses: [],
      prescriptions: [],
      labResults: [],
      treatmentPlan: '',
      createdAt: entry.at,
      updatedAt: entry.at,
    } as unknown as MedicalRecordDoc)),
  ];


  // ── Chart rail ───────────────────────────────────────────────────────────
  // The chart's sections, in the order a clinician reads them: who the patient
  // is, then what is measured, then what is being done, then the record around
  // it. One flat list — a "More" bucket only hid half the chart behind a click
  // for no reason a clinician could see.
  //
  // Sections NOT on this rail (care plan, care coordination, notes,
  // demographics) still render if something deep-links to them — the tab model
  // in `allTabs` is unchanged — they are simply not navigation any more.
  // `group` is the heading of the rail card a section sits under: the clinical
  // record a clinician works through, then the administrative tail that
  // describes the patient rather than their care.
  const OMRS_RAIL_DEFS: { id: string; label: string; icon: typeof Heart; group: string; clinicalOnly?: boolean }[] = [
    { id: 'overview', label: 'Patient summary', icon: Heart, group: 'Clinical' },
    { id: 'vitals', label: 'Vitals & Biometrics', icon: Activity, group: 'Clinical' },
    { id: 'prescriptions', label: 'Medications', icon: Pill, group: 'Clinical' },
    { id: 'orders', label: 'Orders', icon: ClipboardList, group: 'Clinical' },
    { id: 'labs', label: 'Results', icon: FlaskConical, group: 'Clinical' },
    // The timeline IS the visit history — encounters, with the labs, drugs and
    // referrals that hung off them.
    { id: 'history', label: 'Visits', icon: History, group: 'Clinical' },
    // The encounter notes themselves, next to the visits they document.
    { id: 'notes', label: 'Notes', icon: Stethoscope, group: 'Clinical' },
    // A shift-handoff summary, not a documentation flow of its own — sits
    // beside Notes since it's read the same way. Previously unreachable (no
    // rail slot); cheaper to surface it here than to delete a working view.
    { id: 'sbar', label: 'SBAR handoff', icon: MessageSquare, group: 'Clinical' },
    { id: 'allergies', label: 'Allergies', icon: ShieldAlert, group: 'Clinical' },
    { id: 'problems', label: 'Conditions', icon: AlertTriangle, group: 'Clinical' },
    { id: 'immunizations', label: 'Immunizations', icon: Syringe, group: 'Clinical' },
    { id: 'procedures', label: 'Procedures', icon: Bandage, group: 'Clinical' },
    { id: 'programs', label: 'Programs', icon: Layers, group: 'Clinical' },
    // Screenings/reminders/assessments — the forward-looking follow-through
    // half of the chart, closing out the Clinical group.
    { id: 'careChecklist', label: 'Care plan', icon: ClipboardList, group: 'Clinical' },
    { id: 'documents', label: 'Documents', icon: FileText, group: 'Record' },
    { id: 'appointments', label: 'Appointments', icon: Calendar, group: 'Record' },
    // Internal transfers and external referrals — who else is involved in
    // this patient's care, and the record of handing them off.
    { id: 'referrals', label: 'Care coordination', icon: ArrowRightLeft, group: 'Record' },
    // Who the patient is, as registered — contact details, address, next of
    // kin, payor. Sits with the administrative tail rather than the clinical
    // sections above it, and only appears for roles whose `tabs` include it.
    { id: 'demographics', label: 'Demographics', icon: UserIcon, group: 'Record' },
    { id: 'billing', label: 'Billing history', icon: Wallet, group: 'Record' },
  ];
  // Role restrictions still apply: a lab technician's rail is the two sections
  // LAB_TAB_IDS allows, not the full list.
  const omrsRailItems = OMRS_RAIL_DEFS.filter(item => tabs.some(t => t.id === item.id));
  const omrsMoreItems: typeof omrsRailItems = [];

  // Sticky header: pregnancy pill — hoisted unchanged from the old inline
  // patient-banner IIFE so the ANC-derived pill keeps behaving identically.
  const patientANC = (allANCVisits || []).filter(a => a.patientId === patient._id);
  const activeANC = patientANC.find(a => !a.linkedBirthId);
  const isPregnant = !!activeANC;
  const pregnancyPillNode = isPregnant ? (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-bold" style={{
      background: 'rgba(217, 110, 89, 0.12)', color: 'var(--color-danger-500)', border: '1px solid rgba(217, 110, 89, 0.32)', letterSpacing: 0.2,
    }}>
      <DuotoneInfoIcon name="pregnant" size={11} color="var(--color-danger-500)" accent="var(--color-danger-500)" />
      Pregnant{activeANC?.gestationalAge ? ` · ${activeANC.gestationalAge} wk` : ''}
    </span>
  ) : null;


  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .print-only { display: none; }

        @media print {
          /* ── Page setup ── */
          @page {
            size: A4;
            margin: 0;
          }
          @page :first { margin-top: 0; }

          html, body {
            background: #fff !important;
            color: #1a1a1a !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-family: var(--font-platform) !important;
            font-size: 9pt;
            line-height: 1.45;
          }

          /* Hide all app chrome — target every node in the tree */
          body * { visibility: hidden !important; }
          .print-doc-root,
          .print-doc-root * { visibility: visible !important; }

          /* The SBAR tab has its own Print button, which calls window.print()
             against this same stylesheet — so without these rules it printed a
             blank sheet, the whole page having been hidden and the handoff not
             being .print-doc-root. It identifies the patient in its own first
             line, so it prints as itself rather than through the record
             template. */
          .sbar-doc,
          .sbar-doc * { visibility: visible !important; }
          .sbar-doc {
            position: absolute;
            top: 0; left: 0; right: 0;
            width: 100%;
            padding: 10mm 12mm;
            background: #fff;
          }
          /* Both can be mounted at once (print the record while sitting on the
             SBAR tab); the record wins, since that is the document the user
             just signed. */
          body:has(.print-doc-root) .sbar-doc { display: none !important; }

          /* Full-page print wrapper — absolute so content flows across pages.
             The display value has to be restored explicitly: this element also
             carries .print-only, whose "display: none" above is what keeps the
             document off the screen, and that rule stays in force inside this
             media block. Without the line below the whole printed record was
             display:none — "Print chart" put a blank sheet through the
             printer. */
          .print-doc-root {
            display: block !important;
            position: absolute;
            top: 0; left: 0; right: 0;
            width: 100%;
            background: #fff;
          }

          /* Reset everything inside the doc */
          .print-doc-root * {
            font-family: var(--font-platform) !important;
            box-sizing: border-box;
            animation: none !important;
            transition: none !important;
          }

          svg:not(.print-logo-svg) { display: none !important; }

          /* ── Header band ── */
          .rx-header {
            background: var(--accent-hover) !important;
            padding: 10mm 14mm 8mm;
            display: flex;
            align-items: center;
            justify-content: space-between;
            page-break-inside: avoid;
          }
          .rx-header-left { display: flex; align-items: center; gap: 12pt; }
          .rx-logo-wrap {
            background: #fff !important;
            border-radius: 8pt;
            padding: 5pt 7pt;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .rx-logo-wrap img { width: 36pt; height: 36pt; display: block !important; }
          .rx-facility-name {
            color: #fff !important;
            font-size: 13pt;
            font-weight: 700;
            letter-spacing: 0.3pt;
          }
          .rx-facility-sub {
            color: rgba(255,255,255,0.72) !important;
            font-size: 8pt;
            margin-top: 2pt;
          }
          .rx-doc-label {
            text-align: right;
          }
          .rx-doc-label .rx-doc-title {
            color: #fff !important;
            font-size: 10pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1pt;
          }
          .rx-doc-label .rx-doc-meta {
            color: rgba(255,255,255,0.75) !important;
            font-size: 7.5pt;
            margin-top: 4pt;
            line-height: 1.6;
          }

          /* ── Patient banner ── */
          .rx-patient-banner {
            background: #f0f6fb !important;
            border-bottom: 2px solid var(--accent-hover) !important;
            padding: 6mm 14mm;
            page-break-inside: avoid;
          }
          .rx-patient-name {
            font-size: 15pt;
            font-weight: 700;
            color: var(--accent-hover) !important;
            margin-bottom: 5pt;
          }
          .rx-patient-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6pt 12pt;
          }
          .rx-patient-field label {
            display: block;
            font-size: 6.5pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5pt;
            color: #5a7a96 !important;
            margin-bottom: 1pt;
          }
          .rx-patient-field span {
            font-size: 8.5pt;
            color: #1a1a1a !important;
            font-weight: 500;
          }

          /* ── Body ── */
          .rx-body { padding: 6mm 14mm; }

          /* ── Section ── */
          .rx-section { margin-bottom: 10pt; page-break-inside: avoid; }
          .rx-section-title {
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.8pt;
            color: var(--accent-hover) !important;
            border-bottom: 1.5pt solid var(--accent-hover) !important;
            padding-bottom: 2pt;
            margin-bottom: 5pt;
          }
          .rx-section-body { font-size: 8.5pt; color: #1a1a1a !important; }

          /* ── Two-column layout ── */
          .rx-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
          .rx-three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10pt; }

          /* ── Field inline ── */
          .rx-field { margin-bottom: 4pt; }
          .rx-field b { color: #333 !important; font-weight: 600; }

          /* ── Vitals table ── */
          .rx-vitals-table { width: 100%; border-collapse: collapse; }
          .rx-vitals-table td {
            border: 1pt solid #c5d8e8 !important;
            padding: 4pt 8pt;
            font-size: 8pt;
            text-align: center;
            color: #1a1a1a !important;
          }
          .rx-vitals-table td:first-child { text-align: left; font-weight: 600; background: #f0f6fb !important; }

          /* ── Med / lab rows ── */
          .rx-row {
            border-bottom: 0.5pt solid #dde8f0 !important;
            padding: 3pt 0;
            font-size: 8.5pt;
            color: #1a1a1a !important;
          }
          .rx-row:last-child { border-bottom: none !important; }
          .rx-row b { color: var(--accent-hover) !important; }

          /* ── Diagnosis rows ── */
          .rx-dx-row { display: flex; gap: 8pt; align-items: baseline; margin-bottom: 3pt; }
          .rx-dx-code { font-size: 7pt; font-weight: 700; background: #e8f2fa !important; color: var(--accent-hover) !important; padding: 1pt 5pt; border-radius: 3pt; flex-shrink: 0; }
          .rx-dx-name { font-size: 8.5pt; color: #1a1a1a !important; }
          .rx-dx-type { font-size: 7pt; color: #888 !important; margin-left: 4pt; }

          /* ── Allergy pill ── */
          .rx-allergy-row { display: flex; gap: 6pt; align-items: center; margin-bottom: 3pt; }
          .rx-allergy-sev { font-size: 7pt; font-weight: 700; padding: 1pt 5pt; border-radius: 3pt; }
          .rx-allergy-sev.severe { background: #fde8e8 !important; color: #c0392b !important; }
          .rx-allergy-sev.moderate { background: #fef3cd !important; color: #b7791f !important; }
          .rx-allergy-sev.mild { background: #d4edda !important; color: #276749 !important; }
          .rx-allergy-sev.unknown { background: #f1f3f4 !important; color: #555 !important; }

          /* ── Signature block ── */
          .rx-sig-block {
            margin-top: 14pt;
            padding-top: 10pt;
            border-top: 1.5pt solid var(--accent-hover) !important;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30pt;
            page-break-inside: avoid;
          }
          .rx-sig-label { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5pt; color: #5a7a96 !important; margin-bottom: 18pt; }
          .rx-sig-line { border-bottom: 1pt solid #333 !important; margin-bottom: 4pt; height: 1pt; }
          .rx-sig-name { font-size: 8.5pt; color: #1a1a1a !important; font-weight: 600; }
          .rx-sig-role { font-size: 7.5pt; color: #666 !important; }

          /* ── Footer ── */
          .rx-footer {
            background: #f0f6fb !important;
            border-top: 1pt solid #c5d8e8 !important;
            padding: 4mm 14mm;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 7pt;
            color: #5a7a96 !important;
            margin-top: 10mm;
          }
          .rx-footer-conf { font-weight: 700; color: #c0392b !important; }

          /* page break helpers */
          .rx-page-break { page-break-before: always; }
        }
      ` }} />
      <main ref={contentRef} className="page-container ehr-chart-page">
          {/* ══════ PRINT-ONLY HOSPITAL DOCUMENT ══════ */}
          {printSigned && (() => {
            const activeAllergies = (patient.structuredAllergies || []).filter((a: { status: string }) => a.status === 'active');
            const legacyAllergies = !patient.structuredAllergies ? (patient.allergies || []).filter(Boolean) : [];
            const activeProblems = patientProblems.filter(p => p.status === 'active' || p.status === 'chronic');
            // "Current" = anything not stopped, matching the Medications tab
            // and the facesheet. Excluding dispensed left the printed sheet —
            // the copy the patient walks out with — missing exactly the drugs
            // they had just collected and were actually taking.
            const currentMeds = (allPrescriptions || []).filter(rx => rx.patientId === patient._id && rx.status !== 'discontinued');
            const patientLabs = (allLabResults || []).filter(l => l.patientId === patient._id).slice(0, 12);
            const patientImms = (allImmunizations || []).filter(i => i.patientId === patient._id);
            const upcomingPrint = (patientAppointments || [])
              .filter(a => a.status !== 'cancelled' && a.status !== 'no_show' && new Date(`${a.appointmentDate}T${a.appointmentTime || '00:00'}`).getTime() >= Date.now())
              .sort((x, y) => `${x.appointmentDate}T${x.appointmentTime || '00:00'}`.localeCompare(`${y.appointmentDate}T${y.appointmentTime || '00:00'}`))[0];
            const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
            // `registrationHospital` holds the facility ID, not its name — the
            // printed record was headed "hosp-001" instead of the hospital.
            // `regHospital` is the same lookup the Demographics tab already does.
            const printFacilityName = regHospital?.name || patient.registrationHospital || 'Tamam Facility';
            return (
              <div className="print-only print-doc-root">

                {/* ── Blue header band ── */}
                <div className="rx-header">
                  <div className="rx-header-left">
                    <div className="rx-logo-wrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/assets/logos/SVG/Tamam_Style_Guide-33.svg" alt="Tamam" />
                    </div>
                    <div>
                      <div className="rx-facility-name">{printFacilityName}</div>
                      <div className="rx-facility-sub">Tamam · Patient record</div>
                    </div>
                  </div>
                  <div className="rx-doc-label">
                    <div className="rx-doc-title">Patient Medical Record</div>
                    <div className="rx-doc-meta">
                      <span>Printed: {printedAt}</span><br />
                      <span>Record ID: {patient.hospitalNumber || patient.geocodeId || '—'}</span><br />
                      {patient.nationalId && <span>National ID: {patient.nationalId}</span>}
                    </div>
                  </div>
                </div>

                {/* ── Patient identity banner ── */}
                <div className="rx-patient-banner">
                  <div className="rx-patient-name">{patientFullName(patient)}</div>
                  <div className="rx-patient-grid">
                    <div className="rx-patient-field"><label>Date of Birth</label><span>{formatDate(patient.dateOfBirth)}</span></div>
                    <div className="rx-patient-field"><label>Age / Sex</label><span>{patientAgeLabel(patient)} · {patient.gender || '—'}</span></div>
                    <div className="rx-patient-field"><label>Hospital Number</label><span>{patient.hospitalNumber || '—'}</span></div>
                    <div className="rx-patient-field"><label>Phone</label><span>{patient.phone || '—'}</span></div>
                    <div className="rx-patient-field"><label>State / County</label><span>{patient.state || '—'}{patient.county ? ` · ${patient.county}` : ''}</span></div>
                    <div className="rx-patient-field"><label>Facility</label><span>{printFacilityName}</span></div>
                    <div className="rx-patient-field"><label>Visit Date</label><span>{new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</span></div>
                    <div className="rx-patient-field"><label>Blood Group</label><span>{(patient as unknown as Record<string, string>).bloodGroup || '—'}</span></div>
                  </div>
                </div>

                {/* ── Document body ── */}
                <div className="rx-body">

                  {/* Consultation Note */}
                  {printSections.has('consultation') && latestRecord && (
                    <div className="rx-section">
                      <div className="rx-section-title">Consultation Note</div>
                      <div className="rx-section-body">
                        <div className="rx-two-col" style={{ marginBottom: 6 }}>
                          <div className="rx-field"><b>Date:</b> {formatDateTime(latestRecord.consultedAt || latestRecord.visitDate)}</div>
                          <div className="rx-field"><b>Visit type:</b> {latestRecord.visitType}</div>
                          <div className="rx-field"><b>Provider:</b> {latestRecord.providerName}</div>
                          <div className="rx-field"><b>Department:</b> {latestRecord.department}</div>
                        </div>
                        {latestRecord.chiefComplaint && <div className="rx-field"><b>Chief complaint:</b> {latestRecord.chiefComplaint}</div>}
                        {latestRecord.historyOfPresentIllness && <div className="rx-field" style={{ marginTop: 4 }}><b>History of present illness:</b> {latestRecord.historyOfPresentIllness}</div>}
                        {latestRecord.physicalExamination && Object.entries(latestRecord.physicalExamination).filter(([, v]) => v).length > 0 && (
                          <div className="rx-field" style={{ marginTop: 4 }}>
                            <b>Physical examination:</b>{' '}
                            {Object.entries(latestRecord.physicalExamination)
                              .filter(([, v]) => v)
                              .map(([sys, v]) => `${sys.charAt(0).toUpperCase()}${sys.slice(1)}: ${v}`)
                              .join('; ')}
                          </div>
                        )}
                        {latestRecord.treatmentPlan && <div className="rx-field" style={{ marginTop: 4 }}><b>Treatment plan:</b> {latestRecord.treatmentPlan}</div>}
                      </div>
                    </div>
                  )}

                  {/* Diagnoses + Active Problems side by side */}
                  {printSections.has('problems') && <div className="rx-two-col">
                    {latestRecord?.diagnoses && latestRecord.diagnoses.length > 0 && (
                      <div className="rx-section">
                        <div className="rx-section-title">Diagnoses (This Visit)</div>
                        <div className="rx-section-body">
                          {latestRecord.diagnoses.map((d, i) => (
                            <div key={i} className="rx-dx-row">
                              {d.icd10Code && <span className="rx-dx-code">{d.icd10Code}</span>}
                              <span className="rx-dx-name">{d.name}</span>
                              {d.type && <span className="rx-dx-type">{d.type}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {activeProblems.length > 0 && (
                      <div className="rx-section">
                        <div className="rx-section-title">Active Problem List</div>
                        <div className="rx-section-body">
                          {activeProblems.map(p => (
                            <div key={p._id} className="rx-dx-row">
                              {(p.icd10Code || p.icd11Code) && <span className="rx-dx-code">{p.icd10Code || p.icd11Code}</span>}
                              <span className="rx-dx-name">{p.name}</span>
                              {p.status === 'chronic' && <span className="rx-dx-type">chronic</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>}

                  {/* Vital Signs */}
                  {printSections.has('vitals') && latestVitals && (
                    <div className="rx-section">
                      <div className="rx-section-title">Vital Signs</div>
                      <div className="rx-section-body">
                        <table className="rx-vitals-table">
                          <tbody>
                            <tr>
                              {latestVitals.temperature && <><td>Temperature</td><td>{latestVitals.temperature} °C</td></>}
                              {latestVitals.systolic && <><td>Blood Pressure</td><td>{latestVitals.systolic}/{latestVitals.diastolic} mmHg</td></>}
                              {latestVitals.pulse && <><td>Pulse</td><td>{latestVitals.pulse} bpm</td></>}
                            </tr>
                            <tr>
                              {latestVitals.respiratoryRate && <><td>Resp. Rate</td><td>{latestVitals.respiratoryRate} /min</td></>}
                              {latestVitals.oxygenSaturation && <><td>SpO₂</td><td>{latestVitals.oxygenSaturation}%</td></>}
                              {latestVitals.weight && <><td>Weight</td><td>{latestVitals.weight} kg</td></>}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Prescriptions */}
                  {printSections.has('medications') && currentMeds.length > 0 && (
                    <div className="rx-section">
                      <div className="rx-section-title">Prescriptions</div>
                      <div className="rx-section-body">
                        {currentMeds.map((rx, i) => (
                          <div key={rx._id} className="rx-row" style={{ display: 'flex', gap: 12 }}>
                            <span style={{ minWidth: 18, color: '#5a7a96', fontSize: '7.5pt', paddingTop: 1 }}>{i + 1}.</span>
                            <span><b>{rx.medication}</b></span>
                            <span style={{ color: '#555' }}>{rx.dose} · {rx.frequency}{rx.duration ? ` · ${rx.duration}` : ''}{rx.route ? ` · ${rx.route}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Allergies */}
                  {printSections.has('allergies') && (activeAllergies.length > 0 || legacyAllergies.length > 0) && (
                    <div className="rx-section">
                      <div className="rx-section-title">Allergy &amp; Adverse Reaction Record</div>
                      <div className="rx-section-body">
                        {activeAllergies.map((a: { id: string; substance: string; criticality?: string; classification?: string; reaction?: string }) => (
                          <div key={a.id} className="rx-allergy-row">
                            {a.criticality && (
                              <span className={`rx-allergy-sev ${a.criticality.toLowerCase()}`}>{a.criticality}</span>
                            )}
                            <b>{a.substance}</b>
                            {a.classification && <span style={{ color: '#555', fontSize: '8pt' }}>{a.classification}</span>}
                            {a.reaction && <span style={{ color: '#555', fontSize: '8pt' }}>— Reaction: {a.reaction}</span>}
                          </div>
                        ))}
                        {legacyAllergies.map((a: string, i: number) => (
                          <div key={i} className="rx-allergy-row"><b>{a}</b></div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lab Results */}
                  {printSections.has('labs') && patientLabs.length > 0 && (
                    <div className="rx-section">
                      <div className="rx-section-title">Recent Laboratory Results</div>
                      <div className="rx-section-body">
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                          <thead>
                            <tr style={{ background: '#f0f6fb' }}>
                              <th style={{ textAlign: 'left', padding: '3pt 8pt', borderBottom: '1pt solid #c5d8e8', fontWeight: 700 }}>Test</th>
                              <th style={{ textAlign: 'left', padding: '3pt 8pt', borderBottom: '1pt solid #c5d8e8', fontWeight: 700 }}>Result</th>
                              <th style={{ textAlign: 'left', padding: '3pt 8pt', borderBottom: '1pt solid #c5d8e8', fontWeight: 700 }}>Unit</th>
                              <th style={{ textAlign: 'left', padding: '3pt 8pt', borderBottom: '1pt solid #c5d8e8', fontWeight: 700 }}>Reference</th>
                              <th style={{ textAlign: 'left', padding: '3pt 8pt', borderBottom: '1pt solid #c5d8e8', fontWeight: 700 }}>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {patientLabs.map((l, i) => (
                              <tr key={i} style={{ borderBottom: '0.5pt solid #dde8f0', background: l.abnormal ? '#fff8f8' : 'transparent' }}>
                                <td style={{ padding: '3pt 8pt', fontWeight: 600 }}>{l.testName}</td>
                                <td style={{ padding: '3pt 8pt', color: l.abnormal ? '#c0392b' : '#1a1a1a', fontWeight: l.abnormal ? 700 : 400 }}>{l.result}{l.abnormal ? ' ↑' : ''}</td>
                                <td style={{ padding: '3pt 8pt', color: '#555' }}>{l.unit || '—'}</td>
                                <td style={{ padding: '3pt 8pt', color: '#555' }}>{l.referenceRange || '—'}</td>
                                <td style={{ padding: '3pt 8pt', color: '#555' }}>{formatDate(l.completedAt || l.orderedAt || l.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Immunizations */}
                  {printSections.has('immunizations') && patientImms.length > 0 && (
                    <div className="rx-section">
                      <div className="rx-section-title">Immunization Record</div>
                      <div className="rx-section-body">
                        <div className="rx-three-col">
                          {patientImms.map((im, i) => (
                            <div key={i} className="rx-row" style={{ borderBottom: 'none', paddingBottom: 2 }}>
                              <b>{im.vaccine}</b>{im.doseNumber ? ` (Dose ${im.doseNumber})` : ''}<br />
                              <span style={{ color: '#555', fontSize: '7.5pt' }}>{formatDate(im.dateGiven)}{im.batchNumber ? ` · Batch: ${im.batchNumber}` : ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Next Appointment */}
                  {printSections.has('appointments') && upcomingPrint && (
                    <div className="rx-section">
                      <div className="rx-section-title">Next Appointment</div>
                      <div className="rx-section-body rx-two-col">
                        <div className="rx-field"><b>Date &amp; Time:</b> {new Date(`${upcomingPrint.appointmentDate}T${upcomingPrint.appointmentTime || '00:00'}`).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</div>
                        {upcomingPrint.reason && <div className="rx-field"><b>Reason:</b> {upcomingPrint.reason}</div>}
                        {upcomingPrint.providerName && <div className="rx-field"><b>Provider:</b> {upcomingPrint.providerName}</div>}
                        <div className="rx-field"><b>Facility:</b> {printFacilityName}</div>
                      </div>
                    </div>
                  )}

                  {/* Signature block */}
                  <div className="rx-sig-block">
                    <div>
                      <div className="rx-sig-label">Clinician Signature</div>
                      <div className="rx-sig-line" />
                      <div className="rx-sig-name">{printSignature}</div>
                      <div className="rx-sig-role">{currentUser?.role ? currentUser.role.replace(/_/g, ' ') : ''}</div>
                      <div className="rx-sig-role">Signed: {printedAt}</div>
                    </div>
                    <div>
                      <div className="rx-sig-label">Patient / Guardian Signature</div>
                      <div className="rx-sig-line" />
                      <div className="rx-sig-role">Date: ______________________</div>
                      <div className="rx-sig-role" style={{ marginTop: 4 }}>Relationship: ______________</div>
                    </div>
                  </div>

                </div>{/* end rx-body */}

                {/* Fixed footer on every page */}
                <div className="rx-footer">
                  <span className="rx-footer-conf">CONFIDENTIAL — Patient Medical Record</span>
                  <span>Tamam · {patient.hospitalNumber || patient.geocodeId} · {printFacilityName}</span>
                  <span>Printed: {printedAt}</span>
                </div>

              </div>
            );
          })()}

          {/* ══════ SIGN BEFORE PRINT MODAL ══════ */}
          {showPrintModal && (
            <Modal onClose={() => setShowPrintModal(false)} width={560} labelledBy="print-sign-title">
              <div className="rounded-xl p-6 space-y-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                <div className="flex items-center justify-between">
                  <h2 id="print-sign-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Print patient record</h2>
                  <button className="p-1 rounded" onClick={() => setShowPrintModal(false)} style={{ color: 'var(--text-muted)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  Patient identity is always included. Select the sections needed for this printout, then sign the document.
                </p>
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>Sections to print</span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold"
                      style={{ color: 'var(--tamamhealth-blue)' }}
                      onClick={() => setPrintSections(prev => prev.size === PRINT_SECTION_OPTIONS.length ? new Set() : new Set(DEFAULT_PRINT_SECTIONS))}
                    >
                      {printSections.size === PRINT_SECTION_OPTIONS.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PRINT_SECTION_OPTIONS.map(section => (
                      <label key={section.id} className="flex items-start gap-2 rounded-md p-2 cursor-pointer" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                        <input
                          type="checkbox"
                          checked={printSections.has(section.id)}
                          onChange={() => setPrintSections(prev => {
                            const next = new Set(prev);
                            if (next.has(section.id)) next.delete(section.id); else next.add(section.id);
                            return next;
                          })}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{section.label}</span>
                          <span className="block text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>{section.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Clinician name &amp; title</label>
                  <input
                    autoFocus
                    value={printSignature}
                    onChange={e => setPrintSignature(e.target.value)}
                    placeholder="e.g. Dr. James Wani Igga, MD"
                    className="w-full p-2.5 rounded-md text-[13px]"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && printSignature.trim() && printSections.size > 0) {
                        setShowPrintModal(false);
                        setPrintSigned(true);
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button className="btn btn-sm btn-secondary" onClick={() => setShowPrintModal(false)}>Cancel</button>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={!printSignature.trim() || printSections.size === 0}
                    onClick={() => {
                      setShowPrintModal(false);
                      setPrintSigned(true);
                    }}
                  >
                    <Printer className="w-3.5 h-3.5" /> Sign &amp; Print selected
                  </button>
                </div>
              </div>
            </Modal>
          )}

          <button onClick={() => router.push('/patients')} className="ehr-chart-back flex items-center gap-1.5 text-sm mb-4 no-print" style={{ color: 'var(--tamamhealth-blue)' }}>
            <ArrowLeft className="w-4 h-4" /> {t('action.back')}
          </button>

          <OpenmrsChartShell
            activeTab={activeTab}
            setActiveTab={selectTab}
            railItems={omrsRailItems}
            moreItems={omrsMoreItems}
            patient={patient}
            currentUser={currentUser}
            canPrescribe={canPrescribe}
            canOrderLabs={canOrderLabs}
            canConsult={canConsult}
            // Gates the clinical workspace panels on the right rail. Reception,
            // cashiers, the lab bench and pharmacy all reach this chart on the
            // restricted tab sets above; the drawer has to honour the same rule
            // or it becomes a second way in to the same clinical detail.
            canViewClinical={canViewClinical}
            router={router}
            onOpenPrescribeModal={() => setShowPrescribeModal(true)}
            onOpenOrderLabModal={() => setShowOrderLabModal(true)}
            onNoteSaved={() => setNotesRefreshToken(t => t + 1)}
            panelRequest={chartPanelRequest}
            onPanelRequestHandled={() => setChartPanelRequest(null)}
            header={
              <ChartHeader
                patient={patient}
                pregnancyPill={pregnancyPillNode}
                patientBalance={patientBalance}
                onCollectPayment={openPaymentFromHeader}
                onMessage={() => { setMessageIsEducation(false); setShowMessageModal(true); }}
                onPrint={() => { setPrintSignature(currentUser?.name || ''); setPrintSections(new Set(DEFAULT_PRINT_SECTIONS)); setPrintSigned(false); setShowPrintModal(true); }}
                onPatientEd={() => {
                  // Real patient-education action: a message queued to the
                  // patient (app/SMS), pre-labelled — not just a tab switch.
                  // The flag files it under Documents ▸ Patient education.
                  setMessageSubject('Patient education');
                  setMessageIsEducation(true);
                  setShowMessageModal(true);
                }}
                onNote={() => (canConsult ? void openClinicalNoteDrawer() : selectTab('notes'))}
                onScripts={() => (canPrescribe ? setShowPrescribeModal(true) : selectTab('prescriptions'))}
                onOrders={() => (canOrderLabs ? setShowOrderLabModal(true) : selectTab('labs'))}
                onExchange={() => (canManageReferrals ? setShowReferModal(true) : selectTab('appointments'))}
                onEdit={openEditModal}
                onStickyNote={() => { if (canViewClinical) selectTab('notes'); }}
                onShowAllergies={() => selectTab('allergies')}
                onAssignProvider={canAssignPatients ? () => setAssignTarget({
                  patientId: patient._id,
                  patientName: patientFullName(patient),
                  hospitalNumber: patient.hospitalNumber,
                  currentDoctorId: patient.assignedDoctor,
                }) : undefined}
              />
            }
            vitalsBand={canViewClinical ? (
              <ChartVitalsBand
                // The newest reading overall, including a triage stop the
                // patient hasn't been formally seen for yet — not only the
                // newest medical_record, which would leave the band showing
                // stale (or no) vitals right after triage.
                latestVitals={latestVitals}
                latestRecordDate={latestVitalsEntry?.at}
                onViewVitalsHistory={() => selectTab('vitals')}
                onRecordVitals={() => { selectTab('vitals'); setShowNurseVitals(true); }}
                canRecordVitals={canConsult || canRecordVitalEvents}
              />
            ) : undefined}
          >
          <section className="ehr-chart-content">


          {/* Care ownership is in flight (or time-boxed) — shown on every tab,
              because a clinician who doesn't know a transfer is pending can
              start work the receiving team is about to take over. */}
          {patient && (
            <TransferBanner patient={patient} onOpenHistory={() => selectTab('referrals')} />
          )}

          {/* Chart-permanent safety alerts (fall risk, difficult IV access,
              a referral's own acknowledgement, etc.) — previously only
              rendered in the mobile facesheet, so the desktop chart never
              showed them at all. Shown on every tab, same as the banner
              above. `hideAddButton` matches the mobile usage: this is a
              visibility surface, not a second place to write one. */}
          {canViewClinical && patient && (
            <CareAlertsBanner patient={patient} hideAddButton />
          )}


          {activeTab === 'overview' && (
            <PatientFacesheetView
              patient={patient}
              latestVitals={latestVitals}
              problems={patientProblems}
              prescriptions={(allPrescriptions || []).filter(rx => rx.patientId === patient._id)}
              labResults={(allLabResults || []).filter(lab => lab.patientId === patient._id)}
              immunizations={(allImmunizations || []).filter(imm => imm.patientId === patient._id)}
              canViewClinical={canViewClinical}
              onOpenTab={selectTab}
              actions={facesheetActions}
              visiblePanelIds={facesheetPanels}
              customizeOpen={showCustomizeView}
              onToggleCustomize={() => setShowCustomizeView(open => !open)}
              onTogglePanel={toggleFacesheetPanel}
              onResetPanels={() => setFacesheetPanels(new Set(DEFAULT_FACESHEET_PANELS))}
            />
          )}

          {activeTab === 'appointments' && patient && (() => {
            const sortedAppts = [...patientAppointments].sort((a, b) => apptTs(b) - apptTs(a));
            const apptPageRows = sortedAppts.slice((apptPage - 1) * APPT_PAGE_SIZE, apptPage * APPT_PAGE_SIZE);
            return (
              <div className="space-y-2">
                <ChartSection
                  title="Appointments"
                  addLabel="New appointment"
                  onAdd={canBookAppointments ? () => router.push(`/appointments?new=1&patientId=${patient._id}`) : undefined}
                  pagination={{ page: apptPage, pageSize: APPT_PAGE_SIZE, total: sortedAppts.length, onPageChange: setApptPage }}
                >
                  {sortedAppts.length === 0 ? (
                    <OmrsEmptyState
                      itemLabel="appointments"
                      actionLabel="Record appointments"
                      onAction={canBookAppointments ? () => router.push(`/appointments?new=1&patientId=${patient._id}`) : undefined}
                      disabledReason={canBookAppointments ? undefined : 'Requires scheduling permission'}
                    />
                  ) : (
                    <table className="omrs-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Time</th>
                          <th>Care team</th>
                          <th>Context</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apptPageRows.map(appt => (
                          <tr key={appt._id}>
                            <td className="font-mono">{formatDate(appt.appointmentDate)}</td>
                            <td>{formatClockTime(appt.appointmentTime) || '—'}</td>
                            <td>
                              {/* The care team ON THIS APPOINTMENT. The second
                                  line used to print the patient's current
                                  assigning nurse against every row, including
                                  visits booked years earlier by someone else —
                                  a name that was never part of that booking.
                                  `staffName` is the appointment's own second
                                  staff member, and it is simply absent when the
                                  booking has none. */}
                              <div className="appointment-card-provider">
                                <strong>{appt.providerName || 'Doctor unassigned'}</strong>
                                {appt.staffName && <span>{appt.staffName}</span>}
                              </div>
                            </td>
                            <td>
                              <div className="appointment-card-provider">
                                <strong>{appt.reason || appt.department || 'Follow-up'}</strong>
                                <span>{[appt.department, appt.room].filter(Boolean).join(' · ') || 'Appointment'}</span>
                              </div>
                            </td>
                            <td><span className="badge badge-normal text-[10px]">{humanizeStatus(appt.status)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </ChartSection>
              </div>
            );
          })()}

          {/* No wrapper card: PatientSBAR is built from ChartSection now, and
              nesting those inside a card produced a card-in-a-card. */}
          {activeTab === 'sbar' && patient && (
            <>
              <PatientSBAR
                patient={patient}
                records={records}
                labs={(allLabResults || []).filter(l => l.patientId === patient._id)}
                prescriptions={(allPrescriptions || []).filter(r => r.patientId === patient._id)}
                triages={patientTriages}
                problems={patientProblems}
                latestShiftHandoff={latestShiftHandoff}
              />
            </>
          )}

          {/* Problem List — longitudinal active/chronic/resolved */}
          {/* Conditions — OpenMRS-style Conditions table (ChartSection), replacing
              the old ProblemList card-list layout for this tab specifically.
              The original ProblemList widget (with inline edit/resolve) still
              lives on the legacy facesheet view. */}
          {activeTab === 'problems' && patient && (
            <div className="space-y-4">
              <ConditionsSection
                patientId={patient._id}
                patientName={patientFullName(patient)}
                noKnownProblems={patient.noKnownProblems}
                reconciledAt={patient.problemReconciledAt}
                autoOpenAdd={sectionAddRequest === 'problems'}
                onAutoOpenHandled={() => setSectionAddRequest(null)}
              />
            </div>
          )}

          {/* Allergies — OpenMRS-style Allergies table (ChartSection). Directives
              stay reachable here since they don't have their own rail slot. */}
          {activeTab === 'allergies' && patient && (
            <div className="space-y-4">
              <AllergiesSection
                patient={patient}
                autoOpenAdd={sectionAddRequest === 'allergies'}
                onAutoOpenHandled={() => setSectionAddRequest(null)}
              />
              <DirectivesSection patient={patient} />
            </div>
          )}

          {activeTab === 'notes' && patient && (
            <div className="space-y-4">
              {/* Clinical notes are the encounter record now that the
                  consultation wizard is retired, so they lead this tab rather
                  than being signposted off to the Activity feed. */}
              <div className="card-elevated p-5">
                <NotesList
                  patientId={patient._id}
                  patientName={patientFullName(patient)}
                  mrn={patient.hospitalNumber}
                  patientDob={patient.dateOfBirth}
                  currentUser={currentUser}
                  showCreate={canConsult}
                  // Opening a note leaves the chart for /notes/[id]: the note
                  // is a document to be read and signed in full, and the
                  // drawer gave it a third of the screen next to the chart it
                  // was already summarising.
                  refreshToken={notesRefreshToken}
                />
              </div>
              {/* Telephone contacts stay separate: they are care-team messages
                  about a patient, not documentation of an encounter. */}
              <div className="card-elevated p-5">
                <PhoneNotes patient={patient} />
              </div>
            </div>
          )}

          {activeTab === 'demographics' && patient && (
            <PatientDemographicsView
              patient={patient}
              activeTab={demographicsTab}
              onTabChange={setDemographicsTab}
              onEdit={openEditModal}
              // The header's "Edit details" is gated on canRegisterPatients;
              // this button opens the identical modal, so it has to be too —
              // otherwise any chart viewer (a nurse, a cashier looking up a
              // balance) could rewrite the patient's name, DOB or county.
              canEdit={canRegisterPatients}
              appointments={patientAppointments}
              regHospitalName={regHospital?.name || patient.registrationHospital || ''}
            />
          )}

          {activeTab === 'careChecklist' && patient && (
            <div className="space-y-4">
              <ScreeningsPanel patient={patient} />
              <RemindersPanel patient={patient} />
              <div className="card-elevated p-5">
                <AssessmentsPanel patient={patient} focusId={focusId} />
              </div>
            </div>
          )}

          {activeTab === 'documents' && patient && (
            <div className="space-y-4">
              {/* Documents ▸ Referrals ▸ Patient education. Referrals are read
                  here (the record itself is owned by the referrals module) and
                  education reuses the header's own send action, so the section
                  adds no second way to do either. */}
              <DocumentsPanel
                patient={patient}
                referrals={patientReferrals}
                canViewClinical={canViewClinical}
                focusId={focusId}
                onSendEducation={() => {
                  setMessageSubject('Patient education');
                  setMessageIsEducation(true);
                  setShowMessageModal(true);
                }}
                onOpenAllReferrals={() => router.push(`/referrals?patient=${encodeURIComponent(patient._id)}`)}
                onNewReferral={canManageReferrals ? () => setShowReferModal(true) : undefined}
              />
            </div>
          )}

          {activeTab === 'history' && patient && (
            <PatientTimeline
              medicalRecords={records}
              clinicalNotes={clinicalNotes}
              labResults={allLabResults || []}
              prescriptions={allPrescriptions || []}
              immunizations={allImmunizations || []}
              referrals={patientReferrals}
              ancVisits={patientANC}
              appointments={patientAppointments}
              triages={patientTriages}
              // Consultation records carry a full sign / co-sign / addendum
              // lifecycle that no screen had ever mounted, so visits were never
              // attested or locked. The controls belong on the visit itself.
              renderRecordSignature={canViewClinical ? recordId => {
                const rec = records.find(r => r._id === recordId);
                return rec ? <RecordSignatureBar record={rec} /> : null;
              } : undefined}
              focusId={focusId}
            />
          )}

          {/* Labs Tab — results list, and the bench workflow for one order. */}
          {activeTab === 'labs' && (
            <LabWorkspace
              patientId={patient._id}
              canOrderLabs={canOrderLabs}
              canWork={canEnterLabResults}
              onAdd={() => setShowOrderLabModal(true)}
              focusId={focusId}
              seedResult={seedResult}
            />
          )}

          {/* Prescriptions Tab */}
          {activeTab === 'prescriptions' && (
            <div className="space-y-4">
              {patient.preferredPharmacy && (
                <div className="card-elevated px-5 py-3 flex items-center gap-3">
                  <div className="icon-box-sm flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Preferred Pharmacy</p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {patient.preferredPharmacy.name}
                      {patient.preferredPharmacy.address && <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {patient.preferredPharmacy.address}</span>}
                      {patient.preferredPharmacy.phone && <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {patient.preferredPharmacy.phone}</span>}
                    </p>
                  </div>
                </div>
              )}
              <MedicationsSection
                patientId={patient._id}
                patientName={patientFullName(patient)}
                canPrescribe={canPrescribe}
                onAdd={() => setShowPrescribeModal(true)}
                noKnownMedications={patient.noKnownMedications}
                reconciliation={patient.medReconciliation}
                reconciledAt={patient.medReconciliationAt}
                currentUser={currentUser}
                focusId={focusId}
              />
            </div>
          )}

          {/* Vitals Tab */}
          {activeTab === 'vitals' && (
            <ChartSection
              title={vitalsView === 'flowsheet' ? 'Vital sign flowsheet' : 'Vitals'}
              onAdd={canRecordVitalEvents ? () => setShowNurseVitals(true) : undefined}
              addLabel="Record vitals"
              toggleSlot={(
                <div className="ehr-chart-subtabs" role="tablist" aria-label="Vitals view">
                  <button
                    type="button"
                    className={vitalsView === 'table' ? 'is-active' : ''}
                    onClick={() => setVitalsView('table')}
                    role="tab"
                    aria-selected={vitalsView === 'table'}
                  >
                    Vitals
                  </button>
                  <button
                    type="button"
                    className={vitalsView === 'flowsheet' ? 'is-active' : ''}
                    onClick={() => setVitalsView('flowsheet')}
                    role="tab"
                    aria-selected={vitalsView === 'flowsheet'}
                  >
                    Flowsheet
                  </button>
                </div>
              )}
            >
              {vitalsView === 'flowsheet' ? (
                <div className="p-5">
                  <VitalsTrends records={recordsWithTriageVitals} />
                </div>
              ) : (
                <div className="overflow-x-auto" style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
                <table className="omrs-table" style={{ minWidth: 1140 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Source</th>
                      <th>Temp (°C)</th>
                      <th>BP (mmHg)</th>
                      <th>Pulse</th>
                      <th>Resp Rate</th>
                      <th>SpO₂</th>
                      <th>Weight (kg)</th>
                      <th>BMI</th>
                      <th>Facility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vitalsTimeline.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center text-sm py-8" style={{ color: 'var(--text-muted)' }}>
                          No vitals recorded yet for this patient.
                        </td>
                      </tr>
                    )}
                    {vitalsTimeline.map(entry => {
                      const hasBp = entry.systolic !== undefined && entry.diastolic !== undefined;
                      const sourceStyle = entry.source === 'Triage'
                        ? { background: 'var(--accent-light)', color: 'var(--accent-primary)' }
                        : entry.source === 'Nursing'
                          ? { background: 'rgba(124,58,237,0.12)', color: 'var(--accent-purple)' }
                          : { background: 'rgba(31,157,111,0.14)', color: 'var(--color-success)' };
                      return (
                        <tr key={entry.id}>
                          <td className="font-mono text-xs">{formatDate(entry.at)}</td>
                          <td><span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={sourceStyle}>{entry.source}</span></td>
                          <td style={{ color: entry.temperature !== undefined && entry.temperature > 37.5 ? 'var(--color-danger-text)' : 'inherit', fontWeight: entry.temperature !== undefined && entry.temperature > 37.5 ? 600 : 400 }}>
                            {entry.temperature ?? '—'}
                          </td>
                          <td style={{ color: entry.systolic !== undefined && entry.systolic > 140 ? 'var(--color-danger-text)' : 'inherit', fontWeight: entry.systolic !== undefined && entry.systolic > 140 ? 600 : 400 }}>
                            {hasBp ? `${entry.systolic}/${entry.diastolic}` : '—'}
                          </td>
                          <td style={{ color: entry.pulse !== undefined && entry.pulse > 100 ? 'var(--color-danger-text)' : 'inherit' }}>{entry.pulse ?? '—'}</td>
                          <td>{entry.respiratoryRate ?? '—'}</td>
                          <td style={{ color: entry.oxygenSaturation !== undefined && entry.oxygenSaturation < 95 ? 'var(--color-danger-text)' : 'inherit' }}>
                            {entry.oxygenSaturation !== undefined ? `${entry.oxygenSaturation}%` : '—'}
                          </td>
                          <td>{entry.weight ?? '—'}</td>
                          <td>{entry.bmi ?? '—'}</td>
                          <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{(entry.facility || '').replace(' Hospital', '').replace(' Teaching', '') || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </ChartSection>
          )}

          {/* Immunizations — dose history recorded in the chart, through the
              same service the /immunizations module writes with. */}
          {activeTab === 'immunizations' && (
            <ImmunizationsSection
              patient={patient}
              patientName={patientFullName(patient)}
              canRecord={canConsult || canRecordVitalEvents}
              facilityName={regHospital?.name || currentUser?.hospitalName}
            />
          )}

          {/* Care coordination: internal transfers and external referrals share
              one ownership and follow-up destination. */}
          {activeTab === 'referrals' && (
            <div className="space-y-3">
              <TransferHistoryPanel patient={patient} canViewClinical={canViewClinical} />
              <div className="flex items-center justify-between px-1 mb-1">
                <div className="flex items-center gap-2">
                  <div className="icon-box-sm">
                    <ArrowRightLeft className="w-3.5 h-3.5" style={{ color: 'var(--tamamhealth-blue)' }} />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Referrals</span>
                </div>
                <button onClick={() => router.push(`/referrals?patient=${encodeURIComponent(patient._id)}`)} className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--tamamhealth-blue)' }}>
                  All referrals <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              {patientReferrals.length === 0 ? (
                <div className="card-elevated p-8 text-center">
                  <ArrowRightLeft className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('referral.none')}</p>
                </div>
              ) : (
                <div className="space-y-3" style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
                {patientReferrals.map(ref => {
                  const tp = ref.transferPackage as { medicalRecords?: unknown[]; labResults?: unknown[]; attachments?: unknown[]; packageSizeBytes?: number } | undefined;
                  const refAtts = ref.referralAttachments as unknown[] | undefined;
                  return (
                    <div key={ref._id} className="card-elevated px-5 py-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`badge urgency-${ref.urgency} text-[10px]`}>
                            {ref.urgency === 'emergency' && <AlertTriangle className="w-3 h-3" />}
                            {ref.urgency.charAt(0).toUpperCase() + ref.urgency.slice(1)}
                          </span>
                          <span className={`badge ${ref.status === 'sent' ? 'ref-sent' : ref.status === 'received' ? 'ref-received' : ref.status === 'seen' ? 'ref-seen' : ref.status === 'completed' ? 'ref-completed' : 'ref-cancelled'} text-[10px]`}>
                            {ref.status === 'sent' ? 'Sent' : ref.status === 'received' ? 'Received' : ref.status === 'seen' ? 'Being Seen' : ref.status === 'completed' ? 'Completed' : 'Cancelled'}
                          </span>
                          {tp && (
                            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--accent-light)', color: 'var(--tamamhealth-blue)', border: '1px solid var(--accent-border)' }}>
                              <Package className="w-3 h-3" /> Data Package
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                          {ref.referralDate}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <span style={{ color: 'var(--text-secondary)' }}>{ref.fromHospital}</span>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <span className="font-semibold">{ref.toHospital}</span>
                        <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--overlay-subtle)' }}>{ref.department}</span>
                      </div>
                      {canViewClinical ? (
                        <>
                          <p className="text-sm mb-1"><span className="font-semibold">Reason:</span> {ref.reason}</p>
                          {ref.notes && (
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Notes: {ref.notes}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>Clinical reason restricted</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span>Dr. {ref.referringDoctor}</span>
                        {refAtts && refAtts.length > 0 && (
                          <span>{refAtts.length} attachment(s)</span>
                        )}
                        {tp && tp.medicalRecords && (
                          <span>{(tp.medicalRecords as unknown[]).length} record(s) in package</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="space-y-5">
              {/* The superbill / fee ticket (P2.3) is no longer its own card —
                  its service picker rides the Charges toolbar inside BillingTab
                  and the draft ticket renders above the charges it prices. */}
              <BillingTab
                patient={patient}
                patientBalance={patientBalance}
                showPaymentPanel={showPaymentPanel}
                showPlanWizard={showPlanWizard}
                setShowPaymentPanel={setShowPaymentPanel}
                setShowPlanWizard={setShowPlanWizard}
                reloadPayments={reloadPayments}
                superbillEncounterId={(latestRecord as { encounterId?: string } | undefined)?.encounterId}
                hospitalName={hospitals.find(h => h._id === patient.registrationHospital)?.name}
              />
            </div>
          )}

          {/* Orders — unified drug + lab orders table (Stage 3). */}
          {activeTab === 'orders' && (
            <OrdersSection
              patientId={patient._id}
              canPrescribe={canPrescribe}
              canOrderLabs={canOrderLabs}
              onAddDrug={() => setShowPrescribeModal(true)}
              onAddLab={() => setShowOrderLabModal(true)}
              focusId={focusId}
            />
          )}

          {/* Procedures — bedside/theatre procedures (ProcedureDoc), recorded
              and listed directly on the chart. */}
          {activeTab === 'procedures' && (
            <ProceduresSection patientId={patient._id} patientName={patientFullName(patient)} canConsult={canConsult} />
          )}

          {/* Programs — care-program enrollments (ART/TB/PMTCT/ANC/Nutrition/
              EPI/NCD) with enroll + status-transition flows. */}
          {activeTab === 'programs' && (
            <ProgramsSection patientId={patient._id} patientName={patientFullName(patient)} canConsult={canConsult} />
          )}
          </section>
          </OpenmrsChartShell>
      </main>

      {/* Edit Demographics Modal */}
      {showNurseVitals && patient && currentUser && (
        <NurseVitalsModal
          patientId={patient._id}
          patientName={patientFullName(patient)}
          hospitalNumber={patient.hospitalNumber}
          hospitalId={currentUser.hospitalId || patient.registrationHospital || ''}
          hospitalName={currentUser.hospital?.name || currentUser.hospitalName || patient.registrationHospital || undefined}
          orgId={currentUser.orgId}
          encounterId={nurseVitalsEncounterId}
          currentUser={currentUser}
          onClose={() => setShowNurseVitals(false)}
        />
      )}

      {showMessageModal && patient && (
        <Modal onClose={() => !messageSending && setShowMessageModal(false)} width={500} labelledBy="patient-message-title">
          <div className="modal-content card-elevated p-5 w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 id="patient-message-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Message patient
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {patientFullName(patient)}{patient.phone ? ` · ${formatPhoneDisplay(patient.phone)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMessageModal(false)}
                className="p-1.5 rounded-lg"
                disabled={messageSending}
                style={{ background: 'var(--overlay-subtle)' }}
                aria-label="Close patient message"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Channel</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['app', 'sms', 'both'] as const).map(channel => (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => { setMessageChannel(channel); setMessageError(''); setMessageSent(false); }}
                      className="btn btn-sm"
                      style={{
                        background: messageChannel === channel ? 'var(--tamamhealth-blue)' : 'var(--bg-secondary)',
                        color: messageChannel === channel ? '#fff' : 'var(--text-primary)',
                        border: '1px solid var(--border-light)',
                      }}
                    >
                      {channel === 'app' ? 'App' : channel === 'sms' ? 'SMS' : 'App + SMS'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Subject</label>
                <input
                  value={messageSubject}
                  onChange={e => { setMessageSubject(e.target.value); setMessageSent(false); }}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Message</label>
                <textarea
                  autoFocus
                  value={messageBody}
                  onChange={e => { setMessageBody(e.target.value); setMessageError(''); setMessageSent(false); }}
                  rows={4}
                  placeholder="Write a clear patient instruction or follow-up message."
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              {messageError && <p className="text-[12px]" role="alert" style={{ color: 'var(--color-danger-text)' }}>{messageError}</p>}
              {messageSent && <p className="text-[12px] font-semibold" role="status" style={{ color: 'var(--color-success-text)' }}>Message saved and queued.</p>}
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button type="button" onClick={() => setShowMessageModal(false)} className="btn btn-sm btn-secondary" disabled={messageSending}>Close</button>
              <button type="button" onClick={sendPatientMessage} className="btn btn-sm btn-primary" disabled={messageSending || !messageBody.trim()}>
                <MessageSquare className="w-3.5 h-3.5" /> {messageSending ? 'Sending...' : 'Send message'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Demographics Modal */}
      {showEditModal && patient && (
        <Modal onClose={() => !editSubmitting && setShowEditModal(false)}>
          {/* No max-width here: Modal already sizes the dialog panel (600px) and
              paints it opaque, so a narrower child left ~90px of empty panel
              showing past the form's right edge. Matches the message modal above. */}
          <div className="modal-content card-elevated p-5 w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Edit Patient Demographics</h3>
              <button onClick={() => setShowEditModal(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="edit-first-name" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>First Name</label>
                  <input id="edit-first-name" type="text" value={editForm.firstName} onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-middle-name" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Middle Name</label>
                  <input id="edit-middle-name" type="text" value={editForm.middleName} onChange={e => setEditForm({ ...editForm, middleName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-surname" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Surname</label>
                  <input id="edit-surname" type="text" value={editForm.surname} onChange={e => setEditForm({ ...editForm, surname: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  {/* Capped at today — registration already does this, and a
                      future date of birth is never a correction. */}
                  <label htmlFor="edit-dob" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Date of Birth</label>
                  <input id="edit-dob" type="date" max={toIsoDate(new Date())} value={editForm.dateOfBirth} onChange={e => setEditForm({ ...editForm, dateOfBirth: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-gender" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Gender</label>
                  <Select id="edit-gender" value={editForm.gender} onChange={e => setEditForm({ ...editForm, gender: e.target.value as 'Male' | 'Female' })}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </Select>
                </div>
              </div>
              <div>
                <label htmlFor="edit-phone" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Phone</label>
                <input id="edit-phone" type="tel" value={editForm.phone} onChange={e => { setEditForm({ ...editForm, phone: e.target.value }); if (editErrors.phone) setEditErrors({}); }} aria-invalid={!!editErrors.phone} />
                {editErrors.phone && <p className="text-[11px] mt-1" role="alert" style={{ color: 'var(--color-danger-text)' }}>{editErrors.phone}</p>}
              </div>
              {/* State/county are pick-lists, not free text: registration writes
                  from these same lists, and every geographic rollup (surveillance,
                  vital statistics, the ADM1 maps) joins on the exact name. A typo
                  typed here would quietly drop the patient out of their county.
                  A value already on the record that isn't in the list is kept as
                  an option so editing a phone number can't silently rewrite it. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-state" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>State</label>
                  <Select
                    id="edit-state"
                    value={editForm.state}
                    onChange={e => setEditForm({ ...editForm, state: e.target.value, county: '' })}
                  >
                    <option value="">Select state…</option>
                    {editForm.state && !SOUTH_SUDAN_STATES.includes(editForm.state) && (
                      <option value={editForm.state}>{editForm.state} (on record)</option>
                    )}
                    {SOUTH_SUDAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
                <div>
                  <label htmlFor="edit-county" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>County</label>
                  <Select
                    id="edit-county"
                    value={editForm.county}
                    onChange={e => setEditForm({ ...editForm, county: e.target.value })}
                    disabled={!editForm.state}
                  >
                    <option value="">{editForm.state ? 'Select county…' : 'Select a state first'}</option>
                    {editForm.county && !editCounties.includes(editForm.county) && (
                      <option value={editForm.county}>{editForm.county} (on record)</option>
                    )}
                    {editCounties.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowEditModal(false)} className="btn btn-sm btn-secondary" disabled={editSubmitting}>Cancel</button>
              <button onClick={handleEditSubmit} className="btn btn-sm btn-primary" disabled={editSubmitting}>
                {editSubmitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Header action modals — open in place, pre-filled with this patient. */}
      {showOrderLabModal && (
        <LabOrderModal
          onClose={() => setShowOrderLabModal(false)}
          onPlaced={() => { void reloadLabResults(); }}
          presetPatientId={patient._id}
        />
      )}
      <PrescribeModal
        isOpen={showPrescribeModal}
        onClose={() => setShowPrescribeModal(false)}
        patient={patient}
        currentUser={currentUser}
      />
      <ReferModal
        isOpen={showReferModal}
        onClose={() => setShowReferModal(false)}
        patient={patient}
        currentUser={currentUser}
      />
      {assignTarget && (
        <AssignDoctorModal
          target={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </>
  );
}

/**
 * Facesheet card header — icon + title on the left, the card's primary write
 * action on the right. The action button stops propagation so it never also
 * fires the card's "open this tab" click handler.
 */
function FacesheetPanelHead({
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

function PatientFacesheetView({
  patient,
  latestVitals,
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
  problems: ProblemDoc[];
  prescriptions: PrescriptionDoc[];
  labResults: LabResultDoc[];
  immunizations: ImmunizationDoc[];
  canViewClinical: boolean;
  onOpenTab: (tab: string) => void;
  /** Per-panel primary actions. A missing entry hides that panel's action
   *  button (the role lacks the permission); the card itself stays clickable. */
  actions: FacesheetActions;
  visiblePanelIds: Set<FacesheetPanelId>;
  customizeOpen: boolean;
  onToggleCustomize: () => void;
  onTogglePanel: (panelId: FacesheetPanelId) => void;
  onResetPanels: () => void;
}) {
  const activeProblems = problems.filter(problem => problem.status === 'active' || problem.status === 'chronic');
  const activeAllergies = patient.structuredAllergies !== undefined
    ? patient.structuredAllergies.filter(a => a.status === 'active').map(a => ({ name: a.substance, detail: a.reaction || a.criticality }))
    : (patient.allergies || [])
        .filter(a => a && a.toLowerCase() !== 'none known' && a.toLowerCase() !== 'none')
        .map(a => ({ name: a, detail: undefined as string | undefined }));
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
            Clinical information is restricted for your role. Use Demographics, Account, Documents, and Recall for administrative work.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="tebra-facesheet">
      <div className="tebra-section-title">
        <h1>Patient summary</h1>
        <button type="button" onClick={onToggleCustomize}>
          {customizeOpen ? 'Done' : 'Customize View'}
        </button>
      </div>

      {customizeOpen && (
        <div className="tebra-customize-panel" role="group" aria-label="Customize facesheet panels">
          <div className="tebra-customize-panel__head">
            <strong>Show on Facesheet</strong>
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
      <section className="tebra-panel" onClick={() => onOpenTab('prescriptions')}>
        <FacesheetPanelHead icon={Pill} title="Medications" action={actions.medications} />
        {currentMeds.length ? (
          <div className="tebra-list">
            {currentMeds.map(rx => (
              <div key={rx._id} className="tebra-list-row">
                <strong>{rx.medication}</strong>
                <span>{formatRxSig(rx)}</span>
              </div>
            ))}
          </div>
        ) : <p className="tebra-none">(None documented)</p>}
      </section>
      )}

      {showPanel('problems') && (
      <section className="tebra-panel" onClick={() => onOpenTab('problems')}>
        <FacesheetPanelHead icon={ShieldAlert} title="Safety alerts" action={actions.problems} />
        {activeProblems.length || activeAllergies.length ? (
          <div className="tebra-list">
            {activeProblems.slice(0, 4).map(problem => (
              <div key={problem._id} className="tebra-list-row">
                <strong>{problem.name}</strong>
                <span className="tebra-list-row-meta">
                  {problem.icd10Code && <span>{problem.icd10Code}</span>}
                  <Badge tone={problem.status === 'chronic' ? 'warning' : 'success'}>{problem.status}</Badge>
                </span>
              </div>
            ))}
            {activeAllergies.slice(0, 4).map((allergy, index) => (
              <div
                key={`${allergy.name}-${index}`}
                className="tebra-list-row tebra-list-row--alert"
                // Allergies live on their own tab, not Conditions — without
                // this an allergy row opened the Conditions tab instead.
                onClick={event => { event.stopPropagation(); onOpenTab('allergies'); }}
              >
                <strong>Allergy: {allergy.name}</strong>
                <span>{allergy.detail || 'Active'}</span>
              </div>
            ))}
          </div>
        ) : <p className="tebra-none">No active problems or allergies documented.</p>}
        {actions.allergies && (
          <button
            type="button"
            className="tebra-panel-action"
            style={{ marginTop: 8 }}
            onClick={event => { event.stopPropagation(); actions.allergies!.onClick(); }}
          >
            <Plus aria-hidden /> {actions.allergies.label} allergy
          </button>
        )}
      </section>
      )}

      {showPanel('vitals') && (() => {
        const bpElevated = !!(latestVitals?.systolic && latestVitals.systolic >= 140) || !!(latestVitals?.diastolic && latestVitals.diastolic >= 90);
        const tempElevated = !!(latestVitals?.temperature && latestVitals.temperature >= 38);
        const spo2Low = !!(latestVitals?.oxygenSaturation && latestVitals.oxygenSaturation < 94);
        return (
      <section className="tebra-panel tebra-panel--highlight" onClick={() => onOpenTab('vitals')}>
        <FacesheetPanelHead icon={Activity} title="Latest observations" action={actions.vitals} />
        {latestVitals ? (
          <div className="tebra-vitals">
            <span className={bpElevated ? 'is-out-of-range' : ''}>BP <strong>{latestVitals.systolic && latestVitals.diastolic ? `${latestVitals.systolic}/${latestVitals.diastolic}` : '-'}</strong></span>
            <span>Pulse <strong>{latestVitals.pulse ?? '-'}</strong></span>
            <span className={tempElevated ? 'is-out-of-range' : ''}>Temp <strong>{latestVitals.temperature ?? '-'}</strong></span>
            <span className={spo2Low ? 'is-out-of-range' : ''}>SpO2 <strong>{latestVitals.oxygenSaturation ?? '-'}</strong></span>
          </div>
        ) : <p className="tebra-none">(None documented)</p>}
        {recentLabs.length > 0 && (
          // Results live on their own section, not Vitals — without the
          // stopPropagation these rows inherited the card's click and opened
          // the vitals table instead of the result they name.
          <div
            className="tebra-list mt-2"
            onClick={event => { event.stopPropagation(); onOpenTab('labs'); }}
          >
            <div className="tebra-list-row"><strong>Recent results</strong><span>{recentLabs.length} recorded</span></div>
            {recentLabs.slice(0, 2).map(lab => (
              <div key={lab._id} className="tebra-list-row">
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
      <section className="tebra-panel tebra-recommendations" onClick={() => onOpenTab('careChecklist')}>
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

function PatientDemographicsView({
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
  const tabs = [
    ['profile', 'Profile'],
    ['additional', 'Additional Info'],
    ['contacts', 'Contacts'],
    ['upcoming', 'Upcoming Appointments'],
    ['past', 'Past Appointments'],
    ['portal', 'Patient Portal'],
  ];
  const upcoming = appointments
    .filter(appt => new Date(`${appt.appointmentDate}T${appt.appointmentTime || '00:00'}:00`).getTime() >= Date.now())
    .sort((a, b) => `${a.appointmentDate}${a.appointmentTime}`.localeCompare(`${b.appointmentDate}${b.appointmentTime}`));
  const past = appointments
    .filter(appt => new Date(`${appt.appointmentDate}T${appt.appointmentTime || '00:00'}:00`).getTime() < Date.now())
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
          {canEdit && <button type="button" className="tebra-demo-edit" onClick={onEdit}>Edit</button>}
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
            <thead><tr><th>Date</th><th>Time</th><th>Care team</th><th>Context</th><th>Status</th></tr></thead>
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
                  <td>{appt.status}</td>
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

function DemoField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
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
function buildCareActions(patient: PatientDoc, immunizations: ImmunizationDoc[]) {
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
  const todayIso = new Date().toISOString().slice(0, 10);
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
