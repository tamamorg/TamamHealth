'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
// Clean single-stroke Tailwind Labs Heroicons via the local compatibility shim.
import { ArrowLeft, ArrowRightLeft, AlertTriangle, FileText, FlaskConical, Pill, Activity, ShieldAlert, ClipboardList, User as UserIcon, Wallet, Syringe, Stethoscope, Heart, History, Calendar, Bandage, Layers, Archive, Mail, Baby } from '@/components/icons/lucide';

import { usePatients } from '@/lib/hooks/usePatients';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePatientReferrals } from '@/lib/hooks/useReferrals';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { MessageSquare } from '@/components/icons/lucide';
import { Icon as DuotoneInfoIcon } from '@/components/icons';
import { useTranslation } from '@/lib/i18n/useTranslation';

import { LabOrderModal, LabWorkspace, OrdersSection, PatientMessagesSection, HistorySection, ProceduresSection, ProgramsSection, ImmunizationsSection, AssignDoctorModal, NurseVitalsModal, ReferModal, VisitSummaryDialog } from './detail/lazy-panels';
import { toIsoDate } from '@/lib/date-utils';
// Canonical geography — the same lists patient registration writes from, so an
// edit here can't introduce a state/county spelling the geo rollups don't know.
import { bomasFor, countiesFor, payamsFor } from '@/lib/data/south-sudan-reference';

import { patientFullName, patientAgeYearsExact } from '@/lib/patient-utils';
import { usePatientAppointments } from '@/lib/hooks/useAppointments';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTriage } from '@/lib/hooks/useTriage';

import { buildChartLatestVitals } from '@/lib/chart-latest-vitals';

import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePatientPayments } from '@/lib/hooks/usePayments';
import { usePatientHandoff } from '@/lib/hooks/usePatientHandoff';

import { useCreateNote } from '@/lib/clinical-notes/useCreateNote';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { TransferBanner } from '@/components/patients/TransferHistoryPanel';
import CareAlertsBanner from '@/components/patients/CareAlertsBanner';
import { useProblems } from '@/lib/hooks/useProblems';
import type { MedicalRecordDoc, PatientDoc } from '@/lib/db-types';

import { useAuth } from '@/lib/context';
import TamamChartShell from '@/components/ehr/chart/TamamChartShell';
import ChartHeader from '@/components/ehr/chart/ChartHeader';
import ChartVitalsBand from '@/components/ehr/chart/ChartVitalsBand';
import type { AssignDoctorTarget } from '@/components/AssignDoctorModal';

import { safeReturnTo } from '@/lib/navigation/return-to';

import { allowedChartTabIds, chartLandingTab, chartTabHref, resolveChartTab } from '@/lib/chart-tabs';
export { allowedChartTabIds, chartLandingTab, chartTabHref, resolveChartTab };
export type { ChartAccess } from '@/lib/chart-tabs';

