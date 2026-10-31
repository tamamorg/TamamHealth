/**
 * Place a lab or imaging order: one LabResultDoc per test, all sharing an
 * order group id, hung off the patient's current visit so the tests are
 * billable and attributable. Bills the tests, files any attachments, and
 * writes the audit line.
 *
 * The one write path for orders. The Create Lab Order wizard
 * (useLabOrderDraft) and the chart's order basket both call it, so a test
 * ordered from either place lands on the visit, the bill and the bench the
 * same way.
 */

import { v4 as uuidv4 } from 'uuid';
import type { PatientDoc, UserRole } from '@/lib/db-types';
import type { LabOrderDraft, LabOrderReceipt } from './lab-order-types';

/** Who is placing the order — the signed-in user's facility and organisation. */
export interface LabOrderActor {
  _id?: string;
  name?: string;
  username?: string;
  role?: UserRole;
  orgId?: string;
  hospitalId?: string;
  hospitalName?: string;
}

/** One test's Ask-at-Order-Entry answers, already filtered to the answered ones. */
export type AoeAnswerList = { question: string; answer: string }[];

export async function placeLabOrder({
  patient, currentUser, draft, answersFor = () => [],
}: {
  patient: PatientDoc;
  currentUser: LabOrderActor | null | undefined;
  draft: LabOrderDraft;
  answersFor?: (testName: string) => AoeAnswerList;
}): Promise<LabOrderReceipt> {
  if (!draft.tests.length) throw new Error('labOrder.errTests');
  const hospitalId = currentUser?.hospitalId || patient.registrationHospital;
  const patientName = `${patient.firstName} ${patient.surname}`;
  const orderGroupId = `req-${uuidv4()}`;
  const placedAt = new Date().toISOString();

  // Anchor the order to the patient's CURRENT visit at this facility —
  // reusing an open encounter (and pausing it at `awaiting_labs` when
  // that's a legal move) instead of spawning a parallel desk encounter for
  // a patient who is mid-consultation. A true walk-in with no open visit
  // still gets a minimal desk encounter so the tests are billable and
  // attributable (KAN-72). Best-effort — an unbilled test still beats a
  // clinician who cannot order one.
  let deskEncounterId: string | undefined;
  try {
    const { ensureLabOrderEncounter } = await import('@/lib/services/encounter-service');
    const { isImagingStudy } = await import('@/lib/clinical-flow/lab-catalog');
    const encounter = await ensureLabOrderEncounter({
      patientId: patient._id,
      patientName,
      hospitalNumber: patient.hospitalNumber,
      hospitalId: hospitalId || '',
      hospitalName: currentUser?.hospitalName,
      orgId: currentUser?.orgId,
      clinicianId: currentUser?._id,
      clinicianName: draft.orderedByName || currentUser?.name,
      actorId: currentUser?._id,
      placedAt,
      // An all-imaging requisition parks the visit at awaiting_imaging so
      // the radiology queue and the visit state tell the same story.
      to: draft.tests.length > 0
        && draft.tests.every(t => isImagingStudy({ specimen: t.specimen, testName: t.name }))
        ? 'awaiting_imaging'
        : 'awaiting_labs',
    });
    deskEncounterId = encounter._id;
  } catch (err) {
    console.warn('[lab-order] could not open a desk encounter for this order:', err);
  }

  const { createLabResult } = await import('@/lib/services/lab-service');
  const { isImagingStudy: isImaging } = await import('@/lib/clinical-flow/lab-catalog');
  const createdIds: string[] = [];
  const accessionNumbers: string[] = [];

  for (const test of draft.tests) {
    // Only this test's AOE answers travel with this test's document.
    const answers = answersFor(test.name);

    const created = await createLabResult({
      patientId: patient._id,
      patientName,
      hospitalNumber: patient.hospitalNumber,
      encounterId: deskEncounterId,
      testName: test.name,
      specimen: test.specimen,
      tier: test.tier,
      // Every test starts at the bench's first step, STAT included: priority
      // moves it up the queue, it does not draw the specimen. 'in_progress'
      // here read as already processing and skipped Collect and Receive.
      status: 'pending',
      orderStatus: 'ordered',
      result: '',
      unit: '',
      referenceRange: '',
      abnormal: false,
      // `critical` describes the RESULT VALUE, not the order priority —
      // nothing has come back yet, so it cannot be critical (KAN-75).
      critical: false,
      orderedBy: draft.orderedByName || currentUser?.name || 'Lab',
      // The id is what the critical-result task keys on — the name above
      // is display-only. Stamped only when the order is placed as oneself;
      // an order entered on another clinician's behalf keeps just the name
      // and is resolved against the directory at task-raise time.
      orderedById: !draft.orderedByName || draft.orderedByName === currentUser?.name
        ? currentUser?._id
        : undefined,
      // ISO, not a locale string: every consumer parses through
      // new Date(), and the chart's Orders/Results sections sort
      // lexicographically — a locale "08/08/2026…" sorted below every
      // ISO "2026-…" regardless of date.
      orderedAt: placedAt,
      // Modality discriminator — without it every CT scan renders as a
      // "Lab order" in the chart.
      orderKind: isImaging({ specimen: test.specimen, testName: test.name }) ? 'imaging' : 'lab',
      completedAt: '',
      hospitalId,
      hospitalName: currentUser?.hospitalName,
      orgId: currentUser?.orgId,
      clinicalNotes: draft.notes || undefined,
      orderComment: draft.comments.trim() || undefined,
      priority: draft.priority,
      processing: draft.processing,
      collectionTiming: draft.collectionTiming,
      scheduledCollectionAt: draft.collectionTiming === 'future' ? draft.scheduledCollectionAt : undefined,
      fasting: draft.fasting,
      indications: draft.indications.length ? draft.indications : undefined,
      aoeAnswers: answers.length ? answers : undefined,
      orderGroupId,
      requestSource: draft.requestSource,
      externalFacility: draft.externalFacility || undefined,
      externalRequester: draft.externalRequester || undefined,
      externalReference: draft.externalReference || undefined,
    });
    createdIds.push(created._id);
    if (created.accessionNumber) accessionNumbers.push(created.accessionNumber);
  }

  // Record the ordered test ids on the visit. `labOrderIds` is what
  // useResumableEncounters counts to tell the clinician how many results
  // are back — without this write the "Resume" worklist permanently read
  // "0 of 0 results", because nothing on this, the actual ordering path,
  // ever populated the field `appendLabOrderIds` exists to fill. Best
  // effort: the tests themselves are already placed and billable even if
  // this bookkeeping write fails.
  if (deskEncounterId && createdIds.length) {
    try {
      const { appendLabOrderIds } = await import('@/lib/services/encounter-service');
      await appendLabOrderIds(deskEncounterId, createdIds);
    } catch (err) {
      console.warn('[lab-order] could not record order ids on the encounter (the order was placed):', err);
    }
  }

  // Bill the tests against that encounter. Price-driven and best-effort:
  // lines with no catalogued price are skipped and no bill is created when
  // the org hasn't priced anything — the same contract the consultation
  // path uses.
  if (deskEncounterId) {
    try {
      const { chargeForServices } = await import('@/lib/services/fee-schedule-service');
      await chargeForServices(
        {
          patientId: patient._id,
          patientName,
          hospitalNumber: patient.hospitalNumber,
          facilityId: hospitalId,
          facilityName: currentUser?.hospitalName || '',
          facilityLevel: 'clinic',
          state: patient.state || '',
          county: patient.county,
          orgId: currentUser?.orgId,
          encounterId: deskEncounterId,
          generatedBy: currentUser?._id || 'system',
          generatedByName: currentUser?.name || 'Lab desk',
          scope: { orgId: currentUser?.orgId, hospitalId, role: currentUser?.role || 'lab_tech' },
        },
        draft.tests.map((test, i) => ({
          category: 'laboratory' as const,
          serviceCode: test.name,
          description: test.name,
          referenceId: createdIds[i],
          referenceType: 'lab_result',
        })),
      );
    } catch (err) {
      console.warn('[lab-order] could not bill desk lab order (tests were ordered):', err);
    }
  }

  // Anything attached to the requisition is filed on the chart, tagged with
  // the accession so the bench and the chart point at the same paperwork.
  // Best-effort: a failed upload must not lose the order behind it.
  if (draft.documents.length) {
    try {
      const { addPatientDocument } = await import('@/lib/services/patient-document-service');
      for (const file of draft.documents) {
        await addPatientDocument({
          patientId: patient._id,
          title: file.description?.trim() || file.name,
          category: draft.kind === 'imaging' ? 'radiology' : 'lab_report',
          fileName: file.name,
          mimeType: file.mimeType,
          base64Data: file.base64Data,
          sizeBytes: file.sizeBytes,
          note: `Attached to order ${accessionNumbers[0] || orderGroupId}`,
          uploadedById: currentUser?._id,
          uploadedByName: draft.orderedByName || currentUser?.name,
          hospitalId,
          orgId: currentUser?.orgId,
        });
      }
    } catch (err) {
      console.warn('[lab-order] could not file an attached document (the order was placed):', err);
    }
  }

  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('LAB_ORDER_CREATED', currentUser?._id, currentUser?.username,
    `Ordered ${draft.tests.length} test(s) for patient ${draft.patientId}`,
  ).catch(() => {});

  const done: LabOrderReceipt = { orderGroupId, accessionNumbers, createdIds, encounterId: deskEncounterId, placedAt };
  return done;
}
