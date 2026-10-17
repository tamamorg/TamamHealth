/** Payment service split: insurance. Re-exported through ../payment-service. */
import { findByType } from '../db-query';
import type { InsurancePolicyDoc, PayerType, EligibilityCheckDoc, EligibilityStatus, EligibilitySource } from '../../db-types-payments';
import type { DataScope } from '../data-scope';
import { filterByScope, orgOnlyScope } from '../data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { emitSyncEvent } from '../sync-event-service';
import { jubaDate } from '../../time-juba';
import { insurancePolicyForPatient, requireInsuranceWriter } from '@/modules/insurance/services/insurance-workflow-service';
import { eligibilityChecksDB, insurancePoliciesDB } from './shared';

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
    const existing = await getPatientInsurancePolicies(input.patientId, orgOnlyScope(input.orgId));
    for (const p of existing) {
      if (p.isPrimary) {
        p.isPrimary = false;
        p.updatedAt = now;
        await db.put(p);
      }
    }
  }

  const doc: InsurancePolicyDoc = {
    _id: `ins-${uuidv4()}`,
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

export async function getPatientInsurancePolicies(patientId: string, scope: DataScope): Promise<InsurancePolicyDoc[]> {
  return readPatientInsurancePolicies(patientId, scope);
}

/**
 * UNSCOPED: patient-portal read. The portal authenticates a patient (not a staff
 * DataScope) who legitimately sees their own records across every org that
 * treated them. Caller must pass the verified portal token subject. Never use
 * for staff routes.
 */
export async function getPatientInsurancePoliciesUnscopedForPortal(patientId: string): Promise<InsurancePolicyDoc[]> {
  return readPatientInsurancePolicies(patientId, undefined);
}

export async function readPatientInsurancePolicies(patientId: string, scope: DataScope | undefined): Promise<InsurancePolicyDoc[]> {
  const db = insurancePoliciesDB();
  const rows = await findByType<InsurancePolicyDoc>(db, 'insurance_policy', { patientId }, { indexFields: ['type', 'patientId'] });
  return (scope ? filterByScope(rows, scope) : rows)
    .filter(d => d && d.isActive)
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
}

/** Patient ids holding at least one active insurance policy — one bulk query
 *  so list views can badge every row without a per-patient lookup. */
export async function getInsuredPatientIds(scope: DataScope): Promise<Set<string>> {
  const rows = await findByType<InsurancePolicyDoc>(insurancePoliciesDB(), 'insurance_policy');
  const visible = filterByScope(rows, scope);
  return new Set(visible.filter(d => d && d.isActive).map(d => d.patientId));
}

export async function getPrimaryPolicy(patientId: string, scope: DataScope): Promise<InsurancePolicyDoc | null> {
  const policies = await getPatientInsurancePolicies(patientId, scope);
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
  manualEvidence?: { reference: string; method: 'phone' | 'portal' | 'written'; decision: 'verified' | 'denied'; expiresAt: string };
}

export async function checkEligibility(input: CheckEligibilityInput, scope: DataScope): Promise<EligibilityCheckDoc> {
  requireInsuranceWriter(scope);
  const db = eligibilityChecksDB();
  const now = new Date().toISOString();

  // Get the policy to pull payer details
  const policy = await insurancePolicyForPatient(input.policyId, input.patientId, input.facilityId, input.orgId, scope);

  // This is NOT an external payer verification — we have no EDI 270/271 or
  // payer-API integration here. We're producing a LOCAL ESTIMATE off the
  // stored policy terms. Be honest about that: report `unverified` (the doc's
  // status union has no `estimated` value) and record the basis in
  // `rawResponse` so downstream consumers/auditors don't mistake this for a
  // confirmed payer response. A source label cannot establish verification;
  // manual decisions require recorded evidence and expiry.
  if (input.source && input.source !== 'manual') throw new Error('INSURANCE_CONNECTOR_NOT_CONFIGURED');
  const evidence = input.manualEvidence;
  if (evidence && (!evidence.reference?.trim() || evidence.reference.length > 160
    || !['phone', 'portal', 'written'].includes(evidence.method)
    || !['verified', 'denied'].includes(evidence.decision)
    || !Number.isFinite(Date.parse(evidence.expiresAt)) || Date.parse(evidence.expiresAt) <= Date.now())) {
    throw new Error('INSURANCE_INVALID_EVIDENCE');
  }
  const day = jubaDate();
  const active = policy.isActive && policy.effectiveDate <= day && (!policy.terminationDate || policy.terminationDate >= day);
  const status: EligibilityStatus = !active ? 'expired' : evidence?.decision || 'unverified';
  const source: EligibilitySource = 'manual';

  const doc: EligibilityCheckDoc = {
    _id: `elig-${uuidv4()}`,
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
    rawResponse: evidence ? undefined : JSON.stringify({ method: 'local_policy_estimate' }),
    expiresAt: evidence?.expiresAt || now,
    verificationReference: evidence?.reference.trim(),
    verificationMethod: evidence?.method,
    serviceDate: day,
    checkedBy: scope.userId,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('ELIGIBILITY_RECORDED', scope.userId, scope.userId, `Eligibility ${doc._id}: ${status}`);
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

export async function getLatestEligibility(patientId: string, scope: DataScope, policyId?: string): Promise<EligibilityCheckDoc | null> {
  const db = eligibilityChecksDB();
  const rows = await findByType<EligibilityCheckDoc>(db, 'eligibility_check', { patientId }, { indexFields: ['type', 'patientId'] });
  const checks = filterByScope(rows, scope).filter(row => !policyId || row.policyId === policyId)
    .sort((a, b) => (b.checkDate || '').localeCompare(a.checkDate || ''));
  const latest = checks[0];
  if (!latest) return null;
  const policy = await insurancePoliciesDB().get(latest.policyId).catch(() => null) as InsurancePolicyDoc | null;
  if (!policy || !filterByScope([policy], scope).length || policy.patientId !== patientId) return null;
  if (!policy.isActive || policy.effectiveDate > jubaDate() || (policy.terminationDate && policy.terminationDate < jubaDate())) return { ...latest, status: 'expired' };
  if (latest.status === 'verified' || latest.status === 'cached') {
    if (!latest.expiresAt || !Number.isFinite(Date.parse(latest.expiresAt)) || Date.parse(latest.expiresAt) <= Date.now()) return { ...latest, status: 'expired' };
    if (latest.source === 'manual' && !latest.verificationReference) return { ...latest, status: 'unverified' };
  }
  return latest;
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
