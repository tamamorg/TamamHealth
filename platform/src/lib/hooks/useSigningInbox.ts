'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { MedicalRecordDoc, AssessmentDoc } from '../db-types';
import { medicalRecordsDB, assessmentsDB, getDB } from '../db';
import { useDataScope } from './useDataScope';
import type { ClinicalNoteDoc } from '../clinical-notes/types';

// Same db name `note-service.ts`'s `clinicalNotesDB()` resolves to. Read
// directly via `getDB` (already statically imported here, like
// `medicalRecordsDB`/`assessmentsDB`) rather than statically importing the
// whole notes service module into every screen this hook loads on.
const clinicalNotesDB = () => getDB('tamamhealth_clinical_notes');

export interface SigningInboxState {
  /** Draft/legacy consult notes that have not yet been signed. */
  unsignedDrafts: MedicalRecordDoc[];
  /** Trainee-signed notes awaiting a supervising provider's co-signature. */
  awaitingCosign: MedicalRecordDoc[];
  /** Outcome-measure assessments entered by the front desk, awaiting review/signature. */
  heldAssessments: AssessmentDoc[];
  /**
   * Unsigned clinical notes. Now that the consultation wizard is retired, the
   * clinical note IS the encounter record, so it belongs in the same "to
   * sign" inbox as legacy medical-record drafts — otherwise a signed-less
   * note is invisible and never gets attested.
   */
  unsignedNotes: ClinicalNoteDoc[];
  loading: boolean;
  reload: () => void;
}

/**
 * The logged-in clinician's "documents to sign" worklist — the EHR equivalent
 * of the Centricity Chart Desktop inbox. Surfaces unsigned drafts and notes
 * pending co-signature, scoped to the user's facility/org, and live-reloads as
 * records are signed or created elsewhere.
 */
export function useSigningInbox(): SigningInboxState {
  const scope = useDataScope();
  const [unsignedDrafts, setUnsignedDrafts] = useState<MedicalRecordDoc[]>([]);
  const [awaitingCosign, setAwaitingCosign] = useState<MedicalRecordDoc[]>([]);
  const [heldAssessments, setHeldAssessments] = useState<AssessmentDoc[]>([]);
  const [unsignedNotes, setUnsignedNotes] = useState<ClinicalNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!scope) {
      setUnsignedDrafts([]);
      setAwaitingCosign([]);
      setHeldAssessments([]);
      setUnsignedNotes([]);
      setLoading(false);
      return;
    }
    try {
      const [{ getSigningInbox }, { getHeldAssessments }, { getUnsignedNotes }] = await Promise.all([
        import('../services/medical-record-service'),
        import('../services/assessment-service'),
        import('../clinical-notes/note-service'),
      ]);
      const [inbox, held, notes] = await Promise.all([
        getSigningInbox(scope), getHeldAssessments(scope), getUnsignedNotes(undefined, scope),
      ]);
      setUnsignedDrafts(inbox.unsignedDrafts);
      setAwaitingCosign(inbox.awaitingCosign);
      setHeldAssessments(held);
      setUnsignedNotes(notes);
    } catch (err) {
      console.error('Failed to load signing inbox', err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const recChanges = medicalRecordsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    const asmtChanges = assessmentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    const noteChanges = clinicalNotesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { recChanges.cancel(); } catch { /* noop */ }
      try { asmtChanges.cancel(); } catch { /* noop */ }
      try { noteChanges.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return { unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes, loading, reload: load };
}
