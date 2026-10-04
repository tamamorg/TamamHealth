/**
 * What a patient may see of a lab order in the portal.
 *
 * The portal's labs route used to return the whole lab document: the ordering
 * clinician's notes to the laboratory, the coded reasons and order-entry
 * answers, specimen-rejection notes, amendment history, staff names at every
 * step — and the result itself the moment the bench filed it, before any
 * clinician had read it. A critical value could reach the patient's phone
 * ahead of the conversation it calls for.
 *
 * Two rules live here, so the route (and the demo fallback beside it) cannot
 * drift apart:
 *
 *  1. An allow-list. Only the fields below leave the server; a field added to
 *     the lab document later is private until someone adds it here on purpose.
 *  2. A release rule. The result is shown once a clinician has reviewed it
 *     (`reviewed_by_clinician` or later). Until then the patient sees that the
 *     test exists and is awaiting review — never the value, the abnormal flag
 *     or the critical flag.
 *
 * Results recorded before the lab lifecycle existed carry no `orderStatus`;
 * they have no review step to wait for and were visible before, so they stay
 * visible. Anything the lifecycle tracks waits for its review.
 */
import type { LabResultDoc } from './db-types';

const RELEASED_STAGES: ReadonlySet<string> = new Set([
  'reviewed_by_clinician', 'acted_upon', 'communicated_to_patient',
]);

export interface PortalLabResult {
  _id: string;
  patientId: string;
  testName: string;
  specimen?: string;
  orderKind?: 'lab' | 'imaging';
  /** The ordering clinician, as the patient already knows them. */
  orderedBy?: string;
  orderedAt: string;
  createdAt: string;
  /** As the patient may see it: `completed` only once the result is released. */
  status: 'pending' | 'in_progress' | 'completed';
  /** A result has been filed but no clinician has reviewed it yet. */
  awaitingReview: boolean;
  // Present only on a released result.
  result?: string;
  unit?: string;
  referenceRange?: string;
  abnormal?: boolean;
  critical?: boolean;
  completedAt?: string;
}

/** Whether the patient may see this order's result. */
export function isReleasedToPatient(doc: Pick<LabResultDoc, 'status' | 'orderStatus'>): boolean {
  if (doc.status !== 'completed') return false;
  if (!doc.orderStatus) return true;
  return RELEASED_STAGES.has(doc.orderStatus);
}

export function toPortalLabResult(doc: LabResultDoc): PortalLabResult {
  const released = isReleasedToPatient(doc);
  const filedButUnreviewed = doc.status === 'completed' && !released;
  const base: PortalLabResult = {
    _id: doc._id,
    patientId: doc.patientId,
    testName: doc.testName,
    specimen: doc.specimen || undefined,
    orderKind: doc.orderKind,
    orderedBy: doc.orderedBy || undefined,
    orderedAt: doc.orderedAt,
    createdAt: doc.createdAt,
    // An unreviewed result reads as still pending: to the patient, it is.
    status: filedButUnreviewed ? 'pending' : doc.status,
    awaitingReview: filedButUnreviewed,
  };
  if (!released) return base;
  return {
    ...base,
    result: doc.result,
    unit: doc.unit || undefined,
    referenceRange: doc.referenceRange || undefined,
    abnormal: Boolean(doc.abnormal),
    critical: Boolean(doc.critical),
    completedAt: doc.completedAt || undefined,
  };
}
