'use client';

/**
 * /consultation — now the entry ramp into a clinical note.
 *
 * The seven-step consultation wizard this route used to render has been
 * retired: documentation happens in the Clinical Notes module, where the
 * clinician picks the note type up front and writes into the sections that type
 * defines, rather than being walked through one fixed sequence that fits an
 * outpatient consult and nothing else.
 *
 * The route is kept rather than deleted because a dozen things already point at
 * it — the sidebar, the top rail's primary create action, the "Documents to
 * sign" tile, and `callPatient` on the clinician worklist. Redirecting here
 * means every one of those keeps working and lands on the note, instead of each
 * call site having to be found and rewritten (and one being missed).
 *
 * With a `patientId` it resumes today's draft for that patient or starts one;
 * without, it opens the patient registry — the cross-patient notes queue is
 * gone, because documentation belongs to the patient it documents and the
 * chart's Notes tab is the same list already scoped to them.
 *
 * The wizard remains in git history if any of its order-entry steps need to be
 * recovered into the note's Plan section.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/lib/context';
import { listClinicalNotes, createClinicalNote } from '@/lib/clinical-notes/note-service';
import { defaultNoteTypeFor } from '@/components/clinical-notes/CreateNoteButton';
import '@/components/clinical-notes/clinical-notes.css';
import { todayIso } from '@/lib/date-utils';

export default function ConsultationRedirectPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { currentUser } = useApp();
  const [error, setError] = useState<string | null>(null);
  // Effects run twice under React StrictMode in development; without this the
  // first pass would create one note and the second another for the same visit.
  const started = useRef(false);

  const patientId = params?.get('patientId') || '';
  // Both spellings are live: the dashboard's resume link sends ?encounter=,
  // the checkout gate's "visit still open" link sends ?encounterId=.
  const encounterParam = params?.get('encounter') || params?.get('encounterId') || '';

  useEffect(() => {
    if (started.current) return;
    if (!currentUser) return;          // wait for auth to hydrate
    started.current = true;

    (async () => {
      const scope = {
        orgId: currentUser.orgId,
        hospitalId: currentUser.hospitalId,
        role: currentUser.role,
      };

      // Resume a paused visit ("all results back — resume the visit" on the
      // dashboard links here with ?encounter=). The encounter names the
      // patient, and reopening it walks the visit back to `with_clinician` —
      // without this, the link landed on the patient registry and the paused
      // encounter stayed at `awaiting_labs` forever.
      let resolvedPatientId = patientId;
      let resumedEncounterId: string | undefined;
      if (encounterParam) {
        try {
          const { getEncounter, transitionEncounter, RESUMABLE_STATUSES } =
            await import('@/lib/services/encounter-service');
          const { filterByScope } = await import('@/lib/services/data-scope');
          const enc = await getEncounter(encounterParam);
          // Out-of-scope (another org/facility) resolves to "not found".
          const visible = enc && filterByScope([enc], scope).length > 0 ? enc : null;
          if (visible) {
            resolvedPatientId = resolvedPatientId || visible.patientId;
            resumedEncounterId = visible._id;
            if (RESUMABLE_STATUSES.includes(visible.status)) {
              try {
                await transitionEncounter(visible._id, 'with_clinician', { actorId: currentUser._id });
              } catch { /* the note still opens; the desk can move the visit */ }
            }
          }
        } catch { /* fall through to the patientId path */ }
      }

      // No patient in the link: the notes queue used to catch this, but
      // documentation is per-patient now, so the registry is where you pick
      // one.
      if (!resolvedPatientId) { router.replace('/patients'); return; }

      try {
        const today = todayIso();
        const existing = await listClinicalNotes({ patientId: resolvedPatientId }, scope);

        // Resume rather than duplicate: pressing "Start consultation" twice in
        // one clinic session must not split the encounter across two records.
        const draft = existing.find(n => n.status === 'draft' && n.serviceDate === today)
          ?? existing.find(n => n.status === 'draft');
        if (draft) { router.replace(`/notes/${draft._id}`); return; }

        const { getPatientById } = await import('@/lib/services/patient-service');
        // `resolvedPatientId` can come straight from an unauthenticated-looking
        // `?patientId=` query param (no encounter to have already scope-checked
        // it), so this must not be an unscoped chart read. Org + role only (no
        // hospitalId), matching the chart's own referred-in-patient fallback —
        // this route is also how a clinician starts documentation for a
        // same-org patient referred in from another facility.
        const patient = await getPatientById(resolvedPatientId, { orgId: currentUser.orgId, role: currentUser.role }).catch(() => null);
        const patientName = patient
          ? [patient.firstName, patient.middleName, patient.surname].filter(Boolean).join(' ')
          : 'Patient';

        // Link the note to the VISIT it documents.
        //
        // `ClinicalNoteDoc.encounterId` has always existed and nothing ever
        // filled it, so a signed note and the encounter it belonged to were two
        // unrelated records: the visit could not tell whether it had been
        // documented, and signing could not close it. Best-effort — a note is
        // still worth writing for a patient with no open visit thread (a phone
        // note, a back-dated entry), so an absent encounter is not an error.
        let encounterId: string | undefined = resumedEncounterId;
        if (!encounterId) {
          try {
            const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
            const open = await findOpenEncounterForPatient(resolvedPatientId, currentUser.hospitalId || '');
            encounterId = open?._id;
          } catch { /* unlinked note — see above */ }
        }

        const note = await createClinicalNote({
          patientId: resolvedPatientId,
          patientName,
          mrn: patient?.hospitalNumber,
          patientDob: patient?.dateOfBirth,
          noteType: defaultNoteTypeFor({ role: currentUser.role }),
          serviceDate: today,
          serviceTime: new Date().toTimeString().slice(0, 5),
          encounterId,
          assignedToId: currentUser._id,
          assignedToName: currentUser.name || currentUser.username,
          authorId: currentUser._id,
          authorName: currentUser.name || currentUser.username,
          hospitalId: currentUser.hospitalId,
          hospitalName: currentUser.hospitalName,
          orgId: currentUser.orgId,
        });
        router.replace(`/notes/${note._id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not open a clinical note.');
      }
    })();
  }, [currentUser, patientId, encounterParam, router]);

  if (error) {
    return (
      <div className="cn-empty">
        <p>{error}</p>
        <button type="button" className="cn-btn" onClick={() => router.push('/patients')}>
          Go to Patients
        </button>
      </div>
    );
  }

  return <div className="cn-empty">Opening clinical note…</div>;
}
