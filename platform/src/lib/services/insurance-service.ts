/**
 * Insurance Service — policies and eligibility verification. Split out of
 * payment-service.ts; re-exported from there so no caller needs to change.
 */
import type {
  InsurancePolicyDoc, PayerType,
  EligibilityCheckDoc, EligibilityStatus, EligibilitySource,
} from '../db-types-payments';
import { v4 as uuidv4 } from 'uuid';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { insurancePoliciesDB, eligibilityChecksDB } from './payment-dbs';

// ═══════════════════════════════════════════════════════════════════
// INSURANCE POLICIES
// ═══════════════════════════════════════════════════════════════════

export interface CreateInsurancePolicyInput {
  patientId: string;
  payerType: PayerType;
  payerName: string;
  payerCode?: string;
  memberId?: string;
  groupNumber?: string;
  policyNumber?: string;
  subscriberName?: string;
  subscriberRelationship?: 'self' | 'spouse' | 'child' | 'other';
  effectiveDate: string;
  terminationDate?: string;
  isPrimary: boolean;
  copayAmount?: number;
  coinsurancePct?: number;
  deductibleAmount?: number;
  deductibleRemaining?: number;
  oopMax?: number;
  coverageNotes?: string;
  donorProgramId?: string;
  donorCoverageType?: 'full' | 'partial' | 'emergency_only';
  facilityId: string;
  orgId?: string;
  createdBy?: string;
}

export async function createInsurancePolicy(input: CreateInsurancePolicyInput): Promise<InsurancePolicyDoc> {
  const db = insurancePoliciesDB();
  const now = new Date().toISOString();

  // If marking as primary, unmark other policies for this patient
  if (input.isPrimary) {
    const existing = await getPatientInsurancePolicies(input.patientId);
    for (const p of existing) {
      if (p.isPrimary) {
        p.isPrimary = false;
        p.updatedAt = now;
        await db.put(p);
      }
    }
  }

  const doc: InsurancePolicyDoc = {
    _id: `ins-${uuidv4().slice(0, 10)}`,
    type: 'insurance_policy',
    ...input,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'insurance_policy',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function getPatientInsurancePolicies(patientId: string): Promise<InsurancePolicyDoc[]> {
  const db = insurancePoliciesDB();
  const rows = await findByType<InsurancePolicyDoc>(db, 'insurance_policy', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .filter(d => d && d.isActive)
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
}

/** Patient ids holding at least one active insurance policy — one bulk query
 *  so list views can badge every row without a per-patient lookup. */
export async function getInsuredPatientIds(): Promise<Set<string>> {
  const rows = await findByType<InsurancePolicyDoc>(insurancePoliciesDB(), 'insurance_policy');
  return new Set(rows.filter(d => d && d.isActive).map(d => d.patientId));
}

export async function getPrimaryPolicy(patientId: string): Promise<InsurancePolicyDoc | null> {
  const policies = await getPatientInsurancePolicies(patientId);
  return policies.find(p => p.isPrimary) || policies[0] || null;
}

export async function updateInsurancePolicy(id: string, updates: Partial<InsurancePolicyDoc>): Promise<InsurancePolicyDoc | null> {
  const db = insurancePoliciesDB();
  try {
    const doc = await db.get(id) as InsurancePolicyDoc;
    Object.assign(doc, updates, { updatedAt: new Date().toISOString() });
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'insurance_policy',
      resourceId: doc._id,
      operation: 'update',
      resourceVersion: doc._rev,
      orgId: doc.orgId,
      hospitalId: doc.facilityId,
    });
    return doc;
  } catch { return null; }
}

export async function deactivateInsurancePolicy(id: string): Promise<boolean> {
  const db = insurancePoliciesDB();
  try {
    const doc = await db.get(id) as InsurancePolicyDoc;
    doc.isActive = false;
    doc.updatedAt = new Date().toISOString();
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'insurance_policy',
      resourceId: doc._id,
      operation: 'update',
      resourceVersion: doc._rev,
      orgId: doc.orgId,
      hospitalId: doc.facilityId,
    });
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════
// ELIGIBILITY VERIFICATION
// ═══════════════════════════════════════════════════════════════════

export interface CheckEligibilityInput {
  policyId: string;
  patientId: string;
  source?: EligibilitySource;
  checkedBy: string;
  facilityId: string;
  orgId?: string;
}

export async function checkEligibility(input: CheckEligibilityInput): Promise<EligibilityCheckDoc> {
  const db = eligibilityChecksDB();
  const now = new Date().toISOString();

  // Get the policy to pull payer details
  const policy = await getPrimaryPolicy(input.patientId);

  // This is NOT an external payer verification — we have no EDI 270/271 or
  // payer-API integration here. We're producing a LOCAL ESTIMATE off the
  // stored policy terms. Be honest about that: report `unverified` (the doc's
  // status union has no `estimated` value) and record the basis in
  // `rawResponse` so downstream consumers/auditors don't mistake this for a
  // confirmed payer response. Only when a real external source is explicitly
  // passed in (api/edi271/donor_list) do we treat it as verified.
  const isExternal = input.source === 'api' || input.source === 'edi271' || input.source === 'donor_list';
  const status: EligibilityStatus = isExternal ? 'verified' : 'unverified';
  const source: EligibilitySource = input.source || 'manual';

  const doc: EligibilityCheckDoc = {
    _id: `elig-${uuidv4().slice(0, 10)}`,
    type: 'eligibility_check',
    policyId: input.policyId,
    patientId: input.patientId,
    checkDate: now,
    status,
    deductibleRemaining: policy?.deductibleRemaining,
    copayAmount: policy?.copayAmount,
    coinsurancePct: policy?.coinsurancePct,
    oopUsed: policy?.oopUsed,
    oopMax: policy?.oopMax,
    source,
    rawResponse: isExternal
      ? undefined
      : JSON.stringify({ method: 'local_policy_estimate', note: 'Local estimate from stored policy terms; not confirmed with the payer.' }),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    checkedBy: input.checkedBy,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'eligibility_check',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function getLatestEligibility(patientId: string): Promise<EligibilityCheckDoc | null> {
  const db = eligibilityChecksDB();
  const checks = (await findByType<EligibilityCheckDoc>(db, 'eligibility_check', { patientId }, { indexFields: ['type', 'patientId'] }))
    .sort((a, b) => (b.checkDate || '').localeCompare(a.checkDate || ''));
  return checks[0] || null;
}

export function estimatePatientResponsibility(
  billedAmount: number,
  copay: number = 0,
  coinsurancePct: number = 0,
  deductibleRemaining: number = 0,
): number {
  // Patient pays deductible first, then coinsurance on the rest
  const afterDeductible = Math.max(0, billedAmount - deductibleRemaining);
  const deductiblePortion = Math.min(billedAmount, deductibleRemaining);
  const coinsurancePortion = afterDeductible * (coinsurancePct / 100);
  return Math.round((copay + deductiblePortion + coinsurancePortion) * 100) / 100;
}
