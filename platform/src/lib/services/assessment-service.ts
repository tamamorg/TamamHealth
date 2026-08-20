/**
 * Outcome-measure / intake assessment service (P2.2).
 *
 * The front desk creates an assessment (status 'held') by entering the patient's
 * answers; the score auto-totals. The provider later reviews it with the patient
 * and signs it (status 'signed', locked). Mirrors the Centricity outcome-measures
 * workflow. Assessments live in their own synced database (facility-operational,
 * excluded from national analytics).
 */
import { v4 as uuidv4 } from 'uuid';
import { assessmentsDB } from '../db';
import type { AssessmentDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { getInstrument, scoreAssessment } from '../clinical/assessment-instruments';
import { isClinicalAuthorRole } from '../clinical-roles';

export class AssessmentLockError extends Error {
  constructor(id: string) {
    super(`Assessment ${id} is signed and locked.`);
    this.name = 'AssessmentLockError';
  }
}
export class AssessmentAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentAuthorizationError';
  }
}

function byNewest(a: AssessmentDoc, b: AssessmentDoc): number {
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
}

/** Apply scoring + interpretation to an answers map for the given instrument. */
function scored(instrumentId: string, answers: Record<string, number>) {
  const instrument = getInstrument(instrumentId);
  if (!instrument) throw new Error(`Unknown assessment instrument: ${instrumentId}`);
  const s = scoreAssessment(instrument, answers);
  return {
    instrumentName: instrument.name,
    totalScore: s.total,
    answeredCount: s.answered,
    questionCount: s.questionCount,
    interpretation: s.band?.label,
    severity: s.band?.severity,
  };
}

export async function getAssessmentsByPatient(patientId: string): Promise<AssessmentDoc[]> {
  const rows = await findByType<AssessmentDoc>(
    assessmentsDB(),
    'assessment',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  return rows.sort(byNewest);
}

/** Held assessments awaiting provider review/signature — for the signing inbox. */
export async function getHeldAssessments(scope?: DataScope): Promise<AssessmentDoc[]> {
  let rows = await findByType<AssessmentDoc>(assessmentsDB(), 'assessment');
  if (scope) rows = filterByScope(rows, scope);
  return rows.filter((a) => a.documentStatus === 'held').sort(byNewest);
}

export interface CreateAssessmentInput {
  patientId: string;
  patientName?: string;
  instrumentId: string;
  answers: Record<string, number>;
  enteredById?: string;
  enteredByName?: string;
  encounterId?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

export async function createAssessment(input: CreateAssessmentInput): Promise<AssessmentDoc> {
  const meta = scored(input.instrumentId, input.answers || {});
  const db = assessmentsDB();
  const now = new Date().toISOString();
  const doc: AssessmentDoc = {
    _id: `asmt-${uuidv4()}`,
    type: 'assessment',
    patientId: input.patientId,
    patientName: input.patientName,
    instrumentId: input.instrumentId,
    instrumentName: meta.instrumentName,
    answers: input.answers || {},
    totalScore: meta.totalScore,
    answeredCount: meta.answeredCount,
    questionCount: meta.questionCount,
    interpretation: meta.interpretation,
    severity: meta.severity,
    documentStatus: 'held',
    enteredById: input.enteredById,
    enteredByName: input.enteredByName,
    encounterId: input.encounterId,
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_ASSESSMENT', input.enteredById, input.enteredByName, `${meta.instrumentName} (score ${meta.totalScore}) for patient ${doc.patientId}`);
  emitSyncEvent({ resourceType: 'assessment', resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  return doc;
}

/** Update answers while the assessment is still held; re-scores. Locked once signed. */
export async function updateAssessmentAnswers(id: string, answers: Record<string, number>): Promise<AssessmentDoc | null> {
  const db = assessmentsDB();
  let existing: AssessmentDoc;
  try {
    existing = await db.get(id) as AssessmentDoc;
  } catch {
    return null;
  }
  if (existing.documentStatus === 'signed') throw new AssessmentLockError(id);
  const meta = scored(existing.instrumentId, answers || {});
  const updated: AssessmentDoc = {
    ...existing,
    answers: answers || {},
    totalScore: meta.totalScore,
    answeredCount: meta.answeredCount,
    questionCount: meta.questionCount,
    interpretation: meta.interpretation,
    severity: meta.severity,
    updatedAt: new Date().toISOString(),
  };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('UPDATE_ASSESSMENT', undefined, undefined, `Updated ${updated.instrumentName} answers (score ${meta.totalScore}) for patient ${updated.patientId}`);
  emitSyncEvent({ resourceType: 'assessment', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, hospitalId: updated.hospitalId, orgId: updated.orgId });
  return updated;
}

export interface AssessmentSigner {
  userId?: string;
  userName: string;
  userRole?: string;
}

/** Provider reviews with the patient and signs the held assessment, locking it. */
export async function signAssessment(id: string, signer: AssessmentSigner): Promise<AssessmentDoc | null> {
  if (!isClinicalAuthorRole(signer.userRole)) {
    throw new AssessmentAuthorizationError(`Role "${signer.userRole ?? 'unknown'}" may not sign assessments.`);
  }
  const db = assessmentsDB();
  let existing: AssessmentDoc;
  try {
    existing = await db.get(id) as AssessmentDoc;
  } catch {
    return null;
  }
  if (existing.documentStatus === 'signed') throw new AssessmentLockError(id);
  const now = new Date().toISOString();
  const signed: AssessmentDoc = {
    ...existing,
    documentStatus: 'signed',
    signedBy: signer.userId,
    signedByName: signer.userName,
    signedAt: now,
    updatedAt: now,
  };
  const resp = await db.put(signed);
  signed._rev = resp.rev;
  await logAuditSafe('SIGN_ASSESSMENT', signer.userId, signer.userName, `Signed ${signed.instrumentName} for patient ${signed.patientId}`);
  emitSyncEvent({ resourceType: 'assessment', resourceId: signed._id, operation: 'update', resourceVersion: signed._rev, hospitalId: signed.hospitalId, orgId: signed.orgId });
  return signed;
}
