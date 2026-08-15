'use client';

/**
 * The Encounter Note screen.
 *
 * Autosave is debounced per section and always writes the whole section rather
 * than a diff, because the note is the legal record: a lost keystroke is worse
 * than a redundant write. "Last saved" is shown rather than a spinner so a
 * clinician can tell at a glance whether it is safe to walk away from the
 * screen — the question they actually have.
 *
 * Signing is the one irreversible action here, so it confirms, and everything
 * afterwards renders read-only with corrections routed to addenda.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText, Save, Check, Copy, Send, ClipboardList, DollarSign,
  Plus, AlertTriangle, Minus, Syringe, Activity,
} from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import NoteSectionCard from './NoteSectionCard';
import AssignPicker from './AssignPicker';
import { useConfirm } from '@/components/ConfirmDialog';
import PrescribeModal from './prescribe/PrescribeModal';
import LabOrderModal from '@/components/lab/order/LabOrderModal';
import type { NoteSectionActionId } from '@/lib/clinical-notes/section-actions';
import MedicationsModal from './MedicationsModal';
import { useDataScope } from '@/lib/hooks/useDataScope';
import IncludeProblemsModal from './assessment/IncludeProblemsModal';
import AllergiesModal from './AllergiesModal';
import CareCoordinationModal, {
  type CareCoordinationResult, type SummaryProblem, type SummarySocialHistory,
} from './CareCoordinationModal';
import FollowUpModal, { type FollowUpModalResult } from './FollowUpModal';
import PatientEducationModal, { type PatientEducationModalResult } from './PatientEducationModal';
import {
  NOTE_TYPE_ORDER, NOTE_TYPES, getNoteType, getSectionLabel,
  availableOptionalSections, isNoteTypeId,
  type NoteTypeId, type NoteSectionId,
} from '@/lib/clinical-notes/note-catalog';
import {
  getClinicalNoteById, updateClinicalNote, saveNoteSection, addNoteSection,
  removeNoteSection, changeNoteType, clearNote, signClinicalNote,
  addNoteAddendum, recordPlanAction, isNoteLocked,
  listClinicalNotes,
} from '@/lib/clinical-notes/note-service';
import { formatPhoneDisplay } from '@/lib/field-formats';
import type { PatientDoc, PatientDocumentDoc, UserRole } from '@/lib/db-types';
import { loadChartSnapshot, snapshotForSection, formatProblems } from '@/lib/clinical-notes/chart-snapshot';
import { stripTemplateMarkers } from '@/lib/clinical-notes/section-templates';
import type {
  ClinicalNoteDoc, NoteSectionContent, NoteDiagnosis,
} from '@/lib/clinical-notes/types';
import './clinical-notes.css';
import Select from '@/components/Select';

const AUTOSAVE_MS = 900;

/** "01 Jan 1973 (52 yo)" from an ISO date of birth. */
function dobWithAge(dob?: string): string | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dob;
  const text = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? `${text} (${age} yo)` : text;
}

function nameInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** "id_document" → "Id Document" — display label for a document category. */
function docCategoryLabel(category: string): string {
  return String(category).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface ClinicalNoteEditorProps {
  noteId: string;
  currentUser: { _id: string; name?: string; username?: string; role?: string; orgId?: string } | null;
  /** Providers offered in "Assigned To". */
  assignableUsers?: Array<{ _id: string; name: string }>;
  onClose?: () => void;
}

export default function ClinicalNoteEditor({
  noteId, currentUser, assignableUsers = [], onClose,
}: ClinicalNoteEditorProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const scope = useDataScope();

  const [note, setNote] = useState<ClinicalNoteDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<NoteSectionId | null>(null);
  const [showAddOptional, setShowAddOptional] = useState(false);
  const [showSignConfirm, setShowSignConfirm] = useState(false);
  const [showAddendum, setShowAddendum] = useState(false);
  const [addendumText, setAddendumText] = useState('');
  const [showCoordination, setShowCoordination] = useState(false);
  const [showMedications, setShowMedications] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [showAllergies, setShowAllergies] = useState(false);
  const [showPrescribe, setShowPrescribe] = useState(false);
  const [showLabOrder, setShowLabOrder] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showPatientEducation, setShowPatientEducation] = useState(false);
  const [problems, setProblems] = useState<SummaryProblem[]>([]);
  const [socialHistory, setSocialHistory] = useState<SummarySocialHistory[]>([]);

  // Left-rail chart context: the patient record (photo/sex/phone), the
  // patient's other notes, and their most recent resulted labs.
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [siblingNotes, setSiblingNotes] = useState<ClinicalNoteDoc[]>([]);
  const [recentLabs, setRecentLabs] = useState<Array<{ id: string; testName: string; date: string }> | null>(null);
  const [documents, setDocuments] = useState<PatientDocumentDoc[] | null>(null);
  const [docLabel, setDocLabel] = useState<string>('all');

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Patches not yet written to the DB, merged as they arrive rather than
  // replaced — so a second edit to the same section before the debounce fires
  // (e.g. Include Problems landing mid-keystroke) cannot silently discard the
  // first one's pending text.
  const pendingSaves = useRef<Record<string, Partial<NoteSectionContent>>>({});
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await getClinicalNoteById(noteId);
      if (cancelled) return;
      setNote(loaded);
      setLoading(false);
      if (loaded) setSavedAt(loaded.updatedAt);
    })();
    return () => { cancelled = true; };
  }, [noteId]);

  // Problems + social history back the Care Coordination summary.
  useEffect(() => {
    if (!note?.patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getProblemsByPatient } = await import('@/lib/services/problem-service');
        const rows = await getProblemsByPatient(note.patientId);
        if (cancelled) return;
        setProblems(rows.filter(p => p.status === 'active').map(p => ({
          effectiveDate: p.onsetDate || p.createdAt?.slice(0, 10) || '',
          problem: p.name,
          status: p.status.toUpperCase(),
        })));
      } catch { /* the summary simply offers nothing to attach */ }
    })();
    return () => { cancelled = true; };
  }, [note?.patientId]);

  // Chart context for the left rail. Each block fails independently: a rail
  // card with nothing to show is not a reason to block the note.
  useEffect(() => {
    const patientId = note?.patientId;
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getPatientById } = await import('@/lib/services/patient-service');
        const doc = await getPatientById(patientId);
        if (!cancelled) setPatient(doc);
      } catch { /* identity card renders from the note's own fields */ }
      try {
        const rows = await listClinicalNotes({ patientId }, scope);
        if (!cancelled) setSiblingNotes(rows.filter(n => n._id !== noteId).slice(0, 8));
      } catch { /* Patient Notes card shows its empty state */ }
      try {
        const { getLabResultsByPatient } = await import('@/lib/services/lab-service');
        const labs = await getLabResultsByPatient(patientId);
        if (!cancelled) {
          setRecentLabs(labs
            .filter(l => l.status === 'completed')
            .sort((a, b) => (b.completedAt || b.orderedAt || '').localeCompare(a.completedAt || a.orderedAt || ''))
            .slice(0, 5)
            .map(l => ({ id: l._id, testName: l.testName, date: (l.completedAt || l.orderedAt || '').slice(0, 10) })));
        }
      } catch { if (!cancelled) setRecentLabs([]); }
      try {
        const { getPatientDocuments } = await import('@/lib/services/patient-document-service');
        const docs = await getPatientDocuments(patientId);
        if (!cancelled) {
          docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          setDocuments(docs);
        }
      } catch { if (!cancelled) setDocuments([]); }
    })();
    return () => { cancelled = true; };
  }, [note?.patientId, noteId, scope]);

  // Flush any pending autosave when the editor unmounts (or switches to a
  // different note), so navigating away mid-keystroke does not drop the last
  // edit — clearing the timer alone discarded up to AUTOSAVE_MS of typing.
  useEffect(() => {
    return () => {
      for (const sectionId of Object.keys(timers.current)) {
        clearTimeout(timers.current[sectionId]);
        const toSave = pendingSaves.current[sectionId];
        if (toSave) void saveNoteSection(noteId, sectionId as NoteSectionId, toSave).catch(() => undefined);
      }
      timers.current = {};
      pendingSaves.current = {};
    };
  }, [noteId]);

  const locked = note ? isNoteLocked(note) : false;
  const typeDef = note ? getNoteType(note.noteType) : null;

  const sectionIds = useMemo(
    () => (note ? note.sections.map(s => s.sectionId) : []),
    [note],
  );

  const optionalAvailable = useMemo(
    () => (note ? availableOptionalSections(note.noteType, note.addedSections || []) : []),
    [note],
  );

  const persist = useCallback(async (fn: () => Promise<ClinicalNoteDoc | null>) => {
    setSaving(true);
    try {
      const updated = await fn();
      if (updated) { setNote(updated); setSavedAt(updated.updatedAt); }
      return updated;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the note.', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  }, [showToast]);

  // ── Section editing (optimistic + debounced write) ──────────────────────
  const handleSectionChange = useCallback((sectionId: NoteSectionId, patch: Partial<NoteSectionContent>) => {
    setNote((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map(s =>
        s.sectionId === sectionId ? { ...s, ...patch } : s);
      return { ...prev, sections };
    });

    pendingSaves.current[sectionId] = { ...pendingSaves.current[sectionId], ...patch };
    clearTimeout(timers.current[sectionId]);
    timers.current[sectionId] = setTimeout(() => {
      const toSave = pendingSaves.current[sectionId];
      delete pendingSaves.current[sectionId];
      delete timers.current[sectionId];
      if (toSave) void persist(() => saveNoteSection(noteId, sectionId, toSave));
    }, AUTOSAVE_MS);
  }, [noteId, persist]);

  const refreshDerived = useCallback(async (sectionId: NoteSectionId) => {
    if (!note) return;
    const snapshot = await loadChartSnapshot(note.patientId, scope);
    const text = snapshotForSection(sectionId, snapshot);
    await persist(() => saveNoteSection(noteId, sectionId, {
      snapshot: text,
      snapshotAt: new Date().toISOString(),
    }));
    showToast(`${getSectionLabel(sectionId)} refreshed from the chart.`, 'success');
  }, [note, noteId, persist, showToast, scope]);

  // Fill any empty derived section on first open, so a new note opens with
  // today's observations already in it.
  useEffect(() => {
    if (!note || locked) return;
    const empty = note.sections.filter(
      s => !s.snapshot && ['vitals', 'medications', 'allergies'].includes(s.sectionId),
    );
    if (empty.length === 0) return;

    let cancelled = false;
    (async () => {
      const snapshot = await loadChartSnapshot(note.patientId, scope);
      if (cancelled) return;
      for (const section of empty) {
        const text = snapshotForSection(section.sectionId, snapshot);
        if (!text) continue;
        await persist(() => saveNoteSection(noteId, section.sectionId, {
          snapshot: text, snapshotAt: new Date().toISOString(),
        }));
      }
    })();
    return () => { cancelled = true; };
    // Deliberately keyed on the note id only: this is a one-shot prefill, not a
    // reaction to every subsequent edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, note?.patientId]);

  // ── Header actions ──────────────────────────────────────────────────────
  const handleTypeChange = async (next: string) => {
    if (!isNoteTypeId(next)) return;
    await persist(() => changeNoteType(noteId, next));
  };

  const handleClear = async () => {
    if (!window.confirm('Clear every section of this note? Text you have written will be removed.')) return;
    await persist(() => clearNote(noteId));
    showToast('Note cleared.', 'success');
  };

  // ── Section actions ─────────────────────────────────────────────────────
  // Actions that open a popup, or the real order flow, do so in place; the
  // note is only stamped with "ordered from the note" once that order really
  // exists (see the `onPlaced`/`onSend` callbacks below) — clicking a button
  // must never by itself attest that an order was raised. Two targets
  // (`/immunizations`, `/messages`) have no in-place flow here, so those just
  // hand the clinician off without recording anything until it's real.
  const handleSectionAction = useCallback((actionId: NoteSectionActionId) => {
    if (!note) return;
    switch (actionId) {
      case 'include_problems': setShowProblems(true); return;
      case 'review_medications': setShowMedications(true); return;
      case 'manage_allergies': setShowAllergies(true); return;
      case 'prescribe': setShowPrescribe(true); return;
      case 'record_vitals':
        router.push(`/patients/${note.patientId}?tab=vitals`);
        return;
      // Opens FollowUpModal, which only collects the form; the write
      // (createFollowUp, then recordPlanAction) happens in
      // handleScheduleFollowUp once a real FollowUpDoc exists — the old
      // router.push to /appointments only filtered a list and created nothing.
      case 'schedule_followup':
        setShowFollowUp(true);
        return;
      case 'order_lab':
        setShowLabOrder(true);
        return;
      // Care Coordination already creates the referral and records the plan
      // action itself, only on success (see handleCoordination) — reuse it
      // instead of navigating to a list page that does not read patientId.
      case 'refer':
        setShowCoordination(true);
        return;
      // `/immunizations?patientId=` does read and act on this param (it opens
      // the add-immunization form prefilled), but the order is not placed
      // until the clinician submits it there, so nothing is recorded yet.
      // encounterId/noteId ride along so the immunization, once placed, can
      // link back to this visit and note.
      case 'order_vaccine':
        router.push(`/immunizations?patientId=${note.patientId}&encounterId=${note.encounterId || ''}&noteId=${noteId}`);
        return;
      // Opens PatientEducationModal — the old router.push to /messages read
      // neither param, so nothing was ever sent. handleSendEducation sends
      // through the same createMessage flag shape the chart's own
      // "Patient education" action uses, and only then stamps the plan.
      case 'patient_education':
        setShowPatientEducation(true);
        return;
      default: return;
    }
  }, [note, router, noteId]);

  // ── Assessment: problems checked in the Include Problems popup become
  //    diagnosis lines on the note, deduped against what is already there ──
  const handleIncludeProblems = useCallback((lines: NoteDiagnosis[]) => {
    if (!note) return;
    const existing = note.sections.find(s => s.sectionId === 'assessment')?.diagnoses || [];
    const have = new Set(existing.map(d => d.problemId || d.icd11Code || d.name.toLowerCase()));
    const fresh = lines.filter(d => !have.has(d.problemId || d.icd11Code || d.name.toLowerCase()));
    if (fresh.length === 0) return;
    // Routed through handleSectionChange, whose pending-patch merge keeps this
    // from clobbering an assessment edit still waiting on its own debounce.
    handleSectionChange('assessment', { diagnoses: [...existing, ...fresh] });
  }, [note, handleSectionChange]);

  // ── Signing ─────────────────────────────────────────────────────────────
  const handleSign = async () => {
    setShowSignConfirm(false);
    const updated = await persist(() => signClinicalNote(noteId, {
      signedBy: currentUser?._id || '',
      signedByName: userName,
      // Without the role, a provider picking up an unassigned (or a
      // colleague's) draft is refused by the attestation check even though
      // provider roles hold standing signing authority.
      signerRole: currentUser?.role,
    }));
    if (updated) showToast('Note signed.', 'success');
  };

  const handleAddendum = async () => {
    const body = addendumText.trim();
    if (!body) return;
    const updated = await persist(() => addNoteAddendum(noteId, body, currentUser?._id || '', userName));
    if (updated) {
      setAddendumText('');
      setShowAddendum(false);
      showToast('Addendum added.', 'success');
    }
  };

  const handleCoordination = async (result: CareCoordinationResult) => {
    if (!note) return;
    const { createReferral } = await import('@/lib/services/referral-service');
    const summary = [
      result.instructions,
      result.problems.length ? `Problems: ${result.problems.map(p => p.problem).join('; ')}` : '',
    ].filter(Boolean).join('\n');

    const referral = await createReferral({
      patientId: note.patientId,
      patientName: note.patientName,
      fromHospital: note.hospitalName || '',
      fromHospitalId: note.hospitalId || '',
      // No facility id: the recipient is named free-text on the note, and this
      // platform has no provider directory to resolve it against.
      toHospital: result.recipient,
      toHospitalId: '',
      referralDate: new Date().toISOString(),
      urgency: 'routine',
      // The dashboard's "Open referrals" rail filters on createdBy — a
      // referral without it is invisible to the clinician who sent it.
      createdBy: currentUser?._id,
      reason: `Referral from ${getNoteType(note.noteType).label} of ${note.serviceDate}`,
      department: '',
      status: 'sent',
      referringDoctor: userName,
      notes: `${summary}\n\nSent via ${result.channel === 'efax' ? 'eFax' : 'Direct Message'}.`,
      orgId: note.orgId,
    });

    await persist(() => recordPlanAction(noteId, {
      kind: 'referral',
      label: `Referral to ${result.recipient}`,
      targetId: (referral as { _id?: string } | null)?._id,
      createdBy: currentUser?._id,
    }));
    showToast(`Referral created for ${result.recipient}.`, 'success');

    // Best-effort: a referral out ends the clinic portion of this visit.
    // 'referred_out' is in CLOSES_CLINIC_PORTION (stamps closedAt) — that is
    // intended. The referral above already stands regardless of whether the
    // encounter can be advanced, so this never undoes it on failure.
    if (note.encounterId) {
      try {
        const { getEncounter, transitionEncounter } = await import('@/lib/services/encounter-service');
        const enc = await getEncounter(note.encounterId);
        if (enc?.status === 'with_clinician') {
          await transitionEncounter(note.encounterId, 'referred_out', {
            actorId: currentUser?._id,
            actorRole: currentUser?.role as UserRole | undefined,
            reason: `Referred to ${result.recipient}`,
          });
        }
      } catch { /* the referral stands even if the visit can't be advanced */ }
    }
  };

  // Follow-up: FollowUpModal collects the form; this creates the real
  // FollowUpDoc and only then stamps the plan action, mirroring
  // handleCoordination above and the LabOrderModal onPlaced discipline —
  // the note never claims a follow-up exists before one really does.
  const handleScheduleFollowUp = async (result: FollowUpModalResult) => {
    if (!note) return;
    const { createFollowUp } = await import('@/lib/services/follow-up-service');
    const followUp = await createFollowUp({
      patientId: note.patientId,
      patientName: note.patientName,
      encounterId: note.encounterId,
      hospitalId: note.hospitalId,
      geocodeId: patient?.geocodeId,
      // The visible field only asks for a name (see FollowUpModal); the id
      // is always the clinician creating this from the note, matching how
      // POST /api/follow-ups defaults assignedWorker to the acting user.
      assignedWorker: currentUser?._id || '',
      assignedWorkerName: result.assignedWorkerName,
      status: 'active',
      condition: result.condition,
      // No facility-level picker on this note-driven flow yet; 'county'
      // matches the clinic tier this note itself is written from.
      facilityLevel: 'county',
      scheduledDate: result.scheduledDate,
      notes: result.notes || undefined,
      state: patient?.state || '',
      county: patient?.county || '',
      orgId: note.orgId ?? currentUser?.orgId,
    });

    await persist(() => recordPlanAction(noteId, {
      kind: 'follow_up',
      label: `Follow-up: ${result.condition} on ${result.scheduledDate}`,
      targetId: followUp._id,
      createdBy: currentUser?._id,
    }));
    showToast('Follow-up scheduled.', 'success');
  };

  // Patient education: PatientEducationModal collects subject/body; this
  // sends it with the same createMessage flag shape the chart's own
  // "Patient education" action uses (see patients/[id]/page.tsx
  // sendPatientMessage / onPatientEd) so it files under the chart's
  // Documents ▸ Patient education, then stamps the plan on success.
  const handleSendEducation = async (result: PatientEducationModalResult) => {
    if (!note) return;
    const { createMessage } = await import('@/lib/services/message-service');
    await createMessage({
      patientId: note.patientId,
      patientName: note.patientName,
      patientPhone: patient?.phone || '',
      recipientType: 'patient',
      direction: 'staff_to_patient',
      fromDoctorId: currentUser?._id || '',
      fromDoctorName: userName,
      fromHospitalId: note.hospitalId,
      fromHospitalName: note.hospitalName || '',
      subject: result.subject,
      body: result.body,
      channel: 'app',
      patientEducation: true,
      sentAt: new Date().toISOString(),
      orgId: note.orgId ?? currentUser?.orgId,
    });

    await persist(() => recordPlanAction(noteId, {
      kind: 'patient_education',
      label: 'Patient education sent',
      createdBy: currentUser?._id,
    }));
    showToast('Patient education sent.', 'success');
  };

  const handleSaveAndClose = async () => {
    for (const t of Object.values(timers.current)) clearTimeout(t);
    timers.current = {};
    pendingSaves.current = {};
    if (note) {
      for (const section of note.sections) {
        await saveNoteSection(noteId, section.sectionId, {
          text: section.text,
          templateSelection: section.templateSelection,
        }).catch(() => undefined);
      }
      // Best-effort: pause the visit so a clinician stepping away mid-consult
      // shows up on the resume rail (RESUMABLE_STATUSES / "Awaiting labs")
      // instead of looking indistinguishable from one still with_clinician.
      // Never blocks navigation — the draft is already saved above regardless.
      if (note.encounterId) {
        try {
          const { getEncounter, transitionEncounter } = await import('@/lib/services/encounter-service');
          const enc = await getEncounter(note.encounterId);
          if (enc?.status === 'with_clinician') {
            await transitionEncounter(note.encounterId, 'consultation_paused_draft', {
              actorId: currentUser?._id,
              actorRole: currentUser?.role as UserRole | undefined,
            });
          }
        } catch { /* the draft is saved regardless; navigation proceeds either way */ }
      }
    }
    showToast('Note saved.', 'success');
    if (onClose) onClose();
    // Back always lands on a patient's own Notes tab; with no note to name a
    // patient, the registry is the only honest destination.
    else router.push(note ? `/patients/${note.patientId}?tab=notes` : '/patients');
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) return <div className="cn-empty">Loading note…</div>;
  if (!note || !typeDef) return <div className="cn-empty">This note could not be found.</div>;


  return (
    <div className="cn-editor">
      {/* The left rail runs the full height of the screen; the header and
          toolbar belong to the note column, not the page. */}
      <div className="cn-body">
        <aside className="cn-sidebar">
          {/* Patient identity — a bare block above the cards, per the design:
              photo plate, name, one id line, then the risk/status pills. */}
          <div className="cn-ident">
            {patient?.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="cn-patient-photo" src={patient.photoUrl} alt="" />
              : <span className="cn-patient-photo" aria-hidden>{nameInitials(note.patientName)}</span>}
            <div style={{ minWidth: 0 }}>
              <h2 className="cn-ident-name">{note.patientName}</h2>
              <p className="cn-ident-line">
                {[note.mrn, patient?.gender?.[0]?.toUpperCase(), dobWithAge(note.patientDob), patient?.phone ? formatPhoneDisplay(patient.phone) : null]
                  .filter(Boolean).join(' · ')}
              </p>
              <div className="cn-ident-pills">
                {(patient?.allergies?.length || 0) > 0 && (
                  <span className="cn-pill cn-pill-danger">Allergies · {patient!.allergies!.length}</span>
                )}
                {locked
                  ? <span className="cn-pill cn-pill-success">Signed</span>
                  : <span className="cn-pill cn-pill-info">Draft</span>}
              </div>
            </div>
          </div>

          {/* Chart shortcuts as icon tiles */}
          <div className="cn-quick-links">
            <button type="button" className="cn-quick-link" onClick={() => router.push(`/patients/${note.patientId}`)}>
              <FileText size={16} aria-hidden /> Facesheet
            </button>
            <button type="button" className="cn-quick-link" onClick={() => router.push(`/patients/${note.patientId}?tab=immunizations`)}>
              <Syringe size={16} aria-hidden /> Immunize
            </button>
            <button type="button" className="cn-quick-link" onClick={() => router.push(`/patients/${note.patientId}?tab=vitals`)}>
              <Activity size={16} aria-hidden /> Flowsheets
            </button>
          </div>

          {/* The patient's other notes, newest first */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">Patient Notes</p>
            <div className="cn-card-body cn-card-body-roomy cn-card-body--flush">
              {siblingNotes.length === 0 && (
                <p className="cn-card-empty">No other notes for this patient.</p>
              )}
              {siblingNotes.map(n => (
                <button
                  key={n._id}
                  type="button"
                  className="cn-note-row"
                  title={`${getNoteType(n.noteType).label} — ${n.serviceDate}`}
                  onClick={() => router.push(`/notes/${n._id}`)}
                >
                  <span className="cn-note-row-top">
                    <b>{getNoteType(n.noteType).label}</b>
                    <small>{new Date(`${n.serviceDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</small>
                  </span>
                  <span className="cn-note-row-meta">
                    {(n.assignedToName || n.authorName || 'Unassigned')}{isNoteLocked(n) ? ' · signed' : ' · draft'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Note sections (jump + remove) */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">
              Note Sections
              {!locked && optionalAvailable.length > 0 && (
                <button type="button" className="cn-card-head-action" onClick={() => setShowAddOptional(true)}>
                  Add Optional
                </button>
              )}
            </p>
            <div className="cn-card-body cn-card-body--flush">
              <nav className="cn-section-nav">
                {sectionIds.map((id) => {
                  const content = note.sections.find(s => s.sectionId === id);
                  const filled = !!(stripTemplateMarkers(content?.text || '').trim() || content?.snapshot);
                  const removable = !locked && !typeDef.sections.includes(id);
                  return (
                    <div key={id} className="cn-section-nav-row">
                      <button
                        type="button"
                        className="cn-section-nav-item"
                        aria-current={activeSection === id}
                        onClick={() => {
                          setActiveSection(id);
                          document.getElementById(`cn-section-${id}`)?.scrollIntoView({
                            behavior: 'smooth', block: 'start',
                          });
                        }}
                      >
                        <span>{getSectionLabel(id)}</span>
                        {filled && <span className="cn-section-nav-badge">•</span>}
                      </button>
                      {removable && (
                        <button
                          type="button"
                          className="cn-section-nav-remove"
                          aria-label={`Remove ${getSectionLabel(id)}`}
                          title={`Remove ${getSectionLabel(id)}`}
                          onClick={async () => {
                            // The section's narrative goes with it, and the
                            // control is a 20px box beside the section name.
                            const ok = await confirm({
                              title: `Remove the ${getSectionLabel(id)} section?`,
                              message: 'Anything written in it will be removed from this note.',
                              confirmLabel: 'Remove',
                              tone: 'danger',
                            });
                            if (ok) await persist(() => removeNoteSection(noteId, id));
                          }}
                        >
                          <Minus size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Most recent resulted labs */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">Labs / Studies</p>
            <div className="cn-card-body cn-card-body-roomy cn-card-body--flush">
              {recentLabs !== null && recentLabs.length === 0 && (
                <p className="cn-card-empty">You have no previous labs for this patient.</p>
              )}
              {(recentLabs || []).map(lab => (
                <button
                  key={lab.id}
                  type="button"
                  className="cn-rail-row"
                  onClick={() => router.push(`/patients/${note.patientId}?tab=labs&focus=${encodeURIComponent(lab.id)}`)}
                >
                  <span className="cn-rail-row-main">{lab.testName}</span>
                  <span className="cn-rail-row-meta">{lab.date}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Uploaded documents, filterable by label */}
          <div className="cn-sidebar-card">
            <p className="cn-card-head">
              Documents
              <label className="cn-card-head-filter">
                Filter by Label:
                <Select
                  value={docLabel}
                  onChange={e => setDocLabel(e.target.value)}
                  aria-label="Filter documents by label"
                >
                  <option value="all">All</option>
                  {[...new Set((documents || []).map(d => d.category))].map(cat => (
                    <option key={cat} value={cat}>{docCategoryLabel(cat)}</option>
                  ))}
                </Select>
              </label>
            </p>
            <div className="cn-card-body cn-card-body-roomy cn-card-body--flush">
              {documents !== null && documents.length === 0 && (
                <p className="cn-card-empty">No documents for this patient.</p>
              )}
              {(documents || [])
                .filter(doc => docLabel === 'all' || doc.category === docLabel)
                .slice(0, 8)
                .map(doc => (
                  <button
                    key={doc._id}
                    type="button"
                    className="cn-rail-row cn-rail-row-stacked"
                    title={doc.title}
                    onClick={() => router.push(`/patients/${note.patientId}?tab=documents&focus=${encodeURIComponent(doc._id)}`)}
                  >
                    <span className="cn-rail-row-main">
                      {doc.createdAt ? `${new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })} - ` : ''}{doc.title || doc.fileName}
                    </span>
                    <span className="cn-rail-row-sub">{docCategoryLabel(doc.category)}</span>
                  </button>
                ))}
            </div>
          </div>
        </aside>

        <div className="cn-main">
      {/* Header */}
      <div className="cn-header">
        {/* Patient identity lives in the sidebar; the header names the
            document and its context, per the design. */}
        <div className="cn-header-id">
          <h1 className="cn-header-title">Encounter Note</h1>
          <p className="cn-header-context">
            {[typeDef.label, note.patientName, note.hospitalName].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="cn-header-actions">
        <label className="cn-field">
          <span className="cn-label">Note type</span>
          <Select
            className="cn-select"
            value={note.noteType}
            onChange={e => handleTypeChange(e.target.value)}
            disabled={locked}
            aria-label="Note type"
          >
            {NOTE_TYPE_ORDER.map(id => (
              <option key={id} value={id}>{NOTE_TYPES[id].label}</option>
            ))}
          </Select>
        </label>

        <label className="cn-field">
          <span className="cn-label">Date</span>
          <input
            type="date"
            className="cn-input"
            value={note.serviceDate}
            onChange={e => void persist(() => updateClinicalNote(noteId, { serviceDate: e.target.value }))}
            disabled={locked}
            aria-label="Date of service"
          />
        </label>

        <label className="cn-field">
          <span className="cn-label">Time</span>
          <input
            type="time"
            className="cn-input"
            value={note.serviceTime || ''}
            onChange={e => void persist(() => updateClinicalNote(noteId, { serviceTime: e.target.value }))}
            disabled={locked}
            aria-label="Time of service"
          />
        </label>

        <div className="cn-field">
          <span className="cn-label">Assigned to</span>
          {/* Each provider in the menu is its own assign button — picking one
              writes the assignment immediately, so handing a note to a
              colleague is one click rather than a select plus a save. */}
          <AssignPicker
            value={note.assignedToId}
            valueName={note.assignedToName}
            options={assignableUsers}
            disabled={locked}
            onAssign={async (picked) => {
              await persist(() => updateClinicalNote(noteId, {
                assignedToId: picked?._id,
                assignedToName: picked?.name,
              }));
            }}
          />
        </div>

        <button type="button" className="cn-btn" onClick={handleClear} disabled={locked}>
          Clear Note
        </button>
        </div>
      </div>

      {/* Note canvas */}
      <div className="cn-canvas">
          {locked && (
            <div className="cn-locked-banner">
              <Check size={15} />
              <span>
                Signed by {note.signedByName} on {new Date(note.signedAt || '').toLocaleString()}.
                This note is locked — use an addendum to record a correction.
              </span>
            </div>
          )}

          {note.sections.map((section) => {
            const isOptional = !typeDef.sections.includes(section.sectionId);
            return (
              <NoteSectionCard
                key={section.sectionId}
                sectionId={section.sectionId}
                content={section}
                readOnly={locked}
                userId={currentUser?._id || ''}
                orgId={currentUser?.orgId}
                active={activeSection === section.sectionId}
                onFocus={() => setActiveSection(section.sectionId)}
                onChange={patch => handleSectionChange(section.sectionId, patch)}
                onRefreshDerived={refreshDerived}
                onOpenDerived={
                  section.sectionId === 'medications' ? () => setShowMedications(true)
                  : section.sectionId === 'allergies' ? () => setShowAllergies(true)
                  : undefined
                }
                onAction={locked ? undefined : handleSectionAction}
                removable={isOptional}
                onRemove={() => void persist(() => removeNoteSection(noteId, section.sectionId))}
              />
            );
          })}

          {(note.addenda || []).length > 0 && (
            <div style={{ marginTop: 18 }}>
              <h3 className="cn-section-name">Addenda</h3>
              {note.addenda!.map(a => (
                <div className="cn-addendum" key={a.id}>
                  <p className="cn-addendum-meta">
                    {a.authorName} — {new Date(a.createdAt).toLocaleString()}
                  </p>
                  <div>{a.text}</div>
                </div>
              ))}
            </div>
          )}

          {locked && (
            <button
              type="button"
              className="cn-btn"
              style={{ marginTop: 12 }}
              onClick={() => setShowAddendum(true)}
            >
              <Plus size={14} /> Add addendum
            </button>
          )}

          <p className="cn-signature">{note.assignedToName || note.authorName || userName}</p>
          {!locked && (
            <p className="cn-signature-note">Unsigned — signature is applied when you sign the note.</p>
          )}
      </div>
        </div>
      </div>

      {/* Footer */}
      <div className="cn-footer">
        <button
          type="button"
          className="cn-btn cn-btn-primary"
          onClick={() => setShowSignConfirm(true)}
          disabled={locked || saving}
        >
          <Check size={14} /> Sign
        </button>
        <button
          type="button"
          className="cn-btn"
          onClick={() => router.push(`/billing?patientId=${note.patientId}`)}
        >
          <DollarSign size={14} /> Capture Charge
        </button>
        <button
          type="button"
          className="cn-btn"
          onClick={() => {
            const text = note.sections
              .map(s => {
                const dxLines = (s.diagnoses || [])
                  .map(d => `• ${d.name}${d.icd11Code ? ` (ICD-11 ${d.icd11Code})` : ''}${d.startDate ? ` — since ${d.startDate}` : ''}`)
                  .join('\n');
                const body = [dxLines, stripTemplateMarkers(s.text || '') || s.snapshot || '']
                  .filter(Boolean).join('\n');
                return `${getSectionLabel(s.sectionId)}\n${body}`;
              })
              .join('\n\n');
            void navigator.clipboard?.writeText(text);
            showToast('Note copied to the clipboard.', 'success');
          }}
        >
          <Copy size={14} /> Copy
        </button>
        <button type="button" className="cn-btn" onClick={() => setShowCoordination(true)}>
          <Send size={14} /> Care Coordination
        </button>
        <button
          type="button"
          className="cn-btn"
          onClick={() => router.push(`/patients/${note.patientId}?tab=overview`)}
        >
          <ClipboardList size={14} /> Care Checklist
        </button>

        <div className="cn-footer-spacer" />

        <span className="cn-saved">
          {saving ? 'Saving…' : savedAt ? `Last saved ${new Date(savedAt).toLocaleTimeString()}` : ''}
        </span>
        <button
          type="button"
          className="cn-btn cn-btn-save"
          onClick={handleSaveAndClose}
          title={note.encounterId
            ? 'Saves the draft and pauses the visit for later resume'
            : undefined}
        >
          <Save size={14} /> {note.encounterId ? 'Pause visit & close' : 'Save & Close'}
        </button>
      </div>

      {/* Add optional section */}
      {showAddOptional && (
        <Modal onClose={() => setShowAddOptional(false)} width={420}>
          <div style={{ padding: 18 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Add a section</h2>
            {optionalAvailable.length === 0 && (
              <p className="cn-popover-empty">Every optional section is already in this note.</p>
            )}
            {optionalAvailable.map(def => (
              <button
                key={def.id}
                type="button"
                className="cn-popover-item"
                onClick={async () => {
                  await persist(() => addNoteSection(noteId, def.id));
                  setShowAddOptional(false);
                }}
              >
                {def.label}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Sign confirmation */}
      {showSignConfirm && (
        <Modal onClose={() => setShowSignConfirm(false)} width={460}>
          <div style={{ padding: 20 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} /> Sign this note?
            </h2>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>
              Signing attests that this note is a true record of the encounter. It locks the note —
              afterwards, corrections can only be recorded as an addendum, which stays visible
              alongside the original.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="cn-btn" onClick={() => setShowSignConfirm(false)}>Cancel</button>
              <button type="button" className="cn-btn cn-btn-primary" onClick={handleSign}>
                <Check size={14} /> Sign note
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Addendum */}
      {showAddendum && (
        <Modal onClose={() => setShowAddendum(false)} width={520}>
          <div style={{ padding: 20 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>Add an addendum</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted, #64748b)', margin: '0 0 10px' }}>
              The original note is not changed. Your correction is appended and attributed to you.
            </p>
            <textarea
              className="cn-textarea"
              value={addendumText}
              onChange={e => setAddendumText(e.target.value)}
              placeholder="What needs correcting or clarifying…"
              aria-label="Addendum text"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="cn-btn" onClick={() => setShowAddendum(false)}>Cancel</button>
              <button
                type="button"
                className="cn-btn cn-btn-primary"
                onClick={handleAddendum}
                disabled={!addendumText.trim()}
              >
                Add addendum
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showMedications && (
        <MedicationsModal
          patientId={note.patientId}
          patientName={note.patientName}
          currentUser={currentUser}
          encounterId={note.encounterId}
          onClose={() => {
            setShowMedications(false);
            // The popup may have renewed or stopped something — bring the
            // note's snapshot back in line with the chart it just changed.
            if (!locked) void refreshDerived('medications');
          }}
        />
      )}

      {showProblems && (
        <IncludeProblemsModal
          patientId={note.patientId}
          patientName={note.patientName}
          currentUser={currentUser}
          onInclude={handleIncludeProblems}
          onClose={() => setShowProblems(false)}
        />
      )}

      {showAllergies && (
        <AllergiesModal
          patientId={note.patientId}
          currentUser={currentUser}
          onClose={() => {
            setShowAllergies(false);
            if (!locked) void refreshDerived('allergies');
          }}
        />
      )}

      {showPrescribe && (
        <PrescribeModal
          patientId={note.patientId}
          patientName={note.patientName}
          currentUser={currentUser}
          encounterId={note.encounterId}
          onClose={() => {
            setShowPrescribe(false);
            // A prescription written from the note belongs in its medication
            // snapshot, not just in the pharmacy queue.
            if (!locked) void refreshDerived('medications');
          }}
        />
      )}

      {showCoordination && (
        <CareCoordinationModal
          note={note}
          problems={problems}
          socialHistory={socialHistory}
          onSend={handleCoordination}
          onClose={() => setShowCoordination(false)}
        />
      )}

      {showFollowUp && (
        <FollowUpModal
          patientName={note.patientName}
          defaultAssignedWorkerName={userName}
          onSchedule={handleScheduleFollowUp}
          onClose={() => setShowFollowUp(false)}
        />
      )}

      {showPatientEducation && (
        <PatientEducationModal
          patientName={note.patientName}
          onSend={handleSendEducation}
          onClose={() => setShowPatientEducation(false)}
        />
      )}

      {showLabOrder && (
        <LabOrderModal
          presetPatientId={note.patientId}
          onClose={() => setShowLabOrder(false)}
          onPlaced={() => {
            // Fires only once submit() has actually written the order(s) —
            // this is the point the note may honestly say a lab was ordered.
            void persist(() => recordPlanAction(noteId, {
              kind: 'lab',
              label: 'Lab/study ordered from the note',
              createdBy: currentUser?._id,
            }));
          }}
        />
      )}
    </div>
  );
}