import { DEFAULT_PRINT_SECTIONS, DEFAULT_FACESHEET_PANELS, stripArrivalParams, type PrintSectionId, type FacesheetPanelId, type ChartVitalsLike, type FacesheetActions } from './detail/chart-constants';
import { buildHandleEndAssignment } from './detail/buildHandleEndAssignment';
import { buildHandleToggleDeceased } from './detail/buildHandleToggleDeceased';
import { buildHandleEditSubmit } from './detail/buildHandleEditSubmit';
import { buildSendPatientMessage } from './detail/buildSendPatientMessage';
import PatientOverviewTab from './detail/PatientOverviewTab';
import PatientSbarTab from './detail/PatientSbarTab';
import PatientProblemsTab from './detail/PatientProblemsTab';
import PatientAllergiesTab from './detail/PatientAllergiesTab';
import PatientCareChecklistTab from './detail/PatientCareChecklistTab';
import PatientDocumentsTab from './detail/PatientDocumentsTab';
import PatientHistoryTab from './detail/PatientHistoryTab';
import { printWithFooter } from '@/lib/safe-html';
import PatientAppointmentsTab from './detail/PatientAppointmentsTab';
import PatientBillingTab from './detail/PatientBillingTab';
import PatientChartPrintStyles from './detail/PatientChartPrintStyles';
import PatientCoordinationTab from './detail/PatientCoordinationTab';
import PatientDeceasedModal from './detail/PatientDeceasedModal';
import PatientDemographicsTab from './detail/PatientDemographicsTab';
import PatientEditModal from './detail/PatientEditModal';
import PatientMedicationsTab from './detail/PatientMedicationsTab';
import PatientMessageModal from './detail/PatientMessageModal';
import PatientNotesTab from './detail/PatientNotesTab';
import PatientPrintDocument from './detail/PatientPrintDocument';
import PatientPrintModal from './detail/PatientPrintModal';
import PatientVitalsTab from './detail/PatientVitalsTab';
import PatientAncTab from './detail/PatientAncTab';
import StartVisitPanel from '@/components/ehr/chart/panels/StartVisitPanel';
import NotePrescribeForm from '@/components/clinical-notes/prescribe/PrescribeModal';
import BookAppointmentPanel from '@/components/ehr/chart/panels/BookAppointmentPanel';
import { apptBucket, appointmentsInView, type ApptView } from './detail/appointment-buckets';
import { jubaDate } from '@/lib/time-juba';
import { useUrlView } from '@/lib/navigation/use-url-view';


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
  const selectTab = useCallback((next: string, focus?: string) => {
    setActiveTab(prev => {
      if (prev !== next || focus) setFocusId(focus);
      return next;
    });
    router.push(chartTabHref(pathname, next, searchParams.get('returnTo')), { scroll: false });
  }, [router, pathname, searchParams]);

  // Browser navigation (Back/Forward, or a `?tab=` link followed while this
  // page instance stays mounted) drives `activeTab` from the URL. Clinical-tab
  // gating still runs afterward in the allowedTabIds effect below, so a
  // non-clinical viewer deep-linked to a clinical tab is still bounced back.
  //
  // A `focus` arriving this way (a bell notification or a dashboard row for
  // the chart already open) is read here too — otherwise the tab switched but
  // the record it named was never highlighted, and `focus=` stuck in the URL.
  useEffect(() => {
    const resolved = resolveChartTab(searchParams.get('tab'));
    if (resolved) setActiveTab(resolved);
    const focus = searchParams.get('focus');
    if (focus) {
      setFocusId(focus);
      stripArrivalParams();
    }
    // `?note=<id>` (where /notes/[id] now lands): open that note in the
    // chart's workspace — notes are documented here, beside the record.
    const noteParam = searchParams.get('note');
    if (noteParam) {
      setChartPanelRequest(`clinical-note:${noteParam}`);
      stripArrivalParams();
    }
  }, [searchParams]);

  // Strip the one-shot arrival params once they have been read into state, so
  // the URL that stays in the address bar is the shareable one (`?tab=`).
  //
  // The current history state is passed through rather than replaced with
  // null: the App Router keeps its own bookkeeping in that object, and blanking
  // it mid-navigation made the next history event restore the entry we came
  // from — arriving from the dashboard's "documents to sign" list bounced
  // straight back to the dashboard.
  useEffect(() => { stripArrivalParams(); }, []);
  // Sub-views of the Demographics and Vitals tabs, in the URL (?view=) so Back
  // returns to the one the user was on. The chart's tab switch drops ?view=.
  const [demographicsTab, setDemographicsTab] = useUrlView<string>(['profile', 'additional', 'contacts', 'upcoming', 'past', 'portal'], 'profile');
  const [vitalsView, setVitalsView] = useUrlView(['table', 'flowsheet'] as const, 'table');
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
  // A text leaves the building for a phone other people may read; the sender
  // confirms the patient agreed to that before anything is sent.
  const [messageTextConsent, setMessageTextConsent] = useState(false);
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [messageSent, setMessageSent] = useState(false);
  const [messageSentNote, setMessageSentNote] = useState('');
  const [messageSentWarning, setMessageSentWarning] = useState(false);
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
  // Start a visit workspace (header More → Add visit).
  const [showStartVisit, setShowStartVisit] = useState(false);
  // The page's own workspaces (Record vitals, Start a visit, Prescribe) can all
  // be open at once. The one opened last shows; closing it reveals the next
  // one still open, and so on — the chart's workspace stack does the same for
  // the rail panels. Reopening one brings it back to the top.
  type PageWorkspace = 'vitals' | 'startVisit' | 'prescribe' | 'appointment';
  const [showBookAppointment, setShowBookAppointment] = useState(false);
  const [pageWorkspaceOrder, setPageWorkspaceOrder] = useState<PageWorkspace[]>([]);
  const bringPageWorkspace = useCallback((ws: PageWorkspace) => {
    setPageWorkspaceOrder(prev => [...prev.filter(x => x !== ws), ws]);
  }, []);
  const openPrescribe = useCallback(() => { setShowPrescribeModal(true); bringPageWorkspace('prescribe'); }, [bringPageWorkspace]);
  const openBookAppointment = useCallback(() => { setShowBookAppointment(true); bringPageWorkspace('appointment'); }, [bringPageWorkspace]);
  const [correctingVitalsRecord, setCorrectingVitalsRecord] = useState<MedicalRecordDoc | undefined>(undefined);
  const [assignTarget, setAssignTarget] = useState<AssignDoctorTarget | null>(null);
  // One-shot request for the chart shell to open a workspace drawer panel
  // (e.g. header "+ Note" → `clinical-note:<id>`, the note editor drawer).
  const [chartPanelRequest, setChartPanelRequest] = useState<string | null>(null);
  // Bumped when the note drawer closes so the Notes tab under it reloads —
  // the editor autosaves, so whatever was typed is already on disk by then.
  const [notesRefreshToken, setNotesRefreshToken] = useState(0);
  // A note opened from the Notes tab is read over the chart, not by leaving
  // it; a draft's Edit hands it to the note drawer.
  const [noteViewer, setNoteViewer] = useState<{ id: string; kind: 'clinical' | 'record' } | null>(null);
  // One-shot request for a tab's ChartSection to pop its own "Add" form open
  // (e.g. the Facesheet Problems card's "Add" → Conditions tab + add modal).
  const [sectionAddRequest, setSectionAddRequest] = useState<'problems' | 'allergies' | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showVisitSummary, setShowVisitSummary] = useState(false);
  const [printSignature, setPrintSignature] = useState('');
  const [printSigned, setPrintSigned] = useState(false);
  const [printSections, setPrintSections] = useState<Set<PrintSectionId>>(() => new Set(DEFAULT_PRINT_SECTIONS));
  // Trigger print after React commits the selected document into the DOM.
  useEffect(() => {
    if (!printSigned) return;
    const printFrame = window.requestAnimationFrame(() => printWithFooter());
    const reset = () => setPrintSigned(false);
    window.addEventListener('afterprint', reset);
    return () => {
      window.cancelAnimationFrame(printFrame);
      window.removeEventListener('afterprint', reset);
    };
  }, [printSigned]);

  // Tamam-style client-side pagination for the Appointments tab (Stage 3).
  const [apptPage, setApptPage] = useState(1);
  const [apptSearch, setApptSearch] = useState('');
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
  const { patients, loading, update: updatePatient, reload: reloadPatients } = usePatients();
  const confirmPrompt = useConfirmPrompt();
  const { showToast } = useToast();
  const { hospitals } = useHospitals();

  const scopedPatient = patients.find(p => p._id === id);

  // The patients list is scoped to the viewer's facility, so a patient who was
  // registered at another facility in the same organisation (referred in, an
  // appointment booked here, a shared record) isn't in it — the chart would
  // wrongly show "Patient not found". Fetch such a patient directly by id, but
  // gate it through the canonical `getPatientById(id, scope)` so tenant
  // isolation still holds (no cross-org PHI) using the SAME `filterByScope`
  // every other read path uses, rather than a bespoke check.
  //
  // The scope passed here is deliberately org + role only, with `hospitalId`
  // dropped — this is what preserves the "referred-in / cross-facility"
  // lookup this fallback exists for. `filterByScope` only engages its
  // facility narrowing when `scope.hospitalId` is set, so omitting it here
  // limits enforcement to the org boundary, exactly like before, while now
  // also correctly rejecting a doc with no `orgId` at all (the old check
  // treated a missing `orgId` as an automatic pass for every viewer) and
  // routing super_admin/government through `filterByScope`'s own bypass
  // instead of a second, separately-maintained "isNational" check.
  const [fallbackPatient, setFallbackPatient] = useState<PatientDoc | null>(null);
  const [fallbackChecked, setFallbackChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFallbackPatient(null);
    setFallbackChecked(false);
    if (!id || loading || scopedPatient) { setFallbackChecked(true); return; }
    const role = currentUser?.role;
    if (!role) { setFallbackChecked(true); return; }
    const orgId = currentUser?.orgId;
    (async () => {
      const { getPatientById } = await import('@/lib/services/patient-service');
      const doc = await getPatientById(id, { orgId, role });
      if (cancelled) return;
      setFallbackPatient(doc);
      setFallbackChecked(true);
    })();
    return () => { cancelled = true; };
  }, [id, loading, scopedPatient, currentUser?.orgId, currentUser?.role]);

  const patient = scopedPatient ?? (fallbackPatient?._id === id ? fallbackPatient : undefined);
  const { records, loading: recordsLoading, reload: reloadRecords } = useMedicalRecords(patient?._id);
  const { referrals: patientReferrals } = usePatientReferrals(patient?._id);
  const { results: allLabResults, reload: reloadLabResults } = useLabResults(patient?._id);
  const { immunizations: allImmunizations } = useImmunizations(patient?._id);
  const { visits: allANCVisits, reload: reloadANC } = useANC();
  // A visit names its mother in `motherId`; `patientId` is optional and only
  // some visits carry it, so matching on it alone left visits off the chart.
  const patientANC = (allANCVisits || []).filter(a => !!patient && (a.patientId || a.motherId) === patient._id);
  // Antenatal care is a section of the record for any woman, and for anyone
  // whose record already holds an ANC visit.
  const showAncTab = patientANC.length > 0 || patient?.gender === 'Female';
  const { appointments: patientAppointments } = usePatientAppointments(patient?._id);
  // Upcoming / Today / Past on the Appointments tab.
  // In the URL (?view=) so Back returns to the view the user was on.
  const [apptView, setApptView] = useUrlView(['upcoming', 'today', 'past'] as const, 'upcoming' as ApptView);
  // Deep-linked appointment: open the view it falls in, page to its slice of
  // that view, then scroll it into view (same pattern as the other
  // focus-capable sections).
  useEffect(() => {
    if (activeTab !== 'appointments' || !focusId) return;
    const target = (patientAppointments || []).find(a => a._id === focusId);
    if (!target) return;
    const today = jubaDate();
    const view = apptBucket(target, today);
    const idx = appointmentsInView(patientAppointments || [], view, today).findIndex(a => a._id === focusId);
    setApptView(view);
    setApptSearch('');
    setApptPage(Math.floor(idx / APPT_PAGE_SIZE) + 1);
    const frame = requestAnimationFrame(() => {
      document.getElementById(`appointment-row-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, focusId, patientAppointments, setApptView]);
  const { prescriptions: allPrescriptions } = usePrescriptions(patient?._id);
  const { triages: patientTriages, loading: triageLoading } = useTriage(patient?._id);
  const latestShiftHandoff = usePatientHandoff(patient?._id);
  // Merged vitals history across both places they're captured — a consult's
  // own vitalSigns and a triage stop's own vitals fields — normalized and
  // sorted newest-first. Feeds the vitals band, the vitals table and the
  // trends view, so a patient who was just triaged (and not yet seen) shows
  // those readings instead of an older or blank one. Declared before the
  // loading/not-found early return below, alongside the other data hooks —
  // no hook in this component is called after that return.
  // Both sources must have resolved before any reading is called "latest":
  // drawing whichever arrived first showed an older consult reading, then
  // swapped to the newer triage set a moment later.
  const { ready: vitalsReady, timeline: vitalsTimeline } = useMemo(() => buildChartLatestVitals({
    records,
    triages: patientTriages,
    recordsReady: !recordsLoading && !!scope,
    triageReady: !triageLoading && !!scope,
  }), [records, patientTriages, recordsLoading, triageLoading, scope]);
  const latestPatientTriage = useMemo(
    () => [...patientTriages].sort((a, b) => (b.triagedAt || b.createdAt || '').localeCompare(a.triagedAt || a.createdAt || ''))[0],
    [patientTriages],
  );
  const { canConsult, canViewClinical, canOrderLabs, canEnterLabResults, canDispense, canPrescribe, canBookAppointments, canManageReferrals, canRecordVitalEvents, canRegisterPatients, canEnrollPrograms, canRecordMedicationHistory, canCheckInAppointments } = usePermissions();
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
    // A restricted viewer who opened the chart without naming a section also
    // moves on: their summary only says "clinical information is restricted",
    // so the tab their role came for is the useful first screen. Choosing
    // "Patient summary" from the rail sets ?tab=overview and is respected.
    const openedWithoutSection = activeTab === 'overview' && !searchParams.get('tab');
    if (allowedTabIds && (!allowedTabIds.includes(activeTab) || openedWithoutSection)) {
      const landing = chartLandingTab(allowedTabIds);
      setActiveTab(landing);
      // A correction, not navigation: replace the denied `?tab=` rather than
      // pushing a history entry, so Back doesn't walk into the bounce again —
      // and so the address bar can't claim to be on a section that isn't
      // rendering.
      router.replace(chartTabHref(pathname, landing, searchParams.get('returnTo')), { scroll: false });
    }
  }, [allowedTabIds, activeTab, router, pathname, searchParams]);
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
  }, [patient, createClinicalNoteDraft, scope, selectTab]);

  // Edit form state — initialised when modal opens
  const [editForm, setEditForm] = useState({
    firstName: '',
    middleName: '',
    surname: '',
    phone: '',
    state: '',
    county: '',
    payam: '',
    boma: '',
    tribe: '',
    dateOfBirth: '',
    gender: 'Male' as 'Male' | 'Female',
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  /** Counties for the state currently picked in the edit form. */
  const editCounties = useMemo(
    () => countiesFor(editForm.state),
    [editForm.state],
  );
  const editPayams = useMemo(
    () => payamsFor(editForm.state, editForm.county),
    [editForm.state, editForm.county],
  );
  const editBomas = useMemo(
    () => bomasFor(editForm.state, editForm.county, editForm.payam),
    [editForm.state, editForm.county, editForm.payam],
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
      payam: patient.payam || '',
      boma: patient.boma || '',
      tribe: patient.tribe || '',
      dateOfBirth: patient.dateOfBirth || '',
      gender: (patient.gender as 'Male' | 'Female') || 'Male',
    });
    setShowEditModal(true);
  };

  const openPaymentFromHeader = () => {
    selectTab('billing');
    setShowPaymentPanel(true);
  };

  // ── End assignment (header ⋯ menu) ───────────────────────────────────────
  // Moved here from the dashboard worklist rows: closing accountability for a
  // patient is a decision made looking at their record, not in passing from a
  // queue. Offered to the assigned clinician/nurse themselves and to
  // reception — the same set completePatientAssignment enforces — and only
  // while a standing assignment exists.
  const canEndAssignment = !!patient && !!currentUser
    && patient.assignmentStatus !== 'completed'
    && !!(patient.assignedDoctor || patient.assignedNurse)
    && (patient.assignedDoctor === currentUser._id
      || patient.assignedNurse === currentUser._id
      || canAssignPatients
      || currentUser.role === 'super_admin');

  /** Same confirm-with-required-reason flow the dashboard used to run: this
   *  closes accountability for a patient, and the audit entry is worthless
   *  without the why. */
  const handleEndAssignment = buildHandleEndAssignment({ t, patient, currentUser, confirmPrompt, showToast, reloadPatients });

  // ── Deceased status (header ⋯ menu) ──────────────────────────────────────
  // One dialog serves both directions; which one it is comes off the record
  // itself, so the menu and the dialog can never disagree about the state.
  const [showDeceasedModal, setShowDeceasedModal] = useState(false);
  const [deceasedDateInput, setDeceasedDateInput] = useState('');
  const [deceasedSubmitting, setDeceasedSubmitting] = useState(false);

  const openDeceasedModal = () => {
    if (!patient) return;
    setDeceasedDateInput(patient.deceasedDate || toIsoDate(new Date()));
    setShowDeceasedModal(true);
  };

  /**
   * Writes the same field set the Deaths module stamps when a death
   * registration is linked to a patient (see death-service.createDeath), so a
   * patient marked here and one marked there are indistinguishable to every
   * reader — dashboards, search, the follow-up worklists. Marking alive is the
   * exact inverse: the flags are cleared rather than set false-ish, matching a
   * record that was never marked.
   */
  const handleToggleDeceased = buildHandleToggleDeceased({ patient, deceasedDateInput, setDeceasedSubmitting, updatePatient, setShowDeceasedModal });

  // Facesheet card actions. Each one performs the real write action the card
  // represents, reusing the flows the header/tabs already use: the prescribe
  // and lab-order modals, the visit-note drawer, the consultation vitals form,
  // and the Conditions tab's own "Add" modal (opened via
  // sectionAddRequest so the card's action lands directly in the add form).
  const openSectionAdd = (section: 'problems') => {
    selectTab(section);
    setSectionAddRequest(section);
  };
  const facesheetActions: FacesheetActions = {
    // Nursing roles cannot order, but record what the patient already takes on
    // the Medications tab, whose Add opens that form for them.
    ...(canPrescribe
      ? { medications: { label: 'Prescribe', onClick: openPrescribe } }
      : canRecordMedicationHistory ? { medications: { label: 'Record', onClick: () => selectTab('prescriptions') } } : {}),
    ...(canConsult ? { problems: { label: 'Add', onClick: () => openSectionAdd('problems') } } : {}),
    // Vitals entry is always the nurse-vitals form now, for doctors and nurses
    // alike — a full /consultation redirect was the wrong weight for "record
    // a set of numbers" and orphaned the visit from the chart tab it was on.
    ...((canConsult || canRecordVitalEvents) && patient ? { vitals: { label: 'Record', onClick: () => { selectTab('vitals'); setShowNurseVitals(true); bringPageWorkspace('vitals'); } } } : {}),
    ...(canConsult ? { recommendations: { label: 'Review', onClick: () => selectTab('careChecklist'), icon: ClipboardList } } : {}),
  };

  const handleEditSubmit = buildHandleEditSubmit({ patient, editForm, setEditErrors, t, setEditSubmitting, updatePatient, setShowEditModal, showToast });

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

  const sendPatientMessage = buildSendPatientMessage({ t, patient, currentUser, messageBody, setMessageError, messageChannel, messageTextConsent, setMessageSending, regHospital, messageSubject, messageIsEducation, setMessageSentWarning, setMessageSentNote, setMessageSent, setMessageBody, setMessageSubject, setMessageChannel, setMessageTextConsent, setMessageIsEducation });

  // Appointment sort key for the Appointments tab.
  const apptTs = (a: { appointmentDate: string; appointmentTime?: string }) =>
    new Date(`${a.appointmentDate}T${a.appointmentTime || '00:00'}:00`).getTime();

  const allTabs = [
    { id: 'overview', label: 'Patient summary', icon: Heart },
    { id: 'history', label: 'Visits & timeline', icon: FileText },
    { id: 'problems', label: 'Conditions', icon: AlertTriangle },
    { id: 'medicalHistory', label: 'Medical history', icon: Archive },
    { id: 'prescriptions', label: 'Medications', icon: Pill },
    { id: 'immunizations', label: 'Immunizations', icon: Syringe },
    { id: 'allergies', label: 'Allergies', icon: ShieldAlert },
    { id: 'vitals', label: 'Vitals & Biometrics', icon: Activity },
    { id: 'notes', label: 'Notes', icon: FileText },
    { id: 'messages', label: 'Messages', icon: Mail },
    { id: 'sbar', label: 'SBAR handoff', icon: MessageSquare },
    { id: 'labs', label: 'Results', icon: FlaskConical },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'procedures', label: 'Procedures', icon: Bandage },
    { id: 'programs', label: 'Programs', icon: Layers },
    ...(showAncTab ? [{ id: 'anc', label: t('ancChart.title'), icon: Baby }] : []),
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
    muac: latestVitalsEntry.muac,
    bloodGlucose: latestVitalsEntry.bloodGlucose,
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
  /* One flat rail, in reading order: the clinical sections first, then the
     administrative tail. The list used to be split into "Clinical" and
     "Record" cards; the order still carries that sense without a heading
     breaking the list in half. */
  const OMRS_RAIL_DEFS: { id: string; label: string; icon: typeof Heart; clinicalOnly?: boolean }[] = [
    { id: 'overview', label: 'Patient summary', icon: Heart },
    { id: 'vitals', label: 'Vitals & Biometrics', icon: Activity },
    { id: 'prescriptions', label: 'Medications', icon: Pill },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'labs', label: 'Results', icon: FlaskConical },
    // The timeline IS the visit history — encounters, with the labs, drugs and
    // referrals that hung off them.
    { id: 'history', label: 'Visits & timeline', icon: History },
    // The encounter notes themselves, next to the visits they document.
    { id: 'notes', label: 'Notes', icon: Stethoscope },
    // The conversation with the patient through their portal — what the care
    // team wrote, and what the patient wrote back.
    { id: 'messages', label: 'Messages', icon: Mail },
    // A shift-handoff summary, not a documentation flow of its own — sits
    // beside Notes since it's read the same way. Previously unreachable (no
    // rail slot); cheaper to surface it here than to delete a working view.
    { id: 'sbar', label: 'SBAR handoff', icon: MessageSquare },
    { id: 'allergies', label: 'Allergies', icon: ShieldAlert },
    { id: 'problems', label: 'Conditions', icon: AlertTriangle },
    // The standing history — medical, surgical, family, social — recorded once
    // against the patient. Beside Conditions because the two are read together;
    // `history` (Visits) is the encounter timeline, a different thing.
    { id: 'medicalHistory', label: 'Medical history', icon: Archive },
    { id: 'immunizations', label: 'Immunizations', icon: Syringe },
    { id: 'procedures', label: 'Procedures', icon: Bandage },
    { id: 'programs', label: 'Programs', icon: Layers },
    ...(showAncTab ? [{ id: 'anc', label: t('ancChart.title'), icon: Baby }] : []),
    // Screenings/reminders/assessments — the forward-looking follow-through
    // half of the chart, closing out the clinical run.
    { id: 'careChecklist', label: 'Care plan', icon: ClipboardList },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    // Internal transfers and external referrals — who else is involved in
    // this patient's care, and the record of handing them off.
    { id: 'referrals', label: 'Care coordination', icon: ArrowRightLeft },
    // Who the patient is, as registered — contact details, address, next of
    // kin, payor. Sits with the administrative tail rather than the clinical
    // sections above it, and only appears for roles whose `tabs` include it.
    { id: 'demographics', label: 'Demographics', icon: UserIcon },
    { id: 'billing', label: 'Billing history', icon: Wallet },
  ];
  // Role restrictions still apply: a lab technician's rail is the two sections
  // LAB_TAB_IDS allows, not the full list.
  // Labels come from the locale (chart.rail.<id>); the English above is the
  // fallback and the in-code name of each section.
  const omrsRailItems = OMRS_RAIL_DEFS
    .filter(item => tabs.some(tab => tab.id === item.id))
    .map(item => {
      const key = 'chart.rail.' + item.id;
      const label = t(key);
      return { ...item, label: label === key ? item.label : label };
    });
  const omrsMoreItems: typeof omrsRailItems = [];

  // Sticky header: pregnancy pill — hoisted unchanged from the old inline
  // patient-banner IIFE so the ANC-derived pill keeps behaving identically.
  const activeANC = patientANC.find(a => !a.linkedBirthId);
  const isPregnant = !!activeANC;
  const pregnancyPillNode = isPregnant ? (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-bold" style={{
      background: 'rgba(242, 109, 100, 0.12)', color: 'var(--color-danger-500)', border: '1px solid rgba(242, 109, 100, 0.32)', letterSpacing: 0.2,
    }}>
      <DuotoneInfoIcon name="pregnant" size={11} color="var(--color-danger-500)" accent="var(--color-danger-500)" />
      Pregnant{activeANC?.gestationalAge ? ` · ${activeANC.gestationalAge} wk` : ''}
    </span>
  ) : null;


  return (
    <>
      <PatientChartPrintStyles />
      <main ref={contentRef} className="page-container ehr-chart-page">
          {/* ══════ PRINT-ONLY HOSPITAL DOCUMENT ══════ */}
          {printSigned && <PatientPrintDocument patient={patient} patientProblems={patientProblems} allPrescriptions={allPrescriptions} allLabResults={allLabResults} allImmunizations={allImmunizations} patientAppointments={patientAppointments} regHospital={regHospital} printSections={printSections} latestRecord={latestRecord} latestVitals={latestVitals} printSignature={printSignature} currentUser={currentUser} />}

          {/* ══════ SIGN BEFORE PRINT MODAL ══════ */}
          {showPrintModal && <PatientPrintModal setShowPrintModal={setShowPrintModal} setPrintSections={setPrintSections} printSections={printSections} printSignature={printSignature} setPrintSignature={setPrintSignature} setPrintSigned={setPrintSigned} />}

          <button
            onClick={() => router.push(safeReturnTo(searchParams.get('returnTo'), '/patients'))}
            className="ehr-chart-back flex items-center gap-1.5 text-sm mb-4 no-print"
            style={{ color: 'var(--tamamhealth-blue)' }}
          >
            <ArrowLeft className="w-4 h-4" /> {t('action.back')}
          </button>

          <TamamChartShell
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
            onOpenPrescribeModal={openPrescribe}
            onOpenOrderLabModal={() => setShowOrderLabModal(true)}
            onNoteSaved={() => setNotesRefreshToken(t => t + 1)}
            panelRequest={chartPanelRequest}
            onPanelRequestHandled={() => setChartPanelRequest(null)}
            // Record vitals docks in the chart's workspace slot beside the
            // record (OpenMRS O3), so the chart narrows instead of being covered.
            workspace={(() => {
              if (!patient || !currentUser) return null;
              const isOpen: Record<PageWorkspace, boolean> = { vitals: showNurseVitals, startVisit: showStartVisit, prescribe: showPrescribeModal, appointment: showBookAppointment };
              const top = [...pageWorkspaceOrder].reverse().find(ws => isOpen[ws])
                ?? (showNurseVitals ? 'vitals' : showStartVisit ? 'startVisit' : showPrescribeModal ? 'prescribe' : showBookAppointment ? 'appointment' : null);
              if (top === 'startVisit') return {
              title: t('startVisit.title'),
              onClose: () => setShowStartVisit(false),
              content: (
                <StartVisitPanel
                  patient={patient}
                  patientName={patientFullName(patient)}
                  currentUser={{
                    _id: currentUser._id,
                    name: currentUser.name,
                    hospitalId: currentUser.hospitalId,
                    hospitalName: currentUser.hospital?.name || currentUser.hospitalName || undefined,
                    orgId: currentUser.orgId,
                  }}
                  onClose={() => setShowStartVisit(false)}
                />
              ),
            };
              if (top === 'vitals') return {
              title: correctingVitalsRecord ? t('chart.correctVitals') : t('vitalsPanel.title'),
              onClose: () => { setShowNurseVitals(false); setCorrectingVitalsRecord(undefined); },
              content: (
                <NurseVitalsModal
                  presentation="workspace"
                  patientId={patient._id}
                  patientName={patientFullName(patient)}
                  hospitalNumber={patient.hospitalNumber}
                  hospitalId={currentUser.hospitalId || patient.registrationHospital || ''}
                  hospitalName={currentUser.hospital?.name || currentUser.hospitalName || patient.registrationHospital || undefined}
                  orgId={currentUser.orgId}
                  encounterId={nurseVitalsEncounterId}
                  currentUser={currentUser}
                  correctingRecord={correctingVitalsRecord}
                  onClose={() => { setShowNurseVitals(false); setCorrectingVitalsRecord(undefined); }}
                  onSaved={() => reloadRecords()}
                />
              ),
            };
              if (top === 'appointment') return {
                title: t('bookPanel.title'),
                onClose: () => setShowBookAppointment(false),
                content: (
                  <BookAppointmentPanel
                    patient={patient}
                    patientName={patientFullName(patient)}
                    onClose={() => setShowBookAppointment(false)}
                  />
                ),
              };
              if (top === 'prescribe') return {
                title: t('createPage.prescribeTitle'),
                wide: true,
                onClose: () => setShowPrescribeModal(false),
                content: (
                  <div className="tamam-drawer-body">
                    <NotePrescribeForm
                      presentation="page"
                      patientId={patient._id}
                      patientName={patientFullName(patient)}
                      currentUser={currentUser}
                      onClose={() => setShowPrescribeModal(false)}
                    />
                  </div>
                ),
              };
              return null;
            })()}
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
                onVisitSummary={() => setShowVisitSummary(true)}
                onNote={() => (canConsult ? void openClinicalNoteDrawer() : selectTab('notes'))}
                onScripts={() => (canPrescribe ? openPrescribe() : selectTab('prescriptions'))}
                onOrders={() => (canOrderLabs ? setShowOrderLabModal(true) : selectTab('labs'))}
                onExchange={() => (canManageReferrals ? setShowReferModal(true) : selectTab('referrals'))}
                onEdit={openEditModal}
                onStartVisit={canCheckInAppointments ? () => { setShowStartVisit(true); bringPageWorkspace('startVisit'); } : undefined}
                // Only a link for roles that can open the section — for the
                // desk, bench and imaging roles the click bounced them to their
                // landing tab instead.
                onShowAllergies={tabs.some(tab => tab.id === 'allergies') ? () => selectTab('allergies') : undefined}
                onEndAssignment={canEndAssignment ? () => void handleEndAssignment() : undefined}
                // Same gate as Edit details: the roles that may correct the
                // record (all present in DOC_WRITE_ROLES.patient, so the write
                // also replicates rather than dying at the validator).
                onToggleDeceased={canRegisterPatients ? openDeceasedModal : undefined}
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
                loading={!vitalsReady}
                // The newest reading overall, including a triage stop the
                // patient hasn't been formally seen for yet — not only the
                // newest medical_record, which would leave the band showing
                // stale (or no) vitals right after triage.
                latestVitals={latestVitals}
                latestRecordDate={latestVitalsEntry?.at}
                // Fractional age + the ANC pregnancy signal: what the band
                // needs to judge a reading against the right bands (a pulse
                // of 73 is normal for an adult and dangerous for a neonate).
                patientAgeYears={patientAgeYearsExact(patient) ?? undefined}
                isPregnant={isPregnant}
                onViewVitalsHistory={() => selectTab('vitals')}
                onRecordVitals={() => { selectTab('vitals'); setCorrectingVitalsRecord(undefined); setShowNurseVitals(true); bringPageWorkspace('vitals'); }}
                canRecordVitals={canConsult || canRecordVitalEvents}
              />
            ) : undefined}
          >
          <section className="ehr-chart-content">


          {/* Care ownership is in flight (or time-boxed) — shown on every tab,
              because a clinician who doesn't know a transfer is pending can
              start work the receiving team is about to take over. */}
          {patient && (
            <TransferBanner
              patient={patient}
              onOpenHistory={tabs.some(tab => tab.id === 'referrals') ? () => selectTab('referrals') : undefined}
            />
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


          {activeTab === 'overview' && <PatientOverviewTab patient={patient} latestVitals={latestVitals} vitalsReady={vitalsReady} latestPatientTriage={latestPatientTriage} patientProblems={patientProblems} allPrescriptions={allPrescriptions} allLabResults={allLabResults} allImmunizations={allImmunizations} canViewClinical={canViewClinical} selectTab={selectTab} facesheetActions={facesheetActions} facesheetPanels={facesheetPanels} showCustomizeView={showCustomizeView} setShowCustomizeView={setShowCustomizeView} toggleFacesheetPanel={toggleFacesheetPanel} setFacesheetPanels={setFacesheetPanels} />}

          {activeTab === 'appointments' && patient && <PatientAppointmentsTab patientAppointments={patientAppointments} apptTs={apptTs} apptSearch={apptSearch} apptPage={apptPage} APPT_PAGE_SIZE={APPT_PAGE_SIZE} t={t} canBookAppointments={canBookAppointments} onBook={openBookAppointment} apptView={apptView} setApptView={setApptView} setApptSearch={setApptSearch} setApptPage={setApptPage} focusId={focusId} />}

          {/* No wrapper card: PatientSBAR is built from ChartSection now, and
              nesting those inside a card produced a card-in-a-card. */}
          {activeTab === 'sbar' && patient && <PatientSbarTab patient={patient} records={records} allLabResults={allLabResults} allPrescriptions={allPrescriptions} patientTriages={patientTriages} patientProblems={patientProblems} latestShiftHandoff={latestShiftHandoff} />}

          {/* Problem List — longitudinal active/chronic/resolved */}
          {/* Conditions — Tamam-style Conditions table (ChartSection), replacing
              the old ProblemList card-list layout for this tab specifically.
              The original ProblemList widget (with inline edit/resolve) still
              lives on the legacy facesheet view. */}
          {activeTab === 'problems' && patient && <PatientProblemsTab focusId={focusId} patient={patient} sectionAddRequest={sectionAddRequest} setSectionAddRequest={setSectionAddRequest} />}

          {/* Allergies — Tamam-style Allergies table (ChartSection). Directives
              stay reachable here since they don't have their own rail slot. */}
          {activeTab === 'allergies' && patient && <PatientAllergiesTab focusId={focusId} patient={patient} sectionAddRequest={sectionAddRequest} setSectionAddRequest={setSectionAddRequest} />}

          {activeTab === 'notes' && patient && <PatientNotesTab patient={patient} currentUser={currentUser} canConsult={canConsult} setNoteViewer={setNoteViewer} notesRefreshToken={notesRefreshToken} noteViewer={noteViewer} setNotesRefreshToken={setNotesRefreshToken} setChartPanelRequest={setChartPanelRequest} onCreateNote={() => void openClinicalNoteDrawer()} />}

          {activeTab === 'demographics' && patient && <PatientDemographicsTab patient={patient} demographicsTab={demographicsTab} setDemographicsTab={setDemographicsTab} openEditModal={openEditModal} canRegisterPatients={canRegisterPatients} patientAppointments={patientAppointments} regHospital={regHospital} />}

          {activeTab === 'careChecklist' && patient && <PatientCareChecklistTab t={t} patient={patient} focusId={focusId} />}

          {activeTab === 'documents' && patient && <PatientDocumentsTab patient={patient} patientReferrals={patientReferrals} canViewClinical={canViewClinical} focusId={focusId} setMessageSubject={setMessageSubject} setMessageIsEducation={setMessageIsEducation} setShowMessageModal={setShowMessageModal} router={router} canManageReferrals={canManageReferrals} setShowReferModal={setShowReferModal} />}

          {activeTab === 'history' && patient && <PatientHistoryTab patient={patient} patientProblems={patientProblems || []} vitalsTimeline={vitalsTimeline} facilityName={currentUser?.hospital?.name || currentUser?.hospitalName || regHospital?.name} records={records} clinicalNotes={clinicalNotes} allLabResults={allLabResults} allPrescriptions={allPrescriptions} allImmunizations={allImmunizations} patientReferrals={patientReferrals} patientANC={patientANC} patientAppointments={patientAppointments} patientTriages={patientTriages} canViewClinical={canViewClinical} focusId={focusId} />}

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
          {activeTab === 'prescriptions' && <PatientMedicationsTab patient={patient} canPrescribe={canPrescribe} canRecordMedications={canRecordMedicationHistory} canDispense={canDispense} setShowPrescribeModal={setShowPrescribeModal} currentUser={currentUser} focusId={focusId} />}

          {/* Vitals Tab */}
          {activeTab === 'vitals' && <PatientVitalsTab patientAgeYears={patientAgeYearsExact(patient) ?? undefined} isPregnant={isPregnant} vitalsView={vitalsView} canConsult={canConsult} canRecordVitalEvents={canRecordVitalEvents} setCorrectingVitalsRecord={setCorrectingVitalsRecord} setShowNurseVitals={(next) => { setShowNurseVitals(next); if (next === true) bringPageWorkspace('vitals'); }} setVitalsView={setVitalsView} recordsWithTriageVitals={recordsWithTriageVitals} t={t} vitalsTimeline={vitalsTimeline} records={records} onVitalsChanged={() => reloadRecords()} />}

          {/* Immunizations — dose history recorded in the chart, through the
              same service the /immunizations module writes with. */}
          {activeTab === 'immunizations' && (
            <ImmunizationsSection
              focusId={focusId}
              patient={patient}
              patientName={patientFullName(patient)}
              canRecord={canConsult || canRecordVitalEvents}
              facilityName={regHospital?.name || currentUser?.hospitalName}
            />
          )}

          {/* Care coordination: internal transfers and external referrals share
              one ownership and follow-up destination. */}
          {activeTab === 'referrals' && <PatientCoordinationTab patient={patient} canViewClinical={canViewClinical} canManageReferrals={canManageReferrals} setShowReferModal={setShowReferModal} router={router} patientReferrals={patientReferrals} />}

          {activeTab === 'billing' && <PatientBillingTab patient={patient} patientBalance={patientBalance} showPaymentPanel={showPaymentPanel} showPlanWizard={showPlanWizard} setShowPaymentPanel={setShowPaymentPanel} setShowPlanWizard={setShowPlanWizard} reloadPayments={reloadPayments} latestRecord={latestRecord} hospitals={hospitals} />}

          {/* Orders — unified drug + lab orders table (Stage 3). */}
          {activeTab === 'orders' && (
            <OrdersSection
              patientId={patient._id}
              canPrescribe={canPrescribe}
              canOrderLabs={canOrderLabs}
              onAddDrug={openPrescribe}
              onAddLab={() => setShowOrderLabModal(true)}
              focusId={focusId}
            />
          )}

          {/* Messages — the two-way thread with the patient's portal. */}
          {activeTab === 'messages' && canViewClinical && patient && (
            <PatientMessagesSection
              patient={patient}
              patientName={patientFullName(patient)}
              facilityName={regHospital?.name}
            />
          )}

          {/* History — the patient's standing medical, surgical, family and
              social history, recorded once and read by every note. */}
          {activeTab === 'medicalHistory' && canViewClinical && patient && (
            <HistorySection
              patientId={patient._id}
              patientName={patientFullName(patient)}
              onOpenTab={selectTab}
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
            <ProgramsSection patientId={patient._id} patientName={patientFullName(patient)} canEnroll={canEnrollPrograms} />
          )}
          {activeTab === 'anc' && (
            <PatientAncTab
              visits={patientANC}
              canEdit={canRecordVitalEvents}
              onRegister={canRecordVitalEvents ? () => router.push(`/anc?patientId=${encodeURIComponent(patient._id)}`) : undefined}
              focusId={focusId}
              onChanged={() => { void reloadANC(); }}
            />
          )}
          </section>
          </TamamChartShell>
      </main>

      {/* Edit Demographics Modal */}

      {showMessageModal && patient && <PatientMessageModal messageSending={messageSending} setShowMessageModal={setShowMessageModal} patient={patient} setMessageChannel={setMessageChannel} setMessageError={setMessageError} setMessageSent={setMessageSent} messageChannel={messageChannel} messageTextConsent={messageTextConsent} setMessageTextConsent={setMessageTextConsent} t={t} messageSubject={messageSubject} setMessageSubject={setMessageSubject} messageBody={messageBody} setMessageBody={setMessageBody} messageError={messageError} messageSent={messageSent} messageSentWarning={messageSentWarning} messageSentNote={messageSentNote} sendPatientMessage={sendPatientMessage} />}

      {/* Edit Demographics Modal */}
      {showEditModal && patient && <PatientEditModal editSubmitting={editSubmitting} setShowEditModal={setShowEditModal} editForm={editForm} setEditForm={setEditForm} editErrors={editErrors} setEditErrors={setEditErrors} t={t} editCounties={editCounties} editPayams={editPayams} editBomas={editBomas} handleEditSubmit={handleEditSubmit} />}

      {/* Deceased / alive toggle — the ⋯ menu's confirm step. Marking deceased
          asks for the date of death; marking alive only confirms, since there
          is nothing to collect. The full civil registration (cause, informant,
          certification) stays in the Deaths module — this flags the chart. */}
      {showDeceasedModal && patient && <PatientDeceasedModal deceasedSubmitting={deceasedSubmitting} setShowDeceasedModal={setShowDeceasedModal} patient={patient} deceasedDateInput={deceasedDateInput} setDeceasedDateInput={setDeceasedDateInput} handleToggleDeceased={handleToggleDeceased} />}

      {/* Header action modals — open in place, pre-filled with this patient. */}
      {showOrderLabModal && (
        <LabOrderModal
          onClose={() => setShowOrderLabModal(false)}
          onPlaced={() => { void reloadLabResults(); }}
          presetPatientId={patient._id}
        />
      )}
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
      {showVisitSummary && (
        <VisitSummaryDialog
          patient={patient}
          records={records}
          notes={clinicalNotes}
          prescriptions={(allPrescriptions || []).filter(rx => rx.patientId === patient._id)}
          labOrders={(allLabResults || []).filter(lab => lab.patientId === patient._id)}
          appointments={patientAppointments || []}
          currentUser={currentUser}
          onClose={() => setShowVisitSummary(false)}
        />
      )}
    </>
  );
}
