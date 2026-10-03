/**
 * Shared vocabulary for the Create Lab Order flow.
 *
 * The flow has two phases, mirroring how a clinician actually places an order:
 *   1. a compact "Create Order" dialog that captures the essentials
 *      (who, what type, why, which tests), and
 *   2. a full-width requisition wizard — Patient → Tests → Clinical → Review →
 *      Complete — where the reason for testing and the AOEs are answered, the
 *      order is checked, and the printable requisition is produced.
 *
 * The clinician fills all of it in; the laboratory (or imaging unit) reads it.
 * The reason for testing lives in the Clinical step rather than a step of its
 * own: to the bench it is one block of context alongside the AOE answers, and
 * a separate "Diagnosis" step read as if a confirmed diagnosis had to exist
 * before the test that would establish it.
 *
 * Everything here is data only, so the step components stay presentational and
 * the draft can be validated/serialised without touching React.
 */

/** Which work queue the order is routed to. */
export type LabOrderKind = 'labs' | 'imaging';

/** Where the specimen is analysed. */
export type LabOrderProcessing = 'in_house' | 'send_out';

export type LabOrderPriority = 'routine' | 'urgent' | 'stat';

/** When/where the specimen is taken. */
export type CollectionTiming = 'draw_now' | 'lab_collect' | 'future';

export type FastingState = 'yes' | 'no' | 'unknown';

/** The wizard's ordered steps. `complete` is post-submit (requisition preview). */
export type LabOrderStepKey = 'patient' | 'tests' | 'clinical' | 'review' | 'complete';

export const LAB_ORDER_STEPS: LabOrderStepKey[] = [
  'patient', 'tests', 'clinical', 'review', 'complete',
];

/** One investigation on the requisition. */
export interface OrderedTest {
  name: string;
  specimen: string;
  tier: 'basic' | 'special';
  /** LOINC, when the catalogue entry carries one. */
  loinc?: string;
}

/**
 * A coded reason (ICD-11) for the order. Not necessarily a diagnosis: a
 * symptom, a suspected condition and a screening code are all valid, because
 * the result is usually what settles the diagnosis.
 */
export interface OrderIndication {
  code: string;
  title: string;
}

/**
 * An Ask-at-Order-Entry question. Reference labs and imaging units reject
 * requisitions that arrive without these answers (fasting state for a glucose,
 * pregnancy status before an X-ray, antibiotics before a culture), so they are
 * captured with the order rather than chased afterwards.
 */
export interface AoeQuestion {
  id: string;
  label: string;
  type: 'select' | 'text' | 'number' | 'date';
  options?: string[];
  required?: boolean;
  /** Short helper line under the control. */
  help?: string;
}

/** Answers keyed `${testName}::${questionId}`. */
export type AoeAnswers = Record<string, string>;

export const aoeKey = (testName: string, questionId: string) => `${testName}::${questionId}`;

/** A document attached to the requisition before it is placed. */
export interface OrderAttachment {
  id: string;
  name: string;
  mimeType: string;
  base64Data: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  description?: string;
}

/** The whole in-progress order, phase 1 and phase 2 combined. */
export interface LabOrderDraft {
  kind: LabOrderKind;
  patientId: string;
  /** Free-text so a locum's name can be recorded, defaulted to the signed-in user. */
  orderedByName: string;
  processing: LabOrderProcessing;
  priority: LabOrderPriority;
  collectionTiming: CollectionTiming;
  /** ISO datetime, only meaningful when `collectionTiming === 'future'`. */
  scheduledCollectionAt: string;
  fasting: FastingState;
  tests: OrderedTest[];
  indications: OrderIndication[];
  aoe: AoeAnswers;
  /** Instructions for the bench / radiographer — persisted as clinical notes. */
  notes: string;
  /** Staff-only handling comment — saved on each test as `orderComment`, shown
   *  to the bench and on the requisition, never sent to the patient portal. */
  comments: string;
  /** Files that travel with the order (prior report, external result, consent).
   *  Filed against the patient's chart when the order is placed. */
  documents: OrderAttachment[];
}

export const emptyLabOrderDraft = (orderedByName = ''): LabOrderDraft => ({
  kind: 'labs',
  patientId: '',
  orderedByName,
  processing: 'in_house',
  priority: 'routine',
  collectionTiming: 'draw_now',
  scheduledCollectionAt: '',
  fasting: 'unknown',
  tests: [],
  indications: [],
  aoe: {},
  notes: '',
  comments: '',
  documents: [],
});

/**
 * Collection wording depends on the order type: a specimen is drawn, a study is
 * performed. Same three states either way, so only the labels differ.
 */
export function timingLabelKey(kind: LabOrderKind, timing: CollectionTiming): string {
  if (timing === 'future') return 'labOrder.timingFuture';
  if (kind === 'imaging') return timing === 'draw_now' ? 'labOrder.timingPerformNow' : 'labOrder.timingUnitSchedule';
  return timing === 'draw_now' ? 'labOrder.timingDrawNow' : 'labOrder.timingLabCollect';
}

/** The result of a successful submit, used to render the requisition. */
export interface LabOrderReceipt {
  orderGroupId: string;
  accessionNumbers: string[];
  createdIds: string[];
  encounterId?: string;
  placedAt: string;
}
