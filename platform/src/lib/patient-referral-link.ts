/**
 * The link between the two copies of a patient after a cross-organisation
 * referral is accepted. Pure (no DB): used by the lists, the duplicate checks
 * and the chart.
 *
 * Each organisation keeps its own patient document: the sender's (`referredOut`,
 * read-only) and the receiver's (`referredFrom`). They describe one person, so
 * a user who can see both (super admin, platform roles) must get one linked
 * pair, never two unrelated-looking duplicates.
 */
import type { PatientDoc } from './db-types';

type Linkable = Pick<PatientDoc, '_id' | 'referredOut' | 'referredFrom'>;

/** True while the chart is the sending organisation's read-only copy. */
export function isReferredOut(p: Pick<PatientDoc, 'referredOut'>): boolean {
  return !!p.referredOut?.receiverPatientId;
}

/** True when `a` and `b` are the two copies of one cross-organisation referral. */
export function areLinkedCopies(a: Linkable, b: Linkable): boolean {
  return a.referredOut?.receiverPatientId === b._id
    || b.referredOut?.receiverPatientId === a._id
    || a.referredFrom?.patientId === b._id
    || b.referredFrom?.patientId === a._id;
}

/**
 * Drop the sender's referred-out copy when its receiving copy is in the same
 * set, so a viewer who sees both organisations gets the person once (the copy
 * being cared for now). The sender's own users never hold the receiver's copy,
 * so for them the referred-out chart stays listed.
 */
export function withoutShadowedCopies<T extends Linkable>(rows: readonly T[]): T[] {
  const ids = new Set(rows.map(r => r._id));
  return rows.filter(r => !(isReferredOut(r) && ids.has(r.referredOut!.receiverPatientId)));
}
