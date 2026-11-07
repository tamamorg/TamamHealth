import { useEffect, useState } from 'react';
import type { PatientDoc, PatientDocumentDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { listClinicalNotes } from '@/lib/clinical-notes/note-service';
import type { SummaryProblem } from '../CareCoordinationModal';
import type { useDataScope } from '@/lib/hooks/useDataScope';

type Scope = ReturnType<typeof useDataScope>;

/**
 * The chart context around an open note: the active problems for the Care
 * Coordination summary, and the left rail's patient record, sibling notes,
 * recent labs and documents. Each block fails independently: a rail card with
 * nothing to show is not a reason to block the note.
 *
 * The effects here sit where they did inline (after the note load, before the
 * pending-edit flush), so the effect order is unchanged.
 */
export function useNoteChartContext(note: ClinicalNoteDoc | null, noteId: string, scope: Scope) {
  const [problems, setProblems] = useState<SummaryProblem[]>([]);
  // Left-rail chart context: the patient record (photo/sex/phone), the
  // patient's other notes, and their most recent resulted labs.
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [siblingNotes, setSiblingNotes] = useState<ClinicalNoteDoc[]>([]);
  const [recentLabs, setRecentLabs] = useState<Array<{ id: string; testName: string; date: string }> | null>(null);
  const [documents, setDocuments] = useState<PatientDocumentDoc[] | null>(null);

  // Problems + social history back the Care Coordination summary.
  useEffect(() => {
    if (!note?.patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getProblemsByPatient } = await import('@/lib/services/problem-service');
        const rows = await getProblemsByPatient(note.patientId, scope);
        if (cancelled) return;
        setProblems(rows.filter(p => p.status === 'active').map(p => ({
          effectiveDate: p.onsetDate || p.createdAt?.slice(0, 10) || '',
          problem: p.name,
          status: p.status.toUpperCase(),
        })));
      } catch { /* the summary simply offers nothing to attach */ }
    })();
    return () => { cancelled = true; };
  }, [note?.patientId, scope]);

  // Chart context for the left rail.
  useEffect(() => {
    const patientId = note?.patientId;
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      try {
        if (!scope) return;
        const { getPatientById } = await import('@/lib/services/patient-service');
        const doc = await getPatientById(patientId, scope);
        if (!cancelled) setPatient(doc);
      } catch { /* identity card renders from the note's own fields */ }
      try {
        const rows = await listClinicalNotes({ patientId }, scope);
        if (!cancelled) setSiblingNotes(rows.filter(n => n._id !== noteId).slice(0, 8));
      } catch { /* Patient Notes card shows its empty state */ }
      try {
        const { getLabResultsByPatient } = await import('@/lib/services/lab-service');
        const labs = await getLabResultsByPatient(patientId, scope);
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
        const docs = await getPatientDocuments(patientId, scope);
        if (!cancelled) {
          docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          setDocuments(docs);
        }
      } catch { if (!cancelled) setDocuments([]); }
    })();
    return () => { cancelled = true; };
  }, [note?.patientId, noteId, scope]);

  return { problems, patient, siblingNotes, recentLabs, documents };
}
